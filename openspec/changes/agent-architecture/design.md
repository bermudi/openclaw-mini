## Context

OpenClaw-Mini is an event-driven AI agent runtime. Today it has an `Agent` table (many agents, none marked as default), an `InputManager` that hard-requires an `agentId` on every input, sessions keyed by `(channel, channelKey)` which creates separate contexts per messaging channel, a hardcoded `skillToolMap` that maps skill categories to tool subsets, and no sub-agent capability.

We need to introduce routing, unified sessions, sub-agents, and real skill loading — as one coherent change — before channels (Telegram, Discord) or session lifecycle improvements can be built.

### Current architecture (relevant pieces)

- **Prisma schema**: `Agent`, `Session` (unique on `channel+channelKey`), `Task`, `Trigger`, `Memory`
- **InputManager**: `processInput(input, targetAgentId?)` — fails if no agentId for messages/webhooks/hooks
- **AgentExecutor**: `executeTask()` → builds system prompt, calls `generateText()` with tools from `getToolsForAgent(skills)`
- **tools.ts**: `skillToolMap` hardcodes `{ research: ['web_search', ...], coding: [...] }` — no connection to SKILL.md files
- **Scheduler sidecar**: polls for idle agents with pending tasks, calls `POST /api/tasks/:id/execute`

## Goals / Non-Goals

**Goals:**
- Any input source (Telegram, webhook, API) can submit messages without knowing an agent ID
- A default agent catches all unbound channels; specific channels can be bound to different agents
- Multiple channels bound to the same agent share one session (unified conversation history)
- Main agents can spawn ephemeral sub-agents specialized by SKILL.md instructions
- SKILL.md files are parsed at startup, their summaries available to the main agent, their full instructions loaded into sub-agents on spawn
- The existing scheduler, task queue, and executor are reused — sub-agent tasks are just tasks with extra metadata

**Non-Goals:**
- Nested sub-agents (sub-agents spawning sub-agents) — defer to a future change
- ClawHub / remote skill registry — local filesystem only for now
- Channel-specific response formatting (Telegram 4096 char limit, Discord embeds) — handled by the channel connector, not this change
- Workspace files (SOUL.md, USER.md, HEARTBEAT.md) — separate concern from skill loading
- Real-time sub-agent progress streaming — sub-agents return a final result only

## Decisions

### 1. Routing: ChannelBinding table with fallback to default agent

**Choice**: New `ChannelBinding` DB model + `isDefault` flag on `Agent`.

**Resolution order** (3 steps, most-specific wins):
1. Exact match: `bindings[channel][channelKey]`
2. Channel wildcard: `bindings[channel]["*"]`
3. Default agent: `Agent.where(isDefault: true)`

**Alternatives considered**:
- Config file (YAML): simpler but requires restart to change bindings. Dashboard-editable DB wins.
- Environment variable `DEFAULT_AGENT_ID`: too rigid, can't bind specific channels.
- Original OpenClaw's 8-level cascade: over-engineered for our use case. We don't have guilds, teams, or account-level routing.

### 2. Sessions: per-agent, not per-channel

**Choice**: Change session unique constraint from `(channel, channelKey)` to `(agentId, sessionScope)` where `sessionScope` defaults to `"main"`.

When a Telegram message and a WhatsApp message both route to the same default agent, they hit the same session. The agent sees a unified conversation. Each message carries channel metadata (where it came from) so the agent knows where to send the reply, but the session context is shared.

**Alternatives considered**:
- Keep per-channel sessions, sync them: complex, error-prone, redundant data.
- Single global session (no scope): no future flexibility for sub-agent sessions or per-peer isolation.

**Why `sessionScope`**: Sub-agents will use scope `"subagent:<uuid>"` for isolation. Future per-peer DM scoping can use `"peer:<peerId>"`. The scope is a string, not a foreign key — keeps it flexible.

### 3. Sub-agents: ephemeral tasks, not persistent DB agents

