import { Redis } from 'ioredis'
import { env } from '../env.js'

export function createRedisConnection() {
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    maxRetriesPerRequest: null,
  })
}

export const connection = createRedisConnection()
