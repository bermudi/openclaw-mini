## Context

The scheduler (`mini-services/scheduler/index.ts`) is a standalone Bun process that polls for tasks, fires triggers, and processes deliveries. It communicates with the main Next.js app via HTTP API calls. The staged commit added retry/backoff to `runSchedulerMaintenanceViaApi` but left `executeTaskViaApi`, `fireTriggerViaApi`, and `createTaskViaApi` without retry. Additionally, `processPendingDeliveries()` imports `db` from `@/lib/db` — a separate Prisma client from the scheduler's own — creating two concurrent SQLite writers.

## Goals / Non-Goals

**Goals:**
- Eliminate silent task/trigger drops from transient API failures
- Use a single Prisma client across all scheduler database operations
- Prevent log-spam from persistent failures in polling loops
- Make delivery interval configurable

**Non-Goals:**
- Not changing the delivery retry logic itself (already has exponential backoff per-delivery)
- Not adding circuit breakers (backoff is sufficient for this scale)
- Not changing the HTTP API contract between scheduler and main app

## Decisions

### 1. Extract shared retry utility

**Decision:** Create a `retryWithBackoff()` helper function in the scheduler file and use it for all three API call sites.

**Rationale:** The retry logic in `runSchedulerMaintenanceViaApi` is already correct (exponential backoff, 3 retries, 500ms base). Extracting it avoids duplicating the same pattern three more times and makes it easy to tune globally.

**Alternatives considered:**
- Inline retry in each function → duplication, harder to maintain
- External retry library → unnecessary dependency for a simple pattern

### 2. Pass Prisma client to delivery service

**Decision:** Refactor `processPendingDeliveries()` and all internal `db`-using functions in `delivery-service.ts` to accept an optional `PrismaClient` parameter. When called from the scheduler, pass the scheduler's client. When called from the main app, use the default `db` singleton.

**Rationale:** Minimal API change. The delivery service is already structured with a `DbClient` type alias. Adding a parameter with a default value preserves backward compatibility for the main app while allowing the scheduler to inject its own client.

**Alternatives considered:**
- Create a separate `delivery-service-scheduler.ts` → code duplication
- Dependency injection via constructor → overkill for a two-consumer module

### 3. Loop backoff via stateful delay

**Decision:** Track consecutive failure counts per loop (`taskLoopFailures`, `triggerLoopFailures`) and multiply the poll interval by `2^failures` (capped at 60s). Reset to 0 on success.

**Rationale:** Simple, no new dependencies. The backoff is per-loop, not global, so one loop failing doesn't affect others. Capping at 60s prevents excessive delays.

**Alternatives considered:**
- Full circuit breaker pattern → overkill for this scale
- Fixed additional delay → less adaptive to prolonged outages

### 4. Remove `recordTriggerFireViaApi`

**Decision:** Delete this dead function. It wraps `fireTriggerViaApi` but discards the returned data and never uses its `nextTrigger` parameter.

**Rationale:** Dead code that confuses the API surface. If recording trigger state is needed later, it should be done properly with the `nextTrigger` value.

### 5. Validate JSON responses

**Decision:** Check `response.headers.get('content-type')` includes `application/json` before calling `response.json()`. Fall back to reading `response.text()` and including it in the error message.

**Rationale:** Handles 502/503 responses from reverse proxies that return HTML error pages.

## Risks / Trade-offs

- **[Risk]** Passing Prisma client through delivery service changes function signatures → **Mitigation**: Default parameter preserves backward compatibility; only scheduler call sites need updating
- **[Risk]** Loop backoff delays task processing during outages → **Mitigation**: This is intentional — hammering a down app is worse than waiting
- **[Risk]** Removing `recordTriggerFireViaApi` breaks any external caller → **Mitigation**: Grep confirms it's never called anywhere in the codebase
- **[Trade-off]** Retry utility is scheduler-local, not shared with main app → acceptable; the main app has different retry needs (user-facing vs. internal)