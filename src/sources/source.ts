import type { Promisable } from 'type-fest'

export type Source = () => Promisable<void>

