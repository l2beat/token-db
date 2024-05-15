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
  return (subscriber: EventProcessor<Event>) => {
    const queueLogger = logger.for(subscriber.name)
    const queue = setupQueue<Event>({ name: subscriber.name, connection })

    const worker = setupWorker({
      queue,
      connection,
      processor: subscriber.processor,
    })

    queueLogger.info('Queue created')

    return { queue, worker }
  }
}
