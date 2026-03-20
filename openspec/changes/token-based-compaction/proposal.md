## Why

Session compaction currently triggers at a fixed message count (default: 40). This is model-agnostic — a 40-message session might use 5% of a 128K context window or 90% of a 4K one. Nanobot demonstrated that triggering compaction at a *percentage of the context window* adapts automatically to any model. Since we already have token counting infrastructure (the `token-budget` spec and `gpt-tokenizer`), switching the compaction trigger to token-based is a small change with high leverage.

## What Changes

- **Token-based compaction trigger**: Replace the message-count threshold with a token-percentage threshold. Compaction triggers when session messages exceed a configurable percentage of the model's context window (default: 50%). The existing message-count threshold becomes a fallback for cases where token counting fails.
- **Per-agent context configuration**: Add `model`, `contextWindowOverride`, and `compactionThreshold` columns to the Agent table, allowing each agent to run a different model with independent compaction behavior. Users who want to save on inference can set a lower threshold (compact earlier, shorter context); users who want deep conversations can raise it.
- **User-turn boundary detection**: Compaction only triggers after a user message (not mid-assistant-response), preventing partial context loss during multi-turn tool use sequences.
- **Default context window bump**: Update the fallback context window from 8,192 to 128,000 tokens — every mainstream model in 2026 supports at least 128K.

## Capabilities

### New Capabilities
- `agent-context-config`: Per-agent model, context window override, and compaction threshold settings stored in the Agent table

### Modified Capabilities
- `session-compaction`: Trigger condition changes from message-count to token-percentage of context window, with user-turn boundary detection and per-agent threshold
- `token-budget`: Token counting utility is reused by the compaction trigger (no changes to the budget spec itself, just a new consumer)

## Impact

- **Files**: `src/lib/services/session-service.ts` (compaction trigger logic), `src/lib/services/model-provider.ts` (context window lookup), `src/lib/services/model-catalog.ts` (default bump)
- **Dependencies**: None new — reuses existing `gpt-tokenizer`
- **Schema**: Add `model`, `contextWindowOverride`, `compactionThreshold` columns to `Agent` table
- **APIs**: Existing agent CRUD endpoints return the new fields; dashboard can expose them
