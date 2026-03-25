## 1. Dependency checkpoint

- [ ] 1.1 Confirm `skill-loading-pipeline` is implemented and managed skills are discoverable from `data/skills/`
- [ ] 1.2 Confirm `exec-runtime-overhaul` is implemented with writable access to `data/skills/` under approved mounts

## 2. Add `read_skill_file`

- [ ] 2.1 Add a scoped `read_skill_file` tool for built-in and managed skills
- [ ] 2.2 Reject invalid sources and missing skill files clearly
- [ ] 2.3 Add tests for built-in reads, managed reads, and path-scope enforcement

## 3. Add `skill-manager`

- [ ] 3.1 Add `skills/skill-manager/SKILL.md`
- [ ] 3.2 Write instructions covering draft -> test -> evaluate -> refine loops
- [ ] 3.3 Ensure the skill-manager guidance only writes to managed-skill locations

## 4. Verification

- [ ] 4.1 Test creating a managed skill in `data/skills/`
- [ ] 4.2 Verify the new managed skill is discovered without overriding a built-in skill
- [ ] 4.3 Verify `skill-manager` can inspect and refine managed skills safely