**Choice**: Sub-agents are NOT rows in the `Agent` table. They are regular `Task` rows with additional fields: `parentTaskId` (the task that spawned them) and `skillName` (which SKILL.md to load).

**Lifecycle**:
1. Main agent calls `spawn_subagent` tool with `{ skill: "web-search", task: "find flights to Lima" }`
2. Tool creates a new Task (type `"subagent"`, `parentTaskId` set, `skillName` set)
3. Tool creates an ephemeral session with scope `"subagent:<taskId>"`
4. Scheduler picks up the task like any other pending task
5. AgentExecutor detects `type === "subagent"` → loads skill instructions as system prompt, runs with skill-defined tools
6. On completion, result is stored in `task.result`
7. The `spawn_subagent` tool polls for completion and returns the result to the main agent (blocking, like a tool call)

**Alternatives considered**:
- Sub-agents as Agent rows: heavyweight, requires cleanup, conflates persistent agents with ephemeral workers.
- Fire-and-forget async: more complex, requires announcement/callback plumbing. Blocking is simpler and natural for chat (user is waiting for a reply). Async can be added later for long-running tasks.

### 4. Skills: SKILL.md files parsed at startup, cached in memory

**Choice**: Scan a configurable skills directory for `<name>/SKILL.md` files. Parse YAML frontmatter with `gray-matter`. Cache in a module-level `Map<string, LoadedSkill>` with a 60-second TTL.

**What gets injected where**:
- Main agent system prompt: skill summaries (name + description) as a menu
- Sub-agent system prompt: full SKILL.md body as instructions

**Gating**: Skills can declare `requires.env`, `requires.binaries`, `requires.platform` in frontmatter. Gating is checked at load time; failed skills are loaded but marked `enabled: false` with a reason.

**Tool access for sub-agents**: Each SKILL.md can declare a `tools` list in frontmatter. When a sub-agent runs with that skill, only those tools are available. If no tools declared, the sub-agent gets all low-risk tools (current default behavior).

**Alternatives considered**:
- Load skills from DB: adds migration complexity, skills are files by convention (AgentSkills spec).
- Re-parse on every request: wasteful, SKILL.md files rarely change at runtime.

### 5. Agent.skills field: repurposed as available skill names

**Choice**: `Agent.skills` (JSON string array) changes from tool categories (`["research", "coding"]`) to SKILL.md names (`["web-search", "pdf-gen"]`). Empty array = all enabled skills available.

The hardcoded `skillToolMap` in `tools.ts` is deleted. `getToolsForAgent()` is rewritten to give the main agent its own tools (all registered tools) plus the `spawn_subagent` meta-tool. Sub-agents get tools defined by their skill.

## Risks / Trade-offs

**[Blocking sub-agent calls may timeout]** → The `spawn_subagent` tool polls with a configurable timeout (default 120s). If the sub-agent task isn't picked up by the scheduler in time (e.g., scheduler is down), the tool returns an error. Mitigation: the scheduler polls every 5s, so pickup is fast. Future: add async spawn variant.

**[Session sharing across channels loses per-channel history]** → A user switching from Telegram to Discord mid-conversation will see a coherent agent response, but Discord won't show prior Telegram messages. Mitigation: this matches the mental model of a personal assistant — the assistant remembers, the channel is just a viewport.

**[Breaking change to Agent.skills]** → Existing agents with skills like `["research", "coding"]` will fail to match any SKILL.md. Mitigation: migration step clears the skills array on existing agents. Since no real SKILL.md files exist yet, this is safe.

**[Skill directory doesn't exist yet]** → The `skills/` directory was deleted. Mitigation: the skill loader handles empty/missing directories gracefully. Skills are an opt-in capability.

## Open Questions

- **Skill directory location**: Should it be `skills/` in the project root (workspace skills) or `data/skills/` alongside other runtime data? The original OpenClaw uses `<workspace>/skills`. Leaning toward project root `skills/`.
- **Sub-agent model override**: Should a SKILL.md be able to declare a preferred model (e.g., a cheaper model for summarization)? Leaning yes, but deferring to implementation.
