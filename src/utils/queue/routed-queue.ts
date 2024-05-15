import { Logger } from '@l2beat/backend-tools'
import { Job, Processor, Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { setupQueue } from './setup-queue.js'
import { setupWorker } from './setup-worker.js'

type RoutedProcessor<Event, RoutingKey> = {
  name: string
  source: Processor<Event>
  routingKey: RoutingKey
}

export function buildRoutedQueue<Event, RoutingKey extends string | number>({
  connection,
  logger,
  queueName,
  extractRoutingKey,
}: {
  connection: Redis
  logger: Logger
  queueName: string
  extractRoutingKey: (event: Event) => Promise<RoutingKey>
}) {
  return (subscribers: RoutedProcessor<Event, RoutingKey>[]) => {
    const processorBus = subscribers.map((source) => {
      const queueLogger = logger
        .for(queueName)
        .tag(source.name)
        .tag(source.routingKey.toString())

      const queue = setupQueue({ name: source.name, connection })

      const worker = setupWorker({
        queue,
        connection,
        logger: queueLogger,
        processor: source.source,
      })

      queueLogger.info('Queue created')

      return { queue, worker, routingKey: source.routingKey }
    })

    const queueMap = new Map<RoutingKey, Queue>(
      processorBus.map(({ queue, routingKey }) => [routingKey, queue]),
    )

    const ingestQueue = setupQueue<Event>({ name: queueName, connection })

    const routingWorker = setupWorker({
      queue: ingestQueue,
      connection,
      logger: logger.for(queueName),
      processor: async (job: Job<Event>) => {
        const routingKey = await extractRoutingKey(job.data)
        const queue = queueMap.get(routingKey)
        if (queue) {
          await queue.add(job.name, job.data)
        } else {
          logger.debug('No queue for routing key', { routingKey })
        }
      },
    })

    const mapToLog = Object.fromEntries(
      Array.from(queueMap.entries()).map(([key, queue]) => [key, queue.name]),
    )

    logger.info('Routed queue created', {
      from: queueName,
      routing: mapToLog,
    })

    return {
      queue: ingestQueue,
      worker: routingWorker,
      routedBuses: processorBus,
    }
  }
}
