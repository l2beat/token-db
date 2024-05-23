import { Redis } from 'ioredis'
import { PrismaClient } from '../db/prisma.js'
import { Logger } from '@l2beat/backend-tools'
import { NetworkConfig, withExplorer } from '../utils/getNetworksConfig.js'
import { eventRouter } from '../utils/queue/router/index.js'
import { setupQueue } from '../utils/queue/setup-queue.js'
import { setupQueueWithProcessor } from '../utils/queue/queue-with-processor.js'
import { setupCollector } from '../utils/queue/aggregates/collector.js'
import { buildOnChainMetadataSource } from '../sources/onChainMetadata.js'
import { byTokenChainId } from '../utils/queue/router/routing-key-rules.js'

const oneMinuteMs = 60 * 1000

type TokenPayload = { tokenId: string }
type BatchTokenPayload = { tokenIds: string[] }

export async function setupOnChainMetadataQueues({
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
  const router = eventRouter(deps)

  // Routing inbox where TokenUpdate events are broadcasted from independent sources
  const onChainMetadataRoutingInbox = queue<TokenPayload>({
    name: 'OnChainMetadataRoutingInbox',
  })

  // For each network, create routing inbox and backpressure (collector) queue
  // so we can batch process the events instead of calling node for each token
  const onChainMetadataBuses = networksConfig
    .filter(withExplorer)
    .map((networkConfig) => {
      // Per-chain events will be collected here
      const inbox = queue<TokenPayload>({
        name: `OnChainMetadataEventCollector:${networkConfig.name}`,
      })
      // Batch processor for the collected events
      const batchEventProcessor = queueWithProcessor<BatchTokenPayload>({
        name: `OnChainMetadataBatchProcessor:${networkConfig.name}`,
        processor: (job) =>
          buildOnChainMetadataSource({ logger, db, networkConfig })(
            job.data.tokenIds,
          ),
      })

      // Wire up the collector to the processor
      const worker = setupCollector({
        inputQueue: inbox,
        outputQueue: batchEventProcessor.queue,
        aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
        bufferSize: 100,
        flushIntervalMs: oneMinuteMs,
        connection,
        logger,
      })

      return {
        collector: {
          queue: inbox,
          worker,
        },
        processor: batchEventProcessor,
        routingKey: networkConfig.chainId,
      }
    })

  // Route the events from the inbox to the per-chain event collectors
  const routingWorker = router.routingKey({
    from: onChainMetadataRoutingInbox,
    to: onChainMetadataBuses.map((bus) => ({
      queue: bus.collector.queue,
      routingKey: bus.routingKey,
    })),
    extractRoutingKey: byTokenChainId({ db }),
  })

  async function start() {
    const statusLogger = logger.for('OnChainMetadataQueuesModule')
    statusLogger.info('Starting')

    const toRun = [
      ...onChainMetadataBuses.map((bus) => bus.collector.worker),
      ...onChainMetadataBuses.map((bus) => bus.processor.worker),
      routingWorker,
    ]

    toRun.forEach((worker) => worker.run())

    statusLogger.info('Started')
  }

  return {
    start,
    routing: {
      inbox: onChainMetadataRoutingInbox,
      worker: routingWorker,
    },
    buses: onChainMetadataBuses,
  }
}
