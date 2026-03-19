# skill-loading Specification

## Purpose
TBD - created by archiving change agent-architecture. Update Purpose after archive.
## Requirements
### Requirement: Skill discovery from filesystem
The system SHALL scan a skills directory for subdirectories containing a `SKILL.md` file. Each valid subdirectory SHALL be treated as a skill. The default skills directory SHALL be `skills/` in the project root.

#### Scenario: Discover skills in directory
- **WHEN** the skills directory contains `web-search/SKILL.md` and `pdf-gen/SKILL.md`
- **THEN** two skills SHALL be loaded: `web-search` and `pdf-gen`

#### Scenario: Subdirectory without SKILL.md is ignored
- **WHEN** the skills directory contains a subdirectory `drafts/` with no `SKILL.md`
- **THEN** that subdirectory SHALL be silently ignored

#### Scenario: Empty or missing skills directory
- **WHEN** the skills directory does not exist or is empty
- **THEN** the system SHALL start normally with zero skills loaded and log a notice

### Requirement: SKILL.md frontmatter parsing
Each `SKILL.md` file SHALL be parsed using `gray-matter` to extract YAML frontmatter. The frontmatter SHALL support the following fields: `name` (string, required), `description` (string, required), `tools` (string array, optional), and `requires` (object, optional) with sub-fields `binaries` (string array), `env` (string array), and `platform` (string array).

#### Scenario: Parse valid SKILL.md
- **WHEN** a SKILL.md contains frontmatter with `name: "web-search"` and `description: "Search the web"`
- **THEN** the skill SHALL be loaded with those metadata fields and the markdown body as instructions

#### Scenario: Missing required fields
- **WHEN** a SKILL.md has no `name` or no `description` in frontmatter
- **THEN** the skill SHALL be skipped with a warning log indicating the missing field

### Requirement: Skill gating
Skills with a `requires` block in frontmatter SHALL be checked at load time. A skill SHALL be marked `enabled: false` with a `gatingReason` if any requirement is not met.

#### Scenario: Missing required binary
- **WHEN** a skill declares `requires.binaries: ["ffmpeg"]` and `ffmpeg` is not in PATH
- **THEN** the skill SHALL be loaded but disabled with `gatingReason: "missing binary: ffmpeg"`

#### Scenario: Missing required env var
- **WHEN** a skill declares `requires.env: ["SERP_API_KEY"]` and the env var is not set
- **THEN** the skill SHALL be loaded but disabled with `gatingReason: "missing env: SERP_API_KEY"`

#### Scenario: Platform mismatch
- **WHEN** a skill declares `requires.platform: ["darwin"]` and the system is `linux`
- **THEN** the skill SHALL be loaded but disabled with `gatingReason: "unsupported platform: linux (requires: darwin)"`

#### Scenario: All requirements met
- **WHEN** all declared requirements are satisfied
- **THEN** the skill SHALL be marked `enabled: true` with no `gatingReason`

### Requirement: Skill caching with TTL
Loaded skills SHALL be cached in memory. The cache SHALL refresh after a configurable TTL (default 60 seconds) upon the next access.

#### Scenario: Skills served from cache
- **WHEN** skills were loaded less than 60 seconds ago and a skill lookup is requested
- **THEN** the cached skills SHALL be returned without re-reading the filesystem

#### Scenario: Cache expires and refreshes
- **WHEN** more than 60 seconds have passed since the last load and a skill lookup is requested
- **THEN** the skills directory SHALL be re-scanned and the cache updated

### Requirement: Skill summaries in main agent prompt
The main agent's system prompt SHALL include a summary of all enabled skills available to it. Each summary SHALL contain the skill name and description from SKILL.md frontmatter.

#### Scenario: Agent with specific skills
- **WHEN** an agent has `skills: ["web-search", "pdf-gen"]` and both are enabled
- **THEN** the system prompt SHALL include summaries for only those two skills

#### Scenario: Agent with empty skills array
- **WHEN** an agent has `skills: []` (empty array)
- **THEN** the system prompt SHALL include summaries for ALL enabled skills

#### Scenario: Prompt size cap
- **WHEN** skill summaries are injected into the main agent prompt
- **THEN** the total injected text SHALL NOT exceed 5000 characters

### Requirement: Skill listing API
The system SHALL expose a GET endpoint at `/api/skills` that returns all discovered skills with their metadata, enabled status, and gating reason.

#### Scenario: List all skills
- **WHEN** a GET request is made to `/api/skills`
- **THEN** the response SHALL include an array of skills with `name`, `description`, `enabled`, `source`, and optional `gatingReason` for each

#### Scenario: No skills loaded
- **WHEN** no skills directory exists or it is empty
- **THEN** the response SHALL return an empty array

