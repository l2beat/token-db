import { assert } from '@l2beat/backend-tools'
import { getAddress } from 'viem'
import { z } from 'zod'

import { Source, SourceContext } from './source.js'
import { zodFetch } from '../utils/zod-fetch.js'
import { env } from '../env.js'
import { nanoid } from 'nanoid'

export function buildAxelarConfigSource({ logger, db }: SourceContext) {
  return async () => {
    logger = logger.for('AxelarConfigSource')

    const configUrl = env.AXELAR_CONFIG_URL

    if (!configUrl) {
      logger.warn('Axelar config URL not set, skipping source')
      return
    }

    logger.info('Fetching Axelar config')

    const parsed = await zodFetch(configUrl, configResponseSchema)

    logger.info('Upserting bridge info')

    const { id: bridgeId } = await db.bridge.upsert({
      select: { id: true },
      where: {
        name: 'Axelar',
      },
      create: {
        id: nanoid(),
        name: 'Axelar',
      },
      update: {},
    })

    const networks = await db.network
      .findMany({
        include: {
          rpcs: true,
        },
        where: {
          axelarGatewayAddress: {
            not: null,
          },
        },
      })
      .then((result) =>
        result.map((r) => {
          const { axelarGatewayAddress } = r
          assert(axelarGatewayAddress, 'Expected axelarGatewayAddress')
          return {
            ...r,
            axelarGatewayAddress,
          }
        }),
      )

    for (const definition of Object.values(parsed)) {
      // Find the native chain aliast in the defintion
      const sourceToken = definition.chain_aliases[definition.native_chain]

      if (!sourceToken) {
        logger.debug('Native chain alias not found, skipping token', {
          sourceNetwork: definition.native_chain,
          token: definition.id,
        })
        continue
      }

      logger.debug('Processing token', {
        sourceNetwork: definition.native_chain,
        token: definition.id,
      })

      const bridgedTokens = Object.entries(definition.chain_aliases).filter(
        ([chain]) => chain !== definition.native_chain,
      )

      // Find the source network in the DB query result
      const sourceNetwork = networks.find(
        (n) => n.axelarId && n.axelarId === definition.native_chain,
      )

      if (!sourceNetwork) {
        logger.debug('Source network not found, skipping token', {
          sourceNetwork: definition.native_chain,
          token: definition.id,
        })
        continue
      }

      // Upsert bridge escrow (once per network)
      // TODO: move it higher to avoid multiple upserts
      await db.bridgeEscrow.upsert({
        select: { id: true },
        where: {
          networkId_address: {
            networkId: sourceNetwork.id,
            address: sourceToken.tokenAddress,
          },
        },
        create: {
          id: nanoid(),
          bridgeId,
          networkId: sourceNetwork.id,
          address: sourceToken.tokenAddress,
        },
        update: {},
      })

      // Upsert the source token and its metadata
      const { id: sourceTokenId } = await db.token.upsert({
        select: { id: true },
        where: {
          networkId_address: {
            networkId: sourceNetwork.id,
            address: sourceToken.tokenAddress,
          },
        },
        create: {
          id: nanoid(),
          networkId: sourceNetwork.id,
          address: sourceToken.tokenAddress,
        },
        update: {},
      })

      await db.tokenMeta.upsert({
        where: {
          tokenId_source: {
            tokenId: sourceTokenId,
            source: 'axelar-config',
          },
        },
        create: {
          id: nanoid(),
          tokenId: sourceTokenId,
          source: 'axelar-config',
          externalId: sourceToken.fullDenomPath,
          symbol: sourceToken.assetSymbol,
          name: sourceToken.assetName,
        },
        update: {
          externalId: sourceToken.fullDenomPath,
          symbol: sourceToken.assetSymbol,
          name: sourceToken.assetName,
        },
      })

      // Next, process the bridged tokens
      for (const [chain, token] of bridgedTokens) {
        const network = networks.find((n) => n.axelarId && n.axelarId === chain)

        if (!network) {
          logger.debug('Target network not found, skipping token', {
            sourceNetwork: definition.native_chain,
            targetNetwork: chain,
            token: definition.id,
          })
          continue
        }

        const networkId = network.id
        const address = token.tokenAddress

        // Upsert the target token and its metadata
        const { id: targetTokenId } = await db.token.upsert({
          select: { id: true },
          where: {
            networkId_address: {
              networkId,
              address,
            },
          },
          create: {
            id: nanoid(),
            networkId,
            address,
          },
          update: {},
        })

        await db.tokenMeta.upsert({
          where: {
            tokenId_source: {
              tokenId: targetTokenId,
              source: 'axelar-config',
            },
          },
          create: {
            id: nanoid(),
            tokenId: targetTokenId,
            source: 'axelar-config',
            externalId: token.fullDenomPath,
            symbol: token.assetSymbol,
            name: token.assetName,
          },
          update: {
            externalId: token.fullDenomPath,
            symbol: token.assetSymbol,
            name: token.assetName,
          },
        })

        // Upsert the bridge entry
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
    logger.info('Finished processing')
  }
}

const tokenChainConfigSchema = z.object({
  assetSymbol: z.string(),
  assetName: z.string(),
  minDepositAmt: z.number(),
  ibcDenom: z.string(),
  fullDenomPath: z.string(),
  tokenAddress: z.string(),
  mintLimit: z.number(),
})

const tokenDefinitionSchema = z.object({
  id: z.string(),
  common_key: z.object({
    devnet: z.string(),
    testnet: z.string(),
    mainnet: z.string(),
  }),
  native_chain: z.string(),
  fully_supported: z.boolean(),
  decimals: z.number(),
  wrapped_erc20: z.string(),
  is_gas_token: z.boolean(),
  gas_token_id: z.string(),
  chain_aliases: z.record(tokenChainConfigSchema),
})

const configResponseSchema = z.record(tokenDefinitionSchema)
