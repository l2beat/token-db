import { Logger } from '@l2beat/backend-tools'
import { Job, Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { setupWorkerLogging } from '../logging.js'
import { InferQueueDataType, InferQueueResultType } from '../types.js'

type BufferEntry<T> = {
  payload: T
  resolve: (value: void | PromiseLike<void>) => void
  reject: (error: Error) => void
}

/**
 * Collects events from an input queue and aggregates them into a single event
 * forwarded to an output queue.
 * @param inputQueue The queue to collect events from.
 * @param outputQueue The queue to forward the aggregated event to.
 * @param aggregate The function to aggregate many input events into one output event.
 * @param bufferSize The maximum number of events to aggregate before forwarding.
 * @param flushInterval The maximum time to wait before forwarding the aggregated event.
 */
export function setupCollector<
  InputQueue extends Queue,
  OutputQueue extends Queue,
  InputDataType = InferQueueDataType<InputQueue>,
  OutputDataType = InferQueueDataType<OutputQueue>,
  InputResultType = InferQueueResultType<InputQueue>,
>({
  inputQueue,
  outputQueue,
  aggregate,
  bufferSize = 5,
  flushInterval = 10000,
  connection,
  logger,
}: {
  inputQueue: InputQueue
  outputQueue: OutputQueue
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
    concurrency: bufferSize,
  })

  if (logger) {
    setupWorkerLogging({ worker, logger })
  }

  logger.info('Collector setup', {
    bufferSize,
    flushInterval,
    from: inputQueue.name,
    to: outputQueue.name,
  })

  return worker
}
