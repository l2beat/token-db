import { sql } from 'drizzle-orm'
import { db, queryClient } from './client.js'
import { zodFetch } from '../utils/zod-fetch.js'
import { z } from 'zod'
import { networksRepository } from './repository/networks.js'
import { env } from '../env.js'

async function seed() {
  await resetDb()

  const coingeckoKey = env.COINGECKO_KEY

  if (!coingeckoKey) {
    throw new Error('COINGECKO_KEY is not set')
  }

  const networks = await zodFetch(
    `https://pro-api.coingecko.com/api/v3/asset_platforms?x_cg_pro_api_key=${env.COINGECKO_KEY}`,
    networksResponseSchema,
  )

  await networksRepository.upsertMany(
    networks
      .filter((n) => n.chain_identifier !== null)
      .map((network) => ({
        coingeckoId: network.id,
        name: network.name,
        chainId: network.chain_identifier,
      })),
  )

  stop()

  process.on('SIGINT', () => stop)
}

const networksResponseSchema = z.array(
  z.object({
    id: z.string(),
    chain_identifier: z.number().nullable(),
    name: z.string(),
  }),
)

function stop() {
  queryClient.end()
}

async function resetDb() {
  const tableSchema = db._.schema
  if (!tableSchema) {
    throw new Error('No table schema found')
  }

  const dbUrl = new URL(env.DATABASE_URL)
  if (!dbUrl.host.includes('local')) {
    throw new Error('Cannot truncate other database than local')
  }

  const queries = Object.values(tableSchema).map((table) => {
    return sql.raw(`TRUNCATE TABLE ${table.dbName} CASCADE;`)
  })

  await db.transaction(async (tx) => {
    await Promise.all(
      queries.map(async (query) => {
        if (query) await tx.execute(query)
      }),
    )
  })

  console.log('Database emptied ✅')
}

await seed()
