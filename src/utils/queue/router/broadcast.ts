import { Logger } from '@l2beat/backend-tools'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'

/**
 * Broadcast events from one queue to multiple queues.
 */
export function broadcast({
  connection,
  logger,
}: { connection: Redis; logger: Logger }) {
  return (from: Queue, to: Queue[]) => {
    const broadcastWorker = new Worker(
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
