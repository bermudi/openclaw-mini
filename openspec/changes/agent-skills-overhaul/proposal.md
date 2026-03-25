## Why

Our current skills (`planner` and `executor`) are structurally broken. The `executor` has 4 low-risk tools (datetime, calculate, read_file, write_note) — it can't actually *do* anything useful. The `planner` can only delegate to `executor`, creating a planning layer that funnels into a dead end. The SKILL.md bodies are 2-line placeholders, and the `overrides.systemPrompt` field duplicates (and overrides) the body instructions, meaning the markdown content is never used.

Meanwhile, the user's core use case — "message me on Telegram with an image and a task like 'research all AI models released this year and create a chart'" — requires a pipeline of specialized sub-agents: vision analysis → web research → code execution → file delivery. None of these capabilities exist as skills today.

This change replaces the two placeholder skills with a proper skill suite that covers the user's real workflows, and fixes the structural issues in how skills define their instructions.

## What Changes

- **REMOVE** `skills/executor/SKILL.md` and `skills/planner/SKILL.md` — they're non-functional placeholders
- **NEW** `skills/researcher/SKILL.md` — web search + web fetch + summarization skill. Depends on the `web_search` and `web_fetch` tools from the `web-search-providers` change
- **NEW** `skills/vision-analyst/SKILL.md` — image analysis and data extraction using vision-capable models. Takes images passed via task payload, describes them, extracts structured data
- **NEW** `skills/coder/SKILL.md` — writes and executes scripts (Python/TS) in the agent sandbox via `exec_command`, produces output files, can use `send_file_to_chat` to deliver results
- **NEW** `skills/browser/SKILL.md` — web interaction via `browser_action` tool (navigate, click, type, screenshot, extract). Depends on the `browser-control` change. Gated on Playwright binary
- **NEW** `skills/planner/SKILL.md` (rewrite) — orchestrator that decomposes complex multi-step tasks and delegates to the other skills via `spawn_subagent`. Understands the full skill roster and can chain them
- **NEW** `skills/skill-manager/SKILL.md` — self-management skill that creates, edits, lists, and iterates on skills at runtime. Uses the new exec runtime to write SKILL.md files to `data/skills/`, `read_file` to inspect existing skills, and `spawn_subagent` to test new skills. Adapts the full skill-creator workflow (draft → test → evaluate → iterate → optimize description) for runtime use. Depends on `exec-runtime-overhaul` for mount-aware execution and interactive process support, and `skill-loading-pipeline` for multi-directory skill discovery with agent-managed skills taking precedence
- **FIX** skill instruction pattern: body markdown becomes the canonical system prompt; REMOVE `overrides.systemPrompt` field from the codebase entirely. Each SKILL.md body should contain substantive instructions (how to approach tasks, output format expectations, error handling, tool usage patterns) — not one-liners
- **MODIFY** `spawn_subagent` tool schema to accept `attachments` array for passing images/files to sub-agents (required for vision-analyst)
- **NEW** `read_skill_file` tool that can read from `skills/` and `data/skills/` directories (current `read_file` is scoped to agent memory only)
- **MODIFY** `subagent-config.ts` to remove `systemPrompt` from `SubAgentOverrides` type and validation schema

## Capabilities

### New Capabilities

- `skill-researcher`: Skill definition for web research sub-agent — search strategy, source evaluation, summarization format, and tool usage patterns for `web_search` and `web_fetch`
- `skill-vision-analyst`: Skill definition for image/chart analysis sub-agent — how to describe visual content, extract data points, and return structured results
- `skill-coder`: Skill definition for code execution sub-agent — script writing patterns, sandbox execution via `exec_command`, file output via `send_file_to_chat`, language selection
- `skill-browser`: Skill definition for browser automation sub-agent — navigation patterns, form interaction, screenshot capture, data extraction from rendered pages
- `skill-planner`: Skill definition for the orchestrator sub-agent — task decomposition, skill selection, result aggregation, multi-step chaining patterns
- `skill-manager`: Skill definition for the self-management sub-agent — SKILL.md CRUD operations in `data/skills/`, frontmatter validation, skill testing via spawn_subagent, iterative improvement workflow, description optimization

### Modified Capabilities

- `skill-loading`: Add requirement that `overrides.systemPrompt` MUST NOT duplicate the SKILL.md body; clarify that the body is the canonical system prompt for the sub-agent

## Impact

- **Skills directory**: Remove 2 files, add 6 new SKILL.md files (net +4 skills)
- **Dependencies**: Code changes required in `subagent-config.ts` and `tools.ts` to remove `systemPrompt` override support and extend `spawn_subagent` for attachments. The tools referenced (`web_search`, `web_fetch`, `browser_action`) already exist in the codebase
- **Code**: Changes required: (1) remove `systemPrompt` from `SubAgentOverrides` in `subagent-config.ts`, (2) extend `spawn_subagent` schema with `attachments` field in `tools.ts`, (3) add `read_skill_file` tool for skill-manager to inspect skills
- **Cross-change dependencies**: `researcher` skill uses existing `web_search`/`web_fetch` tools; `browser` skill uses existing `browser_action` tool (gated on Playwright import availability, not npx); `coder` skill uses existing `exec_command` tool; `skill-manager` skill needs `exec-runtime-overhaul` (for mount-aware execution) AND `skill-loading-pipeline` (for `data/skills/` discovery with add-only precedence) implemented first
