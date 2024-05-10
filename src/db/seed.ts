import { Prisma } from '@prisma/client'
import intersectionWith from 'lodash/intersectionWith.js'
import { nanoid } from 'nanoid'
import {
  arbitrum,
  base,
  blast,
  linea,
  mainnet,
  manta,
  mantle,
  metis,
  mode,
  optimism,
  polygonZkEvm,
  scroll,
  zkSync,
  zora,
} from 'viem/chains'
import { z } from 'zod'
import { env } from '../env.js'
import { notUndefined } from '../utils/notUndefined.js'
import { zodFetch } from '../utils/zod-fetch.js'
import { createPrismaClient } from './prisma.js'

export const chainsConfig = [
  arbitrum,
  mainnet,
  optimism,
  base,
  blast,
  mantle,
  zkSync,
  manta,
  linea,
  mode,
  metis,
  scroll,
  polygonZkEvm,
  zora,
]

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

  const desiredNetworks = intersectionWith(
    networks,
    chainsConfig,
    ({ chain_identifier }, { id }) => id === chain_identifier,
  )

  await db.network.upsertMany({
    data: desiredNetworks
      .filter((n) => n.chain_identifier !== null)
      .map((network) => ({
        id: nanoid(),
        coingeckoId: network.id,
        name: network.name,
        chainId: network.chain_identifier!,
      })),
    conflictPaths: ['coingeckoId'],
  })

  const allNetworks = await db.network.findMany()

  await db.networkRpc.createMany({
    data: allNetworks
      .map((network) => {
        let rpcUrl: string | undefined =
          process.env[
            network.name.toUpperCase().split(' ').join('_') + '_RPC_URL'
          ]
        if (!rpcUrl) {
          const chain = chainsConfig.find((c) => c.id === network.chainId)
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
    base: {
      axelarId: 'base',
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

  console.log(`Database seeded with ${desiredNetworks.length} networks ✅`)
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
