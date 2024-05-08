import { Logger, assert } from '@l2beat/backend-tools'
import { z } from 'zod'

import { zodFetch } from '../utils/zod-fetch.js'
import { Network, NetworksRepository } from '../db/repository/networks.js'
import { Token, TokensRepository } from '../db/repository/tokens.js'
import {
  TokenMetadata,
  TokenMetadataRepository,
} from '../db/repository/token-metadata.js'

export { buildCoingeckoSource }

type Dependencies = {
  logger: Logger
  repositories: {
    networks: NetworksRepository
    tokens: TokensRepository
    meta: TokenMetadataRepository
  }
}

function buildCoingeckoSource($: Dependencies) {
  const logger = $.logger.for('CoinGecko')

  return async function () {
    const res = await zodFetch(
      'https://api.coingecko.com/api/v3/coins/list?include_platform=true',
      coingeckoResponseSchema,
    )

    const networks = await $.repositories.networks.findCoingeckoNetworks()

    const tokens: {
      token: Omit<Token, 'id'>
      tokenMeta: Omit<TokenMetadata, 'id' | 'tokenId'>
    }[] = res
      .map((token) => ({
        ...token,
        platforms: Object.entries(token.platforms ?? {})
          .map(([platform, address]) => ({
            platform,
            address,
            network: networks.find(
              (network) => network.coingeckoId === platform,
            ),
          }))
          .filter(
            (entry): entry is typeof entry & { network: Network } =>
              !!entry.network,
          ),
      }))
      .flatMap((token) =>
        token.platforms
          .filter((platform) => platform.address.length > 0)
          .map((platform) => ({
            token: {
              networkId: platform.network.id,
              address: platform.address.toUpperCase(),
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

    if (tokens.length > 0) {
      const upsertedTokens = await $.repositories.tokens.upsertAndFindMany(
        tokens.map(({ token }) => token),
      )

      await $.repositories.meta.upsertMany(
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
}

const coingeckoResponseSchema = z.array(
  z.object({
    id: z.string(),
    symbol: z.string(),
    name: z.string(),
    platforms: z.record(z.string()).optional(),
  }),
)
