# surface-directive Specification

## Purpose
TBD - created by archiving change surface-directive. Update Purpose after archive.
## Requirements
### Requirement: SurfaceDirective type definition
The system SHALL define a `SurfaceDirective` type for tools to flag content for direct delivery to chat.

#### Scenario: Text surface directive
- **WHEN** a tool returns a `SurfaceDirective` with `type: 'text'` and `content: "hello"`
- **THEN** the system SHALL treat it as text content to be delivered directly to chat

#### Scenario: File surface directive
- **WHEN** a tool returns a `SurfaceDirective` with `type: 'file'`, `filePath`, and optional `mimeType`
- **THEN** the system SHALL treat it as a file to be delivered directly to chat

### Requirement: ToolResult supports surface directives
The `ToolResult` type SHALL include an optional `surface` field containing an array of `SurfaceDirective`s.

#### Scenario: Tool returns with surface directives
- **WHEN** a tool's execute function returns `{ success: true, data: {...}, surface: [{ type: 'text', content: '...' }] }`
- **THEN** the surface directives SHALL be available for collection by the executor

#### Scenario: Tool returns without surface directives
- **WHEN** a tool's execute function returns without a `surface` field
- **THEN** the tool result SHALL behave identically to today (no change)

### Requirement: Executor collects and delivers surface directives
After `generateText()` completes, the agent executor SHALL collect all surface directives from tool results across all steps and enqueue them as deliveries.

#### Scenario: Single tool produces a surface directive
- **WHEN** one tool in the execution produces a text surface directive
- **THEN** the executor SHALL enqueue a text delivery for the directive's content, followed by the LLM response delivery

#### Scenario: Multiple tools produce surface directives
- **WHEN** multiple tools across multiple steps produce surface directives
- **THEN** the executor SHALL enqueue all surface deliveries in the order they were produced, all before the LLM response delivery

#### Scenario: File surface directive
- **WHEN** a tool produces a file surface directive
- **THEN** the executor SHALL enqueue a file delivery using the directive's `filePath` and optional `caption`

#### Scenario: No surface directives
- **WHEN** no tools in the execution produce surface directives
- **THEN** the executor SHALL behave identically to today — only the LLM response is delivered

#### Scenario: Surface directives for non-message tasks
- **WHEN** surface directives are produced during a non-message task (heartbeat, cron, etc.) that has no delivery target
- **THEN** the executor SHALL discard the surface directives (no delivery target to send to)

### Requirement: exec_command surfaceOutput integration
When `exec_command` is called with `surfaceOutput: true`, the tool SHALL include stdout as a text surface directive.

#### Scenario: surfaceOutput true with output
- **WHEN** an agent calls `exec_command({ command: "cat list.md", surfaceOutput: true })` and the command produces stdout
- **THEN** the tool result SHALL include `surface: [{ type: 'text', content: <stdout> }]`

#### Scenario: surfaceOutput false
- **WHEN** an agent calls `exec_command({ command: "cat list.md", surfaceOutput: false })` or omits `surfaceOutput`
- **THEN** the tool result SHALL NOT include surface directives

#### Scenario: surfaceOutput true with empty stdout
- **WHEN** an agent calls `exec_command` with `surfaceOutput: true` but the command produces no stdout
- **THEN** the tool result SHALL NOT include a surface directive (nothing to surface)

### Requirement: Sub-agent surface bubbling
When a sub-agent task completes, any surface directives collected during its execution SHALL be available to the parent agent via the `spawn_subagent` tool result.

#### Scenario: Sub-agent produces surface directives
- **WHEN** a sub-agent's execution produces surface directives
- **THEN** the `spawn_subagent` tool result SHALL include them as `data.surfaces` array

#### Scenario: Parent re-emits sub-agent surfaces
- **WHEN** a parent agent receives `data.surfaces` from a sub-agent result
- **THEN** the parent agent MAY call `emit_to_chat` with the surface content to deliver it to chat

#### Scenario: Sub-agent surfaces not auto-delivered
- **WHEN** a sub-agent produces surface directives
- **THEN** the surfaces SHALL NOT be automatically delivered to the user — the parent agent MUST explicitly re-emit them

