## Context

Our memory system uses Prisma with SQLite. Memories have: `agentId`, `key` (hierarchical path like `user/name`), `value` (markdown text), `category`, `confidence` (0.0-1.0), and `lastReinforcedAt`. The `memoryService` already provides `getAgentMemories(agentId, category?)` which fetches all non-archived memories sorted by confidence.

Agents currently interact with memory via `read_file` (exact filename match in the filesystem) and `write_note` (creates a new markdown file). These tools bypass the database and confidence system entirely. We need tools that use the proper memory service API.

## Goals / Non-Goals

**Goals:**
- A `memory_search` tool that finds memories by keyword across keys and values
- A `memory_get` tool that retrieves a specific memory by key with full metadata
- Results sorted by confidence, limited to prevent context bloat
- Compact result format: key, snippet, confidence, category

**Non-Goals:**
- Vector/semantic search (would require an embedding model and vector store — way too heavy for lightweight runtime)
- Fuzzy matching or typo tolerance (Prisma `contains` is exact substring match, which is fine)
- Search across multiple agents (each agent searches its own memories only)
- Full-text search index (SQLite FTS5 would be an optimization for large memory stores — premature now)

## Decisions

### 1. Prisma `contains` for search

Use Prisma's `contains` filter on both `key` and `value` fields with `mode: 'insensitive'`. This generates `LIKE '%query%'` in SQLite which is adequate for personal assistant scale.

**Why not SQLite FTS5?** Requires raw SQL, schema changes, and index maintenance. For hundreds to low thousands of memories per agent, `LIKE` is fast enough.

**Upgrade path:** If memory stores grow large, we can add FTS5 behind the same `searchMemories()` method signature.

### 2. Snippet extraction instead of full values

Search results return the first ~200 characters of the value plus an indicator if truncated. The agent can then use `memory_get` to fetch the full value for specific keys it cares about.

**Why?** A search returning 20 full memory values could be thousands of tokens. Snippets give the agent enough to decide relevance.

### 3. Two tools, not one

`memory_search(query)` for discovery, `memory_get(key)` for retrieval. Mirrors the `mcp_list` / `mcp_call` pattern.

**Why not combine?** The agent often needs to browse first ("what do I know about the user?") then retrieve specific entries. Two tools gives it a natural workflow.

### 4. memory_get replaces read_file for memory access

`memory_get` reads from the database (with confidence, category, metadata) rather than the filesystem. This is the correct interface — the DB is the source of truth, files are persistence backups.

**Why not deprecate read_file?** `read_file` still has value for reading arbitrary files in the memory directory that aren't DB-backed memories (e.g., manually placed files). We leave both available.

## Risks / Trade-offs

- **SQLite LIKE is O(n) scan** → Acceptable at personal assistant scale. Revisit with FTS5 if agents accumulate 10K+ memories
- **Case-insensitive search in SQLite** → Prisma's `mode: 'insensitive'` works with SQLite's built-in case folding (ASCII only). Non-ASCII case folding won't work. Acceptable for now
- **No ranking beyond confidence** → Results are sorted by confidence, not by search relevance. For keyword search this is fine — the agent can scan a short list
