## Context

Session context is stored as a single JSON blob in `Session.context` (a `String` column). The `appendToContext` method in `session-service.ts` reads the full blob, deserializes it, pushes a message, re-serializes, and writes it back. Two concurrent messages hitting the same session will race — the second write silently drops the first message. The only guard against unbounded growth is a hard cap at 50 messages with silent truncation (`context.messages.slice(-50)`), which discards all prior context with no summary.

Memory history (`memory-service.ts`, `appendHistory`) follows the same read-modify-write pattern: it reads the full `history` memory value, concatenates a new Markdown entry, and writes the entire string back. There is no size cap — every completed task appends ~700 chars. After 1,000 tasks the history value is ~700 KB, and every append rewrites the entire blob.

Prompt assembly in `agent-executor.ts` uses hard character caps: `context.substring(0, 2000)` for memory and `sessionContext.substring(0, 1000)` for session. These are byte-unaware (character counts, not tokens), model-unaware (same caps for a 4K and a 128K model), and priority-unaware (workspace context has no budget — it just goes first and whatever fits is whatever fits).

The scheduler (`mini-services/scheduler/index.ts`) uses `setInterval` for both task polling and trigger checking. If `processPendingTasks()` takes longer than the 5-second interval, the next invocation overlaps. The delivery loop correctly uses recursive `setTimeout` already.

## Goals / Non-Goals

**Goals:**
- Eliminate session context race conditions by moving from read-modify-write JSON blob to append-only message rows
- Add session compaction so conversations longer than ~40 messages get summarized instead of silently truncated
- Bound memory history growth with rotation to dated archive files and cleanup of stale archives
- Replace hard character caps with token-aware prompt budgeting that respects the active model's context window
- Fix scheduler overlap by switching `setInterval` to recursive `setTimeout`

**Non-Goals:**
- Full semantic search or embedding-based memory retrieval — plain text rotation is sufficient for now
- Multi-model orchestration or model-specific tokenizer selection — `gpt-tokenizer` covers the tokenizer family used by OpenAI-compatible models, which is the primary target
- Real-time streaming of compaction progress — compaction is a background operation
- Per-agent compaction or rotation policies — global configuration is sufficient until multi-agent use cases demand it

## Decisions

### 1. Session storage: JSON blob → `SessionMessage` table

**Choice**: Add a `SessionMessage` model with columns `(id, sessionId, role, content, sender, channel, channelKey, createdAt)`. Each `appendToContext` call becomes a single `INSERT` — no read-modify-write, no races. The `Session.context` column is retained temporarily for migration but no longer written to after migration completes.

**Rationale**: Append-only rows eliminate the race condition by construction. Pagination is a simple `ORDER BY createdAt` query. Compaction becomes `DELETE` old rows + `INSERT` one summary row. The JSON blob approach has no path to atomicity without database-level JSON patching, which SQLite doesn't support well.

**Alternatives considered**:
- Atomic JSON patch (e.g., `json_insert`): SQLite's JSON support is limited; still requires serialization for reads; doesn't solve pagination or compaction cleanly
- Optimistic locking (version column + retry): adds complexity, still has the serialization bottleneck, doesn't address compaction

### 2. Session compaction: summarize-and-replace

**Choice**: When message count for a session exceeds a configurable threshold (default: 40), the oldest messages (all but the most recent N, default: 10) are summarized into a single `system` role message using the configured model (or a cheaper one if available). The summary message replaces the deleted rows. The most recent N messages are kept verbatim to preserve immediate conversational context.

**Rationale**: Summarization preserves the semantic content of the conversation while dramatically reducing token count. Keeping recent messages intact ensures the agent doesn't lose the thread of the current exchange. This mirrors proven patterns in long-running chat systems.

**Trigger**: Compaction runs after `appendToContext` when the count exceeds the threshold. It also exposes a manual endpoint (`POST /api/sessions/:id/compact`) for on-demand compaction.

### 3. Memory rotation: cap + dated archives

**Choice**: Cap history memory value at a configurable size (default: 50 KB). When `appendHistory` would exceed the cap, move the current history content to `data/memories/<agentId>/history/YYYY-MM-DD.md` and reset the active history to just the new entry. A cleanup job (run on the daily scheduler cron) deletes archive files older than a configurable retention period (default: 30 days).

**Rationale**: History is append-only Markdown — it doesn't need to be queryable, just preservable. Dated files are human-readable, easy to grep, and trivially cleaned up. The cap prevents the single-row rewrite from growing without bound.

**Alternatives considered**:
- Separate DB rows per history entry: adds schema complexity for data that's rarely queried programmatically
- Ring buffer in the DB: loses old data permanently instead of archiving it

### 4. Token budgeting: `gpt-tokenizer` with priority allocation

**Choice**: Use `gpt-tokenizer` (pure JS, no native dependencies, ~100 KB) to count tokens. Prompt assembly allocates a total budget based on the model's context window (minus a reserve for the response). Budget is allocated in priority order:

1. **System prompt** (workspace context) — always included in full (already capped by workspace service)
2. **Session context** — filled next, up to remaining budget
3. **Memory snapshot** — gets whatever budget remains

If session context alone exceeds the budget, it's truncated from the oldest messages (but never removes the compaction summary if present). If no budget remains for memory, it's excluded entirely.

**Rationale**: Token counting is the only accurate way to manage context windows. Character-based caps are unreliable — 1,000 characters can be 200-400 tokens depending on content. Priority ordering ensures the most actionable context (current conversation) is preserved over historical memory.

**Performance**: Token counting adds ~1-2ms per prompt assembly. Tokens are counted once per prompt build, not cached across requests (the content changes every time).

### 5. Scheduler: `setInterval` → recursive `setTimeout`

**Choice**: Replace `setInterval(processPendingTasks, 5000)` and `setInterval(processDueTriggers, 60000)` with the same recursive `setTimeout` pattern already used by `runDeliveryLoop`. Each iteration awaits the async work, then schedules the next run.

**Rationale**: Direct fix for overlap. If task processing takes 8 seconds, the next poll starts 5 seconds after completion instead of overlapping. The delivery loop already proves this pattern works in this codebase.

## Risks / Trade-offs

**[Compaction loses conversational detail]** — Summarization is lossy by nature. A user asking "what did I say 30 messages ago?" may get an approximate answer. Mitigation: the pre-compaction content is flushed to memory history before deletion, so the raw detail exists in the archive files even after compaction.

**[Migration from JSON blob to message rows]** — Existing sessions have context stored as JSON. The migration must parse each session's JSON blob and insert individual rows into `SessionMessage`. If the JSON is malformed (the `parseContext` method already handles this with a fallback), those sessions start fresh. Risk is low — the system is pre-production.

**[Token counting adds latency]** — `gpt-tokenizer` encoding is CPU work (~1-2ms for typical prompts). Mitigation: count once during prompt assembly, don't cache (content changes every request). This is negligible compared to the LLM API call latency (seconds).

**[`gpt-tokenizer` is GPT-family specific]** — Token counts may be slightly off for Anthropic or other models. Mitigation: the budget includes a reserve margin (default: 20% of context window for response), which absorbs tokenizer inaccuracy. For safety-critical accuracy, model-specific tokenizers can be added later as a non-goal evolution.

**[Memory rotation during active task]** — If a task is in progress when rotation triggers, the active `appendHistory` call might race with the rotation. Mitigation: rotation is triggered inside `appendHistory` itself (check size → rotate → append), so it's sequential within a single call. Concurrent calls to `appendHistory` are already serialized by the task queue's sequential execution guarantee.
