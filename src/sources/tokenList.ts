import { Logger, assert } from '@l2beat/backend-tools'
import { Source } from './source.js'
import { zodFetch } from '../utils/zod-fetch.js'
import { z } from 'zod'
import { NetworksRepository } from '../db/repository/networks.js'
import { Token, TokensRepository } from '../db/repository/tokens.js'
import {
  TokenMetadata,
  TokenMetadataRepository,
} from '../db/repository/tokenMetadata.js'
import { nanoid } from 'nanoid'

type Dependencies = {
  url: string
  tag: string
  logger: Logger
  repositories: {
    networks: NetworksRepository
    tokens: TokensRepository
    meta: TokenMetadataRepository
  }
}

export function buildTokenListSource($: Dependencies) {
  const logger = $.logger.for('TokenListSource').tag(`${$.tag}`)

  return async function () {
    const result = await zodFetch($.url, TokenList)

    logger.info('Token list fetched', { count: result.tokens.length })

    const networks = await $.repositories.networks.findAll()

    const tokensToInsert = result.tokens.flatMap((token) => {
      const chain = networks.find((n) => n.chainId === token.chainId)

      if (!chain) {
        logger.error('Skipping token - chain not found', {
          chainId: token.chainId,
          token,
        })
        return []
      }

      const insertToken = {
        networkId: chain.id,
        address: token.address,
      }

      const meta = {
        symbol: token.symbol,
        decimals: token.decimals,
        name: token.name,
        source: `TOKEN_LIST_${$.tag}`,
        logoUrl: token.logoURI,
      }

      return { token: insertToken, meta }
    })

    if (tokensToInsert.length === 0) {
      logger.warn('No tokens to insert')
      return
    }

    logger.info('Inserting tokens', { count: tokensToInsert.length })

    const upsertResult = await $.repositories.tokens.upsertAndFindMany(
      tokensToInsert.map((t) => t.token),
    )

    const metadataToUpsert = tokensToInsert.map((tti) => {
      const upsertToken = upsertResult.find(
        (uToken) =>
          uToken.address === tti.token.address &&
          uToken.networkId === tti.token.networkId,
      )

      assert(upsertToken, 'Expected token to be upserted')

      return {
        ...tti.meta,
        tokenId: upsertToken.id,
      }
    })

    logger.info('Inserting metadata', { count: metadataToUpsert.length })

    await $.repositories.meta.upsertMany(metadataToUpsert)

    logger.info('Token list processed')
  }
}

const TokenInfo = z.strictObject({
  chainId: z.number(),
  address: z.string(),
  decimals: z.number(),
  name: z.string(),
  symbol: z.string(),
  logoURI: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extensions: z.record(z.unknown()).optional(),
})

const TokenList = z.strictObject({
  name: z.string(),
  timestamp: z.string(),
  version: z.strictObject({
    major: z.number(),
    minor: z.number(),
    patch: z.number(),
  }),
  tokens: z.array(TokenInfo),
  tokenMap: z.record(TokenInfo).optional(),
  keywords: z.array(z.string()).optional(),
  tags: z
    .record(
      z.strictObject({
        name: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  logoURI: z.string().optional(),
})
