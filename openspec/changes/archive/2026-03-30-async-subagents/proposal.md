## Why

`spawn_subagent` blocks the supervisor LLM in a polling loop until the child completes — the supervisor cannot respond to the user, redirect work, or cancel mid-execution. For short tasks this is acceptable; for long-running research, coding, or multi-subagent orchestration it makes the system feel frozen and removes all mid-flight control.

## What Changes

- Add `spawn_subagent_async` tool: dispatches a subagent and returns the child task ID immediately without polling
- Add `check_subagent` tool: queries the current status and result of a previously dispatched async subagent by task ID
- Add `cancel_subagent` tool: marks a pending or processing subagent task as cancelled
- Add `list_subagents` tool: lists all async subagent tasks tracked in the current session with live status
- Add a durable async task registry stored in session state that survives context compaction — task IDs are never just tool message content
- The existing blocking `spawn_subagent` is unchanged; both patterns coexist

## Capabilities

### New Capabilities

- `async-subagent-dispatch`: The non-blocking spawn mechanism — creates a child task, registers it in the session's async task registry, and returns the task ID without entering a polling loop
- `async-subagent-control`: The supervisor-facing tools (`check_subagent`, `cancel_subagent`, `list_subagents`) that act on async tasks tracked in the registry
- `async-task-registry`: A durable per-session store of async task records (task ID, skill, status, timestamps) persisted in the DB and loaded into the tool execution context, independent of message history

### Modified Capabilities

- `subagent-lifecycle`: Cancellation becomes a first-class termination state alongside `completed` and `failed`; the orphaned-sweep must also handle cancelled tasks

## Impact

- `src/lib/tools.ts` — three new tools registered alongside `spawn_subagent`
- `src/lib/services/task-queue.ts` — new `cancelTask()` method
- `src/lib/services/agent-executor.ts` — tool execution context gains async task registry load/save
- `prisma/schema.prisma` — new `AsyncTaskRecord` table (or JSON column on Session) for registry persistence
- `src/lib/services/session-service.ts` — helpers to read/write the async task registry
- No changes to adapter layer, delivery, or memory systems
- Compatible with `session-history-summarization` change: the registry is a separate state channel, not part of message history
