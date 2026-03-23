## 1. Memory search method

- [ ] 1.1 Add `searchMemories(agentId: string, query: string, limit?: number)` method to `MemoryService` in `src/lib/services/memory-service.ts` — query both `key` and `value` fields using Prisma `contains` with `mode: 'insensitive'`, exclude `archived` category, order by `confidence` desc, limit to `limit ?? 20`
- [ ] 1.2 Map results to compact format: `{ key, snippet (first 200 chars + "..." if truncated), confidence, category }`
- [ ] 1.3 Write unit tests: search by value match, search by key match, no matches, confidence ordering, archived exclusion, limit enforcement, snippet truncation

## 2. Register memory_search tool

- [ ] 2.1 Register `memory_search` tool in `src/lib/tools.ts` with input schema `{ agentId: z.string(), query: z.string(), limit: z.number().int().positive().max(50).optional() }`, risk level `low`
- [ ] 2.2 Execute calls `memoryService.searchMemories(agentId, query, limit)` and returns results
- [ ] 2.3 Write unit test: tool returns compact results from memory service

## 3. Register memory_get tool

- [ ] 3.1 Register `memory_get` tool in `src/lib/tools.ts` with input schema `{ agentId: z.string(), key: z.string() }`, risk level `low`
- [ ] 3.2 Execute calls `memoryService.getMemory(agentId, key)` — return full value, confidence, category, timestamps on success; return error on not found
- [ ] 3.3 Write unit test: get existing memory, get nonexistent memory
