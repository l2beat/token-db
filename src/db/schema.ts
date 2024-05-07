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
export const sourceEnum = pgEnum('source', ['coingecko'])

const ethereumAddress = (name: string) => char(name, { length: 42 })
const nanoid = (name: string) => char(name, { length: 21 })

export const bridges = pgTable('bridges', {
  id: nanoid('id').primaryKey(),
  name: varchar('name', { length: 256 }),
})

export const networks = pgTable('networks', {
  id: nanoid('id').primaryKey(),
  chainId: integer('chain_id'),
  name: varchar('name', { length: 256 }),
})

export const networkRpcs = pgTable('network_rpcs', {
  id: nanoid('id').primaryKey(),
  networkId: integer('network_id').references(() => networks.id),
  url: varchar('url', { length: 256 }),
  // TODO: limits
})

export const tokens = pgTable('tokens', {
  id: nanoid('id').primaryKey(),
  networkId: integer('network_id').references(() => networks.id),
  address: ethereumAddress('address'),
})

export const tokenMetadatas = pgTable('token_metadatas', {
  id: nanoid('id').primaryKey(),
  tokenId: nanoid('token_id').references(() => tokens.id),
  source: sourceEnum('source'),
  name: varchar('name', { length: 256 }),
  symbol: varchar('symbol', { length: 16 }),
  decimals: integer('decimals'),
  logoUrl: varchar('logo_url', { length: 256 }),
  contractName: varchar('contract_name', { length: 256 }),
})

export const deployments = pgTable('deployments', {
  id: nanoid('id').primaryKey(),
  tokenId: nanoid('token_id')
    .references(() => tokens.id)
    .unique(),
  txHash: char('tx_hash', { length: 66 }),
  blockNumber: integer('block_number'),
  timestamp: timestamp('timestamp'),
  from: ethereumAddress('from'),
  to: ethereumAddress('to'),
  isDeployerEOA: boolean('is_deployer_eoa'),
})

export const bridgeEscrows = pgTable('bridge_escrows', {
  id: nanoid('id').primaryKey(),
  bridgeId: nanoid('token_id').references(() => bridges.id),
  networkId: nanoid('network_id').references(() => networks.id),
  address: ethereumAddress('address'),
})

export const tokenBridges = pgTable('token_bridges', {
  id: nanoid('id').primaryKey(),
  tokenId: integer('token_id')
    .references(() => tokens.id)
    .unique(),
  sourceTokenId: integer('source_token_id').references(() => tokens.id),
  bridgeEscrowId: integer('bridge_escrow_id').references(
    () => bridgeEscrows.id,
  ),
})
