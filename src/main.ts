import { PrismaClient } from '@prisma/client'
import { Logger } from '@l2beat/backend-tools'
import { networksRepository } from './db/repository/networks.js'
import { tokensRepository } from './db/repository/tokens.js'
import { tokenMetadataRepository } from './db/repository/token-metadata.js'

import { buildTokenListSource } from './sources/tokenList.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { buildAxelarGatewaySource } from './sources/axelar-gateway.js'

const prisma = new PrismaClient()

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
  // Breaks do-update-set double-insert ;(((
  // {
  //   tag: 'SUPERCHAIN',
  //   url: 'https://static.optimism.io/optimism.tokenlist.json',
  // },
]

const tokenListSources = lists.map(({ tag, url }) =>
  buildTokenListSource({
    tag,
    url,
    logger,
    repositories: {
      networks: networksRepository,
      tokens: tokensRepository,
      meta: tokenMetadataRepository,
    },
  }),
)

const coingeckoSource = buildCoingeckoSource({
  logger,
  repositories: {
    networks: networksRepository,
    tokens: tokensRepository,
    meta: tokenMetadataRepository,
  },
})

const axelarGatewaySource = buildAxelarGatewaySource({
  logger,
  db: db,
  repositories: {
    tokens: tokensRepository,
    meta: tokenMetadataRepository,
  },
})

const pipeline = [coingeckoSource]

for (const step of pipeline) {
  await step()
}

await stop()

async function stop() {
  await prisma.$disconnect()
}

process.on('SIGINT', () => stop)
