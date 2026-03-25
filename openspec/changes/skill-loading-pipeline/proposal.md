## Why

The current `skill-service.ts` implements skill loading as a single undifferentiated function that scans one directory. This blocks two requirements from `exec-runtime-overhaul`: (1) agent-managed skills in `data/skills/` must coexist with built-in `skills/` under a safe precedence model, and (2) the skill system must be extensible to support future sources like remote skills or MCP registries. A pipeline architecture makes precedence rules, multi-source discovery, and validation ordering explicit rather than implicit.

## What Changes

- Replace `loadAllSkills()` with a discover/merge/validate/cache pipeline where each stage is independently testable
- Add `SkillSource` abstraction with filesystem scanner supporting both `skills/` and `data/skills/`
- Agent-managed skills (`data/skills/`) can only introduce NEW skill names — they cannot override built-in skills (`skills/`) on name collision. Collisions result in a validation error and the built-in skill wins
- Introduce `SkillPrecedence` tier metadata so future sources (remote, MCP) can declare priority
- Add `clearSkillCache()` export and wire it to SIGHUP for hot-reload during development
- Extract skill validation into a standalone `validateSkill()` function that runs after merge
- Support future extensibility: `SkillLoader` interface allows adding remote or MCP-based loaders without modifying core pipeline

## Capabilities

### New Capabilities

- `skill-loading-pipeline`: Refactor skill loading into a discover/merge/validate pipeline with explicit precedence. Stages: Discover (per-source) → Merge (built-ins win on collision, managed skills add-only) → Validate (gating + overrides + collision detection) → Cache (TTL + manual invalidation). Each stage is a pure function or service method, making the flow auditable and testable.
- `skill-precedence`: Metadata field declaring skill source precedence tier. Built-in skills have protected namespace; agent-managed skills can only add new names. Collision detection logs a warning and rejects the managed skill. Future sources (remote, MCP) follow the same add-only model by default.

### Modified Capabilities

- `skill-loading`: The single-directory scan is replaced by multi-source pipeline. All existing requirements (discovery, parsing, gating, caching, summaries, API) remain but are implemented through the pipeline. No behavior change to callers.

## Impact

- **Code**: `src/lib/services/skill-service.ts` refactored into pipeline stages. New `src/lib/services/skill-loader.ts` with `SkillLoader` interface.
- **API**: No changes to `loadAllSkills()`, `getSkillSummaries()`, `getSkillForSubAgent()`, or `clearSkillCache()` signatures.
- **Config**: `OPENCLAW_SKILLS_DIR` continues to point to built-in skills. Agent-managed skills use `data/skills/` (hardcoded, not env-configurable).
- **Dependencies**: No new dependencies; pipeline uses existing `gray-matter` parsing and validation logic.
