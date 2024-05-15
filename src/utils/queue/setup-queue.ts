import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

export function setupQueue({
  name,
  connection,
}: { name: string; connection: Redis }) {
  return new Queue(name, {
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
