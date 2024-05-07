import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import postgres from 'postgres'
import { env } from '../env.js'

export function migrateDatabase() {
  const migrationClient = drizzle(postgres(env.DATABASE_URL, { max: 1 }))
  migrate(migrationClient, {
    migrationsFolder: `${__dirname}/migrations`,
  })
}
