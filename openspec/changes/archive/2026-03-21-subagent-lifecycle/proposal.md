## Why

Sub-agents are implemented (`spawn_subagent` tool, `AgentExecutor` sub-agent path, config overrides) but the lifecycle has critical gaps. The parent awaits the sub-agent result via a polling loop with no mechanism to cancel a stuck sub-agent task — if the worker crashes mid-execution, the parent polls until timeout while the sub-agent task sits in `processing` forever. There is no depth limit to prevent infinite recursion (a sub-agent can spawn another sub-agent which spawns another...). Sub-agent errors don't propagate structured context back to the parent. And there is no cleanup for orphaned sub-agent tasks when the parent itself fails or times out.

## What Changes

- **Spawn depth tracking**: Track recursion depth via a `spawnDepth` field on sub-agent tasks. Enforce a configurable max depth (default 3) in `spawn_subagent` to prevent infinite recursion.
- **Parent task cancellation cascade**: When a parent task fails or times out, automatically fail all its pending/processing child sub-agent tasks. This prevents orphaned sub-agents from running indefinitely.
- **Stuck sub-agent recovery**: When the `spawn_subagent` polling loop times out, explicitly fail the child task in the database so the worker doesn't pick it up later. Add a scheduler sweep for sub-agent tasks stuck in `processing` beyond a configurable threshold.
- **Structured error propagation**: Sub-agent failures return structured context (skill name, error message, depth) instead of just a string, so the parent agent can make informed decisions about retries or fallbacks.
- **Sub-agent memory isolation**: Clarify and enforce that sub-agents operate with isolated sessions (already implemented) and do NOT share the parent's memory context. Document that sub-agent results flow back only through the tool return value.

## Capabilities

### New Capabilities
- `subagent-lifecycle`: Spawn depth limits, cascading cancellation, orphan cleanup, and structured error propagation for sub-agent tasks

### Modified Capabilities
- `sub-agents`: The spawn tool gains depth tracking, the executor gains cancellation cascade, and timeout behavior changes from silent expiry to explicit task failure

## Impact

- **Files**: Updates to `src/lib/tools.ts` (spawn depth, timeout cleanup), `src/lib/services/task-queue.ts` (cascade cancellation, orphan sweep), `src/lib/services/agent-executor.ts` (depth propagation), `src/lib/subagent-config.ts` (depth config)
- **Dependencies**: None
- **Schema**: Add `spawnDepth` integer column (default 0) to Task model for recursion tracking
- **APIs**: No new API routes
