import { Logger } from '@l2beat/backend-tools'
import { Job, Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'

type BufferEntry<T> = {
  payload: T
  resolve: (value: void | PromiseLike<void>) => void
  reject: (error: Error) => void
}

// TODO: refine types to infer the output from the aggregate function
export function setupCollector<
  InputDataType = unknown,
  OutputDataType = unknown,
  InputResultType = unknown,
  OutputResultType = unknown,
>({
  inputQueue,
  outputQueue,
  aggregate,
  bufferSize = 5,
  flushInterval = 10000,
  connection,
  logger,
}: {
  inputQueue: Queue<InputDataType, InputResultType, string>
  outputQueue: Queue<OutputDataType, OutputResultType, string>
  aggregate: (data: InputDataType[]) => OutputDataType
  bufferSize: number
  flushInterval: number
  connection: Redis
  logger: Logger
}) {
  logger = logger.for('EventCollector')
  let buffer: BufferEntry<InputDataType>[] | undefined = undefined

  async function flush() {
    if (!buffer) {
      return
    }

    try {
      logger.info('Aggregating events')
      const aggregatedEvent = aggregate(
        // biome-ignore lint/style/noNonNullAssertion: <explanation>
        buffer!.map((entry) => entry.payload),
      )

      logger.info('Sending aggregated event', { event: aggregatedEvent })
      await outputQueue.add('CollectedEvents', aggregatedEvent)

      logger.info('Acknowledging atomic events')
      buffer?.forEach((entry) => entry.resolve())
    } catch {
      buffer?.forEach((entry) =>
        entry.reject(new Error('Failed to aggregate events')),
      )
    }

    buffer = undefined
  }

  const processor = (
    job: Job<InputDataType, InputResultType, string>,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const entry: BufferEntry<InputDataType> = {
        payload: job.data,
        resolve,
        reject,
      }

      if (!buffer) {
        logger.info('No buffer, creating new buffer')
        buffer = [entry]

        setTimeout(async () => {
          logger.info('Flushing buffer due to timeout')
          await flush()
        }, flushInterval)
        return
      }

      logger.info('Adding event to buffer')

      buffer.push(entry)

      logger.info('Buffer after adding', {
        len: buffer.length,
        bufferSize,
        buffer,
        comparison: buffer.length >= bufferSize,
      })

      if (buffer.length >= bufferSize) {
        // backpressure
        logger.info('Buffer exists', {
          len: buffer.length,
          bufferSize,
          buffer,
          comparison: buffer.length >= bufferSize,
        })
        logger.info('Buffer full, flushing')

        flush()
      }
    })
  }

  const worker = new Worker<InputDataType>(inputQueue.name, processor, {
    connection,
    // +1 here for backpressure triggering
    concurrency: bufferSize + 1,
  })

  if (logger) {
    setupLogging({ worker, logger })
  }

  logger.info('Collector setup', {
    bufferSize,
    flushInterval,
    from: inputQueue.name,
    to: outputQueue.name,
  })

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
