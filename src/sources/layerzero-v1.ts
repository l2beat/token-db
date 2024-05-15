import { PrismaClient } from '../db/prisma.js'
import { Logger, assert } from '@l2beat/backend-tools'
import { nanoid } from 'nanoid'
import { setTimeout } from 'timers/promises'
import { NetworkConfig, WithExplorer } from '../utils/getNetworksConfig.js'

type Dependencies = {
  db: PrismaClient
  logger: Logger
  networkConfig: WithExplorer<NetworkConfig>
}

export function buildLayerZeroV1Source({
  db,
  logger,
  networkConfig: { chainId, networkId, explorerClient, publicClient },
}: Dependencies) {
  logger = logger.for('LayerZeroV1Source')

  return async function () {
    logger.info('Upserting bridge info')
    const { id: externalBridgeId } = await db.externalBridge.upsert({
      select: { id: true },
      where: {
        type: 'LayerZeroV1',
      },
      create: {
        id: nanoid(),
        name: 'LayerZeroV1',
        type: 'LayerZeroV1',
      },
      update: {},
    })

    // TODO We have to decide whether we inject required data, filter it out or something else
    const network = await db.network.findFirst({
      where: {
        AND: { chainId, layerZeroV1EndpointAddress: { not: null } },
      },
    })

    if (!network || !network.layerZeroV1EndpointAddress) {
      logger.warn('Network has no layer zero v1 endpoint assigned')
      return
    }

    const endpointAddress = network.layerZeroV1EndpointAddress as `0x${string}`

    const blockNumber = await publicClient.getBlockNumber()

    const deploymentInfo =
      await explorerClient.getContractDeployment(endpointAddress)

    assert(deploymentInfo, 'Could not retrieve deployment info')

    const transaction = await publicClient.getTransaction({
      hash: deploymentInfo.txHash as `0x${string}`,
    })

    const fromAddresses = new Set<string>()
    const fromBlock = Number(transaction.blockNumber)
    const toBlock = Number(blockNumber)
    const batchSize = 10_000
    logger.info(`Fetching addresses from internal transaction to Endpoint`, {
      fromBlock,
      toBlock,
      batchSize,
    })

    for (let i = fromBlock; i < toBlock; i += batchSize) {
      logger.info('Fetching internal transactions', {
        fromBlock: i,
        toBlock: i + batchSize,
      })

      const fetchedInternalTxs = await explorerClient.getInternalTransactions(
        endpointAddress,
        i - 1,
        i + batchSize,
      )

      // reduce memory footprint by only storing the from address
      fetchedInternalTxs.forEach((ftx) => fromAddresses.add(ftx.from))
      await setTimeout(500)
    }

    logger.info('Addresses fetched', { count: fromAddresses.size })

    const ercAddresses: string[] = []

    logger.info('Filtering ERC20 addresses')

    let idx = 1
    for (const address of Array.from(fromAddresses)) {
      logger.info('Pulling ABI', {
        address,
        current: idx++,
        total: fromAddresses.size,
      })

      const source = await explorerClient.getContractSource(
        address as `0x${string}`,
      )

      const isErc20 = source?.ABI.includes('balanceOf')

      if (isErc20) {
        ercAddresses.push(address)
      }

      await setTimeout(500)
    }

    logger.info('ERC20 addresses fetched', { count: ercAddresses.length })

    logger.info('Upserting tokens', { count: ercAddresses.length })
    await db.token.upsertMany({
      data: ercAddresses.map((address) => ({
        id: nanoid(),
        address,
        networkId,
      })),
      conflictPaths: ['networkId', 'address'],
    })

    logger.info('Upserting bridge escrows', { count: ercAddresses.length })
    await db.bridgeEscrow.upsertMany({
      data: ercAddresses.map((address) => ({
        id: nanoid(),
        externalBridgeId,
        address,
        networkId,
      })),
      conflictPaths: ['networkId', 'address'],
    })
  }
}
