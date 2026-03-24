## 1. Schema and configuration

- [x] 1.1 Add database tables and Prisma models for memory chunks, FTS/vector index metadata, embedding cache, and recall logs
- [x] 1.2 Add runtime configuration for embedding provider, model, dimensions, chunking threshold, and vector retrieval mode
- [x] 1.3 Add migration and bootstrap logic for creating FTS and vector index structures in SQLite

## 2. Indexing pipeline

- [x] 2.1 Implement canonical-memory-to-searchable-unit conversion for short memories and chunked long-form memories
- [x] 2.2 Implement asynchronous indexing state management so memory writes mark records for reindex without blocking writes
- [x] 2.3 Implement embedding generation with provider/model/version metadata and content-hash-based cache reuse
- [x] 2.4 Implement full reindex/backfill workflow for existing memories and index drift recovery

## 3. Retrieval and ranking

- [x] 3.1 Implement exact key retrieval against canonical memories for `memory_get`
- [x] 3.2 Implement keyword retrieval over indexed memory text using SQLite FTS
- [x] 3.3 Implement vector retrieval with optimized SQLite vector index support and in-process cosine fallback
- [x] 3.4 Implement Reciprocal Rank Fusion over keyword and vector candidate lists with confidence-aware filtering
- [x] 3.5 Implement recall logging for retrieval mode, candidate counts, selected results, omitted results, and token estimates

## 4. Prompt assembly and tools

- [x] 4.1 Implement pinned-memory and recalled-memory sections in prompt assembly with omission metadata
- [x] 4.2 Update memory context budgeting to apply confidence thresholds before injecting recalled memories
- [x] 4.3 Implement `memory_search` on top of the shared recall substrate with compact ranked results
- [x] 4.4 Update `memory_get` to return canonical memory records and metadata from the shared recall substrate

## 5. Verification and rollout

- [x] 5.1 Add unit tests for chunking, cache invalidation, exact retrieval, keyword retrieval, vector fallback, and RRF fusion
- [x] 5.2 Add integration tests for automatic recall budgeting, pinned-memory inclusion, omission reporting, and explicit search behavior
- [x] 5.3 Run migrations, backfill/reindex on sample memory data, and verify keyword-only fallback works when vector retrieval is disabled
