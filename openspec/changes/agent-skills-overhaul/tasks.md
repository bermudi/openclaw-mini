## 0. Code changes (prerequisites)

- [ ] 0.1 Remove `systemPrompt` from `SUB_AGENT_OVERRIDE_FIELDS` array in `src/lib/subagent-config.ts`
- [ ] 0.2 Remove `systemPrompt` from `SubAgentOverrides` interface in `src/lib/subagent-config.ts`
- [ ] 0.3 Remove `systemPrompt` handling from `resolveSubAgentConfig()` in `src/lib/subagent-config.ts`
- [ ] 0.4 Remove `systemPrompt` from `createSubAgentOverridesSchema()` in `src/lib/subagent-config.ts`
- [ ] 0.5 Extend `spawn_subagent` tool schema in `src/lib/tools.ts` to accept `attachments` array
- [ ] 0.6 Pass attachments through to sub-agent message payload in task creation
- [ ] 0.7 Add `read_skill_file` tool in `src/lib/tools.ts` for reading from skills/ and data/skills/
- [ ] 0.8 Run tests to verify no regressions in subagent lifecycle

## 1. Remove old skills

- [ ] 1.1 Delete `skills/executor/SKILL.md`
- [ ] 1.2 Delete `skills/planner/SKILL.md`
- [ ] 1.3 Remove the `skills/executor/` and `skills/planner/` directories

## 2. Create researcher skill

- [ ] 2.1 Create `skills/researcher/SKILL.md` with frontmatter: `name: researcher`, `description` covering web research and summarization, `tools: [web_search, web_fetch, write_note]`, `overrides` with model (`gpt-4.1-mini`), `maxIterations: 6`, `maxToolInvocations: 8`
- [ ] 2.2 Write SKILL.md body (30+ lines): role statement, search strategy (multiple queries, refine terms, cross-reference sources), source evaluation guidance, `web_search` usage patterns (query formulation, number of results), `web_fetch` usage patterns (when to fetch full page vs rely on snippets), output format (structured findings with sources), error handling (no results, fetch failures)
- [ ] 2.3 Verify skill loads via `GET /api/skills` — should show `researcher` as enabled (note: `web_search`/`web_fetch` tools may not exist yet; skill loads but tools will be empty at runtime until `web-search-providers` change is implemented)

## 3. Create vision-analyst skill

- [ ] 3.1 Create `skills/vision-analyst/SKILL.md` with frontmatter: `name: vision-analyst`, `description` covering image analysis and data extraction, `tools: [read_file]`, `overrides` with vision-capable model (`gpt-4.1`), `maxIterations: 3`, `maxToolInvocations: 2`
- [ ] 3.2 Write SKILL.md body (30+ lines): role statement as image analysis specialist, how to describe visual content (charts, screenshots, photos, diagrams), chart-specific guidance (extract axis labels, data points, trends, legends, time ranges), structured output format (description + extracted data as JSON-like structure), guidance on detail level (comprehensive but concise), what to do when image is unclear or low resolution
- [ ] 3.3 Verify skill loads via `GET /api/skills` — should show `vision-analyst` as enabled

## 4. Create coder skill

- [ ] 4.1 Create `skills/coder/SKILL.md` with frontmatter: `name: coder`, `description` covering script writing, execution, and file output, `tools: [exec_command, send_file_to_chat, write_note, read_file]`, `overrides` with capable model (`gpt-4.1`), `maxIterations: 10`, `maxToolInvocations: 12`
- [ ] 4.2 Write SKILL.md body (40+ lines): role statement, language selection guidance (Python via `uv run` for data/charts/ML, Bun for web/JSON tasks), the write-execute-deliver pattern (write script to file → `exec_command` to run → check stdout/stderr → fix if needed → `send_file_to_chat` to deliver), sandbox awareness (files go to agent sandbox dir), how to handle dependencies (use `uv run --with <pkg>` for Python, inline for Bun), output format for parent agent (what was created, where, key results), error handling (parse stderr, common failure patterns, retry with fixes), security boundaries (no network calls from scripts unless task requires it)
- [ ] 4.3 Verify skill loads via `GET /api/skills` — should show `coder` as enabled

## 5. Create browser skill

