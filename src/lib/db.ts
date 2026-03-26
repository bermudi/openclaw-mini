import { PrismaClient } from '@prisma/client'
import { createConfiguredPrismaClient } from '@/lib/prisma-client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaReady: Promise<void> | undefined
}

// Default log config for module load time - runtime config not available yet
const DEFAULT_PRISMA_LOG: ('error' | 'warn')[] = ['error', 'warn']

const configuredPrisma = globalForPrisma.prisma
  ? {
      client: globalForPrisma.prisma,
      ready: globalForPrisma.prismaReady ?? Promise.resolve(),
    }
  : createConfiguredPrismaClient({
      log: DEFAULT_PRISMA_LOG,
      scope: 'nextjs',
    })

export const db = configuredPrisma.client
export const dbReady = configuredPrisma.ready

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
  globalForPrisma.prismaReady = dbReady
}

export async function resetDbClientForTests(): Promise<void> {
  await (globalForPrisma.prismaReady ?? Promise.resolve())

  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect()
  }

  globalForPrisma.prisma = undefined
  globalForPrisma.prismaReady = undefined
}
