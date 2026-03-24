// OpenClaw Agent Runtime - Database Check
// Validates DB connection and migration status

import { db } from '@/lib/db';
import type { CheckResult } from '../types';

export async function checkDatabase(): Promise<CheckResult> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return {
      success: false,
      error: 'DATABASE_URL environment variable is not set',
      guidance: 'Set DATABASE_URL to your database connection string (e.g., file:./dev.db for SQLite)',
    };
  }

  try {
    // Test connection by running a simple query
    await db.$queryRaw`SELECT 1`;

    // Check if migrations have been applied by looking for _prisma_migrations table
    // For SQLite, we can check if the table exists
    const migrationCheck = await db.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='_prisma_migrations'
    `;

    if (migrationCheck.length === 0) {
      // No migrations table - database might be fresh
      // Check if any of our tables exist
      const tablesCheck = await db.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('agents', 'tasks', 'sessions')
      `;

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
