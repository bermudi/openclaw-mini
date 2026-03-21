# sub-agents Specification

## Purpose
TBD - created by archiving change agent-architecture. Update Purpose after archive.
## Requirements
### Requirement: Spawn sub-agent tool
The main agent SHALL have access to a `spawn_subagent` tool that creates an ephemeral sub-agent task. The tool SHALL accept `skill` (string, required) and `task` (string, required) parameters.

#### Scenario: Spawn a sub-agent with a valid skill
- **WHEN** the main agent calls `spawn_subagent` with `{ skill: "web-search", task: "find flights to Lima for next Friday" }`
- **THEN** a new Task SHALL be created with `type: "subagent"`, `skillName: "web-search"`, `parentTaskId` set to the current task's ID, and `status: "pending"`

#### Scenario: Spawn with unknown skill
- **WHEN** the main agent calls `spawn_subagent` with a skill name that doesn't match any loaded and enabled SKILL.md
- **THEN** the tool SHALL return `{ success: false, error: "Skill 'xyz' not found or disabled" }`

#### Scenario: Spawn with disabled skill
- **WHEN** the main agent calls `spawn_subagent` with a skill that exists but is disabled (failed gating)
- **THEN** the tool SHALL return `{ success: false, error: "Skill 'xyz' not found or disabled: missing binary: ffmpeg" }`

### Requirement: Sub-agent task execution
When the AgentExecutor processes a task with `type: "subagent"`, it SHALL load the full SKILL.md instructions as the system prompt and restrict available tools to those declared by the skill.

#### Scenario: Sub-agent uses skill instructions
- **WHEN** a sub-agent task with `skillName: "web-search"` is executed
- **THEN** the system prompt SHALL contain the full markdown body of `web-search/SKILL.md` (not the main agent's prompt)

#### Scenario: Sub-agent gets skill-defined tools
- **WHEN** a skill's SKILL.md frontmatter declares `tools: ["web_search", "read_file"]`
- **THEN** the sub-agent SHALL only have access to those tools during execution

#### Scenario: Sub-agent with no tools declared
- **WHEN** a skill's SKILL.md frontmatter does not declare a `tools` field
- **THEN** the sub-agent SHALL receive all tools with `riskLevel: "low"`

### Requirement: Sub-agent session isolation
Each sub-agent task SHALL execute within its own isolated session with scope `"subagent:<taskId>"`. This session SHALL NOT share context with the parent agent's main session.

#### Scenario: Sub-agent gets clean session
- **WHEN** a sub-agent task is created
- **THEN** a new session SHALL be created with `sessionScope: "subagent:<taskId>"` and empty context

#### Scenario: Sub-agent session cleanup
- **WHEN** a sub-agent task completes (success or failure)
- **THEN** the sub-agent's session MAY be deleted or retained for audit purposes

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

### Requirement: Sub-agent task metadata
The `Task` model SHALL support sub-agent tracking via `parentTaskId` (nullable string, FK to Task) and `skillName` (nullable string). A new task type `"subagent"` SHALL be added to `TaskType`.

#### Scenario: Sub-agent task has parent reference
- **WHEN** a sub-agent task is created
- **THEN** `parentTaskId` SHALL reference the main agent's currently executing task

#### Scenario: Regular tasks have null sub-agent fields
- **WHEN** a regular task (message, heartbeat, etc.) is created
- **THEN** `parentTaskId` and `skillName` SHALL be `null`

### Requirement: Spawn depth context propagation
The `SpawnSubagentContext` SHALL include a `spawnDepth` field (integer). When creating a sub-agent task, the `spawn_subagent` tool SHALL read the current depth from context and set the child's depth to `currentDepth + 1`.

#### Scenario: Spawn from existing sub-agent context
- **WHEN** `spawn_subagent` is called within a context where `spawnDepth` is 1
- **THEN** the child task SHALL be created with `spawnDepth: 2`

#### Scenario: Spawn from top-level task
- **WHEN** `spawn_subagent` is called from a top-level task (no `spawnDepth` in context, defaults to 0)
- **THEN** the child task SHALL be created with `spawnDepth: 1`

### Requirement: Sub-agent spawn depth tracking
The Task model SHALL include a `spawnDepth` integer field (default 0) for recursion depth tracking.

#### Scenario: Sub-agent task stores depth
- **WHEN** a sub-agent task is created with `spawnDepth: 2`
- **THEN** the `spawnDepth` value SHALL be persisted in the database on the Task record

#### Scenario: Regular task has zero depth
- **WHEN** a regular task (message, heartbeat, etc.) is created
- **THEN** `spawnDepth` SHALL be `0`

### Requirement: Sub-agent completion event emission
When a sub-agent task completes successfully, the system SHALL emit a `subagent:completed` event on the event bus with `taskId`, `parentTaskId`, `skillName`, and `agentId`. The event SHALL be emitted after the task's completion has been committed to the database.

#### Scenario: Sub-agent completes successfully
- **WHEN** a sub-agent task finishes execution with a successful result
- **THEN** the `AgentExecutor` SHALL emit a `subagent:completed` event with `taskId` (the sub-agent's task ID), `parentTaskId` (the parent task that spawned it), `skillName` (the skill the sub-agent was executing), and `agentId` (the sub-agent's agent ID)

#### Scenario: Completion event emitted after DB commit
- **WHEN** a sub-agent task completes and its status is updated to `completed` in the database
- **THEN** the `subagent:completed` event SHALL be emitted only after the database update has committed successfully

### Requirement: Sub-agent failure event emission
When a sub-agent task fails, the system SHALL emit a `subagent:failed` event on the event bus with `taskId`, `parentTaskId`, `skillName`, `agentId`, and `error` (the error message). The event SHALL be emitted after the task's failure has been committed to the database.

#### Scenario: Sub-agent fails
- **WHEN** a sub-agent task fails during execution
- **THEN** the `AgentExecutor` SHALL emit a `subagent:failed` event with `taskId`, `parentTaskId`, `skillName`, `agentId`, and `error` containing the error message

#### Scenario: Failure event emitted after DB commit
- **WHEN** a sub-agent task fails and its status is updated to `failed` in the database
- **THEN** the `subagent:failed` event SHALL be emitted only after the database update has committed successfully

