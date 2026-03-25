## Context

The current `skill-service.ts` has a single `loadAllSkills()` function that (1) scans `skills/` directory, (2) reads each `SKILL.md`, (3) validates overrides, and (4) caches the result. This conflates discovery, parsing, validation, and caching into one place, making it difficult to:

- Add a second skill source (e.g., `data/skills/` for agent-managed skills)
- Define clear precedence rules when skills share names
- Reason about why a skill was disabled or overridden
- Unit test individual stages in isolation

The `exec-runtime-overhaul` design (Decision 7) explicitly requires that `data/skills/` agent-managed skills coexist with `skills/` built-ins and win on name collision. The current implementation has no concept of multiple sources or precedence.

## Goals / Non-Goals

**Goals:**
- Define a skill loading pipeline with discrete, independently testable stages: Discover → Merge → Validate → Cache
- Support two filesystem sources: `skills/` (built-in) and `data/skills/` (agent-managed), with agent-managed winning on name collision
- Enable future extensibility via a `SkillLoader` interface without modifying core pipeline logic
- Preserve all existing behavior: discovery, frontmatter parsing, gating, override validation, caching, summaries, API
- Make skill loading auditable: each stage logs its input/output for debugging

**Non-Goals:**
- Implementing remote skill sources or MCP-based loaders in this change; the interface is designed to accommodate them later
- Changing skill metadata schema (name, description, tools, overrides, requires) or adding versioning
- Modifying the skill caching TTL (remains 60s) or the `SkillCache` structure
- Supporting skill unloading or selective hot-reload beyond full cache invalidation via `clearSkillCache()` and SIGHUP

## Decisions

### Decision 1: Four-stage pipeline with clear boundaries

The skill loading flow becomes four discrete stages:

```
Discover (per source) → Merge (by precedence) → Validate (gating + overrides) → Cache
```

- **Discover**: Each `SkillLoader` scans its own source and returns raw `UnvalidatedSkill[]`. Discovery is source-specific (e.g., filesystem traversal) and produces unvalidated skill objects with `rawOverrides`.
- **Merge**: Takes all skills from all loaders, sorts by `precedence` ascending (lower number = higher priority), and keeps only the first occurrence of each skill name. Agent-managed skills use `precedence: 10`; built-in skills use `precedence: 20`. Lower numeric precedence wins.
- **Validate**: Runs gating checks (binary, env, platform) and overrides schema validation on the merged set. Validation is global—it runs once after merge, not per-source.
- **Cache**: Stores the fully validated `LoadedSkill[]` with TTL. Cache is checked before invoking the pipeline.

Each stage is a pure function or a service method that accepts stage input and returns stage output. No shared mutable state between stages.

**Alternative considered**: Keep discovery and validation per-source (discover then validate each source independently, then merge validated skills). Rejected because override schema validation requires knowing all skill names across sources, so validation must happen post-merge.

**Alternative considered**: More than four stages (e.g., separate Parse, Filter, Enrich). Rejected as over-engineering. The four stages map cleanly to distinct concerns with no cross-stage logic.

### Decision 2: `SkillLoader` interface for extensibility

```typescript
interface SkillLoader {
  readonly source: string;          // e.g., "skills/", "data/skills/"
  readonly precedence: number;     // lower = higher priority on collision
  discover(): Promise<UnvalidatedSkill[]>;
}
```

The pipeline accepts an array of `SkillLoader` instances. Built-in loaders are registered in a list; the order in the list does not matter since merge uses explicit `precedence`. New loaders (remote, MCP) can be added by implementing `SkillLoader` and pushing to the loader list.

**Alternative considered**: Registry pattern with keyed map. Rejected because the key would be the source name, but we already have `source` as a field on the loader. A list is simpler.

**Alternative considered**: Generator/iterator pattern for lazy discovery. Rejected for the first iteration since all skills are in-memory files; lazy discovery adds complexity without benefit.

### Decision 3: Agent-managed skills win on collision

The merge stage sorts by `precedence` ascending and uses a `Map<string, LoadedSkill>`, keeping the first occurrence. Since `data/skills/` loaders use `precedence: 10` and `skills/` loaders use `precedence: 20`, agent-managed skills automatically win.

