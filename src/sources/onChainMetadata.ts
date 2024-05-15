import { Logger } from '@l2beat/backend-tools'

import { nanoid } from 'nanoid'
import { getContract, parseAbiItem } from 'viem'
import { PrismaClient } from '../db/prisma.js'
import { NetworkConfig } from '../utils/getNetworksConfig.js'
import { notUndefined } from '../utils/notUndefined.js'

export { buildOnChainMetadataSource }

const abi = [
  parseAbiItem('function name() view returns (string)'),
  parseAbiItem('function symbol() view returns (string)'),
  parseAbiItem('function decimals() view returns (uint)'),
]

type Dependencies = {
  logger: Logger
  db: PrismaClient
  networkConfig: NetworkConfig
}

function buildOnChainMetadataSource({
  db,
  logger,
  networkConfig,
}: Dependencies) {
  logger = logger.for('onChainMetadata').tag(networkConfig.name)

  return async function () {
    logger.info(`Syncing tokens metadata on ${networkConfig.name}...`)
    const tokens = await db.token.findMany({
      where: {
        network: {
          chainId: networkConfig.chainId,
        },
      },
    })

    const tokensWithMetadata = await Promise.all(
      tokens.map(async (token) => {
        const contract = getContract({
          address: token.address as `0x${string}`,
          abi,
          client: networkConfig.publicClient,
        })

        const [nameResult, symbolResult, decimalsResult] =
          await Promise.allSettled([
            contract.read.name(),
            contract.read.symbol(),
            contract.read.decimals(),
          ])

        const name =
          nameResult.status === 'fulfilled' ? nameResult.value : undefined
        const symbol =
          symbolResult.status === 'fulfilled' ? symbolResult.value : undefined
        const decimals =
          decimalsResult.status === 'fulfilled'
            ? Number(decimalsResult.value)
            : undefined

        if ((name && name.length > 256) || (symbol && symbol.length > 32)) {
          return
        }

        return {
          ...token,
          name,
          symbol,
          decimals,
        }
      }),
    )

    const addedTokensMetadata = await db.tokenMeta.upsertMany({
      data: tokensWithMetadata.filter(notUndefined).map((token) => ({
        id: nanoid(),
        tokenId: token.id,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        source: 'ONCHAIN',
      })),
      conflictPaths: ['tokenId', 'source'],
    })
    logger.info(
      `Synced ${addedTokensMetadata} tokens metadata on ${networkConfig.name}`,
    )
  }
}
