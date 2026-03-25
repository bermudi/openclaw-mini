## MODIFIED Requirements

### Requirement: SKILL.md frontmatter parsing
Each `SKILL.md` file SHALL be parsed using `gray-matter` to extract YAML frontmatter. The frontmatter SHALL support the following fields: `name` (string, required), `description` (string, required), `tools` (string array, optional), `overrides` (object, optional), and `requires` (object, optional) with sub-fields `binaries` (string array), `env` (string array), and `platform` (string array). The `overrides` object MUST NOT include a `systemPrompt` field — this field is removed from the codebase. The SKILL.md markdown body is the canonical and only source of the system prompt for the sub-agent.

#### Scenario: Parse valid SKILL.md
- **WHEN** a SKILL.md contains frontmatter with `name: "web-search"` and `description: "Search the web"`
- **THEN** the skill SHALL be loaded with those metadata fields and the markdown body as instructions

#### Scenario: Missing required fields
- **WHEN** a SKILL.md has no `name` or no `description` in frontmatter
- **THEN** the skill SHALL be skipped with a warning log indicating the missing field

#### Scenario: Body is the system prompt
- **WHEN** a SKILL.md has a markdown body
- **THEN** the body content SHALL be used as the sub-agent's system prompt during execution — there is no override mechanism

#### Scenario: Invalid systemPrompt in overrides
- **WHEN** a SKILL.md sets `overrides.systemPrompt`
- **THEN** the skill SHALL fail validation with an error indicating that `systemPrompt` is not a valid override field — the field has been removed from the schema
