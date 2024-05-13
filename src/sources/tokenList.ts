import { Logger } from '@l2beat/backend-tools'
import { zodFetch } from '../utils/zod-fetch.js'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { PrismaClient } from '../db/prisma.js'

export { buildTokenListSource }

type Dependencies = {
  url: string
  tag: string
  logger: Logger
  db: PrismaClient
}

function buildTokenListSource({ db, url, tag, logger }: Dependencies) {
  logger = logger.for('TokenListSource').tag(`${tag}`)

  return async function () {
    const result = await zodFetch(url, TokenList)

    logger.info('Token list fetched', { count: result.tokens.length })

    const networks = await db.network.findMany()

    const tokensToInsert = result.tokens.flatMap((token) => {
      const chain = networks.find((n) => n.chainId === token.chainId)

      if (!chain) {
        logger.debug('Skipping token - chain not found', {
          chainId: token.chainId,
          token,
        })
        return []
      }

      const insertToken = {
        networkId: chain.id,
        address: token.address.toUpperCase(),
      }

      const meta = {
        symbol: token.symbol,
        decimals: token.decimals,
        name: token.name,
        source: `TOKEN_LIST_${tag}`,
        logoUrl: token.logoURI,
      }

      return { token: insertToken, meta }
    })

    if (tokensToInsert.length === 0) {
      logger.warn('No tokens to insert')
      return
    }

    logger.info('Inserting tokens', { count: tokensToInsert.length })

    await db.token.upsertMany({
      data: tokensToInsert.map(({ token }) => ({
        id: nanoid(),
        ...token,
      })),
      conflictPaths: ['networkId', 'address'],
    })

    const tokenIds = await db.token.findMany({
      select: { id: true, networkId: true, address: true },
      where: {
        OR: tokensToInsert.map(({ token }) => ({
          networkId: token.networkId,
          address: token.address,
        })),
      },
    })

    await db.tokenMeta.upsertMany({
      data: tokensToInsert.map(({ token, meta }) => ({
        id: nanoid(),
        // biome-ignore lint/style/noNonNullAssertion: data must be there
        tokenId: tokenIds.find(
          (t) => t.networkId === token.networkId && t.address === token.address,
        )!.id,
        ...meta,
      })),
      conflictPaths: ['tokenId', 'source'],
    })

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
