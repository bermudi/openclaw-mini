## MODIFIED Requirements

### Requirement: Multi-source skill discovery
The system SHALL support multiple skill sources, scanning both `skills/` (built-in) and `data/skills/` (agent-managed) directories. Each source SHALL be scanned independently and the results merged.

#### Scenario: Discover skills from both sources
- **WHEN** `skills/` contains `planner/SKILL.md` and `data/skills/` contains `custom-tool/SKILL.md`
- **THEN** both skills SHALL be loaded: `planner` from built-in source, `custom-tool` from managed source

#### Scenario: Managed skills directory does not exist
- **WHEN** `data/skills/` does not exist
- **THEN** the system SHALL start normally with only built-in skills loaded

### Requirement: Built-in skills are protected from override
When a managed skill (`data/skills/`) has the same name as a built-in skill (`skills/`), the collision SHALL be detected and the managed skill SHALL be rejected. The built-in skill SHALL always win. This prevents agents with write access to `data/skills/` from overriding trusted built-in skills.

#### Scenario: Collision detected — built-in wins
- **WHEN** `skills/planner/SKILL.md` exists AND `data/skills/planner/SKILL.md` exists
- **THEN** the built-in `planner` SHALL be loaded, the managed `planner` SHALL be rejected, and a warning SHALL be logged indicating the collision

#### Scenario: No collision — both sources load
- **WHEN** `skills/planner/SKILL.md` exists AND `data/skills/custom-tool/SKILL.md` exists with a different name
- **THEN** both skills SHALL be loaded normally

#### Scenario: Managed skill attempts to override built-in
- **WHEN** an agent creates `data/skills/researcher/SKILL.md` but `skills/researcher/SKILL.md` already exists
- **THEN** the managed skill SHALL be rejected with a logged warning, and the built-in `researcher` SHALL be used

### Requirement: Skill loading pipeline stages
Skill loading SHALL follow a discover/merge/validate/cache pipeline where each stage is independently testable:
1. **Discover**: Each source scans its directory and returns unvalidated skill objects
2. **Merge**: Skills are combined with collision detection (built-ins protected)
3. **Validate**: Gating checks and override schema validation run on merged set
4. **Cache**: Validated skills are cached with TTL

#### Scenario: Pipeline execution order
- **WHEN** skills are loaded
- **THEN** discovery SHALL run first per-source, THEN merge with collision detection, THEN validation, THEN caching

### Requirement: Skill source metadata
Each loaded skill SHALL include `source` metadata indicating its origin (`"built-in"` or `"managed"`). This enables auditing and debugging of skill provenance.

#### Scenario: Skill source in API response
- **WHEN** a GET request is made to `/api/skills`
- **THEN** each skill in the response SHALL include a `source` field with value `"built-in"` or `"managed"`

### Requirement: Cache invalidation via SIGHUP
The skill cache SHALL be invalidated when the process receives a SIGHUP signal, enabling hot-reload during development without restarting the server.

#### Scenario: SIGHUP triggers cache clear
- **WHEN** the process receives SIGHUP
- **THEN** the skill cache SHALL be cleared and the next skill lookup SHALL trigger a full reload
