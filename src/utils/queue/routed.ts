import { Logger } from '@l2beat/backend-tools'
import { Job, Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { setupWorker } from './setup-worker.js'

type RoutedQueue<Event, RoutingKey> = {
  queue: Queue<Event>
  routingKey: RoutingKey
}

/**
 * Route events from one queue to multiple queues based on a routing key.
 */
export function routed<Event, RoutingKey>({
  connection,
  logger,
  extractRoutingKey,
}: {
  connection: Redis
  logger: Logger
  extractRoutingKey: (event: Event) => Promise<RoutingKey>
}) {
  return (from: Queue<Event>, to: RoutedQueue<Event, RoutingKey>[]) => {
    logger = logger.for('QueueRouter')

    const queueMap = new Map<RoutingKey, Queue>(
      to.map(({ queue, routingKey }) => [routingKey, queue]),
    )

    const routingWorker = setupWorker({
      queue: from,
      connection,
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

    logger.info('Routing key rule set', {
      from: from.name,
      routing: mapToLog,
    })

    return routingWorker
  }
}
