## MODIFIED Requirements

### Requirement: Skill discovery from filesystem
The system SHALL support multiple skill sources, scanning both `skills/` (built-in) and `data/skills/` (managed) directories. Each source SHALL be scanned independently and the results merged.

#### Scenario: Discover skills from both sources
- **WHEN** `skills/` contains `planner/SKILL.md` and `data/skills/` contains `custom-tool/SKILL.md`
- **THEN** both skills SHALL be loaded: `planner` from the built-in source and `custom-tool` from the managed source

#### Scenario: Managed skills directory does not exist
- **WHEN** `data/skills/` does not exist
- **THEN** the system SHALL start normally with only built-in skills loaded

## ADDED Requirements

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
