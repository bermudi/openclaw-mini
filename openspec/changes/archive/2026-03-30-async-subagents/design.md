## Context

The current `spawn_subagent` tool creates a child task then polls its status in a `while` loop with exponential backoff, blocking the supervisor LLM's execution until the child completes or times out. The task queue already persists all state in SQLite via Prisma — tasks have stable IDs, explicit status transitions, and parent/child linkage via `parentTaskId`. The infrastructure for non-blocking dispatch already exists; what's missing is the surface that lets the supervisor hand off a task ID and come back later.

The critical constraint: deep agents compact their message history when context fills up (see `session-history-summarization` change). If async task IDs live only in tool messages, they vanish at compaction time and the supervisor loses all ability to check or cancel those tasks. The registry must be a separate state channel persisted in the DB.

## Goals / Non-Goals

**Goals:**
- Supervisor returns control to the user immediately after dispatching a subagent
- Supervisor can check status, cancel, and list async tasks at any point in the conversation
- Async task IDs survive context compaction
- Existing blocking `spawn_subagent` is unchanged (no migration burden)
- Cancellation is a first-class terminal state alongside `completed` and `failed`

**Non-Goals:**
- Mid-flight instruction injection ("update" a running subagent with new instructions) — too complex for this change; requires subagent to poll for updates
- HTTP/remote transport for subagents — we run everything in-process
- Streaming partial results from an in-progress subagent
- UI for tracking async tasks in the dashboard (follow-up change)

## Decisions

### Decision 1: Registry as a JSON column on Session, not a separate table

**Chosen**: Add a `asyncTaskRegistry` JSON column to the `Session` table. The registry is a map of `taskId → AsyncTaskRecord` (task ID, skill name, status, created/updated timestamps).

**Rejected**: A separate `AsyncTaskRecord` table. Requires a migration, JOIN queries, and cascading deletes. Adds relational complexity for what is effectively supervisor working memory.

**Rationale**: The registry is per-session, bounded in size (max `maxSpawnDepth` levels × concurrent tasks), and read/written as a unit. JSON column is simpler and fast enough for SQLite. The registry is loaded into the tool execution context at task start (same pattern as session messages) and flushed back to DB after each tool invocation that mutates it.

### Decision 2: `spawn_subagent_async` is a new tool, not a flag on `spawn_subagent`

**Chosen**: A separate `spawn_subagent_async` tool with the same input schema as `spawn_subagent` minus `timeoutSeconds` (not applicable).

**Rejected**: Adding `async: boolean` parameter to `spawn_subagent`. Would make the existing tool's contract ambiguous and complicate LLM prompt engineering — the model has to know which mode it wants upfront.

**Rationale**: Two clearly named tools with distinct descriptions make the LLM's decision unambiguous. The blocking tool is for "wait for result", the async tool is for "fire and come back later". This also lets us evolve the tools independently.

### Decision 3: `check_subagent` reads from task queue, not registry cache

**Chosen**: `check_subagent` calls `taskQueue.getTask(taskId)` for live status, then updates the registry entry with the latest status/timestamps.

**Rejected**: Caching status in the registry and only refreshing on explicit check. Risk of stale status if a task completes between checks.

**Rationale**: SQLite reads are cheap. The registry is the memory; the task queue is the truth. `check_subagent` always goes to the source and writes back to the registry as a side effect.

### Decision 4: `cancel_subagent` sets task to `failed` with reason `"Cancelled by supervisor"`

**Chosen**: Reuse `taskQueue.failTask(id, "Cancelled by supervisor")` with a new `cancelled` status discriminator in the registry. The DB task status remains `failed` (no schema change to task states).

**Rejected**: Adding a `cancelled` status to the Task table. Requires a Prisma migration and changes to all status-checking code paths.

**Rationale**: From the queue's perspective, a cancelled task is a failed task — it won't be retried, cascades to children the same way, and the orphaned-sweep handles it identically. The `cancelled` distinction lives only in the registry (supervisor's view) and is surfaced in `list_subagents` output.

### Decision 5: Registry flushed in tool `execute()` using existing tool execution context

**Chosen**: The async task registry is attached to `ToolExecutionContext` (alongside `agentId`, `taskId`, `spawnDepth`, etc.). Tools that modify the registry call a `flushAsyncRegistry()` helper at the end of their `execute()` body.

**Rejected**: Flushing via a post-tool middleware hook. The tool execution context already has a `withToolExecutionContext` wrapper; adding a flush-on-exit hook would require threading the registry through a new closure layer.

**Rationale**: Explicit flush in `execute()` is simpler and visible. The registry is small so the DB write is negligible.

## Risks / Trade-offs

- **Supervisor forgets to check**: The LLM may never call `check_subagent` if the user doesn't ask. Mitigated by system prompt guidance in the skill instructions (e.g., planner skill) and by `list_subagents` which the supervisor can call proactively.
- **Registry grows unbounded**: A long-running session with many async tasks accumulates registry entries. Mitigated by capping registry size (max 50 entries; oldest terminal entries pruned on insert).
- **Cancellation races**: A task may complete between the supervisor calling `cancel_subagent` and the cancel reaching the queue. Handled by checking final status before marking cancelled — if already `completed`, report the result instead.
- **Child tasks of async subagents**: The cancelled subagent's children are handled by the existing cascading cancellation in `subagent-lifecycle`. No new logic needed.

## Migration Plan

1. Add `asyncTaskRegistry` JSON column to `Session` (nullable, default `null` → treated as empty map)
2. Prisma migration — backward compatible; existing sessions get `null` (empty registry)
3. New tools registered alongside existing `spawn_subagent` — no removal, no flag day
4. No data migration required; registry starts empty for all sessions

Rollback: Remove the three new tools from the registry and drop the column. Existing `spawn_subagent` is unaffected.

## Open Questions

- Should `list_subagents` fetch live status for all non-terminal tasks in one DB query (batch) or sequentially? Batch is cleaner; SQLite handles it fine with an `IN` clause.
- Should the skill system get an `async: true` flag to hint that a skill is intended for async dispatch? Deferred — the supervisor can make this decision based on task duration heuristics.
