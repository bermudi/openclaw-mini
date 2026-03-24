# memory-indexing Specification

## Purpose
TBD - created by archiving change hybrid-memory-recall. Update Purpose after archive.
## Requirements
### Requirement: Canonical memories produce searchable units
The indexing subsystem SHALL derive searchable units from canonical memory records. Memories whose normalized content is below a configurable chunking threshold SHALL produce a single searchable unit; longer memories SHALL be split into overlapping chunks that retain a reference to the canonical memory key.

#### Scenario: Short memory remains a single searchable unit
- **WHEN** a memory value is shorter than the chunking threshold
- **THEN** indexing SHALL create one searchable unit linked to the canonical memory record

#### Scenario: Long memory is chunked with parent linkage
- **WHEN** a memory value exceeds the chunking threshold
- **THEN** indexing SHALL create multiple overlapping searchable chunks that each retain a link to the canonical memory key

### Requirement: Indexed memories support keyword and vector retrieval
The indexing subsystem SHALL maintain a SQLite full-text index over searchable units and SHALL store embeddings plus associated metadata for vector retrieval. If optimized SQLite vector indexing is enabled, the system SHALL update that index; otherwise the stored embeddings SHALL remain available for in-process similarity search.

#### Scenario: Keyword retrieval uses the SQLite text index
- **WHEN** a search query matches indexed memory text
- **THEN** the system SHALL be able to return keyword candidates from the SQLite full-text index

#### Scenario: Vector retrieval falls back without optimized index support
- **WHEN** vector retrieval is enabled but the optimized SQLite vector index is unavailable
- **THEN** the system SHALL use stored embeddings for in-process similarity search instead of failing recall

### Requirement: Embeddings are provider-scoped and cacheable
The system SHALL record embedding provider, model, dimension, content hash, and embedding generation version for each generated embedding. The system SHALL reuse cached embeddings when the content hash and provider metadata match.

#### Scenario: Cached embedding reused for unchanged content
- **WHEN** a memory chunk is reindexed with the same normalized content, provider, and model
- **THEN** the system SHALL reuse the cached embedding instead of requesting a new one

#### Scenario: Provider or model change invalidates cache reuse
- **WHEN** the configured embedding provider, model, or dimension changes for an indexed memory chunk
- **THEN** the system SHALL treat the chunk as requiring a new embedding

### Requirement: Indexing is asynchronous and recoverable
Updates to canonical memories SHALL mark corresponding searchable units as stale and schedule reindexing without blocking the canonical memory write path. The system SHALL also provide a reindex operation that rebuilds the searchable index from canonical memories.

#### Scenario: Memory write succeeds while indexing is pending
- **WHEN** a canonical memory is created or updated and background indexing has not completed yet
- **THEN** the canonical write SHALL succeed and the memory SHALL be marked for later reindexing

#### Scenario: Reindex rebuilds searchable state from canonical memories
- **WHEN** a reindex operation is invoked after index drift or configuration changes
- **THEN** the system SHALL rebuild searchable units and associated index state from canonical memory records

