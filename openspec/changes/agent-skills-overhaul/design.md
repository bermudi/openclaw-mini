## Context

We have a working sub-agent system: `spawn_subagent` creates tasks, the executor loads SKILL.md instructions as the system prompt, restricts tools to the skill's declared set, and returns the result to the parent. The skill-service loads SKILL.md files with gray-matter, supports gating (binaries, env vars, platform), caching, and override validation. All of this works.

The problem is entirely in the skill *content*. Our two skills (`planner`, `executor`) have trivial instructions, duplicate their system prompt between `overrides.systemPrompt` and the body, and give agents access to tools that can't accomplish real tasks. The user wants to message on Telegram with an image and say "research all AI models and create a chart" — this requires vision analysis, web research, code execution, and file delivery. None of those exist as skills.

### Current skill architecture flow

1. Main agent receives message → sees skill summaries in system prompt
2. Main agent calls `spawn_subagent(skill, task)`
3. Skill-service loads SKILL.md → extracts `instructions` (body) and `overrides`
4. Executor resolves config: `overrides.systemPrompt ?? skill.instructions` → becomes system prompt
5. Tools filtered to `overrides.allowedTools` or `skill.tools` or low-risk defaults
6. Sub-agent executes with those constraints

The config resolution at step 4 means if `overrides.systemPrompt` is set, the SKILL.md body is discarded. Both current skills set both, making the body dead code.

## Goals / Non-Goals

**Goals:**

- Create 5 skills that cover the user's real workflows: research, vision analysis, code execution, browser automation, and orchestration
- Each SKILL.md body contains substantive instructions (30-100 lines) that teach the sub-agent *how* to approach its domain — not one-liners
- Remove the `overrides.systemPrompt` anti-pattern: body markdown is the canonical system prompt; overrides configure model/tools/limits only
- Skills declare only the tools they actually need and gate on real dependencies
- The planner skill understands the full roster and can chain skills for multi-step workflows

**Non-Goals:**

- Changing `skill-service.ts` or `agent-executor.ts` code — the loader is correct, the content is wrong
- Building new tools — skills reference tools that exist (or will exist from other changes: `web_search`, `web_fetch`, `browser_action`)
- Adding skill auto-selection or dynamic routing — the main agent decides which skill to use based on summaries in its prompt
- Semantic memory search within skills — that's the `memory-search` change

## Decisions

### Decision 1: Body-only system prompt — no `overrides.systemPrompt`

The SKILL.md body IS the system prompt. The `overrides` block configures runtime parameters only (model, provider, tools, iteration limits). This eliminates the duplication and ensures the markdown body — the most natural place to write instructions — is what the sub-agent actually sees.

**Alternative considered**: Keep `overrides.systemPrompt` as an "override" that replaces the body. Rejected because it creates two competing sources of truth and the body becomes invisible dead code.

### Decision 2: Five focused skills instead of generic planner/executor

Each skill maps to a clear capability domain with specific tools:

| Skill | Domain | Key Tools | Model |
|---|---|---|---|
| `researcher` | Web search + summarization | `web_search`, `web_fetch`, `write_note` | Fast/cheap (gpt-4.1-mini) |
| `vision-analyst` | Image analysis + data extraction | `read_file` | Vision-capable (gpt-4.1) |
| `coder` | Script writing + execution | `exec_command`, `send_file_to_chat`, `write_note`, `read_file` | Capable (gpt-4.1) |
| `browser` | Web interaction + screenshots | `browser_action` | Fast (gpt-4.1-mini) |
| `planner` | Orchestration + delegation | `spawn_subagent`, `get_datetime`, `write_note` | Strong reasoning (gpt-4.1) |
| `skill-manager` | Skill CRUD + iteration | `exec_command`, `read_file`, `spawn_subagent`, `write_note` | Capable (gpt-4.1) |

**Alternative considered**: A single "swiss army knife" skill with all tools. Rejected because it violates least-privilege (code execution + browser in one agent is a security risk) and makes the sub-agent's system prompt unfocused.

### Decision 3: Planner as the only orchestrator, not a default

