import { Logger } from '@l2beat/backend-tools'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'

/**
 * Fan-out events from one queue to multiple queues.
 */
export function fanOut({
  connection,
  logger,
}: { connection: Redis; logger: Logger }) {
  return (from: Queue, to: Queue[]) => {
    logger = logger.for('QueueRouter')

    const fanOutWorker = new Worker(
      from.name,
      async (job) => {
        to.forEach((queue) => {
          queue.add(job.name, job.data)
        })
      },
      { connection },
    )

    logger.info('Fan-out rule set', {
      from: from.name,
      to: to.map((queue) => queue.name),
    })

    return fanOutWorker
  }
}
