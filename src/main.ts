import { sql } from 'drizzle-orm'
import { db, queryClient } from './db/client.js'
import { migrateDatabase } from './db/migrate.js'
import { syncAxelarGateway } from './sources/axelar-gateway.js'
import { syncCoingecko } from './sources/coingecko.js'
import { Logger } from '@l2beat/backend-tools'

await migrateDatabase()

const pipeline = [syncCoingecko, syncAxelarGateway]

const logger = new Logger({})

for (const step of pipeline) {
  await step({ logger })
}

stop()

function stop() {
  queryClient.end()
}

process.on('SIGINT', () => stop)
