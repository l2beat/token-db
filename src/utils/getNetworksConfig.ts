import { Logger } from '@l2beat/backend-tools'
import { PrismaClient } from '../db/prisma.js'
import { PublicClient, createPublicClient, http } from 'viem'
import * as viemChains from 'viem/chains'
import { notUndefined } from './notUndefined.js'

type Dependencies = {
  logger: Logger
  db: PrismaClient
}

export type NetworkConfig = {
  chainId: number
  publicClient: PublicClient
  name: string
}

export async function getNetworksConfig({
  db,
  logger,
}: Dependencies): Promise<NetworkConfig[]> {
  logger = logger.for('NetworksConfig')

  const networks = await db.network.findMany({
    include: {
      rpcs: true,
    },
  })

  const chains = Object.values(viemChains) as viemChains.Chain[]

  return networks
    .filter((network) => network.rpcs[0]?.url)
    .map((network) => {
      const chain = chains.find((c) => c.id === network.chainId)
      if (!chain) {
        return
      }
      return {
        name: network.name,
        chainId: network.chainId,
        publicClient: createPublicClient({
          chain,
          transport: http(network.rpcs[0]?.url, {
            retryCount: 15,
            retryDelay: 1000,
          }),
          batch: {
            multicall: true,
          },
        }),
      }
    })
    .filter(notUndefined)
}
