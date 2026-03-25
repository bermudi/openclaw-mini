## Context

The current `skill-service.ts` has a single `loadAllSkills()` function that scans one directory, parses frontmatter, evaluates gating, validates overrides, and caches the result. That works for a single source, but it makes three important behaviors implicit instead of explicit:

- where skills come from
- what happens when two sources define the same name
- when validation runs relative to merging and caching

This change turns those implicit rules into a pipeline that can support both built-in and managed skills without weakening trust boundaries.

## Goals / Non-Goals

**Goals:**
- define a discover/merge/validate/cache pipeline with testable boundaries
- support two filesystem sources: built-in `skills/` and managed `data/skills/`
- protect built-in skills from managed overrides
- expose stable public provenance metadata for API consumers
- preserve the existing skill-service entry points
- make hot-reload actually re-run gating checks

**Non-Goals:**
- implementing remote or MCP skill sources yet
- adding per-skill precedence in frontmatter
- changing the override schema beyond what other changes already require
- selective cache invalidation per skill

## Decisions

### Decision 1: Four-stage pipeline

The loading flow is:

```text
Discover -> Merge -> Validate -> Cache
```

- **Discover**: each loader returns `UnvalidatedSkill[]`
- **Merge**: all discovered skills are combined using source precedence and collision rules
- **Validate**: gating checks and override validation run on the merged set
- **Cache**: only validated skills enter the cache

Collision handling belongs in **Merge**, not Validate. Validation should run once on the final merged set.

### Decision 2: Source precedence is explicit and consistent

Lower numeric precedence means higher priority.

- built-in skills: `SKILL_PRECEDENCE_BUILTIN = 10`
- managed skills: `SKILL_PRECEDENCE_MANAGED = 20`

That ordering matches the security rule: built-ins always win on collision.

### Decision 3: Collisions are case-insensitive

Skill lookup is already case-insensitive, so merge-time collision detection must be case-insensitive too. `Planner`, `planner`, and `PLANNER` are the same logical skill name.

When a managed skill collides with a built-in skill, the runtime:

1. keeps the built-in skill
2. rejects the managed skill
3. logs a warning with both provenance values and source paths

### Decision 4: Public provenance and internal source path are separate concerns

The public skill metadata exposed by APIs uses:

```typescript
source: 'built-in' | 'managed'
```

The loader may also retain an internal source-path field for logging and diagnostics, but raw file paths are not the stable public API.

### Decision 5: Validation runs on the merged set

Validation still includes:

- binary gating
- env gating
- platform gating
- override schema validation

It runs after merge so `knownSkillNames` reflects the final merged set, not each source in isolation.

### Decision 6: Hot reload clears all skill-loading caches

`clearSkillCache()` resets:

- the loaded skill cache
- the cached binary-availability results used during gating

`src/instrumentation.ts` is the startup hook for registering a one-time `SIGHUP` listener in the Node runtime.

### Decision 7: Managed skills live under the workspace data root for now

Managed skills are loaded from `path.join(process.cwd(), 'data/skills')` in this iteration. The loader treats a missing directory as empty.

This keeps the first implementation simple while still matching the operator-visible workspace layout.

## Risks / Trade-offs

- **Multiple sources add more IO** -> mitigated by TTL caching
- **Changing the meaning of `source` affects API consumers** -> mitigated by making provenance explicit and stable
- **Case-insensitive merge may surface collisions that were previously hidden** -> acceptable, because lookup is already case-insensitive
- **Managed-skill location is still workspace-relative** -> acceptable for the first iteration; can be promoted into config later if needed

## Migration Plan

1. Introduce loader types and precedence constants
2. Refactor `skill-service.ts` into discover/merge/validate/cache stages
3. Register loaders for `skills/` and `data/skills/`
4. Expose provenance as `built-in` or `managed`
5. Extend `clearSkillCache()` to clear binary cache as well
6. Register one-time `SIGHUP` invalidation in `src/instrumentation.ts`
7. Add tests for precedence, case-insensitive collisions, managed-dir absence, and `/api/skills` provenance output

## Open Questions

- None blocking for implementation. Configurable managed-skill roots and non-filesystem loaders remain follow-up work.
