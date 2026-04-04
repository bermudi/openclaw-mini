## MODIFIED Requirements

### Requirement: Indexed memories support keyword and vector retrieval
The indexing subsystem SHALL maintain a SQLite full-text index over searchable units as the default retrieval path. Vector retrieval SHALL only run when a real embedding provider is configured; the system SHALL NOT generate pseudo-semantic embeddings from hashing or other placeholder techniques.

#### Scenario: Default retrieval uses SQLite text index only
- **WHEN** memory indexing runs with embeddings disabled or unconfigured
- **THEN** the system SHALL update the SQLite full-text index and SHALL NOT generate placeholder embeddings

#### Scenario: Real embedding provider enables vector retrieval
- **WHEN** a real embedding provider is configured for memory indexing
- **THEN** the system MAY generate embeddings and use vector retrieval in addition to keyword retrieval

### Requirement: Embeddings are provider-scoped and cacheable
The system SHALL record embedding provider, model, dimension, content hash, and embedding generation version for each generated embedding. No embedding cache entry SHALL be created when embeddings are disabled.

#### Scenario: Cached embedding reused for unchanged content
- **WHEN** a memory chunk is reindexed with the same normalized content, provider, and model
- **THEN** the system SHALL reuse the cached embedding instead of requesting a new one

#### Scenario: Disabled embeddings skip cache writes
- **WHEN** embeddings are disabled for memory indexing
- **THEN** the system SHALL skip embedding generation and SHALL NOT create cache entries for placeholder vectors
