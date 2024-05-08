import { queryClient } from './db/client.js'
import { migrateDatabase } from './db/migrate.js'
import { Logger } from '@l2beat/backend-tools'
import { networksRepository } from './db/repository/networks.js'
import { tokensRepository } from './db/repository/tokens.js'

import { buildTokenListSource } from './sources/tokenList.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { tokenMetadataRepository } from './db/repository/token-metadata.js'
import { syncAxelarGateway } from './sources/axelar-gateway.js'

await migrateDatabase()

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

const pipeline = [syncAxelarGateway]

for (const step of pipeline) {
  await step({ logger })
}

stop()

function stop() {
  queryClient.end()
}

process.on('SIGINT', () => stop)