The main agent's system prompt shows all skill summaries. For simple tasks, the main agent spawns a single specialist directly (e.g., `spawn_subagent("researcher", "find latest OpenAI models")`). For complex multi-step tasks, the main agent spawns the `planner`, which then spawns specialists.

This keeps spawn depth at 1 for simple cases and 2 for complex ones. The max depth of 5 leaves room for edge cases without routine waste.

### Decision 4: Skill gating via `requires` for external dependencies

The `browser` skill gates on `requires.binaries: ["npx"]` since it needs Playwright. The `researcher` skill gates on `requires.env: ["BRAVE_API_KEY"]` OR uses DuckDuckGo fallback (no gating — DuckDuckGo is free). This ensures skills that can't work are disabled with clear reasons.

### Decision 5: Instruction quality pattern

Each SKILL.md body follows a consistent structure:
1. **Role statement** — who you are, what you're good at
2. **Approach** — how to tackle tasks in this domain (strategy, not just "do it")
3. **Tool usage patterns** — when and how to use each tool, with examples
4. **Output format** — what to return to the parent agent
5. **Error handling** — what to do when things fail
6. **Boundaries** — what NOT to do (stay in lane)

This gives the LLM enough context to behave competently without being overly prescriptive.

### Decision 6: Skill-manager uses new exec runtime to write to data/skills/

The `skill-manager` skill needs to create and edit SKILL.md files in `data/skills/`. Rather than adding a bespoke `manage_skill` tool, it uses the new exec runtime from `exec-runtime-overhaul` to write files via standard commands (`mkdir`, `tee`, `cat`) inside an operator-approved writable mount. This keeps the tool surface small and gives the agent the same filesystem primitives a human operator would use.

The skill-manager also uses `spawn_subagent` to test newly created skills — it spawns a sub-agent with the new skill and a test prompt, evaluates the result, and iterates. This adapts the eval loop from `.agents/skills/skill-creator` for runtime use.

**Alternative considered**: A dedicated `manage_skill` tool with create/edit/delete/validate actions. Rejected because it's a narrow-purpose tool that duplicates what the new exec runtime already provides. The skill's instructions (SKILL.md body) encode the workflow — the tool just needs filesystem access.

**Dependencies**: 
- `exec-runtime-overhaul` — required for mount-aware execution to `data/skills/` and PTY/process support for interactive workflows
- `skill-loading-pipeline` — required for agent-managed skills in `data/skills/` to be discovered and take precedence over built-in skills

Both dependencies must be implemented before skill-manager can function fully.

## Risks / Trade-offs

**[Risk] Skills reference tools that don't exist yet** → The `researcher` skill needs `web_search`/`web_fetch` (from `web-search-providers` change) and `browser` needs `browser_action` (from `browser-control` change). Mitigation: skills that reference missing tools will fail gracefully at tool resolution time — the executor filters to available tools, so the sub-agent simply won't have the tool. We can gate `researcher` on env vars if needed, and `browser` is already gated on the binary.

**[Risk] Planner skill might over-delegate simple tasks** → A user asking "what time is it?" shouldn't trigger a planner→executor chain. Mitigation: the main agent (not the planner) decides what to spawn. The skill summaries should make it clear that the planner is for multi-step coordination, not simple queries.

**[Risk] Instructions become stale as tools evolve** → If `exec_command` gains new flags or `browser_action` adds new actions, the skill instructions won't auto-update. Mitigation: skills are plain markdown — easy to update. The instructions describe patterns and strategy, not API signatures.

**[Risk] Skill-manager creates skills with broad tool access** → An agent-created skill could declare `tools: [exec_command, browser_action]`, gaining more access than intended. Mitigation: the sub-agent executor still enforces the allowlist and mode ceiling from runtime config. Skills can declare tools, but the runtime decides which are actually available. Additionally, the planner's `allowedSkills` controls which skills can be spawned.

**[Trade-off] Six skills = more files to maintain** → But each skill is self-contained markdown, no code dependencies, and covers a distinct domain. The alternative (fewer, broader skills) would compromise tool isolation and prompt clarity.
