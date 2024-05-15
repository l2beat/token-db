import { Logger } from '@l2beat/backend-tools'
import { Redis } from 'ioredis'
import { setTimeout } from 'timers/promises'
import { createPrismaClient } from './db/prisma.js'
import { env } from './env.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { buildTokenListSource } from './sources/tokenList.js'
import { buildFanOutQueue } from './utils/queue/fanout-queue.js'
import { wrapTokenQueue } from './utils/queue/wrap.js'

const connection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
})

const db = createPrismaClient()

const logger = new Logger({ format: 'pretty', colors: true })

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

const tokenUpdateQueueRaw = buildFanOutQueue({
  connection,
  logger,
  queueName: 'TokenUpdateQueue',
})([
  {
    name: 'dummy catcher',
    source: async () => {
      logger.info('Dummy catcher started')
      await setTimeout(10_000)
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
