## ADDED Requirements

### Requirement: Coder skill definition
The system SHALL include a `skills/coder/SKILL.md` file with frontmatter fields `name: coder`, a code-task `description`, and `tools` listing `exec_command`, `send_file_to_chat`, `write_note`, and `read_file`.

#### Scenario: Skill discovered and loaded
- **WHEN** the skill-service scans the built-in skills directory
- **THEN** a skill named `coder` SHALL be discoverable with its defined metadata and instruction body

### Requirement: Coder skill instructions match the current runtime
The coder skill instructions SHALL describe coding and execution workflows that match the current runtime constraints rather than promising unrestricted shell workflows.

#### Scenario: Sub-agent receives coding instructions
- **WHEN** a sub-agent task is created with `skill: "coder"`
- **THEN** the sub-agent prompt SHALL contain guidance on using the current exec surface, inspecting results, and reporting outcomes clearly

#### Scenario: Instructions acknowledge runtime limits
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL describe the current execution constraints, including direct command execution and sandbox-relative file delivery

### Requirement: Coder skill tool access
The coder skill SHALL declare `tools: ["exec_command", "send_file_to_chat", "write_note", "read_file"]` in frontmatter and SHALL NOT declare `spawn_subagent` or `browser_action`.

#### Scenario: Execution tools declared
- **WHEN** the coder skill is loaded
- **THEN** its declared tool list SHALL include `exec_command` and `send_file_to_chat`

### Requirement: Coder skill model configuration
The coder skill SHALL configure a capable model and a higher iteration budget than lightweight specialist skills.

#### Scenario: Iteration budget supports inspect-and-fix loops
- **WHEN** the SKILL.md overrides are parsed
- **THEN** the coder skill SHALL define iteration and tool-invocation limits suitable for multi-step execution-oriented tasks
