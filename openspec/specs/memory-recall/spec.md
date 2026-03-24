# memory-recall Specification

## Purpose
TBD - created by archiving change hybrid-memory-recall. Update Purpose after archive.
## Requirements
### Requirement: Hybrid memory recall for prompt assembly
The system SHALL provide a memory recall service that assembles turn-specific memory candidates from pinned memory, exact key matches, keyword retrieval over indexed memory text, and vector similarity over embedded memory chunks. When both keyword and vector candidate lists are available, the service SHALL combine them using Reciprocal Rank Fusion before prompt-budget filtering is applied.

#### Scenario: Hybrid recall fuses keyword and vector candidates
- **WHEN** a turn has both FTS candidates and vector candidates available for recall
- **THEN** the recall service SHALL combine the ranked lists with Reciprocal Rank Fusion and return a single ranked candidate set before budget filtering

#### Scenario: Recall falls back when vector retrieval is unavailable
- **WHEN** embeddings are disabled, unavailable, or the vector retrieval path fails
- **THEN** the recall service SHALL continue using pinned memory, exact matches, and keyword retrieval without failing prompt assembly

### Requirement: Exact memory retrieval returns canonical memory records
The system SHALL provide exact memory retrieval by hierarchical key against the canonical memory store. Exact retrieval SHALL return the full canonical memory value and metadata even when the memory has derived search chunks or indexed embeddings.

#### Scenario: Exact retrieval returns full memory for a chunked record
- **WHEN** `memory_get` is called for a memory key whose value has been split into multiple indexed chunks
- **THEN** the system SHALL return the full canonical memory record rather than only the matching chunk text

#### Scenario: Exact retrieval handles missing keys without index scans
- **WHEN** `memory_get` is called for a memory key that does not exist
- **THEN** the system SHALL return a not-found result without requiring hybrid search over the recall index

### Requirement: Explicit memory search uses the shared recall substrate
The system SHALL provide a `memory_search` operation that uses the same retrieval substrate as automatic recall and returns compact ranked results linked to canonical memory keys. Each result SHALL include a snippet, confidence, category, retrieval method, and ranking score.

#### Scenario: Search returns compact results tied to canonical memory keys
- **WHEN** `memory_search` finds a matching indexed chunk
- **THEN** the result SHALL include the parent memory key and a compact snippet instead of the full memory value

#### Scenario: Search and recall use consistent retrieval behavior
- **WHEN** automatic recall and explicit `memory_search` are executed for similar queries under the same index state
- **THEN** both operations SHALL draw candidates from the same exact, keyword, and vector retrieval substrate

### Requirement: Recall operations are observable
The system SHALL persist a recall log entry for each automatic recall and explicit memory search. Each log entry SHALL record the retrieval mode, candidate counts by method, selected count, omitted count, and estimated token usage.

#### Scenario: Automatic recall logs omitted memories
- **WHEN** automatic recall selects memories under a bounded token budget and omits additional candidates
- **THEN** the system SHALL record the selected count, omitted count, and estimated token usage in the recall log

#### Scenario: Explicit search logs retrieval path
- **WHEN** `memory_search` completes using keyword-only fallback or hybrid retrieval
- **THEN** the recall log SHALL record which retrieval methods contributed candidates to the result set

