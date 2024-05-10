import { createPublicClient, http, isAddress, parseAbiItem } from 'viem'
import { Logger, assert } from '@l2beat/backend-tools'
import { SetRequired } from 'type-fest'
import { nanoid } from 'nanoid'
import { PrismaClient } from '../db/prisma.js'

export { buildAxelarGatewaySource }

type Dependencies = {
  logger: Logger
  db: PrismaClient
}

function buildAxelarGatewaySource({ logger, db }: Dependencies) {
  logger = logger.for('AxelarGatewaySource')

  return async function () {
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
          assert(isAddress(axelarGatewayAddress), 'Expected address')
          return {
            ...r,
            axelarGatewayAddress: axelarGatewayAddress,
          }
        }),
      )

    for (const network of networks) {
      logger.info(`Syncing tokens from Axelar Gateway on ${network.name}...`)
      try {
        const url = network.rpcs.at(0)?.url
        assert(url, 'Expected network to have at least one rpc')
        const client = createPublicClient({
          transport: http(url),
        })

        const logs = await client.getLogs({
          event: parseAbiItem(
            'event TokenDeployed(string symbol, address tokenAddresses)',
          ),
          address: network.axelarGatewayAddress,
          fromBlock: 0n,
          toBlock: 'latest',
        })

        const tokens = logs
          .filter(
            (
              log,
            ): log is typeof log & {
              args: SetRequired<(typeof log)['args'], 'tokenAddresses'>
            } => !!log.args.tokenAddresses,
          )
          .map((log) => ({
            token: {
              networkId: network.id,
              address: log.args.tokenAddresses,
            },
            tokenMeta: {
              source: 'axelar-gateway' as const,
              symbol: log.args.symbol,
              externalId: `${log.transactionHash}-${log.logIndex.toString()}`,
            },
          }))

        await db.token.upsertMany({
          data: tokens.map(({ token }) => ({
            id: nanoid(),
            ...token,
          })),
          conflictPaths: ['networkId', 'address'],
        })

        const tokenIds = await db.token.findMany({
          select: { id: true, networkId: true, address: true },
          where: {
            OR: tokens.map(({ token }) => ({
              networkId: token.networkId,
              address: token.address,
            })),
          },
        })

        await db.tokenMeta.upsertMany({
          data: tokens.map(({ token, tokenMeta }) => ({
            id: nanoid(),
            tokenId: tokenIds.find(
              (t) =>
                t.networkId === token.networkId && t.address === token.address,
            )!.id,
            ...tokenMeta,
          })),
          conflictPaths: ['tokenId', 'source'],
        })

        logger.info(
          `Synced ${tokens.length} tokens from Axelar Gateway on ${network.name}`,
        )
      } catch (e) {
        logger.error(
          `Failed to sync tokens from Axelar Gateway on ${network.name}`,
          e,
        )
      }
    }
  }
}
