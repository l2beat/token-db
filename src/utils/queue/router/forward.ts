import { Logger } from '@l2beat/backend-tools'
import { Job, Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { setupWorker } from '../setup-worker.js'
import { InferQueueDataType } from '../types.js'

/**
 * Forward events from one queue to another.
 */
export function forward<
  EventQueue extends Queue = Queue,
  Event = InferQueueDataType<EventQueue>,
>({
  connection,
  logger,
}: {
  connection: Redis
  logger: Logger
}) {
  return (from: EventQueue, to: EventQueue) => {
    const forwardWorker = setupWorker({
      queue: from,
      connection,
      processor: async (job: Job<Event>) => {
        await to.add(job.name, job.data, job.opts)
      },
    })

    logger.info('Forwarding rule set', {
      from: from.name,
      to: to.name,
    })

    return forwardWorker
  }
}
