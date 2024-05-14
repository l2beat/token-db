import { Logger } from '@l2beat/backend-tools'
import { PrismaClient } from '../db/prisma.js'
import { Token } from '@prisma/client'
import { NetworkExplorerClient } from '../utils/explorers/index.js'
import { setTimeout } from 'timers/promises'
import { PublicClient } from 'viem'
import { nanoid } from 'nanoid'
import { NetworkConfig, WithExplorer } from '../utils/getNetworksConfig.js'
import { upsertTokenMeta } from '../db/helpers.js'

type Dependencies = {
  logger: Logger
  db: PrismaClient
  networkConfig: WithExplorer<NetworkConfig>
}

type Options = {
  /**
   * If true, the source will fetch the data for all tokens from scratch.
   */
  flush: boolean
}

export function buildDeploymentSource(
  { logger, db, networkConfig }: Dependencies,
  { flush }: Options = { flush: false },
) {
  logger = logger.for('DeploymentSource').tag(networkConfig.name)

  return async function () {
    logger.info(`Running deployment source`, {
      chain: networkConfig.name,
    })

    const getDeployment = getDeploymentDataWithRetries(
      networkConfig.explorerClient,
      networkConfig.publicClient,
      logger,
    )

    const whereClause = flush
      ? { network: { chainId: networkConfig.chainId } }
      : {
          AND: {
            network: { chainId: networkConfig.chainId },
            deployment: { is: null },
          },
        }

    const tokens = await db.token.findMany({
      where: whereClause,
    })

    logger.info(`Getting deployments info for tokens`, {
      count: tokens.length,
    })

    for (const [i, token] of tokens.entries()) {
      logger.info(`Getting deployment info for token`, {
        current: i + 1,
        total: tokens.length,
      })

      const { deploymentInfo, metaInfo } = await getDeployment(token)

      await upsertTokenMeta(db, {
        tokenId: token.id,
        source: 'DEPLOYMENT',
        externalId: deploymentInfo.txHash,
        contractName: metaInfo.contractName,
      })

      await db.deployment.upsert({
        where: { tokenId: token.id },
        create: {
          id: nanoid(),
          tokenId: token.id,
          ...deploymentInfo,
        },
        update: {
          ...deploymentInfo,
        },
      })
    }

    logger.info('Deployment info processed')
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
    const tokenAddress = token.address as `0x${string}`
    const [source, deployment] = await Promise.all([
      explorer.getContractSource(tokenAddress),
      explorer.getContractDeployment(tokenAddress),
    ])

    const metaInfo = {
      contractName: source?.ContractName ? source.ContractName : null,
    }

    if (deployment?.txHash.startsWith('GENESIS')) {
      const deploymentInfo = {
        txHash: deployment.txHash,
        blockNumber: null,
        timestamp: null,
        isDeployerEoa: null,
        from: null,
        to: null,
        sourceAvailable: (source?.SourceCode?.length ?? 0) > 0,
      }

      return {
        metaInfo,
        deploymentInfo,
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

    const deploymentInfo = {
      isDeployerEoa: deployment ? true : false,
      txHash: deployment?.txHash ?? null,
      timestamp: block ? new Date(Number(block.timestamp) * 1000) : null,
      blockNumber: tx ? Number(tx.blockNumber) : null,
      from: (tx?.from as string) ?? null,
      to: (tx?.to as string) ?? null,
      sourceAvailable: (source?.SourceCode?.length ?? 0) > 0,
    }

    return {
      metaInfo,
      deploymentInfo,
    }
  }
}
