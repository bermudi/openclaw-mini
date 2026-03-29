## 1. Database Schema

- [x] 1.1 Add `asyncTaskRegistry` JSON column (nullable) to the `Session` model in `prisma/schema.prisma`
- [x] 1.2 Generate and apply Prisma migration for the new column
- [x] 1.3 Add `AsyncTaskRecord` TypeScript interface to `src/lib/types.ts` with fields: `taskId`, `skill`, `status` (union), `createdAt`, `lastCheckedAt?`, `lastUpdatedAt?`

## 2. Task Queue

- [x] 2.1 Add `cancelTask(taskId: string, reason?: string): Promise<boolean>` method to `TaskQueueService` in `src/lib/services/task-queue.ts` — transitions `pending`/`processing` tasks to `failed` with the given reason; returns false if already terminal
- [x] 2.2 Add batch status fetch helper `getTasksByIds(ids: string[]): Promise<Task[]>` to `TaskQueueService` using a single `IN` query

## 3. Session Service

- [x] 3.1 Add `getAsyncTaskRegistry(sessionId: string): Promise<Map<string, AsyncTaskRecord>>` to `session-service.ts` — reads `asyncTaskRegistry` JSON column, returns empty map if null
- [x] 3.2 Add `setAsyncTaskRegistry(sessionId: string, registry: Map<string, AsyncTaskRecord>): Promise<void>` to `session-service.ts` — serializes and writes the registry map back to the column

## 4. Tool Execution Context

- [x] 4.1 Extend `ToolExecutionContext` in `src/lib/types.ts` to include `asyncTaskRegistry: Map<string, AsyncTaskRecord>` and `flushAsyncRegistry: () => Promise<void>`
- [x] 4.2 In `agent-executor.ts`, load the session's async task registry at task start (before `withToolExecutionContext`) and wire `flushAsyncRegistry` to call `sessionService.setAsyncTaskRegistry`
- [x] 4.3 Ensure registry loading is skipped (empty map) when `task.type === 'subagent'` or when no `sessionId` is present

## 5. New Tools

- [x] 5.1 Register `spawn_subagent_async` tool in `src/lib/tools.ts` — creates child task, adds registry entry with `status: "pending"`, calls `flushAsyncRegistry()`, returns task ID; enforce capacity limit (max 50, prune oldest terminal on overflow)
- [x] 5.2 Register `check_subagent` tool in `src/lib/tools.ts` — fetches live task status via `taskQueue.getTask()`, updates registry entry (`lastCheckedAt`, `status`), calls `flushAsyncRegistry()`, returns current status and result if complete
- [x] 5.3 Register `cancel_subagent` tool in `src/lib/tools.ts` — calls `taskQueue.cancelTask()` if not terminal, updates registry entry to `status: "cancelled"`, calls `flushAsyncRegistry()`, returns confirmation or error
- [x] 5.4 Register `list_subagents` tool in `src/lib/tools.ts` — calls `taskQueue.getTasksByIds()` for all non-terminal registry entries in one batch query, updates registry entries, calls `flushAsyncRegistry()`, returns formatted summary

## 6. Subagent Lifecycle: Cancellation

- [x] 6.1 Verify the existing `cascadeFailToChildren` logic in `task-queue.ts` already skips tasks that are already `failed` — add test coverage if not
- [x] 6.2 Confirm the orphaned-sweep in `process-supervisor.ts` or `trigger-service.ts` does not re-fail tasks already in terminal state — add guard if missing
- [x] 6.3 Add test: cancelled tasks (failed with "Cancelled by supervisor") are excluded from orphaned-sweep re-processing

## 7. Tests

- [x] 7.1 Unit test `spawn_subagent_async`: successful dispatch populates registry; depth exceeded returns error without modifying registry; unknown skill returns error without modifying registry
- [x] 7.2 Unit test `check_subagent`: completed task returns result and updates registry; in-progress returns running status; unknown task ID returns error
- [x] 7.3 Unit test `cancel_subagent`: pending task cancelled successfully; already-completed returns error without modifying task; unknown ID returns error
- [x] 7.4 Unit test `list_subagents`: batched status fetch; empty registry returns empty list message
- [x] 7.5 Unit test registry persistence: `getAsyncTaskRegistry` returns empty map for null column; `setAsyncTaskRegistry` round-trips correctly
- [x] 7.6 Unit test registry capacity: inserting the 51st entry evicts the oldest terminal entry; evicts oldest by `createdAt` if no terminal entries exist
- [x] 7.7 Integration test: supervisor dispatches async subagent, user asks to check, supervisor checks and gets result
