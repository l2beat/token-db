import { createPublicClient, http, isAddress, parseAbiItem } from 'viem'
import { Database } from '../db/client.js'
import { isNotNull } from 'drizzle-orm'
import { networksTable } from '../db/schema.js'
import { Logger, assert } from '@l2beat/backend-tools'
import { SetRequired } from 'type-fest'
import { TokensRepository } from '../db/repository/tokens.js'
import { TokenMetadataRepository } from '../db/repository/token-metadata.js'

export { buildAxelarGatewaySource }

type Dependencies = {
  logger: Logger
  db: Database
  repositories: {
    tokens: TokensRepository
    meta: TokenMetadataRepository
  }
}

function buildAxelarGatewaySource($: Dependencies) {
  const logger = $.logger.for('AxelarGatewaySource')

  return async function () {
    const networks = await $.db.query.networks
      .findMany({
        with: { rpcs: true },
        where: isNotNull(networksTable.axelarGateway),
      })
      .then((networks) =>
        networks
          .map((network) => {
            const axelarGateway = network.axelarGateway
            assert(axelarGateway, 'Expected network to have axelarGateway')
            assert(
              isAddress(axelarGateway),
              'Expected axelarGateway to be an address',
            )
            return {
              ...network,
              axelarGateway,
            }
          })
          .filter((network) => network.rpcs.length > 0),
      )

    for (const network of networks) {
      const url = network.rpcs.at(0)?.url
      assert(url, 'Expected network to have at least one rpc')
      const client = createPublicClient({
        transport: http(url),
      })

      const logs = await client.getLogs({
        event: parseAbiItem(
          'event TokenDeployed(string symbol, address tokenAddresses)',
        ),
        address: network.axelarGateway,
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

      const upsertedTokens = await $.repositories.tokens.upsertAndFindMany(
        tokens.map(({ token }) => token),
      )
      await $.repositories.meta.upsertMany(
        tokens.map(({ token, tokenMeta }) => {
          const tokenId = upsertedTokens.find(
            (tokenId) =>
              tokenId.networkId === token.networkId &&
              tokenId.address === token.address,
          )?.id

          assert(tokenId, 'Expected token to be upserted')

          return { ...tokenMeta, tokenId }
        }),
      )

      logger.info(`Synced ${tokens.length} tokens from Axelar Gateway`)
    }
  }
}
