import { Redis } from 'ioredis'
import { PrismaClient } from '../db/prisma.js'
import { Logger } from '@l2beat/backend-tools'
import { NetworkConfig } from '../utils/getNetworksConfig.js'
import { setupQueue } from '../utils/queue/setup-queue.js'
import { setupQueueWithProcessor } from '../utils/queue/queue-with-processor.js'
import { buildArbitrumCanonicalSource } from '../sources/arbitrumCanonical.js'
import { setupCollector } from '../utils/queue/aggregates/collector.js'
import { buildOptimismCanonicalSource } from '../sources/optimismCanonical.js'
import { buildZkSyncCanonicalSource } from '../sources/zkSyncCanonical.js'
import { BatchTokenPayload, TokenPayload } from './payloads.js'

const oneMinuteMs = 60 * 1000

export async function setupCanonicalQueues({
  connection,
  db,
  logger,
  networksConfig,
}: {
  connection: Redis
  db: PrismaClient
  logger: Logger
  networksConfig: NetworkConfig[]
}) {
  const deps = {
    connection,
    logger,
  }

  const queue = setupQueue(deps)
  const queueWithProcessor = setupQueueWithProcessor(deps)

  // Arbitrum
  const arbitrumCanonicalProcessor = queueWithProcessor<BatchTokenPayload>({
    name: 'ArbitrumCanonicalBatchProcessor',
    processor: buildArbitrumCanonicalSource({ logger, db, networksConfig }),
  })
  const arbitrumCanonicalEventCollector = queue<TokenPayload>({
    name: 'ArbitrumCanonicalEventCollector',
  })

  // Handle backpressure from the deployment processor (for each below)
  const arbitrumCollectorWorker = setupCollector({
    inputQueue: arbitrumCanonicalEventCollector,
    outputQueue: arbitrumCanonicalProcessor.queue,
    aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
    bufferSize: 100,
    flushIntervalMs: oneMinuteMs,
    connection,
    logger,
  })

  // Optimism
  const optimismCanonicalProcessor = queueWithProcessor<BatchTokenPayload>({
    name: 'OptimismCanonicalBatchProcessor',
    processor: buildOptimismCanonicalSource({ logger, db, networksConfig }),
  })
  const optimismCanonicalEventCollector = queue<TokenPayload>({
    name: 'OptimismCanonicalEventCollector',
  })

  const optimismCollectorWorker = setupCollector({
    inputQueue: optimismCanonicalEventCollector,
    outputQueue: optimismCanonicalProcessor.queue,
    aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
    bufferSize: 100,
    flushIntervalMs: oneMinuteMs,
    connection,
    logger,
  })

  // ZkSync
  const zkSyncCanonicalProcessor = queueWithProcessor<BatchTokenPayload>({
    name: 'ZkSyncCanonicalBatchProcessor',
    processor: buildZkSyncCanonicalSource({ logger, db, networksConfig }),
  })
  const zkSyncCanonicalEventCollector = queue<TokenPayload>({
    name: 'ZkSyncCanonicalEventCollector',
  })

  const zkSyncCollectorWorker = setupCollector({
    inputQueue: zkSyncCanonicalEventCollector,
    outputQueue: zkSyncCanonicalProcessor.queue,
    aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
    bufferSize: 100,
    flushIntervalMs: oneMinuteMs,
    connection,
    logger,
  })

  function start() {
    const statusLogger = logger.for('CanonicalQueuesModule')
    statusLogger.info('Starting')

    const toRun = [
      arbitrumCollectorWorker,
      arbitrumCanonicalProcessor.worker,
      optimismCollectorWorker,
      optimismCanonicalProcessor.worker,
      zkSyncCollectorWorker,
      zkSyncCanonicalProcessor.worker,
    ]

    toRun.forEach((worker) => worker.run())

    statusLogger.info('Started')
  }

  return {
    start,
    arbitrum: {
      processor: arbitrumCanonicalProcessor,
      collector: {
        queue: arbitrumCanonicalEventCollector,
        worker: arbitrumCollectorWorker,
      },
    },
    optimism: {
      processor: optimismCanonicalProcessor,
      collector: {
        queue: optimismCanonicalEventCollector,
        worker: optimismCollectorWorker,
      },
    },
    zkSync: {
      processor: zkSyncCanonicalProcessor,
      collector: {
        queue: zkSyncCanonicalEventCollector,
        worker: zkSyncCollectorWorker,
      },
    },
  }
}
