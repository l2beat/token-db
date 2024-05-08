import { Logger, assert } from '@l2beat/backend-tools'
import { z } from 'zod'

import { zodFetch } from '../utils/zod-fetch.js'
import { nanoid } from 'nanoid'
import { PrismaClient } from '../db/prisma.js'

export { buildCoingeckoSource }

type Dependencies = {
  logger: Logger
  db: PrismaClient
}

function buildCoingeckoSource({ db, logger }: Dependencies) {
  logger = logger.for('CoinGecko')

  return async function () {
    const res = await zodFetch(
      'https://api.coingecko.com/api/v3/coins/list?include_platform=true',
      coingeckoResponseSchema,
    )

    const networks = await db.network
      .findMany({
        where: {
          coingeckoId: {
            not: null,
          },
        },
      })
      .then((result) =>
        result.map((r) => {
          const { coingeckoId } = r
          assert(coingeckoId, 'Expected coingeckoId')
          return {
            ...r,
            coingeckoId: coingeckoId,
          }
        }),
      )

    const tokens = res
      .map((token) => ({
        ...token,
        platforms: Object.entries(token.platforms ?? {}).flatMap(
          ([platform, address]) => {
            const network = networks.find(
              (network) => network.coingeckoId === platform,
            )

            if (!network) {
              return []
            }

            return { platform, address, network }
          },
        ),
      }))
      .flatMap((token) =>
        token.platforms
          .filter((platform) => platform.address.length > 0)
          .map((platform) => ({
            token: {
              networkId: platform.network.id,
              address: platform.address,
              network: platform.network,
            },
            tokenMeta: {
              externalId: token.id,
              symbol: token.symbol,
              name: token.name,
              // Code-level constraint?
              source: 'COINGECKO',
            },
          })),
      )

    await db.token.upsertMany({
      data: tokens.map(({ token }) => ({
        id: nanoid(),
        networkId: token.networkId,
        address: token.address,
      })),
      conflictPaths: ['networkId', 'address'],
    })

    const tokenIds = await db.token.findMany({
      select: { id: true, networkId: true, address: true },
      where: {
        OR: tokens.map(({ token }) => ({
          AND: {
            networkId: token.networkId,
            address: token.address,
          },
        })),
      },
    })

    const data = tokens.map(({ token, tokenMeta }) => {
      const tokenId = tokenIds.find(
        (t) => t.networkId === token.networkId && t.address === token.address,
      )?.id

      assert(tokenId, 'Expected tokenId')

      return {
        id: nanoid(),
        tokenId: tokenId,
        ...tokenMeta,
      }
    })

    await db.tokenMeta.upsertMany({
      data,
      conflictPaths: ['tokenId', 'source'],
    })

    logger.info(`Synced ${tokens.length} tokens from Coingecko`)
  }
}

const coingeckoResponseSchema = z.array(
  z.object({
    id: z.string(),
    symbol: z.string(),
    name: z.string(),
    platforms: z.record(z.string()).optional(),
  }),
)
