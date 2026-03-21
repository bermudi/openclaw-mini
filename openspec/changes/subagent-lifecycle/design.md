## Context

Sub-agents are functional — `spawn_subagent` creates child tasks, `AgentExecutor` runs them with isolated sessions, and config overrides control their tools/model. But the lifecycle has critical gaps. The polling loop in `spawn_subagent` (exponential backoff from 500ms to 5s, 120s timeout) can leave orphaned tasks: on timeout it returns an error to the parent but the child task stays in whatever state it was in (`pending` or `processing`), so the worker may pick it up or continue executing it after the parent has moved on. There is no depth limit — a sub-agent can spawn another sub-agent indefinitely, risking infinite recursion. When a parent task fails, its child sub-agent tasks continue running with no cascade. And sub-agent errors return plain strings, giving the parent LLM no structured context to reason about failures.

## Goals / Non-Goals

**Goals:**
- Enforce a configurable spawn depth limit to prevent infinite sub-agent recursion
- Cascade cancellation from parent to children when a parent task fails
- Clean up child tasks on `spawn_subagent` timeout (explicitly fail the child in the DB)
- Add a scheduler sweep to catch orphaned sub-agent tasks stuck in `processing`
- Return structured error data (skill, depth, childTaskId) from sub-agent failures

**Non-Goals:**
- Sub-agent retry or restart logic (a failed sub-agent stays failed; the parent decides what to do)
- Sub-agent priority scheduling (all sub-agent tasks use the same FIFO queue)
- Shared memory between parent and sub-agent (results flow only through the tool return value)
- Distributed task execution (single-node SQLite only)

## Decisions

### Decision 1: Track spawn depth on the Task model

**Choice:** Add a `spawnDepth` integer column (default 0) to the Task model in Prisma. When `spawn_subagent` creates a child task, it sets `spawnDepth = parentTask.spawnDepth + 1`. The tool rejects spawns where depth would exceed `maxSpawnDepth` (default 3, configurable via `OPENCLAW_MAX_SPAWN_DEPTH`).

**Alternatives considered:**
- Count ancestors via recursive query → Expensive per spawn, especially as depth grows
- Track depth only in `SpawnSubagentContext` (runtime) → Lost on crash, not queryable for orphan sweep

**Rationale:** A persisted integer is simple, queryable, and survives restarts. The default of 3 allows meaningful sub-agent chains without unbounded recursion.

### Decision 2: Fail child task on spawn timeout

**Choice:** When the `spawn_subagent` polling loop exceeds its timeout, call `taskQueue.failTask(childTaskId, "Sub-agent timed out")` before returning the timeout error to the parent. The existing session cleanup remains.

**Alternatives considered:**
- Let the scheduler orphan sweep handle it → Too slow; the child could execute after the parent has moved on, wasting resources and producing stale results

**Rationale:** Deterministic, immediate cleanup. The parent gets a clean error and the child can't be picked up by the worker afterward.

### Decision 3: Cascading cancellation via `failChildTasks()`

**Choice:** Add `failChildTasks(parentTaskId)` to `TaskQueue` that finds all child tasks with status `pending` or `processing` and fails them with error "Parent task failed". `AgentExecutor` calls this when a task fails. Already-completed child tasks are left alone.

**Alternatives considered:**
- Soft-cancel via a new `cancelled` status → Adds schema complexity (new enum value, UI handling) for no practical benefit in the blocking model where the parent is already waiting

**Rationale:** Prevents orphaned sub-agents from consuming resources. Scoping to `pending`/`processing` avoids retroactively invalidating completed work.

### Decision 4: Scheduler orphan sweep

**Choice:** Periodically query for sub-agent tasks (`type: "subagent"`) stuck in `processing` for longer than `OPENCLAW_SUBAGENT_TIMEOUT` (default 300s). Fail them with error "Orphaned sub-agent: exceeded processing timeout". This is a safety net for crashes — the primary cleanup is Decision 2 and 3.

**Alternatives considered:**
- Heartbeat from polling loop to prove parent is alive → Complex, requires additional DB writes on every poll iteration

**Rationale:** Simple, periodic query. The generous default (300s) avoids false positives for legitimately long-running sub-agents. Configurable threshold gives operators control.

### Decision 5: Structured error propagation

**Choice:** Sub-agent failures return `{ success: false, error: string, data: { skill: string, depth: number, childTaskId: string } }` so the parent LLM has structured context to reason about the failure (e.g., "the web-search sub-agent at depth 2 timed out").

**Alternatives considered:**
- Encode all context in the error string → LLMs can parse it but structured data is more reliable for programmatic use and prompt engineering

**Rationale:** Structured context helps the parent agent make better decisions about retries or fallback strategies without fragile string parsing.

## Risks / Trade-offs

- **[Schema migration]** Adding `spawnDepth` column requires a Prisma migration. Low risk for SQLite — `default: 0` is safe for existing rows, no data loss.
- **[Race condition]** Cascading cancellation could race with concurrent task processing. Mitigated by only failing `pending`/`processing` tasks — if a child completes between the query and the update, the status check prevents overwriting a `completed` result.
- **[Orphan sweep false positives]** Legitimately long-running sub-agents could be killed by the sweep. Mitigated by generous default timeout (300s) and configurable `OPENCLAW_SUBAGENT_TIMEOUT` threshold.
- **[Depth limit too low]** Default `maxSpawnDepth` of 3 may be insufficient for deeply nested workflows. Mitigated by making it configurable via `OPENCLAW_MAX_SPAWN_DEPTH` env var.
