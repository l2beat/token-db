import { Logger } from '@l2beat/backend-tools'
import { Processor } from 'bullmq'
import { Redis } from 'ioredis'
import { linkFanOutDistribution } from './fanout.js'
import { setupQueue } from './setup-queue.js'
import { setupWorker } from './setup-worker.js'

type FanoutProcessor<Event> = {
  name: string
  source: Processor<Event>
}

export function buildFanOutQueue<Event = void>({
  connection,
  logger,
  queueName,
}: { connection: Redis; logger: Logger; queueName: string }) {
  const mainQueue = setupQueue({ name: queueName, connection })

  return (subscribers: FanoutProcessor<Event>[]) => {
    const processorBus = subscribers.map((source) => {
      const queueLogger = logger.for(queueName).tag(source.name)
      const queue = setupQueue({ name: source.name, connection })

      const worker = setupWorker({
        queue,
        connection,
        // logger: queueLogger,
        processor: source.source,
      })

      queueLogger.info('Queue created')

      return { queue, worker }
    })

    linkFanOutDistribution({ connection, logger })(
      mainQueue,
      processorBus.map(({ queue }) => queue),
    )

    return mainQueue
  }
}
