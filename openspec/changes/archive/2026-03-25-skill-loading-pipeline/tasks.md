## 1. Create loader primitives

- [x] 1.1 Add `SkillLoader` interface for discover-stage loaders
- [x] 1.2 Add `UnvalidatedSkill` type for pre-validation skill data
- [x] 1.3 Implement filesystem loader(s) for `skills/` and `data/skills/`
- [x] 1.4 Export precedence constants with consistent ordering: `SKILL_PRECEDENCE_BUILTIN = 10`, `SKILL_PRECEDENCE_MANAGED = 20`

## 2. Refactor `skill-service.ts` into pipeline stages

- [x] 2.1 Extract skill file parsing into a standalone helper
- [x] 2.2 Implement `discoverSkills(loaders)`
- [x] 2.3 Implement `mergeSkills(skills)` with case-insensitive collision handling and built-in precedence
- [x] 2.4 Implement `validateSkills(skills)` for gating and override validation
- [x] 2.5 Wire `loadAllSkills()` as `discover -> merge -> validate -> cache`
- [x] 2.6 Preserve the existing exported function signatures

## 3. Add provenance and managed-source support

- [x] 3.1 Register built-in loader for `skills/`
- [x] 3.2 Register managed loader for `data/skills/`
- [x] 3.3 Expose public `source` provenance as `built-in` or `managed`
- [x] 3.4 Retain internal source-path diagnostics for warnings and logs

## 4. Hot reload behavior

- [x] 4.1 Update `clearSkillCache()` to clear binary-availability cache in addition to loaded skills
- [x] 4.2 Register a one-time `process.on('SIGHUP', ...)` hook in `src/instrumentation.ts`
- [x] 4.3 Verify the next lookup performs a full reload and re-runs gating after `SIGHUP`

## 5. Testing

- [x] 5.1 Add unit test for precedence where built-in and managed skills share the same name and built-in wins
- [x] 5.2 Add unit test for case-insensitive collisions (`Planner` vs `planner`)
- [x] 5.3 Add unit test for missing `data/skills/` directory returning an empty managed set
- [x] 5.4 Add unit test for filesystem loader parsing frontmatter and instructions
- [x] 5.5 Add API test for `/api/skills` showing `source: "built-in" | "managed"`
- [x] 5.6 Run the existing skill-loading and subagent regression suites

## 6. Documentation

- [x] 6.1 Document pipeline stage responsibilities in loader/service module comments
- [x] 6.2 Document provenance semantics and precedence constants in the skill-loading service
