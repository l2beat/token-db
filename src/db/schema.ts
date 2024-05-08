import { relations } from 'drizzle-orm'
import {
  boolean,
  char,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

// TODO: Add more sources
export const sourceEnum = pgEnum('source', ['coingecko', 'axelar-gateway'])

const ethereumAddress = (name: string) => char(name, { length: 42 })
const nanoid = (name: string) => char(name, { length: 21 })

export const bridgesTable = pgTable('bridges', {
  id: nanoid('id').primaryKey(),
  name: varchar('name', { length: 256 }),
})

export const networksTable = pgTable('networks', {
  id: nanoid('id').primaryKey(),
  chainId: integer('chain_id').notNull(),
  name: varchar('name', { length: 256 }).notNull(),
  coingeckoId: varchar('coingecko_id', { length: 256 }),
  axelarGateway: ethereumAddress('axelar_gateway'),
})

export const networksRelations = relations(networksTable, ({ many }) => ({
  rpcs: many(networkRpcsTable),
}))

export const networkRpcsTable = pgTable('network_rpcs', {
  id: nanoid('id').primaryKey(),
  networkId: nanoid('network_id')
    .notNull()
    .references(() => networksTable.id),
  url: varchar('url', { length: 256 }).notNull(),
  // TODO: limits
})

export const networkRpcsRelations = relations(networkRpcsTable, ({ one }) => ({
  network: one(networksTable, {
    fields: [networkRpcsTable.networkId],
    references: [networksTable.id],
  }),
}))

export const tokensTable = pgTable(
  'tokens',
  {
    id: nanoid('id').primaryKey(),
    networkId: nanoid('network_id')
      .notNull()
      .references(() => networksTable.id),
    address: ethereumAddress('address').notNull(),
  },
  (self) => ({
    uniqueNetworkAddress: uniqueIndex('unique_network_address').on(
      self.networkId,
      self.address,
    ),
  }),
)

export const tokenMetadatasTable = pgTable('token_metadatas', {
  id: nanoid('id').primaryKey(),
  tokenId: nanoid('token_id').references(() => tokensTable.id),
  source: sourceEnum('source'),
  name: varchar('name', { length: 256 }),
  symbol: varchar('symbol', { length: 16 }),
  decimals: integer('decimals'),
  logoUrl: varchar('logo_url', { length: 256 }),
  contractName: varchar('contract_name', { length: 256 }),
})

export const deploymentsTable = pgTable('deployments', {
  id: nanoid('id').primaryKey(),
  tokenId: nanoid('token_id')
    .references(() => tokensTable.id)
    .unique(),
  txHash: char('tx_hash', { length: 66 }),
  blockNumber: integer('block_number'),
  timestamp: timestamp('timestamp'),
  from: ethereumAddress('from'),
  to: ethereumAddress('to'),
  isDeployerEOA: boolean('is_deployer_eoa'),
})

export const bridgeEscrowsTable = pgTable('bridge_escrows', {
  id: nanoid('id').primaryKey(),
  bridgeId: nanoid('token_id').references(() => bridgesTable.id),
  networkId: nanoid('network_id').references(() => networksTable.id),
  address: ethereumAddress('address'),
})

export const tokenBridgesTable = pgTable('token_bridges', {
  id: nanoid('id').primaryKey(),
  tokenId: nanoid('token_id')
    .references(() => tokensTable.id)
    .unique(),
  sourceTokenId: nanoid('source_token_id').references(() => tokensTable.id),
  bridgeEscrowId: nanoid('bridge_escrow_id').references(
    () => bridgeEscrowsTable.id,
  ),
})

export const schema = {
  bridges: bridgesTable,
  networks: networksTable,
  networksRelations,
  networkRpcs: networkRpcsTable,
  networkRpcsRelations,
  tokens: tokensTable,
  tokenMetadatas: tokenMetadatasTable,
  deployments: deploymentsTable,
  bridgeEscrows: bridgeEscrowsTable,
  tokenBridges: tokenBridgesTable,
}
