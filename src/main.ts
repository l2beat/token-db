import { queryClient } from './db/client.js'
import { migrateDatabase } from './db/migrate.js'
import { Logger } from '@l2beat/backend-tools'
import { networksRepository } from './db/repository/networks.js'
import { tokensRepository } from './db/repository/tokens.js'

import { buildTokenListSource } from './sources/tokenList.js'
import { tokenMetadataRepository } from './db/repository/token-metadata.js'

await migrateDatabase()

const logger = new Logger({ format: 'pretty', colors: true })

const inchTokenListSource = buildTokenListSource({
  url: 'https://tokens.1inch.eth.link/',
  tag: '1INCH',
  logger,
  repositories: {
    networks: networksRepository,
    tokens: tokensRepository,
    meta: tokenMetadataRepository,
  },
})

const pipeline = [inchTokenListSource]

for (const step of pipeline) {
  await step()
}

stop()

function stop() {
  queryClient.end()
}

process.on('SIGINT', () => stop)
