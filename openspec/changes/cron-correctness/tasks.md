## 1. Canonical Scheduling Foundation

- [ ] 1.1 Add `croner` and implement a shared time-trigger utility for UTC cron validation and `nextTrigger` calculation
- [ ] 1.2 Update trigger create/update flow to use the shared utility for cron scheduling instead of fixed fallbacks
- [ ] 1.3 Remove dead `InputManager` heartbeat/cron execution paths and their duplicate scheduling helpers

## 2. Authoritative Trigger Firing Flow

- [ ] 2.1 Extend `triggerService` with one authoritative fire path for enabled heartbeat/cron triggers
- [ ] 2.2 Refactor `/api/internal/triggers/[id]/fire` and the scheduler so scheduled fires go through the authoritative path instead of separate task and trigger update calls
- [ ] 2.3 Preserve existing heartbeat behavior while removing fake cron parser types and fixed cron fallbacks

## 3. Validation and Manual Fire

- [ ] 3.1 Validate cron expressions on trigger create/update and return clear validation errors
- [ ] 3.2 Add authenticated `POST /api/triggers/[id]/fire` for enabled heartbeat/cron triggers
- [ ] 3.3 Ensure manual fire enqueues the correct task shape and source without mutating `lastTriggered` or `nextTrigger`

## 4. Testing

- [ ] 4.1 Add deterministic unit tests for hourly/daily/weekly cron expressions, UTC evaluation, and invalid cron rejection
- [ ] 4.2 Add integration tests proving scheduled heartbeat/cron fires enqueue expected tasks and recompute `nextTrigger` correctly
- [ ] 4.3 Add integration tests for manual fire success, auth enforcement, unsupported trigger rejection, and schedule preservation
