import { Logger } from '@l2beat/backend-tools'
import { Redis } from 'ioredis'
import { createPrismaClient } from './db/prisma.js'
import { env } from './env.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { buildTokenListSource } from './sources/tokenList.js'
import { buildBaseQueue } from './utils/queue/base-queue.js'

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

const coingeckoSource = buildCoingeckoSource({
  logger,
  db,
})

const refreshSignal = buildBaseQueue({ connection, logger })([
  {
    name: 'coingecko',
    source: coingeckoSource,
  },
  ...tokenListSources,
])

setTimeout(refreshSignal, 5_000)
