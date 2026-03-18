## 1. Schema & Data Model

- [ ] 1.1 Add `isDefault` boolean field to `Agent` model in `prisma/schema.prisma`
- [ ] 1.2 Add `ChannelBinding` model to `prisma/schema.prisma` with `channel`, `channelKey`, `agentId` fields and unique constraint on `(channel, channelKey)`
- [ ] 1.3 Change `Session` unique constraint from `(channel, channelKey)` to `(agentId, sessionScope)` and add `sessionScope` string field (default `"main"`)
- [ ] 1.4 Add `parentTaskId` (nullable FK to Task) and `skillName` (nullable string) fields to `Task` model; add `"subagent"` to the task type documentation
- [ ] 1.5 Run `bunx prisma db push` and verify migrations apply cleanly

## 2. Agent Routing

- [ ] 2.1 Add `setDefaultAgent(agentId)` and `getDefaultAgent()` methods to `agent-service.ts`; enforce the "exactly one default" invariant (auto-set first created agent as default)
- [ ] 2.2 Create routing resolver: `resolveAgent(channel, channelKey)` in `input-manager.ts` that queries `ChannelBinding` with 3-step resolution (exact → channel wildcard → default agent)
- [ ] 2.3 Update `processMessage()` to call `resolveAgent()` when no `targetAgentId` is provided instead of returning an error
- [ ] 2.4 Update `processWebhook()` and `processHook()` to also use `resolveAgent()` as fallback

## 3. Unified Sessions

- [ ] 3.1 Rewrite `getOrCreateSession()` in `input-manager.ts` to key sessions by `(agentId, sessionScope)` instead of `(channel, channelKey)`
- [ ] 3.2 Update `sessionService.appendToContext()` to include `channel` and `channelKey` metadata on each message entry so the system knows where to route replies
- [ ] 3.3 Update `sessionService.getSessionContext()` to include channel source annotations in the context string

## 4. Skill Loading

- [ ] 4.1 Install `gray-matter` dependency (`bun add gray-matter`)
- [ ] 4.2 Create `src/lib/services/skill-service.ts` with types (`SkillMetadata`, `LoadedSkill`) and `loadAllSkills()` function that scans `skills/` directory for SKILL.md files and parses frontmatter
- [ ] 4.3 Implement gating checks in skill-service: `requires.binaries` (check PATH), `requires.env` (check process.env), `requires.platform` (check process.platform)
- [ ] 4.4 Implement in-memory cache with 60-second TTL in skill-service
- [ ] 4.5 Add `getSkillSummaries(agentSkillNames)` method that returns filtered summaries (respects agent's skills array; empty array = all enabled)
- [ ] 4.6 Add `getSkillForSubAgent(skillName)` method that returns full instructions and tools list for a specific skill

## 5. Sub-Agent Lifecycle

- [ ] 5.1 Register `spawn_subagent` tool in `tools.ts` with params `{ skill: string, task: string, timeoutSeconds?: number }`; implementation creates a sub-agent Task and polls for completion
- [ ] 5.2 Create ephemeral sub-agent session (scope `"subagent:<taskId>"`) when the sub-agent task is created
- [ ] 5.3 Update `AgentExecutor.executeTask()` to detect `type === "subagent"` and load skill instructions as system prompt instead of the agent's normal prompt
- [ ] 5.4 Update `AgentExecutor.executeTask()` for sub-agent tasks to restrict tools to those declared in the skill's frontmatter `tools` field

## 6. Main Agent Prompt Update

- [ ] 6.1 Update `AgentExecutor.getSystemPrompt()` to inject skill summaries (from skill-service) into the main agent's system prompt
- [ ] 6.2 Remove the hardcoded `skillToolMap` from `tools.ts` and rewrite `getToolsForAgent()` — main agents get all registered tools plus `spawn_subagent`; sub-agent tools are handled by the executor
- [ ] 6.3 Repurpose `Agent.skills` field: update `agent-service.ts` and agent creation API to treat it as SKILL.md names instead of tool categories

## 7. API Endpoints

- [ ] 7.1 Create `GET /api/channels/bindings` endpoint to list all channel bindings
- [ ] 7.2 Create `POST /api/channels/bindings` endpoint to create a channel binding
- [ ] 7.3 Create `DELETE /api/channels/bindings/:id` endpoint to delete a channel binding
- [ ] 7.4 Create `GET /api/skills` endpoint that returns all discovered skills with metadata, enabled status, and gating reason
- [ ] 7.5 Update `POST /api/input` to no longer require `agentId` for message inputs (routing resolves it)

## 8. Tests & Verification

- [ ] 8.1 Write tests for routing resolution: exact match, wildcard match, default fallback, no default error, explicit agentId override
- [ ] 8.2 Write tests for session unification: two channels same agent share session, different agents get different sessions
- [ ] 8.3 Write tests for skill loading: discovery, frontmatter parsing, gating (missing binary, missing env, platform mismatch), cache TTL
- [ ] 8.4 Write tests for sub-agent lifecycle: spawn with valid skill, spawn with unknown skill, timeout, result return
- [ ] 8.5 End-to-end test: send a message via `/api/input` with no agentId → routing resolves → task created → executor runs → response includes skill summaries in prompt
