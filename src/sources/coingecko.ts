import { Logger, assert } from '@l2beat/backend-tools'
import { z } from 'zod'

import { zodFetch } from '../utils/zod-fetch.js'
import { PrismaClient } from '../db/prisma.js'
import { upsertManyTokensWithMeta } from '../db/helpers.js'

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
            networkId: platform.network.id,
            address: platform.address,
            externalId: token.id,
            symbol: token.symbol,
            name: token.name,
            // Code-level constraint?
            source: 'COINGECKO',
          })),
      )

    await upsertManyTokensWithMeta(db, tokens)

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
