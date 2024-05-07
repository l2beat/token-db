import { sql } from 'drizzle-orm'
import { db, queryClient } from './db/client.js'

const result = await db.execute<{ one: number }>(sql`SELECT 1 as one`)
console.log(result[0]?.one)
stop()

function stop() {
  queryClient.end()
}

process.on('SIGINT', () => stop)
