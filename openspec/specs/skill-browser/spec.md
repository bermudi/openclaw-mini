# skill-browser Specification

## Purpose
TBD - created by archiving change agent-skills-overhaul. Update Purpose after archive.
## Requirements
### Requirement: Browser skill definition
The system SHALL include a `skills/browser/SKILL.md` file with frontmatter fields `name: browser`, a browser-automation `description`, and `tools: ["browser_action"]`.

#### Scenario: Skill discovered and loaded
- **WHEN** the skill-service scans the built-in skills directory
- **THEN** a skill named `browser` SHALL be discoverable with its defined metadata and instruction body

### Requirement: Browser skill instructions
The SKILL.md body SHALL contain substantive instructions covering navigation, interaction, extraction, verification, error handling, and safety boundaries for browser work.

#### Scenario: Sub-agent receives browser-specific instructions
- **WHEN** a sub-agent task is created with `skill: "browser"`
- **THEN** the sub-agent prompt SHALL contain guidance on web interaction patterns, selector usage, and recovery from navigation failures

#### Scenario: Instructions cover multi-step workflows
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL describe how to approach multi-step workflows such as navigate -> interact -> verify -> continue

### Requirement: Browser skill tool restriction
The browser skill SHALL declare `tools: ["browser_action"]` in frontmatter and SHALL NOT declare execution or spawn tools.

#### Scenario: Only browser tool declared
- **WHEN** the browser skill is loaded
- **THEN** its declared tool list SHALL contain `browser_action` and SHALL NOT contain `exec_command`, `spawn_subagent`, or `send_file_to_chat`

### Requirement: Browser skill model configuration
The browser skill SHALL configure a model and iteration limits suitable for browser decision-making workflows.

#### Scenario: Iteration budget supports multi-step browsing
- **WHEN** the SKILL.md overrides are parsed
- **THEN** the browser skill SHALL define a moderate iteration budget appropriate for multi-step navigation and extraction

