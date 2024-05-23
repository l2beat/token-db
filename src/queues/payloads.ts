import { Token } from '@prisma/client'

export type TokenPayload = { tokenId: Token['id'] }
export type BatchTokenPayload = { tokenIds: Token['id'][] }
