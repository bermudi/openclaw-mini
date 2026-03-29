## Why

Sessions accumulate message history without bound. When the token budget for session context is exhausted in `buildPrompt`, the oldest messages are silently discarded — the agent loses early context with no indication and no way to recover it. For long-running sessions (hours of conversation, heartbeats, cross-channel interaction) this silent truncation degrades response quality in ways that are hard to diagnose.

The `session-compaction` spec was written with complete requirements but was never implemented. This change implements it and fills the remaining specification gaps around LLM model selection for summarization and failure behavior.

## What Changes

- `SessionService.appendToContext` gains a compaction trigger: when a `user` message is appended and session token usage exceeds 50% of the agent's context window (or 40 messages as fallback), compaction fires automatically
- Compaction: summarizes the oldest messages into a `[Session Summary]` system message via an LLM call; retains the 10 most recent messages verbatim; flushes raw messages to memory history before deletion
- `POST /api/sessions/:id/compact` manual endpoint exposed
- Summaries survive subsequent truncation in `buildPrompt` (already specced in `token-budget`)
- A delta spec for `session-compaction` fills two implementation-critical gaps: summarization model selection and graceful degradation when the LLM summary call fails

## Capabilities

### New Capabilities

*(none — `session-compaction` spec already defines all core requirements)*

### Modified Capabilities

- `session-compaction`: Add summarization model selection (which model to call for generating the summary), structured summary prompt format (what the model should produce), and failure handling (what happens when the LLM compaction call itself fails)

## Impact

- `src/lib/services/session-service.ts` — add compaction trigger in `appendToContext`, implement `compactSession()` logic, expose `compactSession` for the API endpoint
- `src/app/api/sessions/[id]/compact/route.ts` — new API route for manual compaction
- `src/lib/services/model-provider.ts` — reused for selecting the summarization model
- `src/lib/services/memory-service.ts` — reused (`appendHistory`) for pre-compaction memory flush
- `src/lib/utils/token-counter.ts` — reused for compaction trigger evaluation
- `src/lib/config/runtime.ts` — add `OPENCLAW_SESSION_TOKEN_THRESHOLD` env var
- Prisma schema: no new tables; relies on existing `SessionMessage` model
