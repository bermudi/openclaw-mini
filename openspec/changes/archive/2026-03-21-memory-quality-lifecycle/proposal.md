## Why

Agent memories accumulate without any quality signal — a preference set six months ago has the same weight as one set today. Meanwhile, conversations contain valuable facts that never make it into long-term memory unless the agent explicitly calls a memory tool. MicroClaw's "Memory Reflector" (background LLM extraction) and OpenFang's "Confidence Decay" (automatic demotion of stale memories) solve these problems elegantly. Together they create a memory system that grows smarter and stays fresh.

## What Changes

- **Confidence scoring on memories**: Add a `confidence` field (0.0–1.0, default 1.0) to the Memory model. Memories loaded into agent context are sorted by confidence, and low-confidence entries are excluded when the context budget is tight.
- **Confidence decay**: A scheduled job (runs on heartbeat or daily cron) reduces confidence for memories that haven't been reinforced. Configurable half-life (default: 14 days). Memories below a floor threshold (default: 0.1) are soft-deleted.
- **Memory reflector**: After session compaction, an LLM pass extracts durable facts from the summarized conversation and upserts them as memories with category `extracted` and initial confidence 0.7. Deduplication uses key-based matching with fuzzy content comparison.
- **Anti-poisoning guards**: The reflector rejects extractions that look like prompt injection, contain only filler/small-talk, or contradict high-confidence existing memories.

## Capabilities

### New Capabilities
- `memory-confidence`: Confidence scoring, decay scheduling, and confidence-aware context loading for agent memories
- `memory-reflector`: Automatic LLM-driven extraction of durable facts from compacted session history into long-term memory

### Modified Capabilities
- `session-compaction`: After compaction completes, trigger the memory reflector on the summarized content
- `memory-rotation`: Confidence-aware — archive rotations should preserve confidence metadata

## Impact

- **Files**: `src/lib/services/memory-service.ts` (confidence-aware loading), new `src/lib/services/memory-reflector.ts`, `src/lib/services/session-service.ts` (reflector hook post-compaction)
- **Dependencies**: None new — reuses existing `ai` SDK and `runWithModelFallback`
- **Schema**: Add `confidence Float @default(1.0)` and `lastReinforcedAt DateTime?` to `Memory` model; add `'extracted'` to `MemoryCategory`
- **APIs**: No new public endpoints — reflector is internal; confidence visible in existing memory GET responses