This means:
- If both `skills/planner/SKILL.md` and `data/skills/planner/SKILL.md` exist, the agent-managed version is used and the built-in is silently ignored
- Collision warnings from the current implementation are removed since the precedence mechanism is explicit

**Alternative considered**: Warn on collision and let the operator decide. Rejected because agents need autonomous operation; silent override is the correct default.

**Alternative considered**: Log a debug message on collision. Accepted—pipeline stages emit logs for auditing, but no user-facing warning.

### Decision 4: Validation runs once after merge, not per-source

Both gating (binary/env/platform checks) and override schema validation happen on the merged skill set. This is required because:
- Override schema needs all skill names as `knownSkillNames` (cross-source knowledge)
- Gating reason is a property of the final skill, not the per-source discovery result

**Alternative considered**: Per-source validation with merge at the end. Rejected—see Decision 1 rationale.

### Decision 5: Cache holds fully validated skills only

The cache stores `Map<string, LoadedSkill>` only after validation passes. If validation fails for a skill, the skill is either disabled or skipped before entering the cache. This means the cache always contains usable, fully-checked skills.

Cache invalidation is:
- **TTL-based**: `shouldUseCache()` checks `Date.now() - cache.loadedAt < DEFAULT_CACHE_TTL_MS`
- **Manual**: `clearSkillCache()` sets `loadedAt = 0` and clears the map
- **Signal-based**: Server startup registers `process.on('SIGHUP', clearSkillCache)` for development hot-reload

### Decision 6: `UnvalidatedSkill` type carries raw frontmatter and overrides

```typescript
interface UnvalidatedSkill {
  name: string;
  description: string;
  tools?: string[];
  rawOverrides?: unknown;
  requires?: SkillRequirements;
  enabled: boolean;           // temporarily false during validation
  gatingReason?: string;     // accumulated during validation
  source: string;
  precedence: number;
  instructions: string;
}
```

The `enabled` and `gatingReason` fields start as defaults (no gating) and are updated during the Validate stage. `rawOverrides` is preserved as `unknown` until validation converts it to typed `SubAgentOverrides` or records errors.

### Decision 7: Future sources use explicit precedence values

Remote skill registries or MCP-based loaders should declare an explicit `precedence` value:
- `0-9`: Reserved for system or operator-managed skills
- `10`: Agent-managed (default for `data/skills/`)
- `20`: Built-in (default for `skills/`)
- `30+`: Lower-priority sources

This gives future extension authors clear guidance and avoids conflicts.

## Risks / Trade-offs

- **[Risk] Multiple skill sources increase startup time** → Mitigation: TTL cache means startup cost is paid once per TTL window, not per request. Future: lazy discovery can be added without pipeline restructuring.
- **[Risk] Precedence is implicit in numeric values that developers must know** → Mitigation: Constants (`SKILL_PRECEDENCE_BUILTIN`, `SKILL_PRECEDENCE_AGENT`) are exported from the module. Documentation and default loader implementations make the contract clear.
- **[Risk] Agent-managed skills in `data/skills/` are not validated for safety** → Mitigation: Same validation pipeline runs on all skills regardless of source. Malicious skill content is still subject to gating checks, override validation, and the agent's tool allowlist.

## Migration Plan

1. Create `src/lib/services/skill-loader.ts` with `SkillLoader` interface and `FilesystemSkillLoader` implementation
2. Refactor `skill-service.ts` to use the pipeline internally while preserving the public API
3. Register both `skills/` (precedence 20) and `data/skills/` (precedence 10) loaders
4. Wire `SIGHUP` to `clearSkillCache()` in server startup
5. Add integration test: two skills with same name from different sources, verify precedence
6. Run existing skill-service tests to confirm no regressions

## Open Questions

- Should `data/skills/` be created automatically if missing, or should the loader gracefully handle non-existent directories? (Decision: graceful—loader returns empty array if directory does not exist, consistent with current `skills/` behavior)
- Do we need a `SKILL_PRECEDENCE` frontmatter field so individual skills can declare their own precedence, or is source-level precedence sufficient? (Decision: source-level precedence only for the first iteration; per-skill precedence can be added later if needed)
