## 1. Canonical Scheduling Foundation

- [x] 1.1 Add `croner` and implement a shared time-trigger utility for UTC cron validation and `nextTrigger` calculation
- [x] 1.2 Update trigger create/update flow to use the shared utility for cron scheduling instead of fixed fallbacks
- [x] 1.3 Remove dead `InputManager` heartbeat/cron execution paths and their duplicate scheduling helpers

## 2. Authoritative Trigger Firing Flow

- [x] 2.1 Extend `triggerService` with one authoritative fire path for enabled heartbeat/cron triggers
- [x] 2.2 Refactor `/api/internal/triggers/[id]/fire` and the scheduler so scheduled fires go through the authoritative path instead of separate task and trigger update calls
- [x] 2.3 Preserve existing heartbeat behavior while removing fake cron parser types and fixed cron fallbacks

## 3. Validation and Manual Fire

- [x] 3.1 Validate cron expressions on trigger create/update and return clear validation errors
- [x] 3.2 Add authenticated `POST /api/triggers/[id]/fire` for enabled heartbeat/cron triggers
- [x] 3.3 Ensure manual fire enqueues the correct task shape and source without mutating `lastTriggered` or `nextTrigger`

## 4. Testing

- [x] 4.1 Add deterministic unit tests for hourly/daily/weekly cron expressions, UTC evaluation, and invalid cron rejection
- [x] 4.2 Add integration tests proving scheduled heartbeat/cron fires enqueue expected tasks and recompute `nextTrigger` correctly
- [x] 4.3 Add integration tests for manual fire success, auth enforcement, unsupported trigger rejection, and schedule preservation
