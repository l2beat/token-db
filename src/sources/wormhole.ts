import Papa from 'papaparse'
import { getAddress } from 'viem'
import { z } from 'zod'

import { env } from '../env.js'
import { SourceContext } from './source.js'
import { nanoid } from 'nanoid'
import { assert } from '@l2beat/backend-tools'

export function buildWormholeSource({ logger, db }: SourceContext) {
  logger = logger.for('WormholeSource')
  return async () => {
    const networks = await db.network
      .findMany({
        include: {
          rpcs: true,
        },
        where: {
          wormholeId: {
            not: null,
          },
        },
      })
      .then((result) =>
        result.map((r) => {
          const { wormholeId } = r
          assert(wormholeId, 'Expected wormholeId')
          return {
            ...r,
            wormholeId,
          }
        }),
      )

    logger.info('Upserting bridge info')

    const { id: bridgeId } = await db.bridge.upsert({
      select: { id: true },
      where: {
        name: 'Wormhole',
      },
      create: {
        id: nanoid(),
        name: 'Wormhole',
      },
      update: {},
    })

    const res = await fetch(env.WORMHOLE_LIST_URL)

    const data = await res.text()
    const rawParsed = Papa.parse(data, {
      header: true,
      skipEmptyLines: true,
    }).data
    const parsed = z.array(WormholeToken).parse(rawParsed)
    const normalized = parsed.map((token) => {
      const entry = {
        chain: token.source,
        symbol: token.symbol,
        name: token.name,
        address: token.sourceAddress,
        coingeckoId: token.coingeckoId,
        logo: token.logo,
        chains: [] as { chain: string; address: string }[],
      }
      for (const [key, value] of Object.entries(token)) {
        if (key.endsWith('Address') && key !== 'sourceAddress' && value) {
          const address = z
            .string()
            .transform((arg) => getAddress(arg))
            .parse(value)
          entry.chains.push({
            chain: key.slice(0, -'Address'.length),
            address,
          })
        }
      }
      return entry
    })

    for (const token of normalized) {
      const sourceChain = networks.find(
        (chain) => chain.wormholeId && chain.wormholeId === token.chain,
      )

      if (!sourceChain) {
        logger.debug('Source network not found, skipping token', {
          sourceNetwork: token.chain,
          token: token.address,
        })
        continue
      }

      const { id: sourceTokenId } = await db.token.upsert({
        select: { id: true },
        where: {
          networkId_address: {
            networkId: sourceChain.id,
            address: getAddress(token.address),
          },
        },
        create: {
          id: nanoid(),
          networkId: sourceChain.id,
          address: getAddress(token.address),
        },
        update: {},
      })

      await db.tokenMeta.upsert({
        where: {
          tokenId_source: {
            tokenId: sourceTokenId,
            source: 'wormhole',
          },
        },
        create: {
          id: nanoid(),
          tokenId: sourceTokenId,
          source: 'wormhole',
          externalId: token.address,
          symbol: token.symbol,
          name: token.name,
          logoUrl: token.logo,
        },
        update: {
          externalId: token.address,
          symbol: token.symbol,
          name: token.name,
          logoUrl: token.logo,
        },
      })

      for (const wrapped of token.chains) {
        const destinationChain = networks.find(
          (chain) => chain.wormholeId && chain.wormholeId === wrapped.chain,
        )
        if (destinationChain) {
          const { id: targetTokenId } = await db.token.upsert({
            select: { id: true },
            where: {
              networkId_address: {
                networkId: destinationChain.id,
                address: getAddress(wrapped.address),
              },
            },
            create: {
              id: nanoid(),
              networkId: destinationChain.id,
              address: getAddress(wrapped.address),
            },
            update: {},
          })

          await db.tokenMeta.upsert({
            where: {
              tokenId_source: {
                tokenId: targetTokenId,
                source: 'wormhole',
              },
            },
            create: {
              id: nanoid(),
              tokenId: targetTokenId,
              source: 'wormhole',
              externalId: token.address,
              symbol: token.symbol,
              name: token.name,
              logoUrl: token.logo,
            },
            update: {
              externalId: token.address,
              symbol: token.symbol,
              name: token.name,
              logoUrl: token.logo,
            },
          })

          await db.tokenBridge.upsert({
            where: {
              bridgeId_targetTokenId: {
                bridgeId,
                targetTokenId,
              },
            },
            create: {
              id: nanoid(),
              sourceTokenId,
              targetTokenId,
              bridgeId,
            },
            update: {},
          })
        }
      }
    }
  }
}

const WormholeToken = z
  .object({
    source: z.string(),
    symbol: z.string(),
    name: z.string(),
    sourceAddress: z.string(),
    sourceDecimals: z.string(),
    coingeckoId: z.string(),
    logo: z.string(),
  })
  .passthrough()
