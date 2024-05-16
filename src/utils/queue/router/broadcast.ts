import { Logger } from '@l2beat/backend-tools'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { InferQueueDataType } from '../types.js'

/**
 * Broadcast events from one queue to multiple queues.
 */
export function broadcast<
  EventQueue extends Queue = Queue,
  Event = InferQueueDataType<EventQueue>,
>({ connection, logger }: { connection: Redis; logger: Logger }) {
  return (from: EventQueue, to: EventQueue[]) => {
    const broadcastWorker = new Worker<Event>(
      from.name,
      async (job) => {
        to.forEach((queue) => {
          queue.add(job.name, job.data)
        })
      },
      { connection },
    )

    logger.info('Broadcast rule set', {
      from: from.name,
      to: to.map((queue) => queue.name),
    })

    return broadcastWorker
  }
}
