import { Logger } from '@l2beat/backend-tools'

import { buildAxelarGatewaySource } from './sources/axelar-gateway.js'
import { buildCoingeckoSource } from './sources/coingecko.js'
import { buildTokenListSource } from './sources/tokenList.js'

import { createPrismaClient } from './db/prisma.js'
import { buildArbitrumCanonicalSource } from './sources/arbitrum-canonical.js'
import { buildAxelarConfigSource } from './sources/axelar-config.js'
import { buildOnChainMetadataSource } from './sources/onChainMetadata.js'
import { buildOptimismCanonicalSource } from './sources/optimism-canonical.js'
import { buildWormholeSource } from './sources/wormhole.js'
import { buildDeploymentSource } from './sources/deployment.js'
import { buildOrbitSource } from './sources/orbit.js'
import { getNetworksConfig, withExplorer } from './utils/getNetworksConfig.js'
import { buildLayerZeroV1Source } from './sources/layerzero-v1.js'

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
  {
    tag: 'SUPERCHAIN',
    url: 'https://static.optimism.io/optimism.tokenlist.json',
  },
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
const axelarConfigSource = buildAxelarConfigSource({ logger, db })

const wormholeSource = buildWormholeSource({ logger, db })

const orbitSource = buildOrbitSource({ logger, db })

const deploymentSources = networksConfig
  .filter(withExplorer)
  .map((networkConfig) =>
    buildDeploymentSource({
      logger,
      db,
      networkConfig,
    }),
  )

const arbitrumCanonicalSource = buildArbitrumCanonicalSource({
  logger,
  db,
  networksConfig,
})

const optimismCanonicalSource = buildOptimismCanonicalSource({
  logger,
  db,
  networksConfig,
})

const lzSources = networksConfig.filter(withExplorer).map((networkConfig) =>
  buildLayerZeroV1Source({
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
  axelarConfigSource,
  wormholeSource,
  ...deploymentSources,
  orbitSource,
  ...lzSources,

  // those 2 have to be after deployment sources
  arbitrumCanonicalSource,
  optimismCanonicalSource,
]

for (const step of pipeline) {
  try {
    await step()
  } catch (e) {
    logger.error('Failed to run step', { error: e })
  }
}

await stop()

async function stop() {
  await db.$disconnect()
}

process.on('SIGINT', () => stop)
