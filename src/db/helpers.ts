import { Prisma } from '@prisma/client'
import { PrismaClient } from './prisma.js'
import { nanoid } from 'nanoid'
import { Simplify } from 'type-fest'

export type UpsertTokenMetaInput = Simplify<
  Omit<Prisma.TokenMetaCreateManyInput, 'id'>
>

export async function upsertTokenMeta(
  db: PrismaClient,
  { tokenId, source, ...meta }: UpsertTokenMetaInput,
) {
  const { id: tokenMetaId } = await db.tokenMeta.upsert({
    select: { id: true },
    where: {
      tokenId_source: {
        tokenId,
        source,
      },
    },
    create: {
      id: nanoid(),
      tokenId,
      source,
      ...meta,
    },
    update: {
      ...meta,
    },
  })

  return tokenMetaId
}

export type UpsertTokenWithMetaInput = Simplify<
  Omit<Prisma.TokenCreateManyInput, 'id'> &
    Omit<Prisma.TokenMetaCreateManyInput, 'id' | 'tokenId'>
>

export async function upsertTokenWithMeta(
  db: PrismaClient,
  { networkId, address, source, ...meta }: UpsertTokenWithMetaInput,
) {
  const token = { networkId, address }

  const { id: tokenId } = await db.token.upsert({
    select: { id: true },
    where: {
      networkId_address: {
        ...token,
      },
    },
    create: {
      id: nanoid(),
      ...token,
    },
    update: {},
  })

  const { id: tokenMetaId } = await db.tokenMeta.upsert({
    select: { id: true },
    where: {
      tokenId_source: {
        tokenId,
        source,
      },
    },
    create: {
      id: nanoid(),
      tokenId,
      source,
      ...meta,
    },
    update: {
      ...meta,
    },
  })

  return { tokenId, tokenMetaId }
}

export async function upsertManyTokenMeta(
  db: PrismaClient,
  metas: UpsertTokenMetaInput[],
) {
  await db.tokenMeta.upsertMany({
    data: metas.map((meta) => ({
      id: nanoid(),
      ...meta,
    })),
    conflictPaths: ['tokenId', 'source'],
  })
}

export async function upsertManyTokensWithMeta(
  db: PrismaClient,
  tokens: UpsertTokenWithMetaInput[],
) {
  await db.token.upsertMany({
    data: tokens.map((token) => ({
      id: nanoid(),
      networkId: token.networkId,
      address: token.address,
    })),
    conflictPaths: ['networkId', 'address'],
  })

  const tokenEntities = await db.token.findMany({
    select: { id: true, networkId: true, address: true },
    where: {
      OR: tokens.map((token) => ({
        networkId: token.networkId,
        address: token.address,
      })),
    },
  })

  const tokenIds = Object.fromEntries(
    tokenEntities.map((token) => [
      `${token.networkId}_${token.address}`,
      token.id,
    ]),
  )

  await db.tokenMeta.upsertMany({
    data: tokens.map(({ networkId, address, ...meta }) => ({
      id: nanoid(),
      tokenId: tokenIds[`${networkId}_${address}`] ?? '',
      ...meta,
    })),
    conflictPaths: ['tokenId', 'source'],
  })
}
