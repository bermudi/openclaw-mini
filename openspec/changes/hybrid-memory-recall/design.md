## Context

OpenClaw-Mini already stores durable memories in SQLite with confidence metadata and path-based keys, and prompt assembly already operates under a token budget. The active `memory-search` change explores keyword lookup, but the broader product need is hybrid recall: the runtime must decide what memories to inject automatically for a turn while also supporting explicit search and exact retrieval.

Vector search is now in scope, which changes the design center. If we ship a search-only interface first, we will have to replace both the storage model and the prompt assembly behavior immediately afterward. The system therefore needs a shared recall substrate that can power prompt injection, explicit `memory_search`, and exact `memory_get` while staying lightweight and SQLite-first.

Constraints:
- The runtime should remain local-first and lightweight, with SQLite as the primary persistence layer
- Memory correctness cannot depend on vector infrastructure being healthy; keyword and exact lookup must remain functional fallbacks
- Existing confidence and token-budget behavior already affect prompt assembly and must evolve without breaking current guarantees
- Long-form markdown memories and short fact memories both need retrieval support, but they are not ideal search units in the same way

## Goals / Non-Goals

**Goals:**
- Introduce a recall-first architecture that supports automatic memory injection and explicit tool-driven lookup from the same substrate
- Add SQLite-native hybrid retrieval using exact lookup, FTS5 keyword search, and vector similarity
- Keep source memories and search units separate so long-form memories can be chunked without losing their original key/value representation
- Use Reciprocal Rank Fusion to combine keyword and vector results without fragile score calibration
- Keep recall bounded with pinned memory, confidence thresholds, and token-budgeted injection
- Support graceful fallback when embedding providers or vector indexes are unavailable
- Make recall observable through structured logs and omission metadata

**Non-Goals:**
- Knowledge graph/entity relationship storage
- Cross-agent or global shared memory search
- Mandatory remote embedding providers or server-backed vector stores
- Advanced ranking features such as MMR or learned reranking in the first version
- Replacing the existing memory source-of-truth model with chunk records

## Decisions

### 1. Make recall the primary abstraction

The runtime will treat memory recall as the core behavior and `memory_search` / `memory_get` as consumers of that behavior. Prompt assembly will request a bounded recall set for each turn, while tools will call the same substrate in explicit modes.

Why this over a search-first design:
- Search-only tools do not solve automatic memory injection
- Prompt assembly, exact retrieval, and search results stay consistent when backed by one substrate
- Future retrieval changes can happen behind a stable recall interface

Alternatives considered:
- Keep `memory_search` as the primary feature and bolt recall on later. Rejected because it would lock in the wrong abstraction and require another redesign once vector search lands.

### 2. Separate source memories from searchable chunks

The database will continue to store canonical memory records keyed by hierarchical path. Search and recall will operate over derived chunk records.

Chunking rules:
- Short fact-like memories remain atomic and produce a single search unit
- Long-form memories are split into overlapping chunks so keyword and vector retrieval can target relevant segments
- Search results retain a link to the parent memory key so exact retrieval and reinforcement continue to operate on canonical memories

Why this over storing only chunks:
- Existing memory APIs and reflector logic are key/value oriented
- Exact lookup should return the real memory record, not a stitched synthetic document
- Chunking every memory would add complexity with little value for small facts

Alternatives considered:
- Index raw memories without chunking. Rejected because long-form memory values become poor retrieval units.
- Replace memories with document/chunk-only storage. Rejected because it complicates writes, updates, and exact key semantics.

### 3. Use SQLite FTS5 plus optional vector indexing behind one retrieval interface

The system will support hybrid retrieval with three candidate sources:
- exact key lookup
- FTS5 keyword retrieval over chunk text and keys
- vector similarity over embedded chunks

Vector search will prefer a SQLite-native vector index when available, but the retrieval interface will also support in-process cosine similarity over stored embeddings as a correctness-preserving fallback.

Why this over requiring `sqlite-vec` everywhere:
- It keeps architecture vector-native without making extension availability a hard dependency
- Smaller deployments can still use semantic recall even if the optimized index is unavailable
- The runtime remains usable in keyword-only mode if embeddings are disabled entirely

Alternatives considered:
- `sqlite-vec` only. Rejected because it creates a portability and operability cliff.
- Remote vector database. Rejected because it violates the lightweight local-first goal.

