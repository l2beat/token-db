import { queryClient } from './db/client.js'
import { migrateDatabase } from './db/migrate.js'
import { syncCoingecko } from './sources/coingecko.js'
import { Logger } from '@l2beat/backend-tools'

await migrateDatabase()

const pipeline = [syncCoingecko]

const logger = new Logger({})

for (const step of pipeline) {
  await step({ logger })
}

stop()

function stop() {
  queryClient.end()
}

process.on('SIGINT', () => stop)
