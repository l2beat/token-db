import { ExplorerType, NetworkExplorer } from '@prisma/client'
import { buildEtherscanExplorer } from './etherscan.js'

export { instantiateExplorer }

export type { NetworkExplorerClient }

type NetworkExplorerClient = ReturnType<typeof buildEtherscanExplorer>

function instantiateExplorer(explorer: NetworkExplorer) {
  switch (explorer.type) {
    case ExplorerType.Etherscan:
      return buildEtherscanExplorer(explorer.url, explorer.apiKey)
    default:
      throw new Error(`Unsupported explorer type: ${explorer.type}`)
  }
}
