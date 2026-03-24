## Why

Our current memory change is centered on keyword search, but the actual product need is recall: the runtime should surface the right memories automatically and still support explicit lookup. Since vector search is now in scope, we should design the memory subsystem around hybrid recall from the start instead of shipping a search-only interface that we will immediately have to replace.

A recall-first design lets OpenClaw-Mini stay lightweight while gaining the benefits of semantic retrieval, bounded context injection, and graceful fallback when embedding infrastructure is unavailable. This gives agents better memory quality without committing us to heavyweight graph or server-backed search systems.

## What Changes

- Add a hybrid memory recall pipeline that combines pinned memory, keyword retrieval, vector retrieval, and exact key lookup to assemble a bounded memory context for each turn
- Add SQLite-backed memory indexing for long-form memories, including chunk records, FTS5 search, vector storage, and embedding cache metadata
- Add embedding provider abstractions and indexing workflows so memories can be embedded once and reused across recall and tool-driven search
- Add hybrid ranking for recall and explicit search using Reciprocal Rank Fusion, with confidence thresholds, light recency handling, and token-budgeted context injection
- Add agent-facing `memory_search` and `memory_get` tools on top of the same recall substrate, so explicit browsing and exact retrieval use the same source of truth
- Add graceful fallback behavior so the system continues to work with exact lookup and keyword/FTS retrieval when vector search or embeddings are unavailable
- Add observability for memory recall decisions, including selected memories, omitted memories, retrieval method, and token usage

## Capabilities

### New Capabilities
- `memory-recall`: Hybrid memory recall and explicit memory retrieval built on exact lookup, FTS, and vector search with bounded prompt injection
- `memory-indexing`: SQLite-backed chunk indexing, embedding generation, vector storage, and cache management for searchable memories

### Modified Capabilities
- `memory-confidence`: Confidence changes from simple sort order to recall policy input, including thresholding, prioritization, and recall-time filtering
- `token-budget`: Prompt assembly changes from a single memory snapshot to pinned and recalled memory sections with explicit budgeting and omission reporting

## Impact

- **Storage**: New SQLite search/index tables for memory chunks, FTS, vectors, embedding cache, and recall logs
- **Services**: New recall/indexing services plus changes to memory service and prompt assembly
- **Tools**: New or revised `memory_search` and `memory_get` tools backed by the recall substrate
- **Configuration**: Embedding provider, model, dimension, and vector-index configuration become part of runtime setup
- **Dependencies**: SQLite FTS5 and vector search support (`sqlite-vec` or equivalent fallback path), plus embedding provider integration
- **Performance**: Indexing and embedding work increase write-time/background cost, but improve recall quality and keep prompt injection bounded
