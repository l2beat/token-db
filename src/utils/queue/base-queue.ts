import { Logger } from '@l2beat/backend-tools'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { linkFanOutDistribution } from './fanout.js'

type AnyFunction = (...args: unknown[]) => Promise<unknown>

type OnRefreshTokenRequest = {
  name: string
  source: AnyFunction
}

export function buildBaseQueue({
  connection,
  logger,
}: { connection: Redis; logger: Logger }) {
  const mainQueue = new Queue('MainQueue', { connection })

  return (subscribers: OnRefreshTokenRequest[]) => {
    const buses = subscribers.map((source) => {
      const queueLogger = logger.for('QueueProcessor').tag(source.name)
      queueLogger.info('Creating queue')
      const queue = new Queue(source.name, { connection })

      queueLogger.info('Creating queue worker')

      const worker = new Worker(
        queue.name,
        async () => {
          queueLogger.info('Starting job')
          const now = performance.now()
          await source.source()
          queueLogger.info('Job done', {
            durationMs: Math.round(performance.now() - now),
          })
        },
        { connection },
      )

      return { queue, worker }
    })

    linkFanOutDistribution({ connection, logger })(
      mainQueue,
      buses.map((bus) => bus.queue),
    )

    async function signal() {
      await mainQueue.add('RefreshRequest', {})
    }

    return signal
  }
}
