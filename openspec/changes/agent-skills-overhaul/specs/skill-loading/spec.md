## MODIFIED Requirements

### Requirement: SKILL.md frontmatter parsing
Each `SKILL.md` file SHALL be parsed using `gray-matter` to extract YAML frontmatter. The frontmatter SHALL support the following fields: `name` (string, required), `description` (string, required), `tools` (string array, optional), `overrides` (object, optional), and `requires` (object, optional) with sub-fields `binaries` (string array), `env` (string array), and `platform` (string array). The `overrides` object SHALL NOT include a `systemPrompt` field — the SKILL.md markdown body is the canonical system prompt for the sub-agent.

#### Scenario: Parse valid SKILL.md
- **WHEN** a SKILL.md contains frontmatter with `name: "web-search"` and `description: "Search the web"`
- **THEN** the skill SHALL be loaded with those metadata fields and the markdown body as instructions

#### Scenario: Missing required fields
- **WHEN** a SKILL.md has no `name` or no `description` in frontmatter
- **THEN** the skill SHALL be skipped with a warning log indicating the missing field

#### Scenario: Body is the system prompt
- **WHEN** a SKILL.md has a markdown body and no `overrides.systemPrompt`
- **THEN** the body content SHALL be used as the sub-agent's system prompt during execution

#### Scenario: Overrides.systemPrompt is discouraged
- **WHEN** a SKILL.md sets `overrides.systemPrompt`
- **THEN** the system SHALL still function (the override takes precedence per existing code), but this pattern is considered deprecated — the body should be the sole source of instructions
