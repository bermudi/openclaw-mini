## Why

OpenClaw currently has multiple processes writing to the same SQLite database, which creates lock contention (`SQLITE_BUSY`) and inconsistent write behavior under load. We need one explicit strategy so runtime behavior is predictable and recoverable.

## What Changes

- Adopt a single-writer strategy while remaining on SQLite
- Route all task/trigger/delivery state mutations through authoritative Next.js APIs instead of cross-process direct Prisma writes
- Configure SQLite for improved contention handling (`WAL`, `busy_timeout`) and explicit retry policy for transient lock errors
- Add observability for lock contention and retries

## Capabilities

### New Capabilities

- `storage-concurrency`: guarantees and guardrails for SQLite access patterns

## Impact

- Scheduler loops that currently write via direct Prisma
- Database connection initialization and PRAGMA setup
- Shared persistence services that currently assume local writes are always available
