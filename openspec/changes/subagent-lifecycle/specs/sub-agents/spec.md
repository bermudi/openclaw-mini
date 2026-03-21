## MODIFIED Requirements

### Requirement: Blocking result return
The `spawn_subagent` tool SHALL block until the sub-agent task completes and return the result to the main agent. A configurable timeout SHALL apply. On timeout, the tool SHALL explicitly fail the child task before returning.

#### Scenario: Sub-agent completes within timeout
- **WHEN** a sub-agent task completes with a response within the timeout period (default 120 seconds)
- **THEN** the `spawn_subagent` tool SHALL return `{ success: true, data: { response: "...", skill: "web-search" } }`

#### Scenario: Sub-agent times out
- **WHEN** a sub-agent task does not complete within the timeout period
- **THEN** the child task SHALL be failed in the database with error "Sub-agent timed out", and the tool SHALL return `{ success: false, error: "Sub-agent timed out after 120s", data: { skill: "web-search", depth: 1, childTaskId: "<taskId>" } }`

#### Scenario: Sub-agent fails
- **WHEN** a sub-agent task fails with an error
- **THEN** the `spawn_subagent` tool SHALL return `{ success: false, error: "Sub-agent failed: <error message>", data: { skill: "web-search", depth: 1, childTaskId: "<taskId>" } }`

## ADDED Requirements

### Requirement: Spawn depth context propagation
The `SpawnSubagentContext` SHALL include a `spawnDepth` field (integer). When creating a sub-agent task, the `spawn_subagent` tool SHALL read the current depth from context and set the child's depth to `currentDepth + 1`.

#### Scenario: Spawn from existing sub-agent context
- **WHEN** `spawn_subagent` is called within a context where `spawnDepth` is 1
- **THEN** the child task SHALL be created with `spawnDepth: 2`

#### Scenario: Spawn from top-level task
- **WHEN** `spawn_subagent` is called from a top-level task (no `spawnDepth` in context, defaults to 0)
- **THEN** the child task SHALL be created with `spawnDepth: 1`

### Requirement: Sub-agent task metadata
The Task model SHALL include a `spawnDepth` integer field (default 0) for recursion depth tracking.

#### Scenario: Sub-agent task stores depth
- **WHEN** a sub-agent task is created with `spawnDepth: 2`
- **THEN** the `spawnDepth` value SHALL be persisted in the database on the Task record

#### Scenario: Regular task has zero depth
- **WHEN** a regular task (message, heartbeat, etc.) is created
- **THEN** `spawnDepth` SHALL be `0`
