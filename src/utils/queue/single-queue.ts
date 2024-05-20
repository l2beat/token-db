import { Logger } from '@l2beat/backend-tools'
import { Processor } from 'bullmq'
import { Redis } from 'ioredis'
import { setupQueue } from './setup-queue.js'
import { setupWorker } from './setup-worker.js'

type EventProcessor<Event> = {
  name: string
  processor: Processor<Event>
}

export function buildSingleQueue<Event = unknown>({
  connection,
  logger,
}: { connection: Redis; logger: Logger }) {
  return ({ name, processor }: EventProcessor<Event>) => {
    const queueLogger = logger.for(name)
    const queue = setupQueue<Event>({
      name,
      connection,
    })

    const worker = setupWorker({
      queue,
      connection,
      processor,
      logger: queueLogger,
    })

    queueLogger.info('Queue created')

    return { queue, worker }
  }
}
