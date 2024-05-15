import { assert, Logger } from '@l2beat/backend-tools'
import { SetRequired } from 'type-fest'
import { http, createPublicClient, isAddress, parseAbiItem } from 'viem'
import { upsertManyTokensWithMeta } from '../db/helpers.js'
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
    logger.info(`Syncing tokens from Axelar Gateway...`)

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
      logger.info(`Syncing tokens from Axelar Gateway skipped`)
      return
    }

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
          networkId: network.id,
          address: log.args.tokenAddresses,
          source: 'axelar-gateway' as const,
          symbol: log.args.symbol,
          externalId: `${log.transactionHash}-${log.logIndex.toString()}`,
        }))

      logger.info('Inserting tokens', { count: tokens.length })
      await upsertManyTokensWithMeta(db, tokens)

      logger.info(`Synced ${tokens.length} tokens from Axelar Gateway`)
    } catch (e) {
      logger.error(
        `Failed to sync tokens from Axelar Gateway on ${network.name}`,
        e,
      )
    }
  }
}
