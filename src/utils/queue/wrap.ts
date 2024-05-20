import { Queue } from 'bullmq'

export type TokenUpdateQueue = ReturnType<typeof wrapTokenQueue>
export type DeploymentUpdatedQueue = ReturnType<
  typeof wrapDeploymentUpdatedQueue
>

export function wrapTokenQueue(queue: Queue) {
  return {
    add: async (tokenId: string) => {
      await queue.add('TokenUpdateRequest', { tokenId }, { jobId: tokenId })
    },
  }
}

export function wrapDeploymentUpdatedQueue(queue: Queue) {
  return {
    add: async (tokenId: string) => {
      await queue.add('DeploymentUpdated', { tokenId }, { jobId: tokenId })
    },
  }
}
