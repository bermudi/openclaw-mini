## Why

Cron-backed triggers are not trustworthy today: trigger creation, scheduler rescheduling, and an unwired input path each claim to support cron expressions but compute different fallback times instead. Operators also have no safe way to manually fire a time-based trigger for testing or one-off override without waiting for the next scheduled window.

## What Changes

- Establish one canonical scheduling utility backed by a single cron library and use it at trigger write time and scheduled execution time
- Validate cron expressions at creation/update time and reject invalid expressions with clear errors
- Consolidate time-based trigger firing behind one authoritative service path instead of split task-creation and trigger-update flows
- Remove unused `InputManager` cron/heartbeat execution paths that duplicate scheduling logic without being wired
- Add an authenticated manual fire operation for heartbeat and cron triggers that supports testing and one-off override without mutating schedule state
- Add deterministic tests for cron calculation, rescheduling, validation, and manual fire behavior

## Capabilities

### New Capabilities

- `cron-scheduling`: canonical cron parsing, validation, UTC scheduling policy, and accurate `nextTrigger` calculation for time-based triggers
- `trigger-manual-fire`: authenticated manual execution of heartbeat and cron triggers for testing and override

### Modified Capabilities

- (none)

## Impact

- `src/lib/services/input-manager.ts`
- `src/lib/services/trigger-service.ts`
- `mini-services/scheduler/index.ts`
- `src/app/api/internal/triggers/[id]/fire/route.ts`
- `src/app/api/triggers/[id]/fire/route.ts`
- Trigger creation/update validation flow
- Scheduler trigger execution loop and manual fire route tests
- New dependency on `croner`
