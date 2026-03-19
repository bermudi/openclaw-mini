## 1. Schema & Migration

- [ ] 1.1 Add `SessionMessage` model to `prisma/schema.prisma` with columns: `id`, `sessionId`, `role`, `content`, `sender`, `channel`, `channelKey`, `createdAt`. Add relation to `Session` (cascade delete) and index on `[sessionId, createdAt]`.
- [ ] 1.2 Run `bunx prisma migrate dev` to generate and apply the migration. Verify the `session_messages` table exists in SQLite.
- [ ] 1.3 Write a migration script that parses each existing `Session.context` JSON blob, inserts individual `SessionMessage` rows per message (preserving original timestamps), and logs warnings for malformed JSON. Run it against dev DB and verify row counts match.

## 2. Session Service Refactor

- [ ] 2.1 Rewrite `appendToContext` in `session-service.ts` to do a single `db.sessionMessage.create()` insert instead of the read-modify-write JSON blob pattern. Remove the 50-message truncation logic.
- [ ] 2.2 Rewrite `getSessionContext` to query `SessionMessage` rows ordered by `createdAt` ascending and format them into the same string output. Remove JSON blob deserialization.
- [ ] 2.3 Update `getSession` and `getOrCreateSession` to stop parsing `Session.context`. New sessions no longer write an initial JSON blob to `context`.
- [ ] 2.4 Update `getAgentSessions` to compute `messageCount` via a `COUNT` query on `SessionMessage` rows instead of parsing the JSON blob.
- [ ] 2.5 Update `clearHistory` to delete all `SessionMessage` rows for the session instead of resetting the JSON blob. Update `deleteSession` and `cleanupOldSessions` to rely on cascade delete for message rows.

## 3. Session Compaction

- [ ] 3.1 Add a `compactSession` method to `SessionService` that: queries all `SessionMessage` rows for a session, identifies the oldest messages (all except the most recent N, default 10), calls the LLM to summarize them, flushes raw content to memory via `memoryService.appendHistory`, deletes the summarized rows, and inserts a single `system`-role summary message prefixed with `[Session Summary]`.
- [ ] 3.2 Wire auto-compaction into `appendToContext`: after inserting a message, check the row count; if it exceeds the threshold (default 40), call `compactSession`. Use snapshot isolation — only compact messages that existed at compaction start.
- [ ] 3.3 Add `POST /api/sessions/:id/compact` endpoint that calls `compactSession` on demand and returns `{ summarized, remaining }`. Return a no-op response if the session has fewer messages than the retention count.

## 4. Memory Rotation

- [ ] 4.1 Add a size check to `appendHistory` in `memory-service.ts`: before appending, measure the current history value byte length (UTF-8). If appending would exceed the cap (default 50 KB), rotate the current content to `data/memories/<agentId>/history/YYYY-MM-DD.md` (append if the dated file already exists), then reset the active history to just the new entry.
- [ ] 4.2 Add a `cleanupHistoryArchives` method to `MemoryService` that deletes archive files in `data/memories/<agentId>/history/` older than the retention period (default 30 days). Parse dates from filenames.
- [ ] 4.3 Wire `cleanupHistoryArchives` into the scheduler's daily cleanup cron job (`0 3 * * *` in `mini-services/scheduler/index.ts`), iterating over all agents.

## 5. Token Budget

- [ ] 5.1 Add `gpt-tokenizer` dependency via `bun add gpt-tokenizer`. Create `src/lib/utils/token-counter.ts` with a `countTokens(text: string): number` function that uses `gpt-tokenizer` to encode and return length, with a `catch` fallback to `Math.ceil(text.length / 4)` plus a warning log.
- [ ] 5.2 Add a model context window registry to `model-provider.ts` — a map of known model names to context window sizes, and a `getContextWindowSize(model: string): number` function that defaults to 8192 for unknown models.
- [ ] 5.3 Refactor `buildPrompt` in `agent-executor.ts` to use token budgets: calculate total budget as `contextWindow - responseReserve` (20%, min 1000 tokens). Allocate in priority order: system prompt (full), task content (full), session context (remaining budget, truncate oldest messages first but preserve `[Session Summary]` messages), memory snapshot (whatever remains). Replace the hard `substring(0, 2000)` and `substring(0, 1000)` caps.

## 6. Scheduler Fix

- [ ] 6.1 In `mini-services/scheduler/index.ts`, replace the `setInterval` calls for `processPendingTasks` (line 217) and `processDueTriggers` (line 224) with recursive `setTimeout` loops that await the async work before scheduling the next run — matching the existing `runDeliveryLoop` pattern. Leave the status logging `setInterval` (line 242) and the `node-cron` daily cleanup as-is.

## 7. Testing

- [ ] 7.1 Write tests for session message append: verify `appendToContext` inserts a `SessionMessage` row, verify `getSessionContext` returns formatted rows in order, verify concurrent inserts don't lose messages.
- [ ] 7.2 Write tests for session compaction: verify compaction triggers at threshold, verify summary message has `[Session Summary]` prefix and `system` role, verify pre-compaction flush calls `appendHistory`, verify messages below retention count are not compacted.
- [ ] 7.3 Write tests for memory rotation: verify rotation triggers when history exceeds cap, verify archive file is created at `data/memories/<agentId>/history/YYYY-MM-DD.md`, verify active history is reset to new entry only, verify `cleanupHistoryArchives` deletes files older than retention.
- [ ] 7.4 Write tests for token budget assembly: verify budget calculation from model context window, verify priority ordering (system → task → session → memory), verify session truncation drops oldest messages first but preserves summary, verify fallback when tokenizer errors.
- [ ] 7.5 Verify migration: run migration on a DB with existing session JSON blobs, assert `SessionMessage` rows match original message counts, assert malformed JSON sessions produce zero rows and a warning.
