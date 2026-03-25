## 0. Prompt-source cleanup

- [ ] 0.1 Remove `systemPrompt` from `SUB_AGENT_OVERRIDE_FIELDS` in `src/lib/subagent-config.ts`
- [ ] 0.2 Remove `systemPrompt` from `SubAgentOverrides` in `src/lib/subagent-config.ts`
- [ ] 0.3 Remove `systemPrompt` handling from `createSubAgentOverridesSchema()` in `src/lib/subagent-config.ts`
- [ ] 0.4 Remove `systemPrompt` handling from `resolveSubAgentConfig()` in `src/lib/subagent-config.ts`
- [ ] 0.5 Stop writing `systemPrompt` into sub-agent task payloads in `src/lib/tools.ts`
- [ ] 0.6 Stop reading fallback `systemPrompt` from sub-agent task payloads in `src/lib/services/agent-executor.ts`
- [ ] 0.7 Update tests/spec references that still expect `systemPrompt` as an override field

## 1. Remove placeholder skills

- [ ] 1.1 Delete `skills/executor/SKILL.md`
- [ ] 1.2 Replace the placeholder `skills/planner/SKILL.md` with the rewritten planner definition
- [ ] 1.3 Remove the now-unused placeholder skill directories if they become empty

## 2. Create researcher skill

- [ ] 2.1 Add `skills/researcher/SKILL.md` with frontmatter for `name`, `description`, `tools`, and runtime overrides
- [ ] 2.2 Write a substantive body covering research strategy, source evaluation, output format, and failure handling
- [ ] 2.3 Verify the skill loads with expected metadata

## 3. Create vision-analyst skill

- [ ] 3.1 Add `skills/vision-analyst/SKILL.md` with vision-capable model overrides and minimal tool access
- [ ] 3.2 Write a substantive body covering image understanding, chart extraction, structured output, and ambiguity handling
- [ ] 3.3 Verify the skill loads with expected metadata

## 4. Create coder skill

- [ ] 4.1 Add `skills/coder/SKILL.md` with frontmatter aligned to the current execution tool surface
- [ ] 4.2 Write a substantive body that reflects current exec/runtime constraints rather than future shell/PTTY behavior
- [ ] 4.3 Verify the skill loads with expected metadata

## 5. Create browser skill

- [ ] 5.1 Add `skills/browser/SKILL.md` with `tools: [browser_action]`
- [ ] 5.2 Write a substantive body covering navigation, interaction, extraction, verification, and safety boundaries
- [ ] 5.3 Verify the skill loads with expected metadata when browser support is available

## 6. Rewrite planner skill

- [ ] 6.1 Add planner frontmatter with `tools: [spawn_subagent, get_datetime, write_note]`
- [ ] 6.2 Set `allowedSkills` to `researcher`, `vision-analyst`, `coder`, and `browser`
- [ ] 6.3 Write a substantive body covering decomposition, delegation, aggregation, and when not to delegate
- [ ] 6.4 Verify the skill loads with expected metadata

## 7. Validation and testing

- [ ] 7.1 Verify all five built-in skills are listed with correct high-level metadata
- [ ] 7.2 Verify no built-in skill uses `overrides.systemPrompt`
- [ ] 7.3 Verify each skill body contains substantive instructions rather than placeholder text
- [ ] 7.4 Run the relevant skill-loading and sub-agent regression suites
