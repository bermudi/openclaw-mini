## Context

The current `MemoryService` stores key-value pairs in SQLite + Markdown files. All memories are loaded equally into agent context via `loadAgentContext()` — there's no quality signal, no staleness detection, and no automatic extraction from conversations. The `SessionService` already compacts sessions with LLM summarization and flushes raw content to memory history, but the summarized content is never mined for durable facts.

MicroClaw's Memory Reflector runs every 60 minutes as a background loop, extracting facts from conversations. OpenFang tracks confidence per memory with automatic decay over time. Both ideas complement each other: the reflector *creates* memories, and confidence decay *prunes* them.

## Goals / Non-Goals

**Goals:**
- Every memory has a confidence score that influences context loading priority
- Stale memories automatically decay, reducing noise in agent context
- Compacted session content is automatically mined for durable facts
- Extracted memories are deduplicated against existing memories
- Basic anti-poisoning protects against prompt injection in extracted content

**Non-Goals:**
- Real-time extraction during conversations (too expensive — only post-compaction)
- Vector/semantic similarity for deduplication (overkill — key matching + simple text comparison)
- User-facing confidence tuning UI (confidence is an internal signal, not a user control)
- MicroClaw's 60-minute background loop (our hook into session compaction is more event-driven and efficient)
- Knowledge graph entities/relations (OpenFang's approach — too complex for our lightweight goal)

## Decisions

### 1. Confidence as a Prisma field, not a separate table

**Decision:** Add `confidence Float @default(1.0)` and `lastReinforcedAt DateTime?` directly to the `Memory` model. Explicit user-set memories get confidence 1.0. Reflector-extracted memories start at 0.7. When a memory is updated (via `setMemory` or reflector re-extraction), `lastReinforcedAt` resets to now and confidence is boosted back.

**Alternatives considered:**
- *Separate `MemoryQuality` table*: Normalized, but adds join complexity for every memory read. Since confidence is read on every context load, colocation is better.
- *Confidence in the Markdown file (YAML frontmatter)*: Interesting for git versioning, but the Markdown files are mirrors — SQLite is the read source of truth.

**Rationale:** Simple, fast, no joins. Every `getAgentMemories()` call can `orderBy: { confidence: 'desc' }` cheaply.

### 2. Exponential decay with configurable half-life

**Decision:** Confidence decays using the formula:
```
newConfidence = confidence × (0.5 ^ (daysSinceReinforced / halfLifeDays))
```
Default half-life: 14 days. A memory untouched for 14 days drops to 50% confidence, 28 days → 25%, etc. Memories below a floor (default: 0.1) are soft-deleted (marked `category: 'archived'`).

The decay job runs as part of the existing daily cleanup cron (alongside `cleanupHistoryArchives` and `cleanupOldSessions`).

**Alternatives considered:**
- *Linear decay*: Simpler, but creates a hard cliff where memories suddenly vanish. Exponential is smoother.
- *OpenFang's 7-day fixed threshold*: Too aggressive. 14-day half-life gives memories more runway while still pruning stale ones.

**Rationale:** Exponential decay is the standard in information retrieval. The half-life is tunable via `OPENCLAW_MEMORY_DECAY_HALF_LIFE_DAYS`.

### 3. Reflector triggered post-compaction, not on a timer

**Decision:** The memory reflector runs as a post-compaction hook in `SessionService.compactSessionInternal()`. After the session is compacted and history is flushed, the reflector receives the summary text and extracts structured facts.

**Alternatives considered:**
- *MicroClaw's 60-minute background timer*: Runs even when nothing happened, wastes LLM calls. Event-driven is better.
- *Per-message extraction*: Too expensive (one LLM call per message) and noisy (small talk generates garbage facts).
- *Separate background worker*: Over-engineered for a single-process runtime.

**Rationale:** Compaction is the natural consolidation point — the conversation has already been summarized, so the reflector works with clean, distilled content. This is essentially free since we're already paying for the compaction LLM call.

### 4. Structured extraction prompt with JSON output

**Decision:** The reflector uses a single LLM call with a structured prompt that returns JSON:
```json
[
  { "key": "user/name", "value": "Alice", "category": "preferences" },
  { "key": "user/timezone", "value": "Europe/Berlin", "category": "preferences" }
]
```
Keys follow the hierarchical path convention from the `memory-git-versioning` change. The LLM is instructed to extract only durable facts (preferences, decisions, important context) and skip ephemeral content.

**Alternatives considered:**
- *Free-text extraction then parse*: Fragile, requires another parsing step.
- *Multiple LLM calls per category*: More accurate per-category, but 3x the cost and latency.

**Rationale:** Single call, structured output, easy to validate. The AI SDK's `generateText` with a system prompt works well for this.

### 5. Key-based deduplication with content similarity check

**Decision:** Before upserting an extracted memory, the reflector checks if a memory with the same key exists. If it does:
- If the content is substantially similar (>80% overlap by normalized Levenshtein or simple substring check), skip it and reinforce the existing memory's confidence.
- If the content differs, update the existing memory with the new value and reset confidence.

**Alternatives considered:**
- *MicroClaw's Jaccard similarity*: More sophisticated, but overkill. Simple string comparison works for our short memory values.
- *Vector similarity*: Requires embeddings infrastructure we deliberately chose not to add.
- *Always overwrite*: Loses the reinforcement signal. If the same fact is extracted twice, it should boost confidence.

**Rationale:** Key-based matching is fast and deterministic. The reflector generates predictable keys (e.g., `user/name`, `user/preferences/communication-style`), making collisions meaningful rather than accidental.

### 6. Anti-poisoning: blocklist + confidence ceiling

**Decision:** The reflector applies three guards before accepting an extraction:
1. **Content filter**: Reject extractions containing known injection patterns (e.g., "ignore previous instructions", "system prompt:", role-play markers).
2. **Minimum substance**: Reject extractions shorter than 10 characters or that are generic filler.
3. **Confidence ceiling for extracted facts**: Extracted memories start at 0.7 and can never exceed 0.9 through reinforcement. Only explicit user-set memories reach 1.0.

**Alternatives considered:**
- *LLM-based injection detection*: Another LLM call just to validate. Too expensive for edge cases.
- *MicroClaw's full anti-poisoning suite*: Includes behavioral filters and feedback loops. Admirable but over-engineered for our case.

**Rationale:** Simple blocklist catches the obvious cases. The confidence ceiling ensures extracted facts never outweigh explicit user preferences, even if reinforced many times.

## Dependencies

This change has a **hard dependency** on `memory-git-versioning` (specifically the `memory-paths` capability). The reflector generates hierarchical keys like `user/name`, `user/preferences/style`. These keys must be valid and the path-based file storage must be in place before the reflector is activated. Implementing the reflector with flat keys and then migrating would create inconsistent key formats across memories.

## Interaction with Git Versioning

Confidence and `lastReinforcedAt` are **SQLite-only metadata** — they are not written to the Markdown files. This means:
- **Decay does NOT trigger git commits.** Decay updates `confidence` in the database and potentially sets `category: 'archived'`, but never touches files. The Markdown file remains on disk with its last content.
- **Reflector extraction DOES trigger git commits.** When the reflector calls `setMemory()` to create a new extracted fact, that writes a `.md` file and (if git versioning is enabled) creates a commit.
- **Reinforcement does NOT trigger git commits.** Boosting confidence and resetting `lastReinforcedAt` are database-only operations — the memory value doesn't change, so there's no file write.

This separation is intentional: git tracks *what the agent knows* (content), while SQLite tracks *how confident the agent is* (metadata).

## Risks / Trade-offs

- **[Reflector quality]** Extraction quality depends on the LLM's ability to identify durable facts. → Mitigated by the confidence ceiling (extracted facts are always subordinate to explicit memories) and the decay mechanism (bad extractions fade naturally).
- **[LLM cost]** One additional LLM call per compaction. → Compaction is already infrequent (every ~40 messages). The reflector call uses the same model as compaction, adding ~5-10 cents per compaction on typical models.
- **[Decay too aggressive]** Important memories could decay below the floor. → Users can explicitly set memories (confidence 1.0, no decay). The 14-day half-life is conservative — memories used weekly will be reinforced before decay matters.
- **[Migration]** Existing memories get `confidence: 1.0` and `lastReinforcedAt: now()`. No behavioral change for existing agents until decay starts.
