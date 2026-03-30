## Context

`SessionService` stores conversation history as rows in the `SessionMessage` table. `AgentExecutor.buildPrompt` loads these messages and budget-trims from the oldest end when they don't fit. This silent truncation is the current "compression" strategy — oldest messages simply disappear.

The `session-compaction` spec defines a richer approach: when a threshold is hit, call an LLM to summarize the oldest messages into a compact `[Session Summary]` system message, flush the raw messages to memory history, then delete them. The spec is complete on the triggering, threshold resolution, snapshot isolation, and memory flush requirements. Two gaps remain: (1) which model to use for the LLM summary call, and (2) what to do when that call fails.

The `token-budget` spec already requires that summary messages survive truncation in `buildPrompt`. The `agent-context-config` spec defines per-agent `contextWindowOverride` and `compactionThreshold` resolution.

## Goals / Non-Goals

**Goals:**
- Implement the `session-compaction` spec requirements in `SessionService`
- Resolve the two specification gaps: summarization model selection and failure handling
- Expose `POST /api/sessions/:id/compact` for manual trigger
- Keep compaction non-blocking relative to incoming messages (snapshot isolation)

**Non-Goals:**
- Changing the `SessionMessage` schema — no migrations required
- Persisting compaction artifacts to the filesystem (memory history flush is sufficient)
- Streaming or progressive summarization (one LLM call per compaction)
- Configuring the summarization prompt via workspace files (hardcoded internal prompt is fine)

## Decisions

### Decision: Summarization uses the agent's configured model (not a separate "cheap" model)

**Chosen:** The compaction summary call uses the same model resolution as normal task execution — `agent.model` → global model → fallback. No separate config.

**Alternatives considered:**
- *Dedicated cheap model (e.g. gpt-4.1-mini always)* — cheaper but adds config complexity and a second provider dependency. Defeats the purpose if the agent is already running on gpt-4.1-mini.
- *Separate `OPENCLAW_COMPACTION_MODEL` env var* — useful for operators on expensive models, but over-engineering for now. Can be added as a follow-on.

The compaction call is infrequent (fires at 50% context usage, not every turn) so cost is not a primary concern.

---

### Decision: Compaction failure is non-fatal — session continues without summary

**Chosen:** If the LLM summary call fails (network error, timeout, model error), the system logs a warning, skips deletion, and returns as if no compaction occurred. The session continues growing normally until the next trigger fires.

**Alternatives considered:**
- *Fail the compaction and propagate the error* — would surface to the operator but doesn't help the agent complete its current task.
- *Truncate without summarizing* — equivalent to current behavior; better than nothing but loses context silently without a logged reason.

Non-fatal failure is the right default: compaction is an optimization, not a correctness requirement. The next user message will re-evaluate the threshold and retry.

---

### Decision: Compaction fires in `appendToContext` on user-turn boundary, not in the task executor

**Chosen:** `SessionService.appendToContext` is the right place — it's already the single write point for session messages, it has access to the session and agent IDs, and user-turn boundary detection (`role === 'user'`) naturally prevents mid-response compaction.

**Alternatives considered:**
- *In `AgentExecutor.buildPrompt`* — would require passing compaction capability into the prompt builder, which is a read-only path today. Mixing writes into a read operation is wrong.
- *Separate background worker* — adds process coordination complexity; overkill for this.

---

### Decision: Summarization prompt is hardcoded in `session-service.ts`

**Chosen:** A structured internal prompt asking for: session intent, key decisions, artifacts created, open questions, and next steps. Not operator-configurable.

The summary's audience is the AI model itself in future turns — not the user. Operator-customizable prompts here would risk breaking compaction semantics.

---

### Decision: Retain 10 most recent messages after compaction

**Chosen:** Matches the `session-compaction` spec (`remaining: 11` = 1 summary + 10 recent). This is also consistent with the `token-budget` spec's truncation behavior which preserves summary + 7 most recent when budget-trimming.

The 10 is not configurable for now — it's a reasonable constant that keeps conversational coherence without inflating post-compaction size.

## Risks / Trade-offs

- **[Risk] Compaction fires mid-task on a very fast session** → Mitigation: snapshot isolation (spec requirement) ensures only messages that existed at compaction start are summarized/deleted. New messages appended during the async LLM call are safe.
- **[Risk] LLM summary is low quality** → Mitigation: structured prompt with explicit sections. Post-compaction reflector hook (spec requirement) runs the summary through the memory reflector for additional processing.
- **[Risk] Compaction loops if threshold evaluation is re-run before enough new messages arrive** → Mitigation: compaction only fires on `role: 'user'` boundary. After compaction, the session size drops to ~11 messages which is well below any threshold. No loop is possible.
- **[Risk] `appendToContext` becomes async and slower** → The LLM compaction call is I/O bound (~1–3 seconds). This is in the message ingestion path, meaning the task queue processing sees slightly higher latency on compaction events. Acceptable: compaction is rare and latency is bounded.

## Migration Plan

- No schema migrations
- `OPENCLAW_SESSION_TOKEN_THRESHOLD` env var is additive (default 0.5)
- Existing sessions with 0 messages or few messages are unaffected
- Sessions that are already large (> threshold) will compact on the next user message append after deploy
- Rollback: remove the compaction trigger from `appendToContext`; session messages continue to accumulate as before
