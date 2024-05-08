import { Logger } from '@l2beat/backend-tools'
import type { Promisable } from 'type-fest'

export type Source = ({ logger }: { logger: Logger }) => Promisable<void>
