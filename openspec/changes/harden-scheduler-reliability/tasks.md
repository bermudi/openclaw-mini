## 1. Extract shared retry utility

- [ ] 1.1 Create `retryWithBackoff()` helper function in scheduler with configurable retries (default 3) and base delay (default 500ms)
- [ ] 1.2 Add response validation: check content-type before `response.json()`, fall back to `response.text()` with truncated error message

## 2. Add retry to scheduler API calls

- [ ] 2.1 Wrap `executeTaskViaApi` with `retryWithBackoff()`
- [ ] 2.2 Wrap `fireTriggerViaApi` with `retryWithBackoff()`
- [ ] 2.3 Wrap `createTaskViaApi` with `retryWithBackoff()`
- [ ] 2.4 Remove dead function `recordTriggerFireViaApi` and its export

## 3. Fix dual Prisma client conflict in delivery service

- [ ] 3.1 Refactor `processPendingDeliveries()` to accept optional `PrismaClient` parameter, defaulting to `db` for backward compatibility
- [ ] 3.2 Refactor `dispatchDelivery()` to accept optional `PrismaClient` parameter
- [ ] 3.3 Refactor `markDeliveryFailed()` to accept optional `PrismaClient` parameter
- [ ] 3.4 Update scheduler's `runDeliveryLoop` to pass `getSchedulerPrisma()` to `processPendingDeliveries()`

## 4. Add loop backoff for persistent failures

- [ ] 4.1 Add `taskLoopFailures` counter and apply exponential backoff in `runTaskLoop` (capped at 60s, reset on success)
- [ ] 4.2 Add `triggerLoopFailures` counter and apply exponential backoff in `runTriggerLoop` (capped at 60s, reset on success)

## 5. Make delivery interval configurable

- [ ] 5.1 Replace hardcoded `5000` in `runDeliveryLoop` with `getRuntimeConfig().performance.pollInterval`

## 6. Verify and test

- [ ] 6.1 Run existing tests to ensure no regressions
- [ ] 6.2 Verify scheduler starts and processes tasks/deliveries correctly with the changes