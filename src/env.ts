import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string(),
  COINGECKO_KEY: z.string().optional(),
  PRISMA_QUERY_LOG: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  AXELAR_CONFIG_URL: z
    .string()
    .default(
      'https://axelar-mainnet.s3.us-east-2.amazonaws.com/mainnet-asset-config.json',
    ),
})

export const env = (() => {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    // TODO: better env parsing errors
    console.error(result.error.errors)
    process.exit(1)
  }
  return result.data
})()
