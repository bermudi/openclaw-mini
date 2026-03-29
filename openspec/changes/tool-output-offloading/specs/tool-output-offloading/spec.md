## ADDED Requirements

### Requirement: Large tool results are offloaded to workspace files
When a tool result's token count exceeds the configured offload threshold (default: 2,000 tokens, configurable via `OPENCLAW_OFFLOAD_TOKEN_THRESHOLD`), the system SHALL write the full result content to a scoped workspace file and replace the tool result in the conversation with a compact reference message. Token counting SHALL use the existing `countTokens()` utility. If token counting fails, the system SHALL fall back to character-based estimation (4 chars per token) and still apply the threshold check.

#### Scenario: Tool result exceeds threshold
- **WHEN** a tool returns a result whose token count exceeds the configured threshold
- **THEN** the system SHALL write the full result to `data/workspace/offload/<taskId>/<toolName>-<callIndex>.md` and return a compact reference message in its place

#### Scenario: Tool result below threshold passes through unchanged
- **WHEN** a tool returns a result whose token count is at or below the configured threshold
- **THEN** the result SHALL be returned inline in the conversation without offloading

#### Scenario: Token counting fails, character fallback applied
- **WHEN** `countTokens()` throws during threshold evaluation
- **THEN** the system SHALL estimate tokens as `Math.ceil(content.length / 4)` and proceed with the threshold check normally

### Requirement: Compact reference message format
The compact reference message replacing an offloaded tool result SHALL include: the offload file path, the total line count of the offloaded content, and the first 10 lines as a preview. The message SHALL include an explicit instruction directing the agent to use `read_workspace_file` to retrieve the full content if needed.

#### Scenario: Reference message contains required fields
- **WHEN** a tool result is offloaded to `data/workspace/offload/task-123/web_search-2.md`
- **THEN** the compact message SHALL include the file path, line count, first 10 lines, and the instruction `"Use read_workspace_file to retrieve the full content if needed."`

#### Scenario: Preview truncated at 10 lines
- **WHEN** the offloaded content has more than 10 lines
- **THEN** the preview SHALL contain exactly the first 10 lines with a truncation indicator

#### Scenario: Short content fully previewed
- **WHEN** the offloaded content has 6 lines but exceeds the token threshold (e.g. very long lines)
- **THEN** the preview SHALL contain all 6 lines without a truncation indicator

### Requirement: Offload scope is per task execution
Offload files SHALL be written to a directory scoped to the executing task ID: `data/workspace/offload/<taskId>/`. All offload files for a task SHALL be cleaned up after the task completes (success or failure). Cleanup failure SHALL be logged but SHALL NOT affect task outcome or result.

#### Scenario: Offload directory scoped to task
- **WHEN** task `task-abc` executes and offloads two tool results
- **THEN** both files SHALL be written under `data/workspace/offload/task-abc/`

#### Scenario: Cleanup on task completion
- **WHEN** task `task-abc` completes successfully
- **THEN** the directory `data/workspace/offload/task-abc/` and all its contents SHALL be removed

#### Scenario: Cleanup on task failure
- **WHEN** task `task-abc` fails with an error
- **THEN** the directory `data/workspace/offload/task-abc/` SHALL still be removed in the error path

#### Scenario: Cleanup failure does not propagate
- **WHEN** the offload directory cannot be removed (e.g. permission error)
- **THEN** the system SHALL log a warning and the task result SHALL not be affected

### Requirement: Tool opt-out via noOffload flag
Tool definitions MAY declare `noOffload: true` to prevent offloading of their results. Tools with `noOffload: true` SHALL have their results returned inline regardless of size. The following built-in tools SHALL have `noOffload: true`: `spawn_subagent`, `deliver_message`, `deliver_file`, `send_message_to_agent`.

#### Scenario: Opted-out tool result passes through regardless of size
- **WHEN** `spawn_subagent` returns a result of 10,000 tokens
- **THEN** the result SHALL be returned inline without offloading

#### Scenario: Standard tool with large result is offloaded
- **WHEN** `web_search` returns a result of 5,000 tokens and has no `noOffload` flag
- **THEN** the result SHALL be offloaded normally

### Requirement: Offloading applies only to main-agent tool execution
The offloading wrapper SHALL be applied when tools are loaded via `getToolsForAgent`. It SHALL NOT be applied when tools are loaded via `getToolsByNames` for subagent execution. Subagents already operate with isolated, fresh context and their final response is compact by design.

#### Scenario: Main agent tools are wrapped
- **WHEN** `getToolsForAgent` is called to load tools for a regular message or cron task
- **THEN** the returned tools SHALL have the offloading wrapper applied

#### Scenario: Subagent tools are not wrapped
- **WHEN** `getToolsByNames` is called to load tools for a subagent task
- **THEN** the returned tools SHALL NOT have the offloading wrapper applied
