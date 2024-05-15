import { Logger } from '@l2beat/backend-tools'
import { Token } from '@prisma/client'
import { nanoid } from 'nanoid'
import { setTimeout } from 'timers/promises'
import { PublicClient } from 'viem'
import { PrismaClient } from '../db/prisma.js'
import { NetworkExplorerClient } from '../utils/explorers/index.js'
import { NetworkConfig, WithExplorer } from '../utils/getNetworksConfig.js'

type Dependencies = {
  logger: Logger
  db: PrismaClient
  networkConfig: WithExplorer<NetworkConfig>
  token: {
    id: string
    networkId: string
    address: string
  }
}

export function buildDeploymentSource({
  logger,
  db,
  networkConfig,
  token,
}: Dependencies) {
  logger = logger.for('DeploymentSource').tag(networkConfig.name).tag(token.id)

  return async function () {
    const getDeployment = getDeploymentDataWithRetries(
      networkConfig.explorerClient,
      networkConfig.publicClient,
      logger,
    )

    const { deploymentInfo, metaInfo } = await getDeployment(token)

    const metaId = nanoid()
    const deploymentId = nanoid()

    await db.tokenMeta.upsert({
      where: {
        tokenId_source: {
          tokenId: token.id,
          source: 'DEPLOYMENT',
        },
      },
      create: {
        id: metaId,
        tokenId: token.id,
        source: 'DEPLOYMENT',
        externalId: deploymentInfo.txHash,
        contractName: metaInfo.contractName,
      },
      update: {
        id: metaId,
        externalId: deploymentInfo.txHash,
        contractName: metaInfo.contractName,
      },
    })

    await db.deployment.upsert({
      where: { tokenId: token.id },
      create: {
        id: deploymentId,
        tokenId: token.id,
        ...deploymentInfo,
      },
      update: {
        id: deploymentId,
        ...deploymentInfo,
      },
    })

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
