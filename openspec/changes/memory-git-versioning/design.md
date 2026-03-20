## Context

Agent memory is stored in two places: SQLite via Prisma (source of truth for reads) and Markdown files in `data/memories/{agentId}/{key}.md` (human-readable mirror). The `MemoryService.saveToFile()` writes files on every `setMemory()` call, and `deleteFile()` removes them. History rotation already creates dated archive files in `data/memories/{agentId}/history/`. Keys are flat strings: `preferences`, `history`, `context`.

Letta's approach is the gold standard here: they use real git repos with the `git` CLI, store blocks as Markdown with YAML frontmatter, and use PostgreSQL as a read cache. We can adopt the core idea (git-backed memory files) while skipping the complexity they need for cloud deployment (object storage, Redis locks, delta uploads, memfs microservice). Our local-first, single-process architecture means a simple `git` CLI wrapper is sufficient.

## Goals / Non-Goals

**Goals:**
- Every memory mutation creates a git commit with a meaningful message
- Agents (and users) can view memory history and read memory at any prior commit
- Memory keys become hierarchical paths for better organization
- Existing agents are migrated transparently (flat keys → path-based keys)

**Non-Goals:**
- Cloud/remote git storage (no pushing to GitHub, no object storage backends)
- Branching or merging (single linear history per agent)
- Git-level conflict resolution (sequential task queue prevents concurrent writes)
- YAML frontmatter on memory files (unnecessary complexity for our use case — the category/confidence metadata lives in SQLite)
- Embedding git history in the agent's system prompt (agents don't need to know about versioning — it's an infrastructure concern)

## Decisions

### 1. Use `git` CLI via child_process, not a JS git library

**Decision:** Shell out to `git` using `Bun.spawn` / `child_process.execFile` for all git operations. Wrap in a thin `MemoryGit` class.

**Alternatives considered:**
- *isomorphic-git*: Pure JS, no system dependency. But adds ~2MB to node_modules, has incomplete git feature support, and is slower than native git for our simple use case.
- *simple-git*: Node.js wrapper around git CLI. Adds a dependency for something we can do in ~80 lines of code.

**Rationale:** Same approach Letta uses. `git` is universally available on our target environments (Linux/macOS). Our operations are trivial (init, add, commit, log, show) — no need for a library abstraction. If `git` is not found at startup, disable versioning gracefully and log a warning.

### 2. One git repo per agent, initialized lazily

**Decision:** Each agent's memory directory (`data/memories/{agentId}/`) becomes an independent git repo. The repo is initialized on the first write if it doesn't exist yet.

**Alternatives considered:**
- *Single repo for all agents*: Simpler setup, but creates massive commit histories, makes per-agent operations slow, and couples agent lifecycles.
- *Repo initialized at agent creation*: Eager init, but wastes resources for agents that may never write memory.

**Rationale:** Lazy init means zero cost for agents that haven't written memory yet. Per-agent repos keep histories independent and make deletion trivial (`rm -rf`).

### 3. Hierarchical paths with `/` separator, stored as nested directories

**Decision:** Memory keys become path-like strings: `system/preferences`, `system/history`, `agent/context`. The file is stored at `data/memories/{agentId}/{key}.md`. Directories are created automatically.

**Migration mapping:**
| Old Key | New Key |
|---------|---------|
| `preferences` | `system/preferences` |
| `history` | `system/history` |
| `context` | `agent/context` |

**Alternatives considered:**
- *Flat keys with convention* (e.g., `system.preferences`): No filesystem benefit, just a naming convention.
- *Free-form paths with no prefix requirements*: Harder to enforce structure.

**Rationale:** Actual directories mirror the key hierarchy. `ls data/memories/agent_main/system/` immediately shows all system-level memories. Matches Letta's `system/human`, `system/persona` pattern.

### 4. Commit messages are structured and automatic

**Decision:** Every `setMemory()` call generates a commit message in the format: `{action} {key}` (e.g., "Update system/preferences", "Create agent/context", "Delete system/history"). History appends use: `Append system/history`. Archive rotations use: `Archive system/history to history/2026-03-20`.

**Rationale:** Structured messages make `git log` output immediately useful without needing to parse diffs. Keeps it simple — no user-facing commit message customization.

### 5. History API uses `git log` and `git show`

**Decision:** Two new API routes:
- `GET /api/agents/:id/memory/history?key=system/preferences&limit=20` → runs `git log --format="%H|%at|%s" -n20 -- {key}.md`
- `GET /api/agents/:id/memory/:key/at/:sha` → runs `git show {sha}:{key}.md`

**Rationale:** Direct git CLI queries, no caching layer needed. These are read-only debugging/audit operations, not hot paths.

### 6. Migration: rename keys in DB, move files, initial commit

**Decision:** A one-time migration script:
1. For each agent with memories, rename keys in the `Memory` table (e.g., `preferences` → `system/preferences`)
2. Move files from `{key}.md` to `{new_key}.md` (creating subdirectories as needed)
3. Initialize git repo and create initial commit with all existing files

The migration is idempotent — if a key already has a `/` separator, it's skipped.

**Rationale:** Clean break from flat keys. The migration is offline-safe (run before starting the app after upgrade).

## Risks / Trade-offs

- **[git not installed]** → Graceful degradation: if `git` is not found on PATH at startup, log a warning and disable versioning. All memory operations continue working normally, just without commits. A `GIT_MEMORY_ENABLED` env var allows explicit opt-out.
- **[Disk usage growth]** → Git repos grow with history. For text-only Markdown files with typical agent usage, this is negligible (months of daily updates ≈ a few MB). If needed in the future, `git gc` can be run periodically.
- **[Performance overhead]** → Each `saveToFile()` adds a `git add + git commit` (~10-50ms). Since writes go through the sequential task queue, this doesn't affect latency meaningfully. The git operations are fire-and-forget from the caller's perspective.
- **[Migration data loss]** → The migration script is idempotent and non-destructive (old files are moved, not deleted). If interrupted, re-running completes the remaining work.
