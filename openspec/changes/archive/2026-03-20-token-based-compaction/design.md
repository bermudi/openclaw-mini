## Context

Session compaction currently triggers when `messageCount > threshold` (default: 40 messages) in `SessionService.appendToContext()`. This is a simple, model-agnostic heuristic. The project already has token counting infrastructure: `gpt-tokenizer` in `src/lib/utils/token-counter.ts` with a character-based fallback, and `ModelCatalog` in `src/lib/services/model-catalog.ts` that provides context window sizes per model. The `AgentExecutor` already uses these for prompt budget calculation.

The problem: 40 messages of "yes"/"no" responses use trivially few tokens, while 10 messages of long tool-use outputs can blow out the context window. A token-based trigger adapts to actual content size and model capabilities.

## Goals / Non-Goals

**Goals:**
- Compaction triggers when session token usage exceeds a percentage of the model's context window
- Message-count threshold becomes a fallback when token counting fails
- Compaction only triggers on user-turn boundaries (not mid-assistant-response)
- Zero new dependencies — reuses existing `token-counter.ts` and `ModelCatalog`

**Non-Goals:**
- Changing the compaction *process* itself (summarization, deletion, history flush remain the same)
- Per-session model tracking (uses the agent's configured model)
- Real-time token counting on every message (only check at compaction decision points)

## Decisions

### 1. Token percentage threshold with message-count fallback

**Decision:** The compaction trigger logic in `appendToContext()` becomes:
1. Count tokens in all session messages using `countTokens()`
2. Get the agent's model context window size from `ModelCatalog`
3. If `sessionTokens > contextWindow × tokenThreshold` (default: 0.5), trigger compaction
4. If token counting fails (tokenizer error), fall back to the existing message-count check

The threshold is configurable via `OPENCLAW_SESSION_TOKEN_THRESHOLD` (float, default: 0.5).

**Alternatives considered:**
- *Remove message-count entirely*: Loses the safety net if tokenization fails.
- *Use both thresholds (OR)*: Compact if either token or message threshold is hit. This is the approach taken — the message-count threshold acts as a secondary trigger even when token counting succeeds, catching edge cases where many short messages accumulate.

**Rationale:** Token-based is the primary trigger for precision; message-count is the backstop for reliability. Nanobot uses 50% as their default and it works well — leaves room for the response and for new messages arriving during processing.

### 2. Lazy token counting — only at compaction decision points

**Decision:** Token counting happens only inside `appendToContext()` when checking the compaction trigger, not on every message insert. The token count is computed over all messages in the session at that moment.

**Alternatives considered:**
- *Incremental token tracking*: Maintain a running token count in the session, updated on each insert. Faster check, but requires careful bookkeeping (must subtract on compaction, handle edits). Adds complexity to the Session model.
- *Periodic background check*: Decoupled from message flow, but adds latency to compaction response.

**Rationale:** Computing tokens over ~40-100 messages is fast (<5ms with `gpt-tokenizer`). The simplicity of re-counting beats the complexity of maintaining a running total. We can optimize later if profiling shows this is a bottleneck.

### 3. User-turn boundary detection

**Decision:** Compaction only triggers when the message being appended has `role: 'user'`. If an assistant or system message pushes past the threshold, the compaction is deferred until the next user message.

**Alternatives considered:**
- *Compact on any message*: Simpler, but can split an assistant's multi-turn tool-use sequence, losing context mid-reasoning.
- *Compact between tool call and response*: More granular, but adds edge cases around orphaned tool calls.

**Rationale:** User messages are natural conversation boundaries. The agent has finished its response, the user is starting a new turn — this is the safest point to consolidate history. Nanobot uses exactly this heuristic.

### 4. Per-agent model and context configuration

**Decision:** Add three nullable columns to the `Agent` table:
- `model String?` — the agent's LLM model (overrides global `agent.model` from RuntimeConfig)
- `contextWindowOverride Int?` — manual context window size override (skips ModelCatalog lookup entirely)
- `compactionThreshold Float?` — per-agent token threshold for compaction (overrides `OPENCLAW_SESSION_TOKEN_THRESHOLD`)

Resolution order for context window: `agent.contextWindowOverride` → `ModelCatalog.getContextWindow(agent.model)` → `ModelCatalog.getContextWindow(globalConfig.model)` → 128,000 (default).

Resolution order for compaction threshold: `agent.compactionThreshold` → `OPENCLAW_SESSION_TOKEN_THRESHOLD` env → 0.5 (default).

**Alternatives considered:**
- *JSON config column*: Flexible but untyped. Individual columns are explicit, queryable, and validated by Prisma.
- *Separate AgentConfig table*: Over-normalized. These fields are read on every compaction check — colocation with Agent avoids a join.
- *Config file only (openclaw.yaml)*: The current `RuntimeConfig` is global. Per-agent settings need to live in the DB since agents are DB entities.

**Rationale:** Users running a cheap model for a "quick lookup" agent can set `compactionThreshold: 0.3` to keep context lean, while a "deep research" agent on a 1M-token model can set `compactionThreshold: 0.7` and use the full window. All columns are nullable — `null` means "use the global default", so existing agents are unaffected.

### 5. Default context window bump

**Decision:** Bump `DEFAULT_CONTEXT_WINDOW_SIZE` in `model-catalog.ts` from 8,192 to 128,000. Every model in the existing catalog except the legacy `gpt-4` (which nobody should be using in 2026) is 128K+.

**Rationale:** 8,192 was a conservative fallback from the GPT-4-era. It causes unnecessarily aggressive compaction for any unrecognized model. 128K is the safe floor for modern models.

## Risks / Trade-offs

- **[Token counting cost]** Counting tokens on every `appendToContext` call adds ~1-5ms. → Acceptable. This is not a hot loop — it runs once per user/assistant message, not per token.
- **[Model mismatch]** If the agent's model changes between messages, the token threshold may be calibrated for the wrong context window. → Acceptable. The threshold is a percentage, so it adapts. The worst case is compacting slightly too early or too late for one cycle.
- **[Deferred compaction]** User-turn boundary detection means compaction can be delayed if the agent sends many responses before the user replies. → The message-count fallback catches extreme cases. In practice, agents rarely send more than a few responses before the user's next turn.
