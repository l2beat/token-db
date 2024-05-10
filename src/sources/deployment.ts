import { Logger } from '@l2beat/backend-tools'
import { PrismaClient } from '../db/prisma.js'
import { Token } from '@prisma/client'
import {
  NetworkExplorerClient,
  instantiateExplorer,
} from '../utils/explorers/index.js'
import { setTimeout } from 'timers/promises'
import { PublicClient, createPublicClient, http } from 'viem'
import { nanoid } from 'nanoid'

export { buildDeploymentSource }

type Dependencies = {
  logger: Logger
  db: PrismaClient
}

type Options = {
  /**
   * If true, the source will fetch the data for all tokens from scratch.
   */
  flush: boolean
}

function buildDeploymentSource(
  { logger, db }: Dependencies,
  { flush }: Options = { flush: false },
) {
  logger = logger.for('DeploymentSource')

  return async function () {
    const networksWithExplorer = await db.network.findMany({
      include: { explorer: true, rpcs: true },
      where: {
        explorer: { isNot: null },
      },
    })

    const chainsToRunOn = networksWithExplorer.filter(
      (network) => Boolean(network.explorer) && network.rpcs.length > 0,
    )

    const runStacks = chainsToRunOn.map((ctr) => ({
      chainId: ctr.chainId,
      explorer: instantiateExplorer(ctr.explorer!),
      client: createPublicClient({
        transport: http(ctr.rpcs[0]!.url),
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

    for (const { chainId, name } of chainsToRunOn) {
      logger = logger.tag(`${name}`)

      const explorer = explorerMap.get(chainId)!
      const publicClient = clientMap.get(chainId)!

      const getDeployment = getDeploymentDataWithRetries(
        explorer,
        publicClient,
        logger,
      )

      const whereClause = flush
        ? { network: { chainId } }
        : { AND: { network: { chainId }, deployment: { is: null } } }

      const tokens = await db.token.findMany({
        where: whereClause,
      })

      logger.info(`Getting deployments for tokens`, {
        count: tokens.length,
      })

      for (let i = 0; i < tokens.length; i++) {
        logger.info(`Getting deployment for token`, {
          current: i + 1,
          total: tokens.length,
        })

        const token = tokens[i]!

        const deployment = await getDeployment(token)

        const id = nanoid()

        await db.deployment.upsert({
          where: { tokenId: token.id },
          create: {
            id,
            tokenId: token.id,
            ...deployment,
          },
          update: {
            id,
            ...deployment,
          },
        })
      }
    }

    logger.info('Deployments processed')
  }
}

function getDeploymentDataWithRetries(
  explorer: NetworkExplorerClient,
  publicClient: PublicClient,
  logger: Logger,
) {
  return async function (token: Token) {
    while (true) {
      try {
        return await getDeploymentData(explorer, publicClient)(token)
      } catch (e) {
        logger.error('Failed to get deployment', e)
        await setTimeout(5_000)
      }
    }
  }
}

function getDeploymentData(
  explorer: NetworkExplorerClient,
  publicClient: PublicClient,
) {
  return async function (token: Token) {
    const deployment = await explorer.getContractDeployment(
      token.address as `0x${string}`,
    )

    if (deployment?.txHash.startsWith('GENESIS')) {
      return {
        txHash: deployment.txHash,
        blockNumber: null,
        timestamp: null,
        isDeployerEoa: null,
        from: null,
        to: null,
      }
    }

    const tx =
      deployment &&
      (await publicClient.getTransaction({
        hash: deployment.txHash as `0x${string}`,
      }))
    const block =
      tx &&
      (await publicClient.getBlock({
        blockNumber: tx.blockNumber,
      }))

    return {
      isDeployerEoa: deployment ? true : false,
      txHash: deployment?.txHash ?? null,
      timestamp: block ? new Date(Number(block.timestamp) * 1000) : null,
      blockNumber: tx ? Number(tx.blockNumber) : null,
      from: (tx?.from as string) ?? null,
      to: (tx?.to as string) ?? null,
    }
  }
}
