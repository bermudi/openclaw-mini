## 1. Git Operations Module

- [x] 1.1 Create `src/lib/services/memory-git.ts` with a `MemoryGit` class that wraps git CLI operations: `init()`, `add(file)`, `commit(message)`, `log(path?, limit?)`, `show(sha, path)`. Use `Bun.spawn` or `child_process.execFile` to call `git`. All methods return typed results (e.g., `GitCommit { sha, timestamp, message }`).
- [x] 1.2 Add a static `isAvailable()` method to `MemoryGit` that checks if `git` is on PATH by running `git --version`. Cache the result. If `GIT_MEMORY_ENABLED=false`, return false without checking.
- [x] 1.3 Add error handling: wrap all git operations in try/catch, log errors, and return gracefully (e.g., `log()` returns empty array on failure, `commit()` is a no-op on failure).

## 2. Memory Key Validation & Paths

- [x] 2.1 Add a `validateMemoryKey(key: string): boolean` function to `memory-service.ts` (or a shared util) that rejects keys with `..`, leading/trailing `/`, consecutive `//`, or characters outside `[a-zA-Z0-9/_-]`
- [x] 2.2 Update `saveToFile()` in `memory-service.ts` to create intermediate directories for path-based keys (e.g., `system/preferences` → `data/memories/{agentId}/system/preferences.md`)
- [x] 2.3 Update `deleteFile()` to handle path-based keys and clean up empty parent directories after deletion
- [x] 2.4 Update `initializeAgentMemory()` to use the new default keys: `system/preferences`, `system/history`, `agent/context`
- [x] 2.5 Update `appendHistory()` to use key `system/history` instead of `history`
- [x] 2.6 Update `updateContext()` to use key `agent/context` instead of `context`

## 3. Git Integration in MemoryService

- [x] 3.1 Initialize `MemoryGit` instance in the `MemoryService` constructor (lazy — only when first write happens and `MemoryGit.isAvailable()` is true)
- [x] 3.2 Update `saveToFile()` to call `git.add(filePath)` and `git.commit(message)` after writing the file. Determine action (Create/Update) by checking if the file existed before write.
- [x] 3.3 Update `deleteFile()` to call `git.add(filePath)` and `git.commit("Delete {key}")` after deletion
- [x] 3.4 Update `appendHistoryArchive()` to commit archive file creation with message `Archive system/history to history/{date}`

## 4. History API

- [x] 4.1 Add `getMemoryHistory(agentId, key?, limit?)` method to `MemoryService` that delegates to `MemoryGit.log()`
- [x] 4.2 Add `getMemoryAtCommit(agentId, key, sha)` method to `MemoryService` that delegates to `MemoryGit.show()`
- [x] 4.3 Create `src/app/api/agents/[id]/memory/history/route.ts` — `GET` handler that returns commit history as JSON, with optional `key` and `limit` query params
- [x] 4.4 Create `src/app/api/agents/[id]/memory/[key]/at/[sha]/route.ts` — `GET` handler that returns memory content at a specific commit

## 5. Migration

- [x] 5.1 Create `scripts/migrate-memory-keys.ts` that: queries all Memory rows, renames flat keys to path-based equivalents (`preferences` → `system/preferences`, `history` → `system/history`, `context` → `agent/context`), skips keys already containing `/`, and moves corresponding files
- [x] 5.2 After file migration, initialize git repos for each agent directory and create initial commit with all existing files
- [x] 5.3 Make the migration idempotent — running it multiple times produces no additional changes

## 6. Testing

- [x] 6.1 Write unit tests for `MemoryGit`: `init` creates a repo, `commit` creates a commit, `log` returns history, `show` returns file content at commit, `isAvailable` returns false when git is missing
- [x] 6.2 Write unit tests for key validation: valid keys accepted, path traversal rejected, empty segments rejected, special characters rejected
- [x] 6.3 Write integration tests for `MemoryService`: `setMemory` with path-based key creates nested file and git commit, `deleteMemory` creates delete commit, `appendHistory` uses `system/history` key
- [x] 6.4 Write tests for history API endpoints: returns commit history, returns memory at past commit, returns 404 for non-existent key/commit
- [x] 6.5 Write tests for graceful degradation: all operations succeed when git is unavailable, no git operations when `GIT_MEMORY_ENABLED=false`
