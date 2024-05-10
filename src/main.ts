import { Logger } from '@l2beat/backend-tools'

import { buildAxelarGatewaySource } from './sources/axelar-gateway.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { buildTokenListSource } from './sources/tokenList.js'

import { createPrismaClient } from './db/prisma.js'
import { getNetworksConfig } from './utils/getNetworksConfig.js'
import { buildOnChainMetadataSource } from './sources/onChainMetadata.js'

const db = createPrismaClient()

const logger = new Logger({ format: 'pretty', colors: true })

const networksConfig = await getNetworksConfig({
  db,
  logger,
})

const lists = [
  {
    tag: '1INCH',
    url: 'https://tokens.1inch.eth.link',
  },
  {
    tag: 'AAVE',
    url: 'http://tokenlist.aave.eth.link',
  },
  {
    tag: 'MYCRYPTO',
    url: 'https://uniswap.mycryptoapi.com/',
  },
  // Breaks do-update-set double-insert ;(((
  // {
  //   tag: 'SUPERCHAIN',
  //   url: 'https://static.optimism.io/optimism.tokenlist.json',
  // },
]

const tokenListSources = lists.map(({ tag, url }) =>
  buildTokenListSource({
    tag,
    url,
    logger,
    db,
  }),
)

const coingeckoSource = buildCoingeckoSource({
  logger,
  db,
})

const axelarGatewaySource = buildAxelarGatewaySource({
  logger,
  db,
})

const onChainMetadataSources = networksConfig.map((networkConfig) =>
  buildOnChainMetadataSource({
    logger,
    db,
    networkConfig,
  }),
)

const pipeline = [
  coingeckoSource,
  ...tokenListSources,
  axelarGatewaySource,
  ...onChainMetadataSources,
]

for (const step of pipeline) {
  await step()
}

await stop()

async function stop() {
  await db.$disconnect()
}

process.on('SIGINT', () => stop)
