## ADDED Requirements

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
