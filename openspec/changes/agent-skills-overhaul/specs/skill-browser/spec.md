## ADDED Requirements

### Requirement: Browser skill definition
The system SHALL include a `skills/browser/SKILL.md` file with frontmatter fields: `name: browser`, `description` explaining web interaction and automation capability, `tools` listing `browser_action`, and `requires` block gating on the Playwright binary.

#### Scenario: Skill discovered and loaded when Playwright is available
- **WHEN** the skill-service scans the skills directory and Playwright is installed
- **THEN** a skill named `browser` SHALL be loaded with `enabled: true`

#### Scenario: Skill disabled when Playwright is missing
- **WHEN** the skill-service scans the skills directory and Playwright is not installed
- **THEN** the `browser` skill SHALL be loaded with `enabled: false` and `gatingReason` indicating the missing binary

### Requirement: Browser skill instructions
The SKILL.md body SHALL contain substantive instructions (minimum 30 lines) covering: role definition, navigation patterns (go to URL, wait for load), interaction patterns (click, type, fill forms), data extraction (get text from selectors, screenshot), how to approach multi-step web workflows (login → navigate → extract), output format (structured results + screenshot paths), error handling (element not found, timeout, navigation failure), and security boundaries (no credential entry unless explicitly provided in the task).

#### Scenario: Sub-agent receives browser-specific instructions
- **WHEN** a sub-agent task is created with `skill: "browser"`
- **THEN** the sub-agent's system prompt SHALL contain guidance on web interaction patterns, selector strategies, and error recovery

#### Scenario: Instructions cover multi-step workflows
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL describe how to approach multi-page workflows (navigate → interact → verify → continue)

### Requirement: Browser skill gating
The browser skill SHALL declare `requires.binaries: ["npx"]` in frontmatter to ensure Playwright can be invoked. If the binary is not found, the skill SHALL be disabled with a clear gating reason.

#### Scenario: Gating check passes
- **WHEN** `npx` is available on PATH
- **THEN** the browser skill SHALL be `enabled: true`

#### Scenario: Gating check fails
- **WHEN** `npx` is not available on PATH
- **THEN** the browser skill SHALL be `enabled: false` with `gatingReason: "missing binary: npx"`

### Requirement: Browser skill tool restriction
The browser skill SHALL declare `tools: ["browser_action"]` in frontmatter. The sub-agent SHALL NOT have access to `exec_command`, `spawn_subagent`, or `send_file_to_chat`.

#### Scenario: Only browser tool available
- **WHEN** a browser sub-agent is executing
- **THEN** it SHALL have access only to `browser_action`

### Requirement: Browser skill model configuration
The browser skill SHALL configure `overrides.model` to use a fast model suitable for browser interaction decisions. The skill SHALL set moderate iteration limits to support multi-step navigation workflows.

#### Scenario: Sufficient iterations for multi-step browsing
- **WHEN** the SKILL.md overrides are parsed
- **THEN** `maxIterations` SHALL be at least 6 to support navigate → interact → verify patterns
