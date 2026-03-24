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
- **FIX** skill instruction pattern: body markdown becomes the real system prompt; remove `overrides.systemPrompt` duplication. Each SKILL.md body should contain substantive instructions (how to approach tasks, output format expectations, error handling, tool usage patterns) — not one-liners

## Capabilities

### New Capabilities

- `skill-researcher`: Skill definition for web research sub-agent — search strategy, source evaluation, summarization format, and tool usage patterns for `web_search` and `web_fetch`
- `skill-vision-analyst`: Skill definition for image/chart analysis sub-agent — how to describe visual content, extract data points, and return structured results
- `skill-coder`: Skill definition for code execution sub-agent — script writing patterns, sandbox execution via `exec_command`, file output via `send_file_to_chat`, language selection
- `skill-browser`: Skill definition for browser automation sub-agent — navigation patterns, form interaction, screenshot capture, data extraction from rendered pages
- `skill-planner`: Skill definition for the orchestrator sub-agent — task decomposition, skill selection, result aggregation, multi-step chaining patterns

### Modified Capabilities

- `skill-loading`: Add requirement that `overrides.systemPrompt` MUST NOT duplicate the SKILL.md body; clarify that the body is the canonical system prompt for the sub-agent

## Impact

- **Skills directory**: Remove 2 files, add 5 new SKILL.md files (net +3 skills)
- **Dependencies**: None — skills are pure markdown consumed by existing `skill-service.ts`. The tools they reference (`web_search`, `web_fetch`, `browser_action`) are provided by other changes
- **Code**: No code changes needed — `skill-service.ts` already reads `name`, `description`, `tools`, `overrides`, `requires`, and body instructions correctly. The fix is in the skill *content*, not the loader
- **Cross-change dependencies**: `researcher` skill needs `web-search-providers` change implemented first; `browser` skill needs `browser-control` change implemented first; `coder` skill uses existing `exec_command` and `send_file_to_chat` tools
