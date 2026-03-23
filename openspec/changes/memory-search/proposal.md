## Why

Our memory system stores facts in the database and markdown files, but agents can only read specific files by exact name (`read_file`) or list all files (`list_files`). There's no way to **search** across memories. An agent that's accumulated hundreds of facts can't find the one it needs without guessing the filename.

NanoBot solves this with a two-layer approach: grep-searchable history + fact lookup. We already have the building blocks — `memory-service.ts` with DB-backed memories, `memory-reflector.ts` for extracted facts, confidence scoring, and hierarchical keys. We just need a search tool on top.

## What Changes

- Add a `memory_search` tool that searches across an agent's memories by keyword (case-insensitive text match against keys and values in the database)
- Add a `memory_get` tool that reads a specific memory by key (more precise than `read_file`, works with the DB + confidence system)
- Results include the memory key, a snippet of the value, confidence score, and category — giving the agent enough context to decide what's relevant
- Results are sorted by confidence (highest first) and limited to prevent context bloat

## Capabilities

### New Capabilities

- `memory-search`: Keyword search across agent memories with confidence-aware ranking and compact result format

### Modified Capabilities

_(none — we're adding tools that use the existing memory service API, not changing memory behavior)_

## Impact

- **Tools**: Two new tools registered (`memory_search`, `memory_get`)
- **Code**: Search logic added to `src/lib/services/memory-service.ts`; tool registration in `src/lib/tools.ts`
- **Dependencies**: None — uses existing Prisma queries with `contains` filter
- **Performance**: Database queries with `LIKE` — fine for personal assistant scale (hundreds to low thousands of memories per agent)
