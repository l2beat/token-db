import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { env } from '../env.js'

export async function migrateDatabase() {
  const migrationClient = postgres(env.DATABASE_URL, {
    max: 1,
    onnotice: () => undefined,
  })
  const db = drizzle(migrationClient)
  await migrate(db, {
    migrationsFolder: `${import.meta.dirname}/../../drizzle`,
  })
  migrationClient.end()
}
