import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js'
import { ExpressAdapter } from '@bull-board/express'
import { Logger } from '@l2beat/backend-tools'
import { Token } from '@prisma/client'
import express from 'express'
import { createPrismaClient } from './db/prisma.js'
import { connection } from './redis/redis.js'
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
import { setupCollector } from './utils/queue/aggregates/collector.js'
import { buildArbitrumCanonicalSource } from './sources/arbitrumCanonical.js'
import { buildOptimismCanonicalSource } from './sources/optimismCanonical.js'
import { buildAxelarConfigSource } from './sources/axelarConfig.js'
import { buildAxelarGatewaySource } from './sources/axelarGateway.js'
import { buildOnChainMetadataSource } from './sources/onChainMetadata.js'

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

// #region Deployment processors
// Routing inbox where TokenUpdate events are broadcasted from independent sources
const deploymentRoutingInbox = setupQueue<TokenPayload>({
  name: 'DeploymentRoutingInbox',
  connection,
})

// Output queue for the deployment processors where the tokenIds are broadcasted if the deployment is updated
const deploymentUpdatedInbox = setupQueue<TokenPayload>({
  name: 'DeploymentUpdatedInbox',
  connection,
})

const deploymentUpdatedQueue = wrapDeploymentUpdatedQueue(
  deploymentUpdatedInbox,
)

// For each supported network with an explorer, create a deployment processor
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

// Route the events from deploymentRoutingInbox to the per-chain deployment processors
router.routingKey(async (event) => {
  const token = await db.token.findFirstOrThrow({
    where: { id: event.tokenId },
    include: { network: true },
  })

  return token.network.chainId
})(deploymentRoutingInbox, deploymentProcessors)
// #endregion Deployment processors

// #region Canonical sources - Arbitrum
const arbitrumCanonicalProcessor = buildSingleQueue<{ tokenIds: string[] }>({
  connection,
  logger,
})({
  name: 'ArbitrumCanonicalProcessor',
  processor: buildArbitrumCanonicalSource({ logger, db, networksConfig }),
})

// Handle backpressure from the deployment processor
const arbitrumCanonicalEventCollector = setupQueue<TokenPayload>({
  name: 'ArbitrumCanonicalEventCollector',
  connection,
})
const oneMinuteMs = 60 * 1000

setupCollector({
  inputQueue: arbitrumCanonicalEventCollector,
  outputQueue: arbitrumCanonicalProcessor.queue,
  aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
  bufferSize: 100,
  flushIntervalMs: oneMinuteMs,
  connection,
  logger,
})
// #endregion Canonical sources - Arbitrum

// #region Canonical sources - Optimism
const optimismCanonicalProcessor = buildSingleQueue<{ tokenIds: string[] }>({
  connection,
  logger,
})({
  name: 'OptimismCanonicalProcessor',
  processor: buildOptimismCanonicalSource({ logger, db, networksConfig }),
})

// Handle backpressure from the deployment processor
const optimismCanonicalEventCollector = setupQueue<TokenPayload>({
  name: 'OptimismCanonicalEventCollector',
  connection,
})

setupCollector({
  inputQueue: optimismCanonicalEventCollector,
  outputQueue: optimismCanonicalProcessor.queue,
  aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
  bufferSize: 100,
  flushIntervalMs: oneMinuteMs,
  connection,
  logger,
})
// #endregion Canonical sources - Optimism

// #region Canonical sources update wire up
router.routingKey(async (event) => {
  const token = await db.token.findFirstOrThrow({
    where: { id: event.tokenId },
    include: { network: true },
  })

  return token.network.chainId
})(deploymentUpdatedInbox, [
  // Ditch the rest
  {
    queue: arbitrumCanonicalEventCollector,
    routingKey: 42161,
  },
  {
    queue: optimismCanonicalEventCollector,
    routingKey: 10,
  },
])
// #endregion Canonical sources update wire up

const tokenUpdateInbox = setupQueue<TokenPayload>({
  name: 'TokenUpdateInbox',
  connection,
})

const tokenUpdateQueue = wrapTokenQueue(tokenUpdateInbox)

// #region On-chain metadata sources
// Routing inbox where TokenUpdate events are broadcasted from independent sources
const onChainMetadataRoutingInbox = setupQueue<TokenPayload>({
  name: 'OnChainMetadataRoutingInbox',
  connection,
})

// For each network, create routing inbox and backpressure (collector) queue
// so we can batch process the events instead of calling node for each token
const onChainMetadataBuses = networksConfig
  .filter(withExplorer)
  .map((networkConfig) => {
    // Per-chain events will be collected here
    const eventCollectorInbox = setupQueue<TokenPayload>({
      name: `OnChainMetadataEventCollector:${networkConfig.name}`,
      connection,
    })

    // Batch processor for the collected events
    const batchEventProcessor = buildSingleQueue<{ tokenIds: string[] }>({
      connection,
      logger,
    })({
      name: `OnChainMetadataBatchProcessor:${networkConfig.name}`,
      processor: (job) =>
        buildOnChainMetadataSource({
          logger,
          db,
          networkConfig,
        })(job.data.tokenIds),
    })

    // Wire up the collector to the processor
    setupCollector({
      inputQueue: eventCollectorInbox,
      outputQueue: batchEventProcessor.queue,
      aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
      bufferSize: 100,
      flushIntervalMs: oneMinuteMs,
      connection,
      logger,
    })

    return {
      queue: eventCollectorInbox,
      batchQueue: batchEventProcessor.queue,
      routingKey: networkConfig.chainId,
    }
  })

// Route the events from the global inbox to the per-chain event collectors
router.routingKey(async (event) => {
  const token = await db.token.findFirstOrThrow({
    where: { id: event.tokenId },
    include: { network: true },
  })

  return token.network.chainId
})(
  onChainMetadataRoutingInbox,
  onChainMetadataBuses.map((bus) => ({
    queue: bus.queue,
    routingKey: bus.routingKey,
  })),
)
// #endregion On-chain metadata sources
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

// Input signal, might be removed
const refreshInbox = setupQueue({
  name: 'RefreshInbox',
  connection,
})

// Input signal, might be removed
router.broadcast(
  refreshInbox,
  independentSources.map((q) => q.queue),
)

// Broadcast the token update events to the independent sources to dependant sources
router.broadcast(tokenUpdateInbox, [
  deploymentRoutingInbox,
  onChainMetadataRoutingInbox,
])

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
  arbitrumCanonicalEventCollector,
  optimismCanonicalEventCollector,
  arbitrumCanonicalProcessor.queue,
  optimismCanonicalProcessor.queue,
  deploymentUpdatedInbox,
  onChainMetadataBuses.map((b) => b.queue),
  onChainMetadataBuses.map((b) => b.batchQueue),
  onChainMetadataRoutingInbox,
].flat()

createBullBoard({
  queues: allQueues.map((q) => new BullMQAdapter(q)),
  serverAdapter: serverAdapter,
})

const app = express()

app.use('/admin/queues', serverAdapter.getRouter())
app.get('/refresh', (_req, res) => {
  refreshInbox.add('RefreshSignal', {})
  res.status(201).send({ msg: 'Refresh signal sent' })
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
