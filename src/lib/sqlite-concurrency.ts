import { PrismaClient } from '@prisma/client';

const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_BUSY_RETRY_DELAYS_MS = [25, 50, 100, 200] as const;
type PrismaExtendedClient = PrismaClient & {
  $extends: (extension: {
    query: {
      $allModels: {
        $allOperations: (context: {
          model?: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) => Promise<unknown>;
      };
    };
  }) => PrismaClient;
};

type SqliteBusyMetrics = {
  busyEvents: number;
  retryAttempts: number;
  retrySuccesses: number;
  retryExhausted: number;
};

type SqliteConcurrencyQueryExtension = {
  query: {
    $allModels: {
      $allOperations: (context: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  };
};

const WRITE_ACTIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const sqlitePragmaClients = new WeakMap<PrismaClient, Promise<void>>();

const sqliteBusyMetrics: SqliteBusyMetrics = {
  busyEvents: 0,
  retryAttempts: 0,
  retrySuccesses: 0,
  retryExhausted: 0,
};

function isSqliteDatabase(): boolean {
  return (process.env.DATABASE_URL ?? '').startsWith('file:');
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isSqliteBusyError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /SQLITE_BUSY|database is locked/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function applySqlitePragmas(client: PrismaClient, scope: string): Promise<void> {
  if (!isSqliteDatabase()) {
    return;
  }

  const existing = sqlitePragmaClients.get(client);
  if (existing) {
    return existing;
  }

  const init = (async () => {
    await client.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await client.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    console.info(`[SQLite] Applied WAL and busy_timeout for ${scope}`);
  })();

  sqlitePragmaClients.set(client, init);

  try {
    await init;
  } catch (error) {
    sqlitePragmaClients.delete(client);
    throw error;
  }
}

export function buildSqliteConcurrencyQueryExtension(scope: string, ready?: Promise<void>): SqliteConcurrencyQueryExtension {
  return {
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (ready && model && WRITE_ACTIONS.has(operation)) {
            await ready;
          }

          if (!model || !WRITE_ACTIONS.has(operation)) {
            return query(args);
          }

          return retrySqliteBusy(`${scope}:${model}.${operation}`, () => query(args));
        },
      },
    },
  };
}

export function extendSqliteConcurrencyClient(
  client: PrismaClient,
  scope: string,
  ready?: Promise<void>,
) : PrismaClient {
  if (!isSqliteDatabase()) {
    return client;
  }

  const extendedClient = client as PrismaExtendedClient;

  if (typeof extendedClient.$extends !== 'function') {
    return client;
  }

  return extendedClient.$extends(buildSqliteConcurrencyQueryExtension(scope, ready)) as unknown as PrismaClient;
}

export async function retrySqliteBusy<T>(operation: string, action: () => Promise<T>): Promise<T> {
  let retries = 0;

  while (true) {
    try {
      const result = await action();

      if (retries > 0) {
        sqliteBusyMetrics.retrySuccesses += 1;
        console.info('[SQLite] Busy retry succeeded', { operation, retryCount: retries });
      }

      return result;
    } catch (error) {
      if (!isSqliteBusyError(error)) {
        throw error;
      }

      sqliteBusyMetrics.busyEvents += 1;

      if (retries >= SQLITE_BUSY_RETRY_DELAYS_MS.length) {
        sqliteBusyMetrics.retryExhausted += 1;
        console.error('[SQLite] Busy retry exhausted', {
          operation,
          retryCount: retries,
          error: getErrorMessage(error),
        });
        throw error;
      }

      const delay = SQLITE_BUSY_RETRY_DELAYS_MS[retries];
      retries += 1;
      sqliteBusyMetrics.retryAttempts += 1;

      console.warn('[SQLite] Busy lock detected', {
        operation,
        retryCount: retries,
        maxRetries: SQLITE_BUSY_RETRY_DELAYS_MS.length,
        delayMs: delay,
      });

      await sleep(delay);
    }
  }
}

export function getSqliteBusyMetrics(): SqliteBusyMetrics & { retrySuccessRate: number | null } {
  const completedRetrySeries = sqliteBusyMetrics.retrySuccesses + sqliteBusyMetrics.retryExhausted;

  return {
    ...sqliteBusyMetrics,
    retrySuccessRate: completedRetrySeries === 0 ? null : sqliteBusyMetrics.retrySuccesses / completedRetrySeries,
  };
}

export function getSqliteBusyFailureMessage(): string {
  return 'SQLite remained locked after bounded retries; retry later or route the operation through the single-writer API.';
}

export function resetSqliteBusyMetricsForTests(): void {
  sqliteBusyMetrics.busyEvents = 0;
  sqliteBusyMetrics.retryAttempts = 0;
  sqliteBusyMetrics.retrySuccesses = 0;
  sqliteBusyMetrics.retryExhausted = 0;
}
