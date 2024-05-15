import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

export function setupQueue<
  DataType,
  ReturnType = unknown,
  NameType extends string = string,
>({ name, connection }: { name: string; connection: Redis }) {
  return new Queue<DataType, ReturnType, NameType>(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 5,

      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
    },
  })
}
