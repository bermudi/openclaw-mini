## Status: STALE (2026-04-03)

This change was written against the old topology architecture where the scheduler was a separate mini-service with HTTP callbacks to the Next.js app. After the `runtime-reforge` change, the architecture is unified:

- The `mini-services/scheduler/` directory has been deleted
- The runtime now uses in-process service wrappers in `src/lib/runtime/service-api.ts`
- There's no longer a separate Prisma client conflict (just one shared `db` import)
- The ViaApi functions are now direct service calls, not HTTP API calls

The underlying concerns (retry/backoff, error handling) may still be valid but need re-evaluation against the new unified runtime architecture.

---

## Why (Original - Pre-Runtime-Reforge)

The scheduler service has multiple reliability gaps that cause silent task drops, database conflicts, and unbounded retry loops. The staged commit (`1880083`) added retry/backoff to maintenance API calls but left three other API call sites unprotected, and the delivery service uses a separate Prisma client from the scheduler's own, risking `SQLITE_BUSY` conflicts on concurrent writes.

## What Changes (Original)

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

## Impact (Original - Files No Longer Exist)

- `mini-services/scheduler/index.ts`: **DELETED** - Retry logic would need to go in `src/lib/runtime/lifecycle.ts`
- `src/lib/services/delivery-service.ts`: `processPendingDeliveries()` now uses shared `db` import (no longer a parameter)
- `mini-services/scheduler/index.ts`: **DELETED**
- No public API changes; internal service reliability only