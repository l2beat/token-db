import { Logger } from '@l2beat/backend-tools'
import { PrismaClient } from '../db/prisma.js'
import { NetworkConfig, withExplorer } from '../utils/getNetworksConfig.js'
import { Redis } from 'ioredis'
import { eventRouter } from '../utils/queue/router/index.js'
import { setupQueueWithProcessor } from '../utils/queue/queue-with-processor.js'
import { TokenPayload } from './payloads.js'
import { wrapDeploymentUpdatedQueue } from '../utils/queue/wrap.js'
import { setupQueue } from '../utils/queue/setup-queue.js'
import { buildDeploymentSource } from '../sources/deployment.js'
import { byTokenChainId } from '../utils/queue/router/routing-key-rules.js'

export async function setupDeploymentQueues({
  connection,
  db,
  logger,
  networksConfig,
}: {
  connection: Redis
  db: PrismaClient
  logger: Logger
  networksConfig: NetworkConfig[]
}) {
  const deps = {
    connection,
    logger,
  }

  const router = eventRouter(deps)
  const queue = setupQueue(deps)
  const queueWithProcessor = setupQueueWithProcessor(deps)

  // Routing inbox where TokenUpdate events are broadcasted from independent sources
  const routingInbox = queue<TokenPayload>({ name: 'DeploymentRoutingInbox' })

  // Output queue for the deployment processors where the tokenIds are broadcasted if the deployment is updated
  const updatedInbox = queue<TokenPayload>({ name: 'DeploymentUpdatedInbox' })
  const updatedQueue = wrapDeploymentUpdatedQueue(updatedInbox)

  // For each supported network with an explorer, create a deployment processor
  const buses = networksConfig.filter(withExplorer).map((networkConfig) => {
    const processor = buildDeploymentSource({
      logger,
      db,
      networkConfig,
      queue: updatedQueue,
    })
    const { queue, worker } = queueWithProcessor<TokenPayload>({
      name: `DeploymentProcessor:${networkConfig.name}`,
      processor: (job) => processor(job.data.tokenId),
    })

    return { queue, worker, routingKey: networkConfig.chainId }
  })

  // Route the events from routing inbox to the per-chain deployment processors
  const routeingWorker = router.routingKey({
    from: routingInbox,
    to: buses,
    extractRoutingKey: byTokenChainId({ db }),
  })

  async function start() {
    const statusLogger = logger.for('DeploymentQueuesModule')

    buses.forEach(({ worker }) => worker.run())
    routeingWorker.run()

    statusLogger.info('Started')
  }

  return {
    start,
    routing: {
      inbox: routingInbox,
      worker: routeingWorker,
    },
    update: {
      inbox: updatedInbox,
    },
    buses,
  }
}
