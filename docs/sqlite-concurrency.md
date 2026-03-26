# SQLite concurrency strategy

OpenClaw Mini now treats the Next.js app as the single authoritative SQLite writer for task, trigger, and delivery lifecycle state.

## Write-path inventory

- `mini-services/scheduler/index.ts` still reads agents, pending tasks, and due triggers directly with Prisma.
- Task creation already routes through `POST /api/tasks`.
- Task execution already routes through `POST /api/tasks/:id/execute`.
- Trigger fire acknowledgements now route through `POST /api/internal/triggers/:id/fire`.
- Delivery processing, orphan sweeping, task cleanup, history archive cleanup, and memory confidence decay now route through `POST /api/scheduler/health`.
- `mini-services/openclaw-ws/index.ts` does not write to SQLite.

## SQLite contention settings

- Every Prisma client now applies `PRAGMA journal_mode = WAL`.
- Every Prisma client now applies `PRAGMA busy_timeout = 5000`.
- SQLite write operations retry bounded `SQLITE_BUSY` failures with backoff delays of `25ms`, `50ms`, `100ms`, and `200ms`.

## Retries exhausted

- The system emits structured lock logs with the operation name and retry count on every contention event.
- In-memory counters track busy events, retry attempts, retry successes, retry exhaustion count, and retry success rate.
- If SQLite remains locked after the bounded retries, the write fails explicitly and internal APIs return `503` with guidance to retry later through the single-writer API.
