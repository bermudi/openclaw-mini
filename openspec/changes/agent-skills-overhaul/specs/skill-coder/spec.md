## ADDED Requirements

### Requirement: Coder skill definition
The system SHALL include a `skills/coder/SKILL.md` file with frontmatter fields: `name: coder`, `description` explaining code writing and execution capability, and `tools` listing `exec_command`, `send_file_to_chat`, `write_note`, and `read_file`.

#### Scenario: Skill discovered and loaded
- **WHEN** the skill-service scans the skills directory
- **THEN** a skill named `coder` SHALL be loaded with `enabled: true`

#### Scenario: Skill description enables main agent selection for code tasks
- **WHEN** the main agent receives a task requiring script writing, data processing, or file generation
- **THEN** the skill summary SHALL make it clear that `coder` is the right choice

### Requirement: Coder skill instructions
The SKILL.md body SHALL contain substantive instructions (minimum 40 lines) covering: role definition, language selection guidance (Python for data/charts, TypeScript/Bun for web/JSON tasks), script writing patterns (write to sandbox, then execute), how to use `exec_command` (write script file first, then run it), how to use `send_file_to_chat` to deliver output files to the user, output format for returning results to parent agent, error handling (parse stderr, retry with fixes), and sandbox constraints.

#### Scenario: Sub-agent receives coding-specific instructions
- **WHEN** a sub-agent task is created with `skill: "coder"`
- **THEN** the sub-agent's system prompt SHALL contain guidance on writing scripts, executing them safely, and delivering output files

#### Scenario: Instructions cover the write-execute-deliver pattern
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL describe the pattern: write script to sandbox → execute via `exec_command` → check output → deliver via `send_file_to_chat`

### Requirement: Coder skill tool access
The coder skill SHALL declare `tools: ["exec_command", "send_file_to_chat", "write_note", "read_file"]` in frontmatter. The sub-agent SHALL have access to code execution and file delivery but NOT to `spawn_subagent` or `browser_action`.

#### Scenario: Execution tools available
- **WHEN** a coder sub-agent is executing
- **THEN** it SHALL have access to `exec_command` and `send_file_to_chat`

#### Scenario: No spawning or browsing
- **WHEN** a coder sub-agent attempts to use `spawn_subagent` or `browser_action`
- **THEN** the tool invocation SHALL be rejected with a permission error

### Requirement: Coder skill model configuration
The coder skill SHALL configure `overrides.model` to use a capable model suitable for code generation. The skill SHALL set higher iteration and tool invocation limits than other skills to support the write-execute-fix cycle.

#### Scenario: Sufficient iterations for code development
- **WHEN** the SKILL.md overrides are parsed
- **THEN** `maxIterations` SHALL be at least 8 and `maxToolInvocations` SHALL be at least 10 to allow for write → run → fix cycles

#### Scenario: Model suitable for code generation
- **WHEN** a coder sub-agent task is executed
- **THEN** the model SHALL be one known for strong code generation capability
