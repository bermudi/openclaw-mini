# memory-search Specification

## ADDED Requirements

### Requirement: memory_search tool
The system SHALL register a `memory_search` tool that searches an agent's memories by keyword.

#### Scenario: Search by keyword
- **GIVEN** agent `main` has memories with keys `user/name` (value: "Alice prefers concise answers") and `user/timezone` (value: "UTC+2, Berlin")
- **WHEN** the agent calls `memory_search` with `query: "alice"`
- **THEN** the tool SHALL return the `user/name` memory as a match (case-insensitive substring match on value)

#### Scenario: Search matches keys and values
- **GIVEN** agent `main` has a memory with key `project/deadlines` and value "Sprint ends Friday"
- **WHEN** the agent calls `memory_search` with `query: "project"`
- **THEN** the tool SHALL return the memory (matched on key)

#### Scenario: Search with no matches
- **WHEN** the agent calls `memory_search` with `query: "xyznonexistent"`
- **THEN** the tool SHALL return `{ success: true, data: { results: [], query: "xyznonexistent" } }`

#### Scenario: Results sorted by confidence
- **GIVEN** agent `main` has matching memories with confidences 0.9, 0.5, and 1.0
- **WHEN** `memory_search` returns results
- **THEN** results SHALL be ordered: confidence 1.0 first, 0.9 second, 0.5 third

#### Scenario: Results limited to prevent context bloat
- **GIVEN** agent `main` has 50 memories matching the query
- **WHEN** `memory_search` is called without a `limit` parameter
- **THEN** at most 20 results SHALL be returned

#### Scenario: Custom result limit
- **WHEN** the agent calls `memory_search` with `query: "user"` and `limit: 5`
- **THEN** at most 5 results SHALL be returned

#### Scenario: Archived memories excluded
- **GIVEN** a memory has `category: "archived"` (soft-deleted via confidence decay)
- **WHEN** `memory_search` runs
- **THEN** archived memories SHALL NOT appear in results

### Requirement: Compact search result format
Each search result SHALL include the memory key, a snippet of the value (first 200 characters), the confidence score, and the category.

#### Scenario: Snippet truncation
- **GIVEN** a matching memory has a value of 500 characters
- **WHEN** it appears in search results
- **THEN** the snippet SHALL be the first 200 characters followed by "..."

#### Scenario: Short value not truncated
- **GIVEN** a matching memory has a value of 50 characters
- **WHEN** it appears in search results
- **THEN** the full value SHALL be returned without truncation

### Requirement: memory_get tool
The system SHALL register a `memory_get` tool that retrieves a specific memory by exact key.

#### Scenario: Get existing memory
- **GIVEN** agent `main` has a memory with key `user/name`
- **WHEN** the agent calls `memory_get` with `key: "user/name"`
- **THEN** the tool SHALL return the full memory value, confidence, category, and timestamps

#### Scenario: Get nonexistent memory
- **WHEN** the agent calls `memory_get` with `key: "nonexistent/key"`
- **THEN** the tool SHALL return `{ success: false, error: "Memory not found: nonexistent/key" }`

#### Scenario: Get returns full value (no truncation)
- **GIVEN** a memory has a 5000-character value
- **WHEN** `memory_get` retrieves it
- **THEN** the complete value SHALL be returned
