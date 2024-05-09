import { zodFetch } from '../utils/zod-fetch.js'
import { z } from 'zod'
import { env } from '../env.js'
import { PrismaClient, Prisma } from '@prisma/client'
import { nanoid } from 'nanoid'
import * as viemChains from 'viem/chains'
import { notUndefined } from '../utils/notUndefined.js'

const networksResponseSchema = z.array(
  z.object({
    id: z.string(),
    chain_identifier: z.number().nullable(),
    name: z.string(),
  }),
)

async function seed() {
  const coingeckoKey = env.COINGECKO_KEY

  if (!coingeckoKey) {
    throw new Error('COINGECKO_KEY is not set')
  }

  const networks = await zodFetch(
    `https://pro-api.coingecko.com/api/v3/asset_platforms?x_cg_pro_api_key=${env.COINGECKO_KEY}`,
    networksResponseSchema,
  )

  await db.network.createMany({
    data: networks
      .filter((n) => n.chain_identifier !== null)
      .map((network) => ({
        id: nanoid(),
        coingeckoId: network.id,
        name: network.name,
        chainId: network.chain_identifier!,
      })),
  })

  const allNetworks = await db.network.findMany()
  const chains = Object.values(viemChains) as viemChains.Chain[]

  await db.networkRpc.createMany({
    data: allNetworks
      .map((network) => {
        let rpcUrl: string | undefined =
          process.env[
            network.name.toUpperCase().split(' ').join('_') + '_RPC_URL'
          ]
        if (!rpcUrl) {
          const chain = chains.find((c) => c.id === network.chainId)
          rpcUrl = chain?.rpcUrls.default.http[0]
          if (!rpcUrl) {
            return undefined
          }
        }
        return {
          id: nanoid(),
          networkId: network.id,
          url: rpcUrl,
        }
      })
      .filter(notUndefined),
  })

  console.log(`Database seeded with ${networks.length} networks ✅`)
}

async function resetDb() {
  const dbUrl = new URL(env.DATABASE_URL)
  if (!dbUrl.host.includes('local')) {
    throw new Error('Cannot truncate other database than local')
  }

  const queries = Object.values(Prisma.ModelName).map(
    (tableName) => `TRUNCATE TABLE "${tableName}" CASCADE;`,
  )

  await db.$transaction(queries.map((query) => db.$executeRawUnsafe(query)))

  console.log('Database emptied ✅')
}

const db = new PrismaClient()

await resetDb()
await seed()
db.$disconnect()
