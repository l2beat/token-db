import { Prisma } from '@prisma/client'
import { createPrismaClient } from '../db/prisma.js'
import { argv } from 'process'
import { writeFile } from 'fs/promises'

const path = argv[2]

if (!path) {
  console.error('Usage: yarn export <output-path>')
  process.exit(1)
}

const db = createPrismaClient()

const selectNetworkMeta = {
  id: true,
  chainId: true,
  name: true,
} satisfies Prisma.NetworkSelect

const selectExternalBridgeMeta = {
  id: true,
  name: true,
  type: true,
} satisfies Prisma.ExternalBridgeSelect

const tokens = await db.token.findMany({
  select: {
    id: true,
    network: { select: selectNetworkMeta },
    address: true,
    deployment: {
      select: {
        id: true,
        txHash: true,
        blockNumber: true,
        timestamp: true,
        from: true,
        to: true,
        isDeployerEoa: true,
        sourceAvailable: true,
      },
    },
    metadata: {
      select: {
        id: true,
        source: true,
        externalId: true,
        name: true,
        symbol: true,
        decimals: true,
        logoUrl: true,
        contractName: true,
      },
    },
    bridgedFrom: {
      select: {
        id: true,
        sourceTokenId: true,
        externalBridge: {
          select: selectExternalBridgeMeta,
        },
      },
    },
  },
})

await db.$disconnect()

await writeFile(path, JSON.stringify(tokens, null, 2))

console.log(`Exported ${tokens.length} tokens to ${path} ✅`)
