import { z } from 'zod'

export { buildEtherscanExplorer }

function buildEtherscanExplorer(apiUrl: string, apiKey: string) {
  async function call(
    module: string,
    action: string,
    params: Record<string, string>,
  ) {
    const query = new URLSearchParams({
      module,
      action,
      ...params,
      apikey: apiKey,
    })
    const url = `${apiUrl}?${query.toString()}`

    const res = await fetch(url)
    const json = await res.json()
    const response = EtherscanResponse.parse(json)

    return response
  }

  async function getContractDeployment(address: `0x${string}`) {
    const response = await call('contract', 'getcontractcreation', {
      contractaddresses: address,
    })
    if (response.message === 'No data found') {
      return undefined
    }
    if (response.message !== 'OK') {
      throw new Error(`Unexpected response: ${response.message}`)
    }
    return GetContractCreationResult.parse(response.result)[0]!
  }

  return {
    getContractDeployment,
  }
}

export type EtherscanResponse = z.infer<typeof EtherscanResponse>
const EtherscanResponse = z.object({
  message: z.string(),
  result: z.unknown().optional(),
})

export type ContractCreatorAndCreationTxHash = z.infer<
  typeof ContractCreatorAndCreationTxHash
>
export const ContractCreatorAndCreationTxHash = z.object({
  contractAddress: z.string(),
  contractCreator: z.string(),
  txHash: z.string(),
})

export const GetContractCreationResult = z
  .array(ContractCreatorAndCreationTxHash)
  .length(1)
