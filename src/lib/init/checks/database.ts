// OpenClaw Agent Runtime - Database Check
// Validates DB connection and migration status

import { db } from '@/lib/db';
import type { CheckResult } from '../types';

const DB_CHECK_TIMEOUT_MS = 10000; // 10 seconds

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${context} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export async function checkDatabase(): Promise<CheckResult> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return {
      success: false,
      error: 'DATABASE_URL environment variable is not set',
      guidance: 'Set DATABASE_URL to your database connection string (e.g., file:./dev.db for SQLite)',
    };
  }

  // Only SQLite is supported at this time - fail fast with clear guidance for other databases
  if (!databaseUrl.startsWith('file:') && !databaseUrl.startsWith('sqlite:')) {
    return {
      success: false,
      error: 'Only SQLite is supported at this time',
      guidance: 'Use a file-based SQLite database (e.g., DATABASE_URL="file:./dev.db")',
    };
  }

  try {
    // Test connection by running a simple query with timeout
    await withTimeout(
      db.$queryRaw`SELECT 1`,
      DB_CHECK_TIMEOUT_MS,
      'Database connection check'
    );

    // Check if migrations have been applied by looking for _prisma_migrations table
    // For SQLite, we can check if the table exists
    const migrationCheck = await withTimeout(
      db.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='_prisma_migrations'
      `,
      DB_CHECK_TIMEOUT_MS,
      'Migration table check'
    );

    if (migrationCheck.length === 0) {
      // No migrations table - database might be fresh
      // Check if any of our tables exist
      const tablesCheck = await withTimeout(
        db.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name IN ('agents', 'tasks', 'sessions', 'memory_chunks', 'memory_index_states')
        `,
        DB_CHECK_TIMEOUT_MS,
        'Tables existence check'
      );

      if (tablesCheck.length === 0) {
        return {
          success: false,
          error: 'Database has not been migrated',
          guidance: 'Run database migrations: bunx prisma migrate deploy or bunx prisma db push',
        };
      }
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `Database connection failed: ${message}`,
      guidance: 'Ensure the database is accessible and DATABASE_URL is correct',
    };
  }
}