### 4. Use Reciprocal Rank Fusion for hybrid ranking

Hybrid search and recall will combine FTS and vector result lists using Reciprocal Rank Fusion (RRF). Confidence thresholds and light recency handling will be applied as policy controls around fusion, not as a replacement for fusion.

Why RRF over weighted score fusion:
- FTS and vector scores are hard to calibrate across providers and models
- RRF operates on rank ordering and is therefore simpler to tune and more robust to provider changes
- Documents appearing in both candidate sets naturally receive a boost

Alternatives considered:
- Weighted score fusion. Rejected for the first version because it requires score normalization and tuning.
- Vector-only ranking. Rejected because exact text matches and path hints remain highly valuable.

### 5. Budget memory injection as pinned plus recalled sections

Prompt assembly will distinguish between:
- pinned memory: small, stable memory that is always preferred for inclusion
- recalled memory: dynamic memory selected per turn via hybrid recall

Pinned memory gets a reserved slice of the prompt budget before dynamic recall is filled. Recalled memory then uses the remaining memory allocation and reports omissions when truncation occurs.

Why this over a single memory snapshot:
- Stable preferences and identity should not disappear just because a session is large
- Dynamic recall and always-on memory serve different roles and need different budgeting rules
- Omission reporting improves debugging and future tuning

Alternatives considered:
- Keep a single undifferentiated memory section. Rejected because it makes memory behavior opaque and harder to tune.

### 6. Add embedding provider abstraction and cache metadata

Embedding generation will be isolated behind a provider interface that records provider name, model, dimension, and embedding generation version. Cached embeddings will be keyed by content hash plus provider/model so reindexing can avoid redundant calls.

Why this over embedding inline without metadata:
- Model or dimension changes must be detectable
- Cache invalidation must be explicit when providers change
- The runtime should support local or remote providers without changing recall logic

Alternatives considered:
- Store bare embeddings only. Rejected because dimension and provider mismatches become hard to detect and recover from.

### 7. Make indexing asynchronous and recall observable

Memory writes should enqueue or mark chunks for indexing/reindexing rather than block every write on embedding work. Recall operations should record which retrieval path was used, how many candidates were considered, how many memories were injected, how many were omitted, and the estimated token cost.

Why this over synchronous indexing and no logs:
- Embedding work is slower and more failure-prone than core memory writes
- Recall quality will be difficult to debug without observability
- Logging gives us a concrete feedback loop for threshold and budget tuning

Alternatives considered:
- Synchronous embedding on every write. Rejected because it increases latency and couples memory writes to provider health.

## Risks / Trade-offs

- **Embedding infrastructure adds operational complexity** → Keep vector retrieval optional and preserve exact/keyword fallback paths
- **Vector index availability may vary by environment** → Support in-process cosine fallback and allow vector features to be disabled by configuration
- **Chunk/index state can drift from canonical memories** → Store content hashes and indexing metadata, and provide explicit reindex workflows
- **Hybrid recall can inject irrelevant or stale memories** → Apply confidence thresholds, pinned-memory limits, category-aware filtering, and token budgets
- **Prompt assembly becomes more complex** → Keep section boundaries explicit and log omission decisions for inspection
- **Background indexing can lag behind recent writes** → Return exact lookup results immediately and allow keyword recall over canonical text until embeddings catch up

## Migration Plan

1. Add the new indexing tables, metadata tables, and recall logging tables without changing existing memory APIs
2. Introduce the recall service in keyword/exact mode first so prompt assembly can switch to the new interface safely
3. Backfill chunk records for existing memories and enable FTS indexing
4. Add embedding provider configuration, cache storage, and vector indexing/reindex workflows
5. Enable hybrid recall and tool-driven hybrid search once vector backfill is complete
6. Roll back by disabling hybrid recall and vector retrieval in configuration while keeping canonical memories intact; the new index tables can remain unused if needed

## Open Questions

- Which memory categories or keys should be pinned by default versus only dynamically recalled?
- Should session context always have higher priority than pinned memory, or should pinned memory reserve budget ahead of session growth?
- What default embedding provider and model should OpenClaw-Mini support first: remote API, local Ollama, or both?
- Should recency boosting be global or limited to event-like categories?
- How should manual memory edits interact with chunk reindexing when filesystem backups diverge from the database record?
