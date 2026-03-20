## 1. Schema & Defaults

- [x] 1.1 Bump `DEFAULT_CONTEXT_WINDOW_SIZE` in `src/lib/services/model-catalog.ts` from 8,192 to 128,000
- [x] 1.2 Add three nullable columns to the `Agent` model in `prisma/schema.prisma`: `model String?`, `contextWindowOverride Int?`, `compactionThreshold Float?`
- [x] 1.3 Run `bunx prisma db push` (or create a migration) to apply schema changes
- [x] 1.4 Add validation in the agent update API: `compactionThreshold` must be between 0.1–0.9, `contextWindowOverride` must be a positive integer ≥ 1,000

## 2. Context Resolution Helpers

- [x] 2.1 Create a `resolveAgentContextWindow(agent: Agent): Promise<number>` function that resolves in order: `agent.contextWindowOverride` → `ModelCatalog.getContextWindow(agent.model)` → `ModelCatalog.getContextWindow(globalConfig.model)` → 128,000
- [x] 2.2 Create a `resolveCompactionThreshold(agent: Agent): number` function that resolves: `agent.compactionThreshold` → `OPENCLAW_SESSION_TOKEN_THRESHOLD` env → 0.5
- [x] 2.3 Place both helpers in `src/lib/services/model-provider.ts` so `AgentExecutor` and `SessionService` can share them
- [x] 2.4 Refactor `AgentExecutor.buildPrompt()` to use `resolveAgentContextWindow()` instead of directly calling `ModelCatalog`

## 3. Token-Based Compaction Trigger

- [x] 3.1 Update `appendToContext()` in `session-service.ts`: after appending the message, check if `message.role === 'user'` before evaluating compaction. If role is not `user`, skip compaction evaluation entirely.
- [x] 3.2 Add token-based threshold check: load the agent from the session, resolve context window and threshold via the new helpers, count tokens across all session messages using `countTokens()`, and trigger compaction if `sessionTokens > contextWindow × threshold`
- [x] 3.3 Keep the existing message-count check as a secondary trigger: if token counting succeeds but is below threshold, still check `messageCount > messageCountThreshold` and trigger if exceeded
- [x] 3.4 Add try/catch around token counting: if `countTokens()` throws, log a warning and fall back to message-count-only evaluation

## 4. Session Service Refactor

- [x] 4.1 Update the `appendToContext` method to fetch the agent record (via session → agentId) so the per-agent config is available for the compaction decision
- [x] 4.2 Extract the compaction trigger logic into a private method `shouldCompact(sessionId, agent, appendedRole): Promise<boolean>` for clarity and testability

## 5. Testing

- [x] 5.1 Write unit tests for `resolveAgentContextWindow`: agent with override returns it, agent with model returns catalog value, agent with neither returns global model's value, completely unconfigured returns 128,000
- [x] 5.2 Write unit tests for `resolveCompactionThreshold`: agent with threshold returns it, agent without returns env value, no env returns 0.5
- [x] 5.3 Write unit tests for validation: `compactionThreshold` outside 0.1–0.9 rejected, `contextWindowOverride` below 1,000 rejected
- [x] 5.4 Write unit tests for token-based trigger: session exceeding agent's threshold triggers compaction, session below does not
- [x] 5.5 Write unit tests for message-count fallback: session below token threshold but above 40 messages triggers compaction
- [x] 5.6 Write unit tests for user-turn boundary: compaction deferred when assistant message exceeds threshold, triggered on next user message
- [x] 5.7 Write unit tests for tokenizer failure fallback: when `countTokens` throws, falls back to message-count check
- [x] 5.8 Write integration test: end-to-end flow where two agents with different thresholds compact at different points
