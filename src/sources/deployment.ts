import { Logger } from '@l2beat/backend-tools'
import { PrismaClient } from '../db/prisma.js'
import { Deployment, Token } from '@prisma/client'
import { Cache } from '../utils/cache.js'
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

function buildDeploymentSource({ logger, db }: Dependencies) {
  logger = logger.for('DeploymentSource')

  return async function () {
    const networksWithExplorer = await db.network.findMany({
      include: { explorer: true, rpcs: true },
      where: {
        AND: [{ explorer: { isNot: null } }],
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

    const supportedChainIds = chainsToRunOn.map((chain) => chain.chainId)

    logger.info(`Running on chains ${supportedChainIds.join(', ')}`)

    const tokenDeployments: Deployment[] = []

    for (const chainId of supportedChainIds) {
      logger.info(`Getting deployments for chain ${chainId}`)
      const cache = new Cache<Deployment>(`deployments-cache-${chainId}.json`)

      const explorer = explorerMap.get(chainId)!
      const publicClient = clientMap.get(chainId)!

      const getCachedDeploymentFn = getCachedDeployment(
        cache,
        explorer,
        publicClient,
        logger,
      )

      const tokens = await db.token.findMany({
        where: { network: { chainId: chainId } },
      })

      logger.info(
        `Getting deployments for ${tokens.length} tokens on chain ${chainId}`,
      )

      for (let i = 0; i < tokens.slice(0, 100).length; i++) {
        logger.info(`Getting deployment for token ${i + 1}/${tokens.length}`)
        const { deployment } = await getCachedDeploymentFn(tokens[i]!)

        tokenDeployments.push(deployment)
      }
    }

    logger.info('Inserting deployments into database', {
      count: tokenDeployments.length,
    })

    await db.deployment.upsertMany({
      data: tokenDeployments,
      conflictPaths: ['tokenId'],
    })

    logger.info('Deployments processed')
  }

  function getCachedDeployment(
    cache: Cache<Deployment>,
    explorer: NetworkExplorerClient,
    publicClient: PublicClient,
    logger: Logger,
  ) {
    return async function (token: Token) {
      const cached = cache.get(token.address as `0x${string}`)
      if (cached) {
        return { deployment: fromCache(cached), isCached: true }
      }
      while (true) {
        try {
          const deployment = await getDeployment(explorer, publicClient)(token)

          cache.set(token.address, deployment)
          return { deployment, isCached: false }
        } catch (e) {
          logger.error('Failed to get deployment', e)
          await setTimeout(5_000)
        }
      }
    }
  }
}

function getDeployment(
  explorer: NetworkExplorerClient,
  publicClient: PublicClient,
) {
  return async function (token: Token) {
    const deployment = await explorer.getContractDeployment(
      token.address as `0x${string}`,
    )

    if (deployment?.txHash.startsWith('GENESIS')) {
      return {
        id: nanoid(),
        tokenId: token.id,
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

    const timestamp = block ? new Date(Number(block.timestamp) * 1000) : null

    console.dir({ timestamp })

    return {
      id: nanoid(),
      tokenId: token.id,
      isDeployerEoa: deployment ? true : false,
      txHash: deployment?.txHash ?? null,
      timestamp,
      blockNumber: tx ? Number(tx.blockNumber) : null,
      from: (tx?.from as string) ?? null,
      to: (tx?.from as string) ?? null,
    }
  }
}

function fromCache(dep: Deployment): Deployment {
  return {
    ...dep,
    timestamp: dep.timestamp ? new Date(dep.timestamp) : null,
  }
}
