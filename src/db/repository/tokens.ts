import { InferInsertModel, and, eq, or } from 'drizzle-orm'
import { tokensTable } from '../schema.js'
import { db } from '../client.js'
import { nanoid } from 'nanoid'

export { TokensRepository }
export type { Token }

type Token = InferInsertModel<typeof tokensTable>

class TokensRepository {
  async upsertMany(tokens: Omit<InferInsertModel<typeof tokensTable>, 'id'>[]) {
    await db
      .insert(tokensTable)
      // TODO: to checksum?
      .values(
        tokens.map((token) => ({
          ...token,
          address: token.address.toUpperCase(),
          id: nanoid(),
        })),
      )
      .onConflictDoNothing()
  }

  async upsertAndFindMany(
    tokens: Omit<InferInsertModel<typeof tokensTable>, 'id'>[],
  ) {
    await this.upsertMany(tokens)

    return db
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
