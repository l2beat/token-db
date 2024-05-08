import { InferInsertModel, and, eq, or } from 'drizzle-orm'
import { tokensTable } from '../schema.js'
import { db } from '../client.js'
import { nanoid } from 'nanoid'

class TokensRepository {
  async upsertMany(tokens: Omit<InferInsertModel<typeof tokensTable>, 'id'>[]) {
    await db
      .insert(tokensTable)
      .values(tokens.map((token) => ({ ...token, id: nanoid() })))
      .onConflictDoNothing()
  }

  async upsertAndFindMany(
    tokens: Omit<InferInsertModel<typeof tokensTable>, 'id'>[],
  ) {
    await this.upsertMany(tokens)
    return await db
      .select()
      .from(tokensTable)
      .where(
        or(
          ...tokens.map((token) =>
            and(
              eq(tokensTable.address, token.address),
              eq(tokensTable.networkId, token.networkId),
            ),
          ),
        ),
      )
  }
}

export const tokensRepository = new TokensRepository()
