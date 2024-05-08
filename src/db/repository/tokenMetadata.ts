import { InferInsertModel } from 'drizzle-orm'
import { tokenMetadatasTable } from '../schema.js'
import { db } from '../client.js'
import { nanoid } from 'nanoid'
import { conflictUpdateSetAllColumns } from '../../utils/drizzle-conflict-update.js'

class TokenMetadataRepository {
  async upsertMany(
    metadatas: Omit<InferInsertModel<typeof tokenMetadatasTable>, 'id'>[],
  ) {
    await db
      .insert(tokenMetadatasTable)
      .values(
        metadatas.map((metadata) => ({
          ...metadata,
          id: nanoid(),
        })),
      )
      .onConflictDoUpdate({
        target: [tokenMetadatasTable.source, tokenMetadatasTable.externalId],
        set: conflictUpdateSetAllColumns(tokenMetadatasTable),
      })
  }
}

export const tokenMetadataRepository = new TokenMetadataRepository()
