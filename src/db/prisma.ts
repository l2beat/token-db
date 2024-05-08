import { Prisma, PrismaClient as VanillaPrismaClient } from '@prisma/client'
import { env } from '../env.js'
import pick from 'lodash/pick.js'
import { chunkUpsert } from '../utils/chunk-upsert.js'

export const createPrismaClient = () =>
  new VanillaPrismaClient({
    log: !env.PRISMA_QUERY_LOG
      ? ['warn', 'error']
      : ['query', 'info', 'warn', 'error'],
  }).$extends({
    model: {
      $allModels: {
        // https://github.com/prisma/prisma/issues/4134
        async upsertMany<T>(
          this: T,
          {
            data,
            conflictPaths,
            typeCast,
          }: {
            data: Prisma.Args<T, 'createMany'>['data']
            conflictPaths: (keyof Prisma.Args<T, 'create'>['data'])[]
            // https://github.com/prisma/prisma/issues/10252
            typeCast?: {
              [P in keyof Prisma.Args<T, 'create'>['data']]?: string
            }
          },
        ): Promise<number> {
          data = Array.isArray(data) ? data : [data]
          if (data.length === 0) {
            return 0
          }

          const context = Prisma.getExtensionContext(this)

          const model = Prisma.dmmf.datamodel.models.find(
            (model) => model.name === context.$name,
          )
          if (!model) {
            throw new Error('No model')
          }

          const tableArg = Prisma.raw(`"${model.dbName || model.name}"`)

          const writeableFields = model.fields.filter(
            (field) =>
              !['createdAt'].includes(field.name) &&
              !field.relationName &&
              !field.isGenerated,
          )

          const columns = writeableFields.map((field) => field.name)

          const columnsArg = Prisma.raw(columns.map((c) => `"${c}"`).join(','))

          const conflictArg = Prisma.raw(
            conflictPaths.map((c) => `"${String(c)}"`).join(','),
          )

          const updateColumns = columns.filter(
            (c) => !conflictPaths.includes(c) && c !== 'id',
          )
          const updateArg = Prisma.raw(
            updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(','),
          )

          const chunked = chunkUpsert<Prisma.Args<T, 'createMany'>['data']>(
            data,
            (elem) => JSON.stringify(pick(elem, conflictPaths)),
            500,
          )

          let count = 0

          for (const chunk of chunked) {
            const values = (chunk as any[]).map(
              (d) =>
                Prisma.sql`(${Prisma.join(
                  writeableFields.map((field) => {
                    if (field.isUpdatedAt) {
                      return Prisma.sql`CURRENT_TIMESTAMP`
                    }

                    const column = field.name
                    const cast = typeCast && typeCast[column]
                    if (cast) {
                      return Prisma.sql`${d[column]}::${Prisma.raw(cast)}`
                    }

                    return d[column]
                  }),
                )})`,
            )

            if (updateColumns.length > 0) {
              count += await (context.$parent as any).$executeRaw`
                INSERT INTO ${tableArg} (${columnsArg})
                VALUES ${Prisma.join(values)}
                ON CONFLICT (${conflictArg}) DO UPDATE SET
                  ${updateArg};`
            } else {
              count += await (context.$parent as any).$executeRaw`
                INSERT INTO ${tableArg} (${columnsArg})
                VALUES ${Prisma.join(values)}
                ON CONFLICT (${conflictArg}) DO NOTHING;`
            }
          }

          return count
        },
      },
    },
  })

export type PrismaClient = ReturnType<typeof createPrismaClient>
