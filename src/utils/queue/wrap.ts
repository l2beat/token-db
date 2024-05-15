import { Queue } from 'bullmq'

export type TokenUpdateQueue = ReturnType<typeof wrapTokenQueue>

export function wrapTokenQueue(queue: Queue) {
  return {
    add: (tokenId: string) => {
      return queue.add('TokenUpdateRequest', { tokenId }, { jobId: tokenId })
    },
  }
}
