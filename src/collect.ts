import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js'
import { ExpressAdapter } from '@bull-board/express'
import { Logger } from '@l2beat/backend-tools'
import { Token } from '@prisma/client'
import express from 'express'
import { nanoid } from 'nanoid'
import { connection } from './redis/redis.js'
import { setupCollector } from './utils/queue/aggregates/collector.js'
import { setupQueue } from './utils/queue/setup-queue.js'
import { setupWorker } from './utils/queue/setup-worker.js'

type TokenPayload = { tokenId: Token['id'] }

const logger = new Logger({ format: 'pretty', colors: true })

const heavyInboxQueue = setupQueue<TokenPayload>({
  connection,
  name: 'HeavyInbox',
})
const lightOutboxQueue = setupQueue<{ tokenIds: string[] }>({
  connection,
  name: 'LightOutbox',
})

setupCollector<TokenPayload, { tokenIds: string[] }>({
  inputQueue: heavyInboxQueue,
  outputQueue: lightOutboxQueue,
  aggregate: (data) => ({ tokenIds: data.map((d) => d.tokenId) }),
  bufferSize: 5,
  flushInterval: 1000_0000,
  connection,
  logger,
})

setupWorker<{ tokenIds: string[] }>({
  queue: lightOutboxQueue,
  connection,
  processor: async (job) => {
    await Promise.resolve()
    console.log('Heeeey!, i just got some collectibles!!!', job.data)
  },
  logger,
})

// #endregion Independent sources

// #region BullBoard

const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/admin/queues')

const allQueues = [heavyInboxQueue, lightOutboxQueue].flat()

createBullBoard({
  queues: allQueues.map((q) => new BullMQAdapter(q)),
  serverAdapter: serverAdapter,
})

const app = express()

app.use('/admin/queues', serverAdapter.getRouter())
app.post('/add-token', (_req, res) => {
  const id = nanoid()

  heavyInboxQueue.add('TokenUpdated', { tokenId: id })

  return res.status(201).send({
    msg: 'Token added to the queue',
    tokenId: id,
  })
})

app.listen(3000, () => {
  console.log('Running on 3000...')
  console.log('For the UI, open http://localhost:3000/admin/queues')
})

// #endregion BullBoard
