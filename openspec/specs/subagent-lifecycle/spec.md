# subagent-lifecycle Specification

## Purpose
TBD - created by archiving change subagent-lifecycle. Update Purpose after archive.
## Requirements
### Requirement: Spawn depth tracking
Each sub-agent task SHALL have a `spawnDepth` integer field (default 0). When `spawn_subagent` creates a child task, it SHALL set `spawnDepth` to the parent task's `spawnDepth + 1`.

#### Scenario: Top-level task spawns sub-agent
- **WHEN** a top-level task (spawnDepth 0) calls `spawn_subagent`
- **THEN** the child task SHALL be created with `spawnDepth: 1`

#### Scenario: Nested sub-agent spawn
- **WHEN** a sub-agent at depth 2 calls `spawn_subagent`
- **THEN** the child task SHALL be created with `spawnDepth: 3`

#### Scenario: Regular task has default depth
- **WHEN** a regular (non-subagent) task is created
- **THEN** `spawnDepth` SHALL be `0`

### Requirement: Spawn depth limit
The `spawn_subagent` tool SHALL reject spawn requests where the resulting depth would exceed `maxSpawnDepth` (default 3, configurable via `OPENCLAW_MAX_SPAWN_DEPTH` environment variable). The tool SHALL return a structured error without creating a task.

#### Scenario: Spawn rejected at max depth
- **WHEN** a sub-agent at depth 3 calls `spawn_subagent` with `maxSpawnDepth` set to 3
- **THEN** the tool SHALL return `{ success: false, error: "Maximum spawn depth of 3 exceeded" }` and SHALL NOT create a child task

#### Scenario: Spawn allowed below max depth
- **WHEN** a sub-agent at depth 2 calls `spawn_subagent` with `maxSpawnDepth` set to 3
- **THEN** the spawn SHALL succeed and the child task SHALL be created with `spawnDepth: 3`

### Requirement: Timeout task cleanup
When the `spawn_subagent` polling loop times out, it SHALL explicitly fail the child task via `taskQueue.failTask()` with error "Sub-agent timed out" before returning the timeout error to the parent.

#### Scenario: Sub-agent exceeds timeout
- **WHEN** a sub-agent task does not complete within the timeout period (default 120 seconds)
- **THEN** the child task status SHALL be set to `failed` with error "Sub-agent timed out", the sub-agent session SHALL be cleaned up, and then the timeout error SHALL be returned to the parent

#### Scenario: Sub-agent completes just before timeout
- **WHEN** a sub-agent task completes successfully before the timeout expires
- **THEN** the normal success path SHALL be followed and no failure SHALL be recorded on the child task

### Requirement: Cascading cancellation
When a parent task fails, the system SHALL fail all its pending and processing child sub-agent tasks with error "Parent task failed". Already-completed or already-cancelled child tasks SHALL NOT be affected.

#### Scenario: Parent fails with pending children
- **WHEN** a parent task fails and has 2 child sub-agent tasks with status `pending`
- **THEN** both child tasks SHALL be set to `failed` with error "Parent task failed"

#### Scenario: Parent fails with mixed-status children
- **WHEN** a parent task fails and has 1 child task with status `completed`, 1 with status `pending`, and 1 with status `failed` (already cancelled)
- **THEN** only the `pending` child task SHALL be failed; the `completed` and already-`failed` child tasks SHALL NOT be modified

#### Scenario: Parent completes successfully
- **WHEN** a parent task completes successfully
- **THEN** no cascade action SHALL be taken on child tasks

### Requirement: Orphaned sub-agent sweep
The scheduler SHALL periodically check for sub-agent tasks stuck in `processing` status for longer than a configurable threshold (default 300s, configurable via `OPENCLAW_SUBAGENT_TIMEOUT` environment variable). It SHALL fail these tasks with error "Orphaned sub-agent: exceeded processing timeout".

#### Scenario: Sub-agent stuck beyond threshold
- **WHEN** a sub-agent task has been in `processing` status for 400 seconds and the threshold is 300 seconds
- **THEN** the sweep SHALL set the task to `failed` with error "Orphaned sub-agent: exceeded processing timeout"

#### Scenario: Sub-agent within threshold
- **WHEN** a sub-agent task has been in `processing` status for 100 seconds and the threshold is 300 seconds
- **THEN** the sweep SHALL NOT affect the task

### Requirement: Structured error propagation
Sub-agent failures SHALL return structured error data including `skill`, `spawnDepth`, and `childTaskId` in addition to the error message.

#### Scenario: Sub-agent fails with error
- **WHEN** a sub-agent with skill "web-search" at depth 1 fails with an error
- **THEN** the `spawn_subagent` tool SHALL return `{ success: false, error: "Sub-agent failed: <error>", data: { skill: "web-search", depth: 1, childTaskId: "<taskId>" } }`

#### Scenario: Sub-agent times out
- **WHEN** a sub-agent with skill "web-search" at depth 1 exceeds the timeout
- **THEN** the `spawn_subagent` tool SHALL return `{ success: false, error: "Sub-agent timed out after 120s", data: { skill: "web-search", depth: 1, childTaskId: "<taskId>" } }`

### Requirement: Supervisor-initiated cancellation
A subagent task in `pending` or `processing` status SHALL be cancellable by the supervisor via the `cancel_subagent` tool. The task SHALL be transitioned to `failed` with error `"Cancelled by supervisor"`. This is equivalent to a task failure for all cascade and sweep purposes.

#### Scenario: Pending task cancelled by supervisor
- **WHEN** `cancel_subagent` is called for a task with status `pending`
- **THEN** the task SHALL transition to `failed` with error `"Cancelled by supervisor"` and any child tasks SHALL be cascaded per the cascading cancellation requirement

#### Scenario: Processing task cancelled by supervisor
- **WHEN** `cancel_subagent` is called for a task with status `processing`
- **THEN** the task SHALL transition to `failed` with error `"Cancelled by supervisor"` and any child tasks SHALL be cascaded per the cascading cancellation requirement

#### Scenario: Terminal task cannot be cancelled
- **WHEN** `cancel_subagent` is called for a task with status `completed` or `failed`
- **THEN** the task status SHALL NOT be changed and the tool SHALL return an appropriate error

### Requirement: Orphaned-sweep excludes supervisor-cancelled tasks
The orphaned sub-agent sweep SHALL NOT attempt to re-fail tasks that were already failed with reason `"Cancelled by supervisor"`. The sweep's stale-detection logic applies only to tasks stuck in `processing` without an explicit terminal reason.

#### Scenario: Cancelled task not re-failed by sweep
- **WHEN** the orphaned sweep runs and encounters a task with status `failed` and error `"Cancelled by supervisor"`
- **THEN** the sweep SHALL skip that task and SHALL NOT generate a new failure event for it

