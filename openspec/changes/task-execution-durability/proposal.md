## Why

Task execution coordination currently relies on in-memory process state (`processing` map), and agent status can remain stuck in `busy` after failure/crash paths. This causes duplicate execution and deadlocked agents.

## What Changes

- Replace in-memory execution lock assumptions with durable database-backed claiming semantics
- Add crash-recovery sweep for stale `processing` tasks and stale `busy` agent states
- Ensure parent-task failure propagates to children exactly once
- Add explicit lifecycle telemetry for claim/release/recovery transitions

## Capabilities

### New Capabilities

- `task-execution-durability`: durable per-agent execution coordination and recovery

## Impact

- `src/lib/services/task-queue.ts`
- `src/lib/services/agent-executor.ts`
- Scheduler recovery loops
- Agent status transitions and failure handling
