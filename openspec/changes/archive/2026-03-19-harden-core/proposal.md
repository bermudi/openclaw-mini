## Why

The core engine works end-to-end, but session and memory management will break under real usage. Session context is stored as a JSON blob with read-modify-write updates (race conditions under concurrent messages), history memory grows without bounds on every task completion, and the context window has no awareness of model token limits — just a hard 50-message cap with silent truncation and a 1000-char session preview. A 10-minute conversation will hit the cap and lose all prior context with no summary. These aren't edge cases; they're guaranteed failures during normal use.

## What Changes

- **Session compaction**: When session message count exceeds a threshold, summarize older messages into a compact entry using a cheaper model, preserving continuity without blowing the context window
- **Memory rotation**: Cap history memory size, rotate old entries to dated archive files (`memory/YYYY-MM-DD.md`), and add cleanup for stale archives
- **Token-aware context building**: Replace hard character caps with token-aware budgeting when assembling the prompt (session preview, memory snapshot, workspace context), respecting the active model's context window
- **Session atomicity**: Replace the read-modify-write pattern in `appendToContext` with an append-only message table or atomic JSON patch to prevent concurrent message corruption
- **Scheduler overlap prevention**: Replace `setInterval` with recursive `setTimeout` for task polling (delivery loop already does this correctly)

## Capabilities

### New Capabilities
- `session-compaction`: Automatic and manual summarization of session history to prevent context window overflow, including pre-compaction memory flush
- `memory-rotation`: Bounded memory growth with date-based archival and configurable retention, preventing unbounded DB row and file growth
- `token-budget`: Token-aware context assembly that respects model limits when building prompts from session, memory, and workspace sources

### Modified Capabilities
- `agent-routing`: Session context handling changes from JSON blob read-modify-write to append-only storage pattern

## Impact

- **Files**: `session-service.ts`, `memory-service.ts`, `agent-executor.ts` (prompt building), `workspace-service.ts` (cap logic), `model-provider.ts` (token counting)
- **Schema**: New `SessionMessage` table or migration of `Session.context` from JSON blob to normalized rows
- **Dependencies**: May need a tokenizer library (e.g., `tiktoken` or `gpt-tokenizer`) for token counting
- **APIs**: No breaking API changes — compaction is internal. May add `/api/sessions/:id/compact` for manual trigger
- **Scheduler**: Minor fix to replace `setInterval` with `setTimeout` pattern
