# async-task-registry Specification

## Purpose
TBD - created by archiving change async-subagents. Update Purpose after archive.
## Requirements
### Requirement: Registry persisted in session row
The async task registry SHALL be stored as a JSON column (`asyncTaskRegistry`) on the `Session` table, not in message history. The column SHALL be nullable with a default of `null` (treated as an empty registry).

#### Scenario: New session has empty registry
- **WHEN** a new session is created
- **THEN** the `asyncTaskRegistry` column SHALL be `null` and the session's effective registry SHALL be an empty map

#### Scenario: Registry survives context compaction
- **WHEN** the session's message history is compacted (summarized)
- **THEN** the `asyncTaskRegistry` column SHALL be unaffected and all previously registered task IDs SHALL remain accessible

### Requirement: Registry loaded into tool execution context
At the start of each task execution, the system SHALL read the session's `asyncTaskRegistry` column and attach it to the `ToolExecutionContext` so all async tools can read and mutate the registry without additional DB queries mid-execution.

#### Scenario: Registry available to async tools during execution
- **WHEN** an agent task begins execution and the session has a non-null registry
- **THEN** the tool execution context SHALL contain the deserialized registry map

#### Scenario: Registry defaults to empty map when null
- **WHEN** an agent task begins execution and the session's `asyncTaskRegistry` is `null`
- **THEN** the tool execution context SHALL contain an empty registry map (not null/undefined)

### Requirement: Registry flushed after mutation
After any tool call that mutates the registry (`spawn_subagent_async`, `check_subagent`, `cancel_subagent`, `list_subagents`), the updated registry SHALL be written back to the `asyncTaskRegistry` column on the session row before the tool's `execute()` function returns.

#### Scenario: Registry persisted after dispatch
- **WHEN** `spawn_subagent_async` successfully dispatches a task
- **THEN** the session's `asyncTaskRegistry` column SHALL be updated with the new entry before the tool returns to the LLM

#### Scenario: Registry persisted after check
- **WHEN** `check_subagent` fetches live status and updates a registry entry
- **THEN** the session's `asyncTaskRegistry` column SHALL reflect the updated entry before the tool returns

### Requirement: AsyncTaskRecord structure
Each registry entry SHALL be an `AsyncTaskRecord` containing: `taskId` (string), `skill` (string), `status` (`"pending" | "running" | "completed" | "failed" | "cancelled"`), `createdAt` (ISO 8601 string), and optionally `lastCheckedAt` (ISO 8601 string) and `lastUpdatedAt` (ISO 8601 string).

#### Scenario: Record created with required fields
- **WHEN** a new async task is registered
- **THEN** the record SHALL have non-null `taskId`, `skill`, `status: "pending"`, and `createdAt`; `lastCheckedAt` and `lastUpdatedAt` SHALL be absent until set

#### Scenario: Record updated on check
- **WHEN** `check_subagent` or `list_subagents` updates a registry entry
- **THEN** the entry's `lastCheckedAt` SHALL be set to the current timestamp and `status` SHALL reflect the latest fetched value

### Requirement: Registry scoped to parent session only
The async task registry is attached to the supervisor's session. Sub-agent tasks spawned via `spawn_subagent_async` SHALL NOT inherit or share the registry — they run in their own isolated subagent sessions.

#### Scenario: Subagent does not see supervisor registry
- **WHEN** a subagent task executes and calls any tool
- **THEN** the tool execution context for that subagent task SHALL have an empty registry (or the registry from its own session, not the parent's)

