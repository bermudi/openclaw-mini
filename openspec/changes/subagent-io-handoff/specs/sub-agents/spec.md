## MODIFIED Requirements

### Requirement: Spawn sub-agent tool
The main agent SHALL have access to a `spawn_subagent` tool that creates an ephemeral sub-agent task. The tool SHALL accept `skill` (string, required) and `task` (string, required), and MAY accept `attachments` and `visionInputs` for attachment-aware delegation.

#### Scenario: Spawn a sub-agent with files
- **WHEN** the main agent calls `spawn_subagent` with attachment metadata from the current task
- **THEN** the created child task SHALL preserve those attachments in its payload

#### Scenario: Spawn a sub-agent with vision inputs
- **WHEN** the main agent calls `spawn_subagent` with `visionInputs`
- **THEN** the created child task SHALL preserve those vision inputs in its payload

### Requirement: Sub-agent task execution
When the AgentExecutor processes a task with `type: "subagent"`, it SHALL load the full SKILL.md instructions as the system prompt, restrict tools to those declared by the skill, and preserve attachment-related payloads when present.

#### Scenario: Sub-agent receives inherited vision inputs
- **WHEN** a sub-agent task payload includes `visionInputs`
- **THEN** the executor SHALL process those vision inputs through the same multimodal execution path used for top-level message tasks

#### Scenario: Sub-agent receives inherited delivery context
- **WHEN** a sub-agent tool needs to deliver a surfaced file back to chat
- **THEN** the task execution context SHALL include an inherited delivery target from the parent task
