## 0. Prerequisites

- [ ] 0.1 Verify that `memory-git-versioning` change is fully implemented — specifically that hierarchical memory paths (`system/`, `user/`, `agent/`) and key validation are in place. The reflector generates hierarchical keys and will not work correctly with flat keys.

## 1. Schema & Types

- [ ] 1.1 Add `confidence Float @default(1.0)` and `lastReinforcedAt DateTime?` fields to the `Memory` model in `prisma/schema.prisma`
- [ ] 1.2 Add `'extracted'` and `'archived'` to the `MemoryCategory` type in `src/lib/types.ts`
- [ ] 1.3 Update the `Memory` interface in `src/lib/types.ts` to include `confidence: number` and `lastReinforcedAt: Date | null`
- [ ] 1.4 Run `bunx prisma db push` (or create a migration) to apply schema changes
- [ ] 1.5 Update `mapMemory()` in `memory-service.ts` to include `confidence` and `lastReinforcedAt` in the mapped output

## 2. Confidence-Aware Memory Operations

- [ ] 2.1 Update `setMemory()` in `memory-service.ts`: set `confidence: 1.0` and `lastReinforcedAt: new Date()` on create; on update, set `lastReinforcedAt: new Date()` and preserve or set confidence to 1.0 for explicit writes
- [ ] 2.2 Update `getAgentMemories()` to exclude memories with `category: 'archived'` by default, and order by `confidence: 'desc'`
- [ ] 2.3 Update `loadAgentContext()` to sort memories by confidence descending, so low-confidence memories are the first to be dropped under budget pressure

## 3. Confidence Decay

- [ ] 3.1 Add a `decayMemoryConfidence()` method to `MemoryService` that: queries all non-archived memories where `lastReinforcedAt` is not null, applies the decay formula `confidence × (0.5 ^ (daysSince / halfLifeDays))`, updates confidence in the database, and soft-deletes (sets `category: 'archived'`) memories below the floor (0.1)
- [ ] 3.2 Make half-life configurable via `OPENCLAW_MEMORY_DECAY_HALF_LIFE_DAYS` (default: 14) and floor via `OPENCLAW_MEMORY_DECAY_FLOOR` (default: 0.1)
- [ ] 3.3 Integrate `decayMemoryConfidence()` into the existing daily cleanup schedule (alongside `cleanupHistoryArchives` and `cleanupOldSessions`)

## 4. Memory Reflector

- [ ] 4.1 Create `src/lib/services/memory-reflector.ts` with a `reflectOnContent(agentId: string, content: string): Promise<void>` function
- [ ] 4.2 Implement the LLM extraction call: use `runWithModelFallback` + `generateText` with a system prompt that instructs the model to extract durable facts as a JSON array of `{ key, value, category }` objects
- [ ] 4.3 Parse the LLM response: extract JSON from the response text, validate each entry has `key`, `value`, and `category` fields, reject malformed entries
- [ ] 4.4 Implement anti-poisoning filter: reject extractions containing injection patterns (`ignore previous instructions`, `system prompt:`, `<|system|>`, `[INST]`), content shorter than 10 characters, or empty/whitespace-only values
- [ ] 4.5 Implement deduplication: for each extracted fact, check if a memory with the same key exists. If content is similar, reinforce existing (boost confidence, reset `lastReinforcedAt`). If content differs, update value and reset confidence to 0.7. If no existing memory, create with confidence 0.7.
- [ ] 4.6 Enforce the confidence ceiling: when reinforcing extracted memories, cap confidence at 0.9

## 5. Post-Compaction Hook

- [ ] 5.1 In `SessionService.compactSessionInternal()`, after the compaction transaction completes, call `reflectOnContent(session.agentId, summaryText)` wrapped in a try/catch that logs errors but does not throw
- [ ] 5.2 Ensure the reflector hook runs after `memoryService.appendHistory()` but does not block the compaction return

## 6. API Updates

- [ ] 6.1 Update the memory GET endpoints (`/api/agents/:id/memory`) to include `confidence` and `lastReinforcedAt` in the response
- [ ] 6.2 Ensure the memory rotation (`appendHistoryArchive`) preserves confidence and `lastReinforcedAt` when resetting the history value

## 7. Testing

- [ ] 7.1 Write unit tests for confidence decay: 14-day-old memory decays to ~0.5, 1-day-old memory barely decays, memory below floor gets archived, already-archived memories are skipped
- [ ] 7.2 Write unit tests for the memory reflector: successful extraction creates memories with confidence 0.7, duplicate key reinforces existing, changed value updates and resets confidence, injection patterns rejected, short content rejected, LLM failure is caught and logged
- [ ] 7.3 Write unit tests for the anti-poisoning filter: test each rejection pattern independently
- [ ] 7.4 Write integration tests: compaction triggers reflector, reflector failure doesn't break compaction, confidence-aware context loading orders by confidence
- [ ] 7.5 Write tests for confidence ceiling: reinforced extracted memory never exceeds 0.9, explicit user memory stays at 1.0
