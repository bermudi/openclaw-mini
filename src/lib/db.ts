import { PrismaClient } from '@prisma/client'
import { getPrismaLogConfig } from '@/lib/config/runtime'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: getPrismaLogConfig(),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db