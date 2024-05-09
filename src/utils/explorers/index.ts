import { ExplorerType, NetworkExplorer, Prisma } from '@prisma/client'
import { buildEtherscanExplorer } from './etherscan.js'

export { instantiateExplorer }

export type { NetworkExplorerClient }

type NetworkExplorerClient = ReturnType<typeof buildEtherscanExplorer>

function instantiateExplorer(explorer: NetworkExplorer) {
  switch (explorer.type) {
    case ExplorerType.ETHERSCAN:
      return buildEtherscanExplorer(explorer.url, explorer.apiKey)
    default:
      throw new Error(`Unsupported explorer type: ${explorer.type}`)
  }
}
