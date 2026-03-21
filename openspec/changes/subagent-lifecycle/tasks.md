## 1. Schema & Model Changes

- [ ] 1.1 Add `spawnDepth Int @default(0)` column to the `Task` model in `prisma/schema.prisma`
- [ ] 1.2 Run `bunx prisma migrate dev --name add-spawn-depth` to generate and apply the migration
- [ ] 1.3 Update `CreateTaskInput` in `src/lib/services/task-queue.ts` to accept optional `spawnDepth?: number`; pass it through to `db.task.create()` (default 0)
- [ ] 1.4 Update `TaskQueue.mapTask()` to include `spawnDepth` in the mapped `Task` output
- [ ] 1.5 Add `spawnDepth?: number` to the `Task` interface in `src/lib/types.ts`

## 2. Spawn Depth Tracking & Limit

- [ ] 2.1 Add `spawnDepth` field to `SpawnSubagentContext` in `src/lib/tools.ts`
- [ ] 2.2 In `AgentExecutor.executeTask()`, pass the current task's `spawnDepth` into `withSpawnSubagentContext()` so child spawns can read it
- [ ] 2.3 In the `spawn_subagent` tool execute function, read `context.spawnDepth` (default 0), compute `childDepth = spawnDepth + 1`, and reject with `{ success: false, error: "Maximum spawn depth of N exceeded" }` if `childDepth > maxSpawnDepth`
- [ ] 2.4 Read `maxSpawnDepth` from `OPENCLAW_MAX_SPAWN_DEPTH` env var (default 3, positive integer)
- [ ] 2.5 Pass `spawnDepth: childDepth` to `taskQueue.createTask()` when creating the sub-agent task

## 3. Timeout Task Cleanup

- [ ] 3.1 In the `spawn_subagent` timeout path (after the polling while loop), call `taskQueue.failTask(childTaskId, "Sub-agent timed out")` before session cleanup and returning the timeout error
- [ ] 3.2 Guard against double-fail: check the child task status before calling `failTask()` — if already `completed` or `failed`, skip

## 4. Cascading Cancellation

- [ ] 4.1 Add `failChildTasks(parentTaskId: string, error: string)` method to `TaskQueue` that queries all child tasks with `parentTaskId` and status `pending` or `processing`, and fails each with the given error
- [ ] 4.2 In `AgentExecutor.executeTask()` catch block (task failure path), call `taskQueue.failChildTasks(taskId, "Parent task failed")` after failing the parent task
- [ ] 4.3 In `TaskQueue.failTask()`, call `failChildTasks()` after failing the task to handle nested cascading (child of a child)

## 5. Structured Error Propagation

- [ ] 5.1 Update the `spawn_subagent` failure return path to include `data: { skill, depth: childDepth, childTaskId }` alongside the error string
- [ ] 5.2 Update the timeout return path to include the same structured data
- [ ] 5.3 Update the "task disappeared" return path to include available context

## 6. Orphaned Sub-agent Sweep

- [ ] 6.1 Add `sweepOrphanedSubagents()` method to `TaskQueue` that queries sub-agent tasks (`type: "subagent"`) in `processing` status where `startedAt` is older than `OPENCLAW_SUBAGENT_TIMEOUT` seconds (default 300); fail each with "Orphaned sub-agent: exceeded processing timeout"
- [ ] 6.2 Wire `sweepOrphanedSubagents()` into the scheduler's periodic health check interval

## 7. Testing

- [ ] 7.1 Write spawn depth tests: top-level spawn creates depth 1, nested spawn increments depth, spawn at max depth rejected with error, depth persisted in DB
- [ ] 7.2 Write timeout cleanup tests: timeout fails child task in DB, child that completes before timeout is not failed, structured error returned with skill/depth/childTaskId
- [ ] 7.3 Write cascading cancellation tests: parent fail cascades to pending children, completed children not affected, nested cascade (grandchild tasks also failed)
- [ ] 7.4 Write orphan sweep tests: stuck sub-agent beyond threshold is failed, sub-agent within threshold is not affected
- [ ] 7.5 Write structured error tests: failure/timeout/disappearance all return structured data with correct fields
