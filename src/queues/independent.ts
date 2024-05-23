import { Logger } from '@l2beat/backend-tools'
import { Redis } from 'ioredis'
import { PrismaClient } from '../db/prisma.js'
import { setupQueue } from '../utils/queue/setup-queue.js'
import { setupQueueWithProcessor } from '../utils/queue/queue-with-processor.js'
import { TokenPayload } from './payloads.js'
import { wrapTokenQueue } from '../utils/queue/wrap.js'
import { buildCoingeckoSource } from '../sources/coingecko.js'
import { buildAxelarConfigSource } from '../sources/axelarConfig.js'
import { buildWormholeSource } from '../sources/wormhole.js'
import { buildOrbitSource } from '../sources/orbit.js'
import { buildTokenListSource } from '../sources/tokenList.js'
import { NetworkConfig } from '../utils/getNetworksConfig.js'
import { buildAxelarGatewaySource } from '../sources/axelarGateway.js'

export async function setupIndependentQueues({
  db,
  logger,
  connection,
  networksConfig,
}: {
  db: PrismaClient
  logger: Logger
  connection: Redis
  networksConfig: NetworkConfig[]
}) {
  const deps = {
    connection,
    logger,
  }
  const queue = setupQueue(deps)
  const queueWithProcessor = setupQueueWithProcessor(deps)

  const tokenUpdateInbox = queue<TokenPayload>({ name: 'TokenUpdateInbox' })
  const tokenUpdateQueue = wrapTokenQueue(tokenUpdateInbox)

  const lists = [
    { tag: '1INCH', url: 'https://tokens.1inch.eth.link' },
    { tag: 'AAVE', url: 'http://tokenlist.aave.eth.link' },
    { tag: 'MYCRYPTO', url: 'https://uniswap.mycryptoapi.com/' },
    {
      tag: 'SUPERCHAIN',
      url: 'https://static.optimism.io/optimism.tokenlist.json',
    },
  ]

  const coingecko = queueWithProcessor({
    name: 'CoingeckoProcessor',
    processor: buildCoingeckoSource({ logger, db, queue: tokenUpdateQueue }),
  })

  const axelarConfig = queueWithProcessor({
    name: 'AxelarConfigProcessor',
    processor: buildAxelarConfigSource({ logger, db, queue: tokenUpdateQueue }),
  })

  const wormhole = queueWithProcessor({
    name: 'WormholeProcessor',
    processor: buildWormholeSource({ logger, db, queue: tokenUpdateQueue }),
  })

  const orbit = queueWithProcessor({
    name: 'OrbitProcessor',
    processor: buildOrbitSource({ logger, db, queue: tokenUpdateQueue }),
  })

  const tokenLists = lists.map(({ tag, url }) =>
    queueWithProcessor({
      name: `TokenListProcessor:${tag}`,
      processor: buildTokenListSource({
        tag,
        url,
        logger,
        db,
        queue: tokenUpdateQueue,
      }),
    }),
  )

  const axelarGateway = networksConfig.map((networkConfig) =>
    queueWithProcessor({
      name: `AxelarGatewayProcessor:${networkConfig.name}`,
      processor: buildAxelarGatewaySource({
        logger,
        db,
        networkConfig,
        queue: tokenUpdateQueue,
      }),
    }),
  )

  async function start() {
    const statusLogger = logger.for('IndependentQueuesModule')
    statusLogger.info('Starting')

    coingecko.worker.run()
    axelarConfig.worker.run()
    wormhole.worker.run()
    orbit.worker.run()
    tokenLists.forEach(({ worker }) => worker.run())
    axelarGateway.forEach(({ worker }) => worker.run())

    statusLogger.info('Started')
  }

  return {
    start,
    sources: {
      coingecko,
      axelarConfig,
      wormhole,
      orbit,
      tokenLists,
      axelarGateway,
    },
    inbox: tokenUpdateInbox,
  }
}
