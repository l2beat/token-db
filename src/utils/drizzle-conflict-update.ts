import { sql } from 'drizzle-orm'
import { PgUpdateSetSource, PgTable } from 'drizzle-orm/pg-core'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'

/**
 * Helper function for drizzle, that generates a conflict update object that sets all
 * columns to the values from the excluded table, excluding ones with default values
 * and named 'id' (customizable).
 * @see https://github.com/drizzle-team/drizzle-orm/issues/1728#issuecomment-1998494043
 * @param table table to generate the conflict update object for
 * @param customOptions custom options to override the default ones
 * @returns conflict update object
 */
export function conflictUpdateSetAllColumns<TTable extends PgTable>(
  table: TTable,
  customOptions?: { skipColumns?: string[] },
): PgUpdateSetSource<TTable> {
  const options = Object.assign(
    {
      skipColumns: ['id'],
    },
    customOptions,
  )

  const columns = getTableColumns(table)
  const { name: tableName } = getTableConfig(table)
  const conflictUpdateSet = Object.entries(columns).reduce(
    (acc, [columnName, columnInfo]) => {
      if (options.skipColumns?.includes(columnName)) {
        return acc
      }
      if (!columnInfo.default) {
        // @ts-ignore
        acc[columnName] = sql.raw(
          `COALESCE(excluded.${columnInfo.name}, ${tableName}.${columnInfo.name})`,
        )
      }
      return acc
    },
    {},
  ) as PgUpdateSetSource<TTable>
  return conflictUpdateSet
}
