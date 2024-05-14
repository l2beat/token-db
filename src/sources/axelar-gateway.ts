import { assert, Logger } from '@l2beat/backend-tools'
import { nanoid } from 'nanoid'
import { SetRequired } from 'type-fest'
import { isAddress, parseAbiItem } from 'viem'
import { PrismaClient } from '../db/prisma.js'
import { NetworkConfig } from '../utils/getNetworksConfig.js'

export { buildAxelarGatewaySource }

type Dependencies = {
  logger: Logger
  db: PrismaClient
  networkConfig: NetworkConfig
}

function buildAxelarGatewaySource({ logger, db, networkConfig }: Dependencies) {
  logger = logger.for('AxelarGatewaySource').tag(`${networkConfig.name}`)

  return async function () {
    const network = await db.network
      .findFirst({
        include: {
          rpcs: true,
        },
        where: {
          axelarGatewayAddress: {
            not: null,
          },
          chainId: networkConfig.chainId,
        },
      })
      .then((result) => {
        if (!result) {
          return
        }
        const { axelarGatewayAddress } = result
        assert(axelarGatewayAddress, 'Expected axelarGatewayAddress')
        assert(isAddress(axelarGatewayAddress), 'Expected address')
        return {
          ...result,
          axelarGatewayAddress: axelarGatewayAddress,
        }
      })

    if (!network) {
      logger.info(
        `Syncing tokens from Axelar Gateway on ${networkConfig.name} skipped`,
      )
      return
    }

    logger.info(`Syncing tokens from Axelar Gateway on ${network.name}...`)
    try {
      const logs = await networkConfig.publicClient.getLogs({
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
          // biome-ignore lint/style/noNonNullAssertion: data must be there
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
