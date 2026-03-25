## 1. Create loader primitives

- [ ] 1.1 Add `SkillLoader` interface for discover-stage loaders
- [ ] 1.2 Add `UnvalidatedSkill` type for pre-validation skill data
- [ ] 1.3 Implement filesystem loader(s) for `skills/` and `data/skills/`
- [ ] 1.4 Export precedence constants with consistent ordering: `SKILL_PRECEDENCE_BUILTIN = 10`, `SKILL_PRECEDENCE_MANAGED = 20`

## 2. Refactor `skill-service.ts` into pipeline stages

- [ ] 2.1 Extract skill file parsing into a standalone helper
- [ ] 2.2 Implement `discoverSkills(loaders)`
- [ ] 2.3 Implement `mergeSkills(skills)` with case-insensitive collision handling and built-in precedence
- [ ] 2.4 Implement `validateSkills(skills)` for gating and override validation
- [ ] 2.5 Wire `loadAllSkills()` as `discover -> merge -> validate -> cache`
- [ ] 2.6 Preserve the existing exported function signatures

## 3. Add provenance and managed-source support

- [ ] 3.1 Register built-in loader for `skills/`
- [ ] 3.2 Register managed loader for `data/skills/`
- [ ] 3.3 Expose public `source` provenance as `built-in` or `managed`
- [ ] 3.4 Retain internal source-path diagnostics for warnings and logs

## 4. Hot reload behavior

- [ ] 4.1 Update `clearSkillCache()` to clear binary-availability cache in addition to loaded skills
- [ ] 4.2 Register a one-time `process.on('SIGHUP', ...)` hook in `src/instrumentation.ts`
- [ ] 4.3 Verify the next lookup performs a full reload and re-runs gating after `SIGHUP`

## 5. Testing

- [ ] 5.1 Add unit test for precedence where built-in and managed skills share the same name and built-in wins
- [ ] 5.2 Add unit test for case-insensitive collisions (`Planner` vs `planner`)
- [ ] 5.3 Add unit test for missing `data/skills/` directory returning an empty managed set
- [ ] 5.4 Add unit test for filesystem loader parsing frontmatter and instructions
- [ ] 5.5 Add API test for `/api/skills` showing `source: "built-in" | "managed"`
- [ ] 5.6 Run the existing skill-loading and subagent regression suites

## 6. Documentation

- [ ] 6.1 Document pipeline stage responsibilities in loader/service module comments
- [ ] 6.2 Document provenance semantics and precedence constants in the skill-loading service
