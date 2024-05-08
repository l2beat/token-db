import { InferInsertModel, isNotNull } from 'drizzle-orm'
import { db } from '../client.js'
import { networksTable } from '../schema.js'
import { assert } from '@l2beat/backend-tools'
import { nanoid } from 'nanoid'

class NetworksRepository {
  async upsertMany(
    networks: Omit<InferInsertModel<typeof networksTable>, 'id'>[],
  ) {
    await db
      .insert(networksTable)
      .values(networks.map((network) => ({ ...network, id: nanoid() })))
      .onConflictDoNothing()
  }

  async findCoingeckoNetworks() {
    const networks = await db
      .select()
      .from(networksTable)
      .where(isNotNull(networksTable.coingeckoId))

    return networks.map((network) => {
      assert(network.coingeckoId, 'Expected network to have coingeckoId')
      return {
        id: network.id,
        name: network.name,
        coingeckoId: network.coingeckoId,
      }
    })
  }
}

export const networksRepository = new NetworksRepository()
