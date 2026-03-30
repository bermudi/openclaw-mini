# async-subagent-dispatch Specification

## Purpose
TBD - created by archiving change async-subagents. Update Purpose after archive.
## Requirements
### Requirement: Non-blocking subagent dispatch
The `spawn_subagent_async` tool SHALL create a child task and register it in the session's async task registry, then return the child task ID immediately without entering a polling loop.

#### Scenario: Async dispatch returns task ID immediately
- **WHEN** the supervisor calls `spawn_subagent_async` with a valid skill and task description
- **THEN** the tool SHALL create the child task, add an entry to the async task registry with status `pending`, and return `{ success: true, data: { taskId: "<id>", skill: "<skill>", message: "Subagent dispatched. Use check_subagent(\"<id>\") to poll for results." } }` without waiting for the child to complete

#### Scenario: Async dispatch respects spawn depth limit
- **WHEN** `spawn_subagent_async` is called and the resulting child depth would exceed `maxSpawnDepth`
- **THEN** the tool SHALL return `{ success: false, error: "Maximum spawn depth of <N> exceeded" }` and SHALL NOT create a task or registry entry

#### Scenario: Async dispatch with unknown skill
- **WHEN** `spawn_subagent_async` is called with a skill name that does not exist or is disabled
- **THEN** the tool SHALL return `{ success: false, error: "<skill> not found or disabled" }` and SHALL NOT create a task or registry entry

### Requirement: Async registry entry on dispatch
On successful dispatch, the system SHALL add an `AsyncTaskRecord` to the session's async task registry containing: `taskId`, `skill`, `status: "pending"`, and `createdAt` timestamp.

#### Scenario: Registry entry created on success
- **WHEN** `spawn_subagent_async` dispatches a subagent successfully
- **THEN** the session's async task registry SHALL contain an entry for the new task ID with `status: "pending"` and a `createdAt` timestamp

#### Scenario: Registry entry NOT created on failure
- **WHEN** `spawn_subagent_async` fails (invalid skill, depth exceeded, etc.)
- **THEN** the session's async task registry SHALL NOT be modified

### Requirement: Async task registry capacity limit
The async task registry SHALL hold at most 50 entries per session. When a new entry would exceed this limit, the oldest terminal entry (`completed`, `failed`, or `cancelled`) SHALL be pruned to make room. If no terminal entry exists and the cap is reached, the dispatch SHALL proceed and the oldest entry SHALL be evicted regardless.

#### Scenario: Registry at capacity with terminal entries
- **WHEN** the registry contains 50 entries and at least one is terminal
- **THEN** on the next successful dispatch, the oldest terminal entry SHALL be removed and the new entry SHALL be added

#### Scenario: Registry at capacity with no terminal entries
- **WHEN** the registry contains 50 entries and none are terminal
- **THEN** on the next successful dispatch, the oldest entry by `createdAt` SHALL be evicted and the new entry SHALL be added

