import { PublicClient, createPublicClient, http } from 'viem'
import { PrismaClient } from '../db/prisma.js'
import {
  NetworkExplorerClient,
  instantiateExplorer,
} from '../utils/explorers/index.js'
import { Logger, assert } from '@l2beat/backend-tools'
import { nanoid } from 'nanoid'
import { setTimeout } from 'timers/promises'

type Dependencies = {
  db: PrismaClient
  logger: Logger
}

export { buildLayerZeroV1Source }

function buildLayerZeroV1Source({ db, logger }: Dependencies) {
  logger = logger.for('LayerZeroV1Source')

  return async function () {
    logger.info('Upserting bridge info')
    const { id: bridgeId } = await db.bridge.upsert({
      select: { id: true },
      where: {
        name: 'LayerZeroV1',
      },
      create: {
        id: nanoid(),
        name: 'LayerZeroV1',
      },
      update: {},
    })

    const networksWithExplorer = await db.network.findMany({
      include: { explorer: true, rpcs: true },
      where: {
        AND: [
          {
            explorer: { isNot: null },
          },
          {
            layerZeroV1EndpointAddress: { not: null },
          },
        ],
      },
    })

    const chainsToRunOn = networksWithExplorer.filter(
      (network) =>
        Boolean(network.explorer) &&
        network.rpcs.length > 0 &&
        network.layerZeroV1EndpointAddress,
    )

    const runStacks = chainsToRunOn.map((ctr) => ({
      chainId: ctr.chainId,
      // biome-ignore lint/style/noNonNullAssertion: I love prisma types mumbojubmo
      explorer: instantiateExplorer(ctr.explorer!),
      client: createPublicClient({
        transport: http(ctr.rpcs[0]?.url),
      }),
    }))

    const explorerMap = new Map<number, NetworkExplorerClient>(
      runStacks.map(({ chainId, explorer }) => [chainId, explorer]),
    )

    const clientMap = new Map<number, PublicClient>(
      runStacks.map(({ chainId, client }) => [chainId, client]),
    )

    logger.info(`Running on chains`, {
      chains: chainsToRunOn.map((c) => c.name),
    })

    for (const {
      chainId,
      name,
      id,
      layerZeroV1EndpointAddress,
    } of chainsToRunOn) {
      logger = logger.tag(`${name}`)

      // biome-ignore lint/style/noNonNullAssertion: checked above
      const endpointAddress = layerZeroV1EndpointAddress! as `0x${string}`

      // biome-ignore lint/style/noNonNullAssertion: part of run stacks
      const explorer = explorerMap.get(chainId)!
      // biome-ignore lint/style/noNonNullAssertion: part of run stacks
      const publicClient = clientMap.get(chainId)!

      const blockNumber = await publicClient.getBlockNumber()

      const deploymentInfo =
        await explorer.getContractDeployment(endpointAddress)

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

        const fetchedInternalTxs = await explorer.getInternalTransactions(
          endpointAddress,
          i - 1,
          i + batchSize,
        )

        // reduce memory footprint by only storing the from address
        fetchedInternalTxs.forEach((ftx) => fromAddresses.add(ftx.from))
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

        const source = await explorer.getContractSource(
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
          networkId: id,
        })),
        conflictPaths: ['networkId', 'address'],
      })

      logger.info('Upserting bridge escrows', { count: ercAddresses.length })
      await db.bridgeEscrow.upsertMany({
        data: ercAddresses.map((address) => ({
          id: nanoid(),
          bridgeId,
          address,
          networkId: id,
        })),
        conflictPaths: ['networkId', 'address'],
      })
    }
  }
}
