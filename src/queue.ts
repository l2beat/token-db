import { Logger } from '@l2beat/backend-tools'
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
  queueName: 'DeploymentIngestQueue',
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
      name: `Deployment:${networkConfig.chainId}`,
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

const tokenUpdateQueue = wrapTokenQueue(tokenUpdateQueueRaw)

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
    name: 'Coingecko',
    source: coingeckoSource,
  },
])

refreshQueue.add('RefreshSignal', {})
