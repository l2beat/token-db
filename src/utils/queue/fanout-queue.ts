import { Logger } from '@l2beat/backend-tools'
import { Redis } from 'ioredis'
import { linkFanOutDistribution } from './fanout.js'
import { setupQueue } from './setup-queue.js'
import { JobProcessor, setupWorker } from './setup-worker.js'

type OnRefreshTokenRequest = {
  name: string
  source: JobProcessor
}

export function buildFanOutQueue({
  connection,
  logger,
  queueName,
}: { connection: Redis; logger: Logger; queueName: string }) {
  const queue = setupQueue({ name: queueName, connection })

  return (subscribers: OnRefreshTokenRequest[]) => {
    const processorBus = subscribers.map((source) => {
      const queueLogger = logger.for(queueName).tag(source.name)
      const queue = setupQueue({ name: source.name, connection })

      const processor = async () => {
        await source.source()
      }

      const worker = setupWorker({
        queue,
        connection,
        logger: queueLogger,
        processor,
      })

      queueLogger.info('Queue created')

      return { queue, worker }
    })

    linkFanOutDistribution({ connection, logger })(
      queue,
      processorBus.map(({ queue }) => queue),
    )

    return queue
  }
}
