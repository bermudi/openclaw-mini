import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Default log config for module load time - runtime config not available yet
const DEFAULT_PRISMA_LOG: ('error' | 'warn')[] = ['error', 'warn']

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: DEFAULT_PRISMA_LOG,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

export async function resetDbClientForTests(): Promise<void> {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect()
    globalForPrisma.prisma = undefined
  }
}
