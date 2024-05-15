import { Logger } from '@l2beat/backend-tools'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'

export type JobProcessor = (...args: unknown[]) => Promise<unknown>

export function setupWorker({
  queue,
  connection,
  processor,
  logger,
}: {
  queue: Queue
  connection: Redis
  processor: JobProcessor
  logger: Logger
}) {
  const worker = new Worker(queue.name, processor, {
    connection,
  })

  setupLogging({ worker, logger })

  return worker
}

function setupLogging({ worker, logger }: { worker: Worker; logger: Logger }) {
  worker.on('active', (job) => {
    logger.info('Starting job', { id: job.id, name: job.name })
  })

  worker.on('completed', (job) => {
    logger.info('Job done', { id: job.id, name: job.name })
  })

  worker.on('error', (error) => {
    logger.error('Worker error', { error })
  })

  worker.on('failed', (job) => {
    const hasStalled = !job

    if (hasStalled) {
      logger.error('Job stalled')
    } else {
      logger.error('Job failed', { id: job.id, name: job.name })
    }
  })
}