- [ ] 5.1 Create `skills/browser/SKILL.md` with frontmatter: `name: browser`, `description` covering web interaction and automation, `tools: [browser_action]`, `requires: { binaries: [] }` (no binary gating — Playwright availability is checked via import, not npx), `overrides` with fast model (`gpt-4.1-mini`), `maxIterations: 8`, `maxToolInvocations: 10`
- [ ] 5.2 Write SKILL.md body (30+ lines): role statement, navigation patterns (navigate to URL, verify page loaded via title/text), interaction patterns (click buttons, fill forms, wait for results), data extraction (get text from specific selectors, screenshot for visual verification), multi-step workflow approach (navigate → interact → verify → continue), output format (structured results + any screenshots taken), error handling (element not found, page timeout, unexpected content), security boundaries (never enter credentials unless explicitly provided in the task)
- [ ] 5.3 Verify skill loads via `GET /api/skills` — should show `browser` as disabled with gating reason if Playwright is not installed, or enabled if it is

## 6. Create planner skill (rewrite)

- [ ] 6.1 Create `skills/planner/SKILL.md` with frontmatter: `name: planner`, `description` covering multi-step task orchestration and delegation, `tools: [spawn_subagent, get_datetime, write_note]`, `overrides` with strong reasoning model (`gpt-4.1`), `maxIterations: 12`, `maxToolInvocations: 10`, `allowedSkills: [researcher, vision-analyst, coder, browser, skill-manager]`
- [ ] 6.2 Write SKILL.md body (50+ lines): role statement as orchestrator, full skill catalog (researcher: web search + summarization; vision-analyst: image/chart analysis; coder: script writing + execution + file delivery; browser: web interaction + automation; skill-manager: create/edit/test skills), task decomposition guidance (break complex tasks into sequential or parallel sub-tasks), skill selection decision tree (what task → which skill), chaining patterns (vision-analyst output → coder input; researcher findings → coder data), how to call `spawn_subagent` with clear task descriptions, result aggregation (synthesize sub-agent outputs into coherent response), when NOT to delegate (simple questions, single-step tasks), error handling (sub-agent timeout, partial failures — use what you have), output format (synthesized final response combining all sub-agent results)
- [ ] 6.3 Verify skill loads via `GET /api/skills` — should show `planner` as enabled with all 5 allowed skills

## 7. Create skill-manager skill

- [ ] 7.1 Create `skills/skill-manager/SKILL.md` with frontmatter: `name: skill-manager`, `description` covering runtime skill creation, editing, testing, and optimization, `tools: [exec_command, read_file, spawn_subagent, write_note]`, `overrides` with capable model (`gpt-4.1`), `maxIterations: 15`, `maxToolInvocations: 20`
- [ ] 7.2 Write SKILL.md body (60+ lines): role statement as the agent's self-improvement specialist, SKILL.md anatomy (frontmatter fields: name, description, tools, requires, overrides; body: substantive instructions), how to create a new skill (mkdir `data/skills/<name>/` via the new mount-aware `exec_command` runtime, write SKILL.md with proper frontmatter + instructions body), how to edit existing skills (`read_skill_file` to inspect, exec_command to overwrite), how to list/audit skills (`read_skill_file` on skills/ and data/skills/ directories), frontmatter validation guidance (required fields, tool names must match registered tools, gating with requires), skill testing workflow (spawn_subagent with the new skill name + test prompt, evaluate output, iterate), iterative improvement pattern (draft → test → evaluate → refine instructions → retest), description optimization guidance (write descriptions that trigger correctly — include what the skill does AND when to use it), output format (report what was created/modified, test results, any issues found), error handling (invalid frontmatter, missing tools, test failures), boundaries (only write to data/skills/, never modify built-in skills in skills/ — built-ins are protected from override by skill-loading-pipeline)
- [ ] 7.3 Verify skill loads via `GET /api/skills` — should show `skill-manager` as enabled (note: full functionality requires `exec-runtime-overhaul` for mount-aware access to `data/skills/` AND `skill-loading-pipeline` for managed-skill discovery and precedence)

## 8. Validation and testing

- [ ] 8.1 Run `GET /api/skills` and verify all 6 skills are listed with correct metadata (name, description, enabled status, tool lists)
- [ ] 8.2 Verify no skill sets `overrides.systemPrompt` — grep all SKILL.md files for `systemPrompt` in overrides block (this field is now removed from codebase, so any remaining usage would be invalid frontmatter)
- [ ] 8.3 Verify each SKILL.md body has substantive instructions (minimum line counts: researcher 30, vision-analyst 30, coder 40, browser 30, planner 50, skill-manager 60)
- [ ] 8.4 Run existing tests (`bun test`) to confirm no regressions in skill-service loading, subagent-lifecycle, or agent-architecture tests
- [ ] 8.5 Test skill gating: temporarily remove `npx` from PATH and verify `browser` skill shows as disabled with correct gating reason
- [ ] 8.6 After `exec-runtime-overhaul` and `skill-loading-pipeline` are implemented, verify skill-manager can write to `data/skills/` and newly written skills are discovered with correct precedence
