## ADDED Requirements

### Requirement: Planner skill definition
The system SHALL include a `skills/planner/SKILL.md` file with frontmatter fields `name: planner`, an orchestration-focused `description`, and `tools: ["spawn_subagent", "get_datetime", "write_note"]`.

#### Scenario: Skill discovered and loaded
- **WHEN** the skill-service scans the built-in skills directory
- **THEN** a skill named `planner` SHALL be discoverable with its defined metadata and instruction body

### Requirement: Planner skill instructions
The planner body SHALL contain substantive instructions for decomposition, specialist selection, delegation, aggregation, and partial-failure handling.

#### Scenario: Sub-agent receives orchestration instructions
- **WHEN** a sub-agent task is created with `skill: "planner"`
- **THEN** the prompt SHALL include the built-in specialist roster and guidance for using each skill appropriately

#### Scenario: Instructions include the skill catalog
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL describe `researcher`, `vision-analyst`, `coder`, and `browser` with guidance on when to use each one

### Requirement: Planner allowed-skills roster
The planner skill SHALL declare `overrides.allowedSkills` containing `researcher`, `vision-analyst`, `coder`, and `browser`.

#### Scenario: Planner allowlist is exhaustive for the built-in roster
- **WHEN** the planner skill overrides are parsed
- **THEN** `allowedSkills` SHALL include `researcher`, `vision-analyst`, `coder`, and `browser`

### Requirement: Planner skill tool restriction
The planner skill SHALL declare orchestration tools only and SHALL NOT declare direct execution or browser tools.

#### Scenario: No direct execution tools declared
- **WHEN** the planner skill is loaded
- **THEN** its declared tools SHALL exclude `exec_command`, `browser_action`, and `send_file_to_chat`
