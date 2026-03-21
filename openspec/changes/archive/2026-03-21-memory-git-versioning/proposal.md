## Why

Agent memory is mutable and overwrites itself — when a preference updates or context shifts, the previous state is lost forever. There's no way to understand *how* an agent's understanding evolved, debug regressions in agent behavior, or recover accidentally overwritten memories. Letta (letta-ai/letta) demonstrated that tracking memory as git commits gives you time-travel, diffs, and full auditability essentially for free. Combined with hierarchical paths (inspired by IronClaw and Letta's `system/human`, `system/persona` pattern), this makes memory organization intuitive and scalable.

## What Changes

- **Git-backed memory files**: Initialize a git repo inside each agent's `data/memories/{agentId}/` directory. Every call to `saveToFile()` becomes a `git add + git commit` with a descriptive message (e.g., "Update preferences", "Append history entry").
- **Hierarchical memory paths**: Replace flat keys (`preferences`, `history`, `context`) with path-based keys (`system/preferences`, `system/history`, `agent/context`). Memory files are stored at `{key}.md` relative to the agent's memory directory, enabling natural directory grouping.
- **Memory history API**: New endpoints to view commit log and read memory at a specific point in time (time-travel reads).
- **Dashboard integration**: Memory timeline view showing how memory evolved, with diff visualization.

## Capabilities

### New Capabilities
- `memory-versioning`: Git-backed versioning of agent memory files — commit on every write, history retrieval, time-travel reads, and diff viewing
- `memory-paths`: Hierarchical path-based memory keys replacing flat keys, with directory-based organization

### Modified Capabilities
- `memory-rotation`: Archive files will also be committed to the git repo, making rotation history auditable

## Impact

- **Files**: `src/lib/services/memory-service.ts` (git operations on write), new `src/lib/services/memory-git.ts` (git wrapper), memory API routes
- **Dependencies**: None — uses `git` CLI directly (same approach as Letta), no library needed
- **Schema**: `Memory.key` values change from flat to path-based (migration needed for existing data)
- **APIs**: New `GET /api/agents/:id/memory/history` and `GET /api/agents/:id/memory/:key/at/:sha` endpoints
- **Infrastructure**: Requires `git` available on the host (standard on all target environments)
