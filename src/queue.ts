import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js'
import { ExpressAdapter } from '@bull-board/express'
import { Logger } from '@l2beat/backend-tools'
import express from 'express'
import { Redis } from 'ioredis'
import { createPrismaClient } from './db/prisma.js'
import { env } from './env.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { buildDeploymentSource } from './sources/deployment.js'
import { buildTokenListSource } from './sources/tokenList.js'
import { getNetworksConfig, withExplorer } from './utils/getNetworksConfig.js'
import { buildFanOutQueue } from './utils/queue/fanout-queue.js'
import { buildRoutedQueue } from './utils/queue/routed-queue.js'
import { wrapTokenQueue } from './utils/queue/wrap.js'

const connection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
})

const db = createPrismaClient()

const logger = new Logger({ format: 'pretty', colors: true })

const networksConfig = await getNetworksConfig({
  db,
  logger,
})

const lists = [
  {
    tag: '1INCH',
    url: 'https://tokens.1inch.eth.link',
  },
  // {
  //   tag: 'AAVE',
  //   url: 'http://tokenlist.aave.eth.link',
  // },
  // {
  //   tag: 'MYCRYPTO',
  //   url: 'https://uniswap.mycryptoapi.com/',
  // },
  // {
  //   tag: 'SUPERCHAIN',
  //   url: 'https://static.optimism.io/optimism.tokenlist.json',
  // },
]

const tokenListSources = lists.map(({ tag, url }) => ({
  source: buildTokenListSource({
    tag,
    url,
    logger,
    db,
  }),
  name: `TokenList:${tag}`,
}))

const deploymentQueue = buildRoutedQueue<{ tokenId: string }, number>({
  connection,
  logger,
  queueName: 'DeploymentQueue',
  extractRoutingKey: async (event) => {
    const token = await db.token.findFirstOrThrow({
      where: { id: event.tokenId },
      include: { network: true },
    })

    return token.network.chainId
  },
})(
  networksConfig.filter(withExplorer).map((networkConfig) => {
    return {
      name: `DeploymentProcessor:${networkConfig.chainId}`,
      source: async (job) =>
        buildDeploymentSource({ logger, db, networkConfig })(job.data.tokenId),
      routingKey: networkConfig.chainId,
    }
  }),
)

const tokenUpdateQueueRaw = buildFanOutQueue<{ tokenId: string }>({
  connection,
  logger,
  queueName: 'TokenUpdateQueue',
})([
  {
    name: 'DeploymentRoutingQueue',
    source: async (job) => {
      await deploymentQueue.queue.add(job.name, job.data)
    },
  },
])

const tokenUpdateQueue = wrapTokenQueue(tokenUpdateQueueRaw.queue)

const coingeckoSource = buildCoingeckoSource({
  logger,
  db,
  queue: tokenUpdateQueue,
})

const refreshQueue = buildFanOutQueue({
  connection,
  logger,
  queueName: 'RefreshQueue',
})([
  {
    name: 'CoingeckoProcessor',
    source: coingeckoSource,
  },
  // ...tokenListSources,
])

refreshQueue.queue.add('RefreshSignal', {})

const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/admin/queues')

const allqueues = [
  refreshQueue.queue,
  refreshQueue.processorBus.map((q) => q.queue),
  tokenUpdateQueueRaw.queue,
  tokenUpdateQueueRaw.processorBus.map((q) => q.queue),
  deploymentQueue.queue,
  deploymentQueue.routedBuses.map((q) => q.queue),
].flat()

createBullBoard({
  queues: allqueues.map((q) => new BullMQAdapter(q)),
  serverAdapter: serverAdapter,
})

const app = express()

app.use('/admin/queues', serverAdapter.getRouter())

// other configurations of your server

app.listen(3000, () => {
  console.log('Running on 3000...')
  console.log('For the UI, open http://localhost:3000/admin/queues')
  console.log('Make sure Redis is running on port 6379 by default')
})
