# skill-loading Specification

## Purpose
TBD - created by archiving change agent-architecture. Update Purpose after archive.
## Requirements
### Requirement: Skill discovery from filesystem
The system SHALL support multiple skill sources, scanning both `skills/` (built-in) and `data/skills/` (managed) directories. Each source SHALL be scanned independently and the results merged.

#### Scenario: Discover skills from both sources
- **WHEN** `skills/` contains `planner/SKILL.md` and `data/skills/` contains `custom-tool/SKILL.md`
- **THEN** both skills SHALL be loaded: `planner` from the built-in source and `custom-tool` from the managed source

#### Scenario: Managed skills directory does not exist
- **WHEN** `data/skills/` does not exist
- **THEN** the system SHALL start normally with only built-in skills loaded

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

### Requirement: Built-in skills are protected from override
When a managed skill has the same logical name as a built-in skill, the collision SHALL be detected case-insensitively and the managed skill SHALL be rejected. The built-in skill SHALL always win.

#### Scenario: Collision detected - built-in wins
- **WHEN** `skills/planner/SKILL.md` exists and `data/skills/planner/SKILL.md` exists
- **THEN** the built-in `planner` SHALL be loaded, the managed `planner` SHALL be rejected, and a warning SHALL be logged

#### Scenario: Collision detected regardless of case
- **WHEN** `skills/Planner/SKILL.md` exists and `data/skills/planner/SKILL.md` exists
- **THEN** the runtime SHALL treat them as the same skill name and keep only the built-in skill

#### Scenario: No collision
- **WHEN** `skills/planner/SKILL.md` exists and `data/skills/custom-tool/SKILL.md` exists with a different name
- **THEN** both skills SHALL be loaded normally

### Requirement: Skill loading pipeline stages
Skill loading SHALL follow a discover/merge/validate/cache pipeline where each stage is independently testable.

1. **Discover**: each source scans its directory and returns unvalidated skill objects
2. **Merge**: skills are combined using source precedence and collision detection
3. **Validate**: gating checks and override schema validation run on the merged set
4. **Cache**: validated skills are cached with TTL

#### Scenario: Pipeline execution order
- **WHEN** skills are loaded
- **THEN** discovery SHALL run first, then merge, then validation, then caching

### Requirement: Skill provenance metadata
Each loaded skill SHALL expose public provenance metadata indicating whether it came from the built-in or managed source.

#### Scenario: Skill source in API response
- **WHEN** a GET request is made to `/api/skills`
- **THEN** each skill in the response SHALL include `source: "built-in" | "managed"`

### Requirement: Cache invalidation via SIGHUP
The skill cache SHALL be invalidated when the process receives `SIGHUP`, and the next skill lookup SHALL re-run discovery and gating checks.

#### Scenario: SIGHUP triggers full reload
- **WHEN** the process receives `SIGHUP`
- **THEN** loaded skill data and cached binary-gating results SHALL be cleared, and the next skill lookup SHALL trigger a full reload

