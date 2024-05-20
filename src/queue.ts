import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js'
import { ExpressAdapter } from '@bull-board/express'
import { Logger } from '@l2beat/backend-tools'
import { Token } from '@prisma/client'
import express from 'express'
import { createPrismaClient } from './db/prisma.js'
import { connection } from './redis/redis.js'
import { buildAxelarConfigSource } from './sources/axelar-config.js'
import { buildAxelarGatewaySource } from './sources/axelar-gateway.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { buildDeploymentSource } from './sources/deployment.js'
import { buildOrbitSource } from './sources/orbit.js'
import { buildTokenListSource } from './sources/tokenList.js'
import { buildWormholeSource } from './sources/wormhole.js'
import { getNetworksConfig, withExplorer } from './utils/getNetworksConfig.js'
import { eventRouter } from './utils/queue/router/index.js'
import { setupQueue } from './utils/queue/setup-queue.js'
import { buildSingleQueue } from './utils/queue/single-queue.js'
import {
  wrapDeploymentUpdatedQueue,
  wrapTokenQueue,
} from './utils/queue/wrap.js'
import { buildArbitrumCanonicalSource } from './sources/arbitrum-canonical.js'
import { setupCollector } from './utils/queue/aggregates/collector.js'

type TokenPayload = { tokenId: Token['id'] }

const db = createPrismaClient()

const logger = new Logger({ format: 'pretty', colors: true })

const networksConfig = await getNetworksConfig({
  db,
  logger,
})

const router = eventRouter({
  connection,
  logger,
})

const sourceQueue = buildSingleQueue({ connection, logger })
const dependantQueue = buildSingleQueue<TokenPayload>({ connection, logger })

const lists = [
  {
    tag: '1INCH',
    url: 'https://tokens.1inch.eth.link',
  },
  {
    tag: 'AAVE',
    url: 'http://tokenlist.aave.eth.link',
  },
  {
    tag: 'MYCRYPTO',
    url: 'https://uniswap.mycryptoapi.com/',
  },
  {
    tag: 'SUPERCHAIN',
    url: 'https://static.optimism.io/optimism.tokenlist.json',
  },
]

const deploymentRoutingInbox = setupQueue<TokenPayload>({
  name: 'DeploymentRoutingInbox',
  connection,
})

const deploymentUpdatedInbox = setupQueue<TokenPayload>({
  name: 'DeploymentUpdatedInbox',
  connection,
})

const deploymentUpdatedQueue = wrapDeploymentUpdatedQueue(
  deploymentUpdatedInbox,
)

const arbitrumCanonicalBatchInbox = buildSingleQueue<{ tokenIds: string[] }>({
  connection,
  logger,
})({
  name: 'ArbitrumCanonicalProcessor',
  processor: buildArbitrumCanonicalSource({ logger, db, networksConfig }),
})

const arbitrumCanonicalAtomicInbox = setupQueue<TokenPayload>({
  name: 'ArbitrumCanonicalAtomicProcessor',
  connection,
})
const oneMinuteMs = 60 * 1000

setupCollector({
  inputQueue: arbitrumCanonicalAtomicInbox,
  outputQueue: arbitrumCanonicalBatchInbox.queue,
  aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
  bufferSize: 100,
  flushIntervalMs: oneMinuteMs,
  connection,
  logger,
})

router.routingKey(async (event) => {
  const token = await db.token.findFirstOrThrow({
    where: { id: event.tokenId },
    include: { network: true },
  })

  return token.network.chainId
})(deploymentUpdatedInbox, [
  // Ditch the rest
  {
    queue: arbitrumCanonicalAtomicInbox,
    routingKey: 42161,
  },
])

// Routed per chain id
const deploymentProcessors = networksConfig
  .filter(withExplorer)
  .map((networkConfig) => {
    const processor = buildDeploymentSource({
      logger,
      db,
      networkConfig,
      queue: deploymentUpdatedQueue,
    })

    const bus = dependantQueue({
      name: `DeploymentProcessor:${networkConfig.name}`,
      processor: (job) => {
        return processor(job.data.tokenId)
      },
    })

    return {
      queue: bus.queue,
      routingKey: networkConfig.chainId,
    }
  })

