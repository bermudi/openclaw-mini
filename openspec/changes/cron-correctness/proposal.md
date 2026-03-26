## Why

Cron scheduling currently has two broken paths: one path ignores the cron expression entirely, and another path calls a parser API that does not exist. This creates silent scheduling drift and makes trigger behavior untrustworthy.

## What Changes

- Establish one canonical cron parsing/scheduling utility shared by InputManager and scheduler
- Validate cron expressions at creation/update time and reject invalid expressions
- Compute `nextRunAt` from the real expression rather than fixed fallbacks
- Add deterministic tests for representative cron patterns and edge conditions

## Capabilities

### New Capabilities

- `cron-scheduling`: canonical cron parsing, validation, and next-run calculation

## Impact

- `src/lib/services/input-manager.ts`
- `mini-services/scheduler/index.ts`
- Trigger creation/update validation flow
- Scheduler trigger execution loop and tests
