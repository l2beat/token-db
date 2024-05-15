import { Logger } from '@l2beat/backend-tools'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'

/**
 *         ____ A.1
 *        /
 * A ----> ---- A.2
 *        \____ A.3
 *
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
