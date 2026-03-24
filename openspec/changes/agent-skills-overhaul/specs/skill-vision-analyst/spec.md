## ADDED Requirements

### Requirement: Vision analyst skill definition
The system SHALL include a `skills/vision-analyst/SKILL.md` file with frontmatter fields: `name: vision-analyst`, `description` explaining image analysis and data extraction capability, and `tools` listing `read_file`.

#### Scenario: Skill discovered and loaded
- **WHEN** the skill-service scans the skills directory
- **THEN** a skill named `vision-analyst` SHALL be loaded with `enabled: true`

#### Scenario: Skill description enables main agent selection for image tasks
- **WHEN** the main agent receives a message with an attached image and a request to analyze it
- **THEN** the skill summary SHALL make it clear that `vision-analyst` is the right choice for image understanding tasks

### Requirement: Vision analyst skill instructions
The SKILL.md body SHALL contain substantive instructions (minimum 30 lines) covering: role definition as an image analysis specialist, how to describe visual content (charts, screenshots, photos, diagrams), how to extract structured data from charts (axes, data points, trends), output format (structured description + extracted data), and guidance on what level of detail to provide.

#### Scenario: Sub-agent receives vision-specific instructions
- **WHEN** a sub-agent task is created with `skill: "vision-analyst"`
- **THEN** the sub-agent's system prompt SHALL contain specific guidance on chart analysis, data extraction, and structured output formatting

#### Scenario: Instructions cover chart analysis specifically
- **WHEN** the SKILL.md body is loaded
- **THEN** it SHALL include guidance on extracting data points, axis labels, trends, and legends from chart images

### Requirement: Vision analyst skill model configuration
The vision analyst skill SHALL configure `overrides.model` to use a vision-capable model. The skill SHALL set conservative iteration limits since vision tasks are typically single-turn analysis.

#### Scenario: Vision-capable model used
- **WHEN** a vision-analyst sub-agent task is executed
- **THEN** the model SHALL be one that supports vision input (e.g., `gpt-4.1` or equivalent)

#### Scenario: Low iteration count for focused analysis
- **WHEN** the SKILL.md overrides are parsed
- **THEN** `maxIterations` SHALL be 3 or fewer, reflecting that vision analysis is typically a single focused response

### Requirement: Vision analyst tool restriction
The vision analyst skill SHALL declare minimal tools since its primary capability is the model's vision understanding. The sub-agent SHALL NOT have access to `exec_command`, `browser_action`, or `spawn_subagent`.

#### Scenario: Minimal tool access
- **WHEN** a vision-analyst sub-agent is executing
- **THEN** it SHALL have access only to its declared tools (e.g., `read_file`) and NOT to execution or browser tools
