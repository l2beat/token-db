import { zodFetch } from '../utils/zod-fetch.js'
import { z } from 'zod'
import { env } from '../env.js'
import { Prisma } from '@prisma/client'
import { nanoid } from 'nanoid'
import { createPrismaClient } from './prisma.js'

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

  await db.network.upsertMany({
    data: networks
      .filter((n) => n.chain_identifier !== null)
      .map((network) => ({
        id: nanoid(),
        coingeckoId: network.id,
        name: network.name,
        chainId: network.chain_identifier!,
      })),
    conflictPaths: ['coingeckoId'],
  })

  const axelarConsts = {
    ethereum: {
      axelarGatewayAddress: '0x4F4495243837681061C4743b74B3eEdf548D56A5',
      axelarId: 'ethereum',
    },
    'arbitrum-one': {
      axelarGatewayAddress: '0xe432150cce91c13a887f7D836923d5597adD8E31',
      axelarId: 'arbitrum',
    },
    'optimistic-ethereum': {
      axelarId: 'optimism',
      axelarGatewayAddress: '0xe432150cce91c13a887f7D836923d5597adD8E31',
    },
    avalanche: {
      axelarId: 'avalanche',
      axelarGatewayAddress: '0x5029C0EFf6C34351a0CEc334542cDb22c7928f78',
    },
    base: {
      axelarId: 'base',
      axelarGatewayAddress: '0xe432150cce91c13a887f7D836923d5597adD8E31',
    },
    'polygon-pos': {
      axelarId: 'polygon',
      axelarGatewayAddress: '0x6f015F16De9fC8791b234eF68D486d2bF203FBA8',
    },
    celo: {
      axelarId: 'celo',
      axelarGatewayAddress: '0xe432150cce91c13a887f7D836923d5597adD8E31',
    },
    linea: {
      axelarId: 'linea',
      axelarGatewayAddress: '0xe432150cce91c13a887f7D836923d5597adD8E31',
    },
  } as const

  await db.$transaction(
    Object.entries(axelarConsts).map(([coingeckoId, consts]) =>
      db.network.update({
        where: {
          coingeckoId,
        },
        data: {
          ...consts,
        },
      }),
    ),
  )

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

const db = createPrismaClient()

await resetDb()
await seed()
db.$disconnect()
