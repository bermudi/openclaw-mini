# emit-to-chat Specification

## Purpose
TBD - created by archiving change surface-directive. Update Purpose after archive.
## Requirements
### Requirement: emit_to_chat tool registration
The system SHALL register an `emit_to_chat` tool that allows agents to push text directly to the user's chat.

#### Scenario: Emit text to chat
- **WHEN** an agent calls `emit_to_chat({ text: "Here is the content..." })`
- **THEN** the tool SHALL return a `ToolResult` with `surface: [{ type: 'text', content: "Here is the content..." }]`

#### Scenario: Tool result indicates success
- **WHEN** `emit_to_chat` is called
- **THEN** the tool SHALL return `{ success: true, data: { emitted: true } }` along with the surface directive

### Requirement: emit_to_chat is always available
The `emit_to_chat` tool SHALL be registered unconditionally (not gated by any config flag).

#### Scenario: Tool available by default
- **WHEN** the tool registry initializes
- **THEN** `emit_to_chat` SHALL be in the list of available tools with risk level `low`

