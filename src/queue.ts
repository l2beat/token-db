import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js'
import { ExpressAdapter } from '@bull-board/express'
import { Logger } from '@l2beat/backend-tools'
import express from 'express'
import { createPrismaClient } from './db/prisma.js'
import { buildAxelarConfigSource } from './sources/axelar-config.js'
import { buildDeploymentSource } from './sources/deployment.js'
import { buildOrbitSource } from './sources/orbit.js'
import { buildTokenListSource } from './sources/tokenList.js'
import { buildWormholeSource } from './sources/wormhole.js'
import { getNetworksConfig, withExplorer } from './utils/getNetworksConfig.js'
import { buildSingleQueue } from './utils/queue/single-queue.js'
import { setupQueue } from './utils/queue/setup-queue.js'
import { fanOut } from './utils/queue/fanout.js'
import { Token } from '@prisma/client'
import { forward } from './utils/queue/forward.js'
import { wrapTokenQueue } from './utils/queue/wrap.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { buildAxelarGatewaySource } from './sources/axelar-gateway.js'
import { routed } from './utils/queue/routed.js'
import { connection } from './redis/redis.js'

type TokenPayload = { tokenId: Token['id'] }

const db = createPrismaClient()

const logger = new Logger({ format: 'pretty', colors: true })

const networksConfig = await getNetworksConfig({
  db,
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

// Routed per chain id
const deploymentProcessors = networksConfig
  .filter(withExplorer)
  .map((networkConfig) => {
    const processor = buildDeploymentSource({ logger, db, networkConfig })

    const bus = dependantQueue({
      name: `DeploymentProcessor:${networkConfig.name}`,
      processor: (job) => {
        return processor(job.data.tokenId)
      },
    })

    return {
      queue: bus.queue,
      processor,
      routingKey: networkConfig.chainId,
    }
  })

routed<TokenPayload, number>({
  connection,
  logger,
  extractRoutingKey: async (event) => {
    const token = await db.token.findFirstOrThrow({
      where: { id: event.tokenId },
      include: { network: true },
    })

    return token.network.chainId
  },
})(deploymentRoutingInbox, deploymentProcessors)

const tokenUpdateInbox = setupQueue<TokenPayload>({
  name: 'TokenUpdateInbox',
  connection,
})

forward({ connection, logger })(tokenUpdateInbox, deploymentRoutingInbox)

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
]

const refreshInbox = setupQueue({
  name: 'RefreshInbox',
  connection,
})

fanOut({ connection, logger })(
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

app.listen(3000, () => {
  console.log('Running on 3000...')
  console.log('For the UI, open http://localhost:3000/admin/queues')
})

// #endregion BullBoard
