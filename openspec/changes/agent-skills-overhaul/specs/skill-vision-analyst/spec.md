## ADDED Requirements

### Requirement: Vision analyst skill definition
The system SHALL include a `skills/vision-analyst/SKILL.md` file with frontmatter fields `name: vision-analyst`, an image-analysis `description`, and a minimal declared tool set.

#### Scenario: Skill discovered and loaded
- **WHEN** the skill-service scans the built-in skills directory
- **THEN** a skill named `vision-analyst` SHALL be discoverable with its defined metadata and instruction body

### Requirement: Vision analyst skill instructions
The SKILL.md body SHALL contain substantive instructions covering image description, chart/data extraction, structured output, and ambiguity handling.

#### Scenario: Sub-agent receives vision-specific instructions
- **WHEN** a sub-agent task is created with `skill: "vision-analyst"`
- **THEN** the prompt SHALL include guidance on chart analysis, data extraction, and structured reporting

#### Scenario: Instructions cover chart analysis specifically
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL include guidance on axis labels, legends, time ranges, and notable trends when analyzing charts

### Requirement: Vision analyst model configuration
The vision analyst skill SHALL configure a vision-capable model and conservative iteration limits.

#### Scenario: Vision-capable model used
- **WHEN** the skill overrides are parsed
- **THEN** the configured model SHALL be one intended for vision-capable analysis

### Requirement: Vision analyst tool restriction
The vision analyst skill SHALL declare a minimal tool set and SHALL NOT declare execution, browser, or spawn tools.

#### Scenario: Minimal tool declaration
- **WHEN** the vision-analyst skill is loaded
- **THEN** its declared tools SHALL exclude `exec_command`, `browser_action`, and `spawn_subagent`
