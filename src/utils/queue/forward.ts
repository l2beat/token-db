import { Logger } from '@l2beat/backend-tools'
import { Job, Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { setupWorker } from './setup-worker.js'

/**
 *
 * A ----> B
 *
 */

export function forward<Event>({
  connection,
  logger,
}: {
  connection: Redis
  logger: Logger
}) {
  return (from: Queue<Event>, to: Queue<Event>) => {
    logger = logger.for('QueueRouter')

    const forwardWorker = setupWorker({
      queue: from,
      connection,
      processor: async (job: Job<Event>) => {
        await to.add(job.name, job.data)
      },
    })

    logger.info('Forwarding rule set', {
      from: from.name,
      to: to.name,
    })

    return forwardWorker
  }
}
