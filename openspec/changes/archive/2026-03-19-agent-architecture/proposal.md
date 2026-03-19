## Why

The current system requires every input to carry an explicit `agentId`, but there's no mechanism to resolve one — channels like Telegram only know a `chatId`, not which agent should handle the message. Sessions are keyed by `(channel, channelKey)`, creating separate contexts per channel instead of a unified conversation. The `skills` field on Agent maps to a hardcoded tool filter, not to the SKILL.md files that should instruct specialized sub-agents. And sub-agents don't exist at all — there's no way for a main agent to spawn an isolated worker for a specific task.

These gaps block three planned features (Telegram connector, session lifecycle, skill loading) and must be resolved as a single coherent architecture change.

## What Changes

- **Default agent routing**: Introduce a channel binding system that resolves incoming messages to the correct agent. A default agent handles all unbound channels. Removes the hard requirement for callers to supply `agentId`.
- **Channel bindings table**: A new DB model (`ChannelBinding`) maps `(channel, channelKey)` → `agentId` with most-specific-wins resolution (exact match → channel wildcard → global default).
- **Unified sessions per agent**: Sessions become per-agent (not per-channel). Multiple channels bound to the same agent share one session and conversation history.
- **Sub-agent lifecycle**: Main agents can spawn ephemeral sub-agents via a `spawn_subagent` tool. Sub-agents run in isolated sessions (`agent:<id>:subagent:<uuid>`), execute a task using a skill's instructions and tools, and announce results back to the parent.
- **Skills as sub-agent blueprints**: SKILL.md files (YAML frontmatter + markdown instructions) define what a sub-agent knows and can do. Skill summaries are injected into the main agent's prompt as a menu; full instructions are only loaded into the sub-agent when spawned.
- **BREAKING**: `Agent.skills` changes meaning — from a hardcoded tool-category filter to a list of SKILL.md skill names available to that agent's sub-agents. The `skillToolMap` in `tools.ts` is removed.

## Capabilities

### New Capabilities
- `agent-routing`: Default agent designation and channel binding resolution for incoming inputs
- `sub-agents`: Ephemeral sub-agent spawn/execute/announce lifecycle
- `skill-loading`: SKILL.md parsing, gating, and injection as sub-agent blueprints

### Modified Capabilities
<!-- No existing specs to modify — this is the first set of specs -->

## Impact

- **Schema**: New `ChannelBinding` model. `Agent` gets `isDefault` field. `Session` unique constraint changes from `(channel, channelKey)` to `(agentId, sessionScope)`. New fields on `Task` for sub-agent tracking (`parentTaskId`, `skillName`).
- **InputManager**: `processMessage()` no longer requires `targetAgentId` — resolves via routing. `processInput()` signature changes (agentId becomes optional for all input types).
- **AgentExecutor**: System prompt includes skill summaries. New `spawn_subagent` tool registered. Sub-agent execution path with isolated session and skill instructions.
- **Tools**: `getToolsForAgent()` rewritten — no more hardcoded `skillToolMap`. Tool access determined by skill definition.
- **API**: `/api/input` no longer requires `agentId` for message inputs. New endpoints for channel binding CRUD and skill listing.
- **Scheduler**: No changes to task polling — sub-agent tasks are regular tasks with extra metadata.
- **Dependencies**: `gray-matter` for SKILL.md frontmatter parsing.
