## 1. Create SkillLoader Interface and FilesystemLoader

- [ ] 1.1 Define `SkillLoader` interface in `src/lib/services/skill-loader.ts` with `source`, `precedence`, and `discover()` method
- [ ] 1.2 Define `UnvalidatedSkill` type mirroring the internal type currently in `skill-service.ts`
- [ ] 1.3 Implement `FilesystemSkillLoader` class that scans a directory for `SKILL.md` files and returns `UnvalidatedSkill[]`
- [ ] 1.4 Export precedence constants: `SKILL_PRECEDENCE_AGENT = 10`, `SKILL_PRECEDENCE_BUILTIN = 20`

## 2. Refactor skill-service.ts into Pipeline

- [ ] 2.1 Extract `readSkillFile()` into a standalone async function that returns `UnvalidatedSkill`
- [ ] 2.2 Implement `discoverSkills(loaders: SkillLoader[])` stage: calls each loader's `discover()`, returns flat `UnvalidatedSkill[]`
- [ ] 2.3 Implement `mergeSkills(skills: UnvalidatedSkill[])` stage: sorts by `precedence` ascending, keeps first occurrence of each name, returns `UnvalidatedSkill[]`
- [ ] 2.4 Implement `validateSkills(skills: UnvalidatedSkill[])` stage: runs gating checks and override schema validation, returns `LoadedSkill[]` with errors in `gatingReason`
- [ ] 2.5 Wire pipeline stages in `loadAllSkills()`: discover → merge → validate → cache
- [ ] 2.6 Preserve all existing function signatures (`loadAllSkills`, `getSkillSummaries`, `getSkillForSubAgent`, `clearSkillCache`)

## 3. Register Both Skill Sources

- [ ] 3.1 Create built-in `FilesystemSkillLoader` for `skills/` with `SKILL_PRECEDENCE_BUILTIN`
- [ ] 3.2 Create agent-managed `FilesystemSkillLoader` for `data/skills/` with `SKILL_PRECEDENCE_AGENT`
- [ ] 3.3 Register both loaders in the pipeline list used by `loadAllSkills()`

## 4. Add Hot-Reload Support

- [ ] 4.1 Wire `process.on('SIGHUP', clearSkillCache)` in server startup entry point
- [ ] 4.2 Verify cache clears and skills reload on SIGHUP signal during manual testing

## 5. Testing

- [ ] 5.1 Add unit test for `mergeSkills` precedence: two skills same name, different precedence, verify correct one wins
- [ ] 5.2 Add unit test for `FilesystemSkillLoader`: mock fs, verify correct parsing of SKILL.md frontmatter
- [ ] 5.3 Add integration test: create `data/skills/test/SKILL.md` alongside `skills/test/SKILL.md`, verify agent version loaded
- [ ] 5.4 Run existing skill-service tests to confirm no regressions

## 6. Documentation

- [ ] 6.1 Update `src/lib/services/skill-loader.ts` JSDoc with pipeline architecture overview
- [ ] 6.2 Add `SKILL_PRECEDENCE_*` constants to module exports
