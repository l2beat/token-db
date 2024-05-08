import { PrismaClient } from '@prisma/client'
import { syncAxelarGateway } from './sources/axelar-gateway.js'
import { syncCoingecko } from './sources/coingecko.js'
import { Logger } from '@l2beat/backend-tools'

const prisma = new PrismaClient()

const pipeline = [syncCoingecko, syncAxelarGateway]

const logger = new Logger({})

for (const step of pipeline) {
  await step({ logger })
}

await stop()

async function stop() {
  await prisma.$disconnect()
}

process.on('SIGINT', () => stop)
