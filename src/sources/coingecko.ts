import { Logger, assert } from '@l2beat/backend-tools'
import { z } from 'zod'
import { InferInsertModel } from 'drizzle-orm'

import { zodFetch } from '../utils/zod-fetch.js'
import { tokenMetadatasTable, tokensTable } from '../db/schema.js'
import { networksRepository } from '../db/repository/networks.js'
import { tokensRepository } from '../db/repository/tokens.js'
import { tokenMetadataRepository } from '../db/repository/token-metadata.js'
import { Source } from './source.js'

export const syncCoingecko: Source = async ({ logger }) => {
  logger = logger.for('syncCoingecko')

  const res = await zodFetch(
    'https://api.coingecko.com/api/v3/coins/list?include_platform=true',
    coingeckoResponseSchema,
  )

  const networks = await networksRepository.findCoingeckoNetworks()

  const tokens: {
    token: Omit<InferInsertModel<typeof tokensTable>, 'id'>
    tokenMeta: Omit<
      InferInsertModel<typeof tokenMetadatasTable>,
      'id' | 'tokenId'
    >
  }[] = res
    .map((token) => ({
      ...token,
      platforms: Object.entries(token.platforms ?? {})
        .map(([platform, address]) => ({
          platform,
          address,
          network: networks.find((network) => network.coingeckoId === platform),
        }))
        .filter(
          (
            entry,
          ): entry is typeof entry & { network: (typeof networks)[number] } =>
            !!entry.network,
        ),
    }))
    .flatMap((token) =>
      token.platforms
        .filter((platform) => platform.address.length > 0)
        .map((platform) => ({
          token: {
            networkId: platform.network.id,
            address: platform.address,
          },
          tokenMeta: {
            externalId: token.id,
            symbol: token.symbol,
            name: token.name,
            source: 'coingecko',
          },
        })),
    )

  if (tokens.length > 0) {
    const upsertedTokens = await tokensRepository.upsertAndFindMany(
      tokens.map(({ token }) => token),
    )

    await tokenMetadataRepository.upsertMany(
      tokens.map(({ token, tokenMeta }) => {
        const upsertedToken = upsertedTokens.find(
          (upsertedToken) =>
            upsertedToken.address === token.address &&
            upsertedToken.networkId === token.networkId,
        )
        assert(upsertedToken, 'Expected token to be upserted')
        return { ...tokenMeta, tokenId: upsertedToken.id }
      }),
    )
  }

  logger.info(`Synced ${tokens.length} tokens from Coingecko`)
}

const coingeckoResponseSchema = z.array(
  z.object({
    id: z.string(),
    symbol: z.string(),
    name: z.string(),
    platforms: z.record(z.string()).optional(),
  }),
)
