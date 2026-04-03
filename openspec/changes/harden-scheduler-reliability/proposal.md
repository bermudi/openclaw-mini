## Why

The scheduler service has multiple reliability gaps that cause silent task drops, database conflicts, and unbounded retry loops. The staged commit (`1880083`) added retry/backoff to maintenance API calls but left three other API call sites unprotected, and the delivery service uses a separate Prisma client from the scheduler's own, risking `SQLITE_BUSY` conflicts on concurrent writes.

## What Changes

- Add retry/backoff to `executeTaskViaApi`, `fireTriggerViaApi`, and `createTaskViaApi` — matching the pattern already applied to `runSchedulerMaintenanceViaApi`
- Fix dual Prisma client conflict: `processPendingDeliveries()` currently imports `db` from `@/lib/db` (a Next.js-oriented singleton) instead of using the scheduler's own Prisma client; refactor to accept a Prisma client parameter
- Add exponential backoff to `runTaskLoop` and `runTriggerLoop` on persistent failures to prevent log-spam hammering
- Make `runDeliveryLoop` interval configurable via runtime config instead of hardcoded `5000ms`
- Remove dead code: `recordTriggerFireViaApi` is never called and wraps `fireTriggerViaApi` confusingly
- Add response validation to all API call functions to handle non-JSON responses (e.g., 502 HTML error pages)

## Capabilities

### New Capabilities
- `scheduler-retry`: Retry/backoff for all scheduler-to-app API calls
- `scheduler-prisma-isolation`: Single Prisma client shared between scheduler loops and delivery processing
- `scheduler-loop-resilience`: Backoff on persistent failures in task/trigger loops, configurable delivery interval

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- `mini-services/scheduler/index.ts`: Retry logic added to 3 functions, dead code removed, loop backoff added
- `src/lib/services/delivery-service.ts`: `processPendingDeliveries()` and all `db`-using functions accept a Prisma client parameter instead of importing the singleton
- `mini-services/scheduler/index.ts`: Passes its Prisma client into delivery processing
- No public API changes; internal service reliability only