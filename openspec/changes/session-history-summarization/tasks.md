## 1. Configuration

- [ ] 1.1 Add `OPENCLAW_SESSION_TOKEN_THRESHOLD` env var to `src/lib/config/runtime.ts` (default: 0.5, range: 0–1)
- [ ] 1.2 Add `sessionTokenThreshold` to the runtime config shape and expose it through `getRuntimeConfig()`

## 2. Compaction Core Logic

- [ ] 2.1 Add `compactSession(sessionId, agentId)` method to `SessionService` that: counts tokens for all messages, takes a snapshot of the oldest (N - 10) messages, calls LLM for summary, creates `[Session Summary]` system message, flushes raw content to `memoryService.appendHistory`, deletes snapshot messages, returns `{ summarized, remaining }`
- [ ] 2.2 Implement the hardcoded summarization prompt in `compactSession`: instructs the model to produce session intent, key decisions, artifacts, open questions, and next steps
- [ ] 2.3 Use the agent's model via `getModelConfig()` / `resolveModelConfig()` for the LLM summary call; log the model used in the audit event
- [ ] 2.4 Implement graceful degradation: if the LLM call throws or returns empty/whitespace, log a warning with sessionId, agentId, error; abort without deleting any messages; return `{ summarized: 0, remaining: currentCount }`
- [ ] 2.5 Implement snapshot isolation: collect the message IDs to delete before the async LLM call; only delete those specific IDs after the summary is saved

## 3. Compaction Trigger

- [ ] 3.1 In `SessionService.appendToContext`, after inserting the new message, check if `role === 'user'`; if so, evaluate the compaction threshold
- [ ] 3.2 Resolve context window and threshold per `agent-context-config` spec: `agent.contextWindowOverride` → `ModelCatalog(agent.model)` → `ModelCatalog(globalModel)` → 128,000; threshold: `agent.compactionThreshold` → `OPENCLAW_SESSION_TOKEN_THRESHOLD` → 0.5
- [ ] 3.3 Count total session tokens using `countTokens()` on all current messages; fall back to message-count threshold (40) if counting fails
- [ ] 3.4 Fire `compactSession()` when either threshold condition is met; if compaction fails, log and continue without propagating the error

## 4. Post-Compaction Hooks

- [ ] 4.1 After successful summary generation, invoke the memory reflector non-blocking (`void memoryReflector.reflect(...)`) with the summary text and agent ID; catch and log any reflector errors without affecting compaction result
- [ ] 4.2 Emit an audit log event `session_compacted` with `{ sessionId, agentId, summarized, remaining, model }`

## 5. Manual Compaction API

- [ ] 5.1 Create `src/app/api/sessions/[id]/compact/route.ts` with `POST` handler that calls `compactSession(sessionId, agentId)` and returns `{ summarized, remaining }`
- [ ] 5.2 Handle edge case: session with fewer messages than the retention count returns `{ summarized: 0, remaining: N }` without error
- [ ] 5.3 Apply existing API auth middleware to the new route

## 6. Tests

- [ ] 6.1 Unit test `compactSession`: normal flow — LLM returns summary, correct messages deleted, summary message created with `[Session Summary]` prefix
- [ ] 6.2 Unit test `compactSession`: LLM throws — no messages deleted, warning logged, returns `{ summarized: 0, remaining: N }`
- [ ] 6.3 Unit test `compactSession`: LLM returns empty string — same as throw case
- [ ] 6.4 Unit test `compactSession`: session with fewer than 11 messages — no compaction, returns `{ summarized: 0, remaining: N }`
- [ ] 6.5 Unit test compaction trigger in `appendToContext`: fires on user message when threshold exceeded; does not fire on assistant message; does not fire when below threshold
- [ ] 6.6 Unit test compaction trigger: token counting failure falls back to message count threshold
- [ ] 6.7 Unit test `buildPrompt` (token-budget): compaction summary message is preserved during truncation when combined message set exceeds budget
- [ ] 6.8 Integration test: `POST /api/sessions/:id/compact` returns correct `{ summarized, remaining }` payload