router.routingKey(async (event) => {
  const token = await db.token.findFirstOrThrow({
    where: { id: event.tokenId },
    include: { network: true },
  })

  return token.network.chainId
})(deploymentRoutingInbox, deploymentProcessors)

const tokenUpdateInbox = setupQueue<TokenPayload>({
  name: 'TokenUpdateInbox',
  connection,
})

const tokenUpdateQueue = wrapTokenQueue(tokenUpdateInbox)

// #region Independent sources

const coingeckoSource = buildCoingeckoSource({
  logger,
  db,
  queue: tokenUpdateQueue,
})
const axelarConfigSource = buildAxelarConfigSource({
  logger,
  db,
  queue: tokenUpdateQueue,
})
const wormholeSource = buildWormholeSource({
  logger,
  db,
  queue: tokenUpdateQueue,
})
const orbitSource = buildOrbitSource({ logger, db, queue: tokenUpdateQueue })
const tokenListSources = lists.map(({ tag, url }) =>
  sourceQueue({
    processor: buildTokenListSource({
      tag,
      url,
      logger,
      db,
      queue: tokenUpdateQueue,
    }),
    name: `TokenListProcessor:${tag}`,
  }),
)

// const lzV1Sources = networksConfig.filter(withExplorer).map((networkConfig) => {
//   return {
//     name: `LayerZeroV1Processor:${networkConfig.name}`,
//     processor: buildLayerZeroV1Source({
//       logger,
//       db,
//       networkConfig,
//       queue: tokenUpdateQueue,
//     }),
//   }
// })

// const lzV1Queues = lzV1Sources.map((source) => sourceQueue(source))

const axelarGatewayQueues = networksConfig.map((networkConfig) =>
  sourceQueue({
    name: `AxelarGatewayProcessor:${networkConfig.name}`,
    processor: buildAxelarGatewaySource({
      logger,
      db,
      networkConfig,
      queue: tokenUpdateQueue,
    }),
  }),
)

const coingeckoQueue = sourceQueue({
  name: 'CoingeckoProcessor',
  processor: coingeckoSource,
})

const axelarConfigQueue = sourceQueue({
  name: 'AxelarConfigProcessor',
  processor: axelarConfigSource,
})

const wormholeQueue = sourceQueue({
  name: 'WormholeProcessor',
  processor: wormholeSource,
})

const orbitQueue = sourceQueue({
  name: 'OrbitProcessor',
  processor: orbitSource,
})

const independentSources = [
  coingeckoQueue,
  ...axelarGatewayQueues,
  axelarConfigQueue,
  wormholeQueue,
  orbitQueue,
  ...tokenListSources,
  // ...lzV1Queues,
]

const refreshInbox = setupQueue({
  name: 'RefreshInbox',
  connection,
})

router.forward(tokenUpdateInbox, deploymentRoutingInbox)

router.broadcast(
  refreshInbox,
  independentSources.map((q) => q.queue),
)
// #endregion Independent sources

// #region BullBoard

const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/admin/queues')

const allQueues = [
  deploymentRoutingInbox,
  tokenUpdateInbox,
  refreshInbox,
  ...independentSources.map((q) => q.queue),
  deploymentProcessors.map((p) => p.queue),
  arbitrumCanonicalBatchInbox.queue,
  arbitrumCanonicalAtomicInbox,
  deploymentUpdatedInbox,
].flat()

createBullBoard({
  queues: allQueues.map((q) => new BullMQAdapter(q)),
  serverAdapter: serverAdapter,
})

const app = express()

app.use('/admin/queues', serverAdapter.getRouter())
app.get('/refresh', () => {
  refreshInbox.add('RefreshSignal', {})
})

app.get('/refresh/axelar-gateway', () => {
  axelarConfigQueue.queue.add('RefreshSignal', {})
})

app.get('/refresh/lists', () => {
  tokenListSources.forEach((q) => q.queue.add('RefreshSignal', {}))
})

app.listen(3000, () => {
  console.log('Running on 3000...')
  console.log('For the UI, open http://localhost:3000/admin/queues')
})

// #endregion BullBoard
