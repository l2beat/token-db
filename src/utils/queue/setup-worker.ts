import { Logger } from '@l2beat/backend-tools'
import { Processor, Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'

export function setupWorker<
  DataType,
  ResultType,
  NameType extends string = string,
>({
  queue,
  connection,
  processor,
  logger,
}: {
  queue: Queue
  connection: Redis
  processor: Processor<DataType, ResultType, NameType>
  logger?: Logger
}) {
  const worker = new Worker(queue.name, processor, {
    connection,
  })

  if (logger) {
    setupLogging({ worker, logger })
  }

  return worker
}

function setupLogging<DataType, ResultType, NameType extends string>({
  worker,
  logger,
}: { worker: Worker<DataType, ResultType, NameType>; logger: Logger }) {
  worker.on('active', (job) => {
    logger.debug('Event processing job', { id: job.id, event: job.name })
  })

  worker.on('completed', (job) => {
    logger.debug('Event processing done', { id: job.id, eve: job.name })
  })

  worker.on('error', (error) => {
    logger.error('Worker error', { error })
  })

  worker.on('failed', (job) => {
    const hasStalled = !job

    if (hasStalled) {
      logger.error('Event processing stalled')
    } else {
      logger.error('Event processing failed', { id: job.id, name: job.name })
    }
  })
}
