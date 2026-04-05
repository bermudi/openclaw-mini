import { Prisma, PrismaClient } from '@prisma/client'
import { applySqlitePragmas, extendSqliteConcurrencyClient } from '@/lib/sqlite-concurrency'
import { snapshotEnv, restoreEnvSnapshot } from '@/lib/env-snapshot'

export function createConfiguredPrismaClient(options?: {
  log?: Prisma.LogLevel[]
  scope?: string
}): {
  client: PrismaClient
  ready: Promise<void>
} {
  const envSnap = snapshotEnv()
  const baseClient = new PrismaClient({
    log: options?.log,
  })
  restoreEnvSnapshot(envSnap)
  const scope = options?.scope ?? 'prisma'
  let resolveReady: (() => void) | undefined
  let rejectReady: ((error: unknown) => void) | undefined

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  void ready.catch(() => undefined)

  const client = extendSqliteConcurrencyClient(baseClient, scope, ready)

  void applySqlitePragmas(baseClient, scope)
    .then(() => resolveReady?.())
    .catch((error) => {
      console.error(`[SQLite] Failed to configure ${scope} connection:`, error)
      rejectReady?.(error)
    })

  return { client, ready }
}
