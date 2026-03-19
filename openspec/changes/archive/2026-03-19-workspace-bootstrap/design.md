## Context

The agent's persona and behavior are currently defined by a hardcoded string in `AgentExecutor.getSystemPrompt()`. This is inflexible — changing the agent's personality or rules requires editing source code. The original OpenClaw uses plain Markdown files on disk (`SOUL.md`, `AGENTS.md`, `USER.md`, etc.) that are read at prompt-build time. This is simple, version-controllable, and editable without restarts.

The current system prompt in `agent-executor.ts` is ~15 lines of generic instructions. It will be replaced with content loaded from workspace files.

## Goals / Non-Goals

**Goals:**
- Agent persona, instructions, and user context are configurable via Markdown files
- Files are read at prompt-build time (no caching needed — these are small files read per-request)
- Per-file and total character caps prevent blowing up the context window
- First boot creates sensible defaults so the system works out of the box
- Dashboard can edit workspace files via API

**Non-Goals:**
- Per-agent workspaces (each agent having its own set of files) — for now, one global workspace. Per-agent workspaces can be added when the multi-agent use case demands it
- File watching or hot-reload notifications — files are read fresh each time, no watcher needed
- Workspace versioning or git integration — users can git-track `data/workspace/` themselves
- Canvas files or other non-bootstrap workspace content

## Decisions

### 1. Workspace location: `data/workspace/`

**Choice**: `data/workspace/` in the project root, following the existing `data/` convention (where `data/memories/` already lives).

**Alternatives considered**:
- Project root (alongside `src/`): pollutes the repo root with runtime config files
- `~/.openclaw/workspace/`: hidden, harder to discover and edit
- Per-agent directories (`data/workspace/<agentId>/`): premature — we have one main agent for now

### 2. Read on every request, no caching

**Choice**: Read workspace files synchronously on each `getSystemPrompt()` call. No caching.

**Rationale**: These are small files (< 20KB each) on local disk. `fs.readFileSync` for 5-6 small files is sub-millisecond. Caching adds complexity (invalidation, TTL) for zero measurable gain. The user edits a file, the next message picks it up — zero-delay feedback loop.

**Alternatives considered**:
- In-memory cache with TTL: unnecessary complexity for tiny files
- File watcher (`fs.watch`): fragile across platforms, not worth it

### 3. Ordered injection with caps

**Choice**: Bootstrap files are injected in a fixed order (IDENTITY → SOUL → USER → AGENTS → TOOLS → MEMORY) with a per-file cap of 20,000 characters and a total cap of 150,000 characters. If a file exceeds the per-file cap, it's truncated with a notice. If total exceeds the cap, remaining files are skipped.

**Rationale**: Matches the original OpenClaw's approach. Order matters — identity and persona come first (highest priority context), operational notes last. Caps are generous defaults that prevent a user from accidentally stuffing 500KB into MEMORY.md and blowing the context window.

### 4. HEARTBEAT.md is task-type-gated

**Choice**: `HEARTBEAT.md` is only injected when the task type is `heartbeat`. It's not part of the regular bootstrap sequence.

**Rationale**: Heartbeat checklists ("check email, review calendar, update notes") are irrelevant noise for regular message handling. Keeping them separate matches the original OpenClaw's design.

## Risks / Trade-offs

**[Synchronous file reads on every request]** → Acceptable for local filesystem with small files. Would need revisiting if workspace files were on network storage. Mitigation: files are capped at 20KB each.

**[Single global workspace, not per-agent]** → If a user creates a second agent with different persona needs, they'd need per-agent workspaces. Mitigation: defer to when multi-agent actually matters. The `agent-architecture` change establishes one default agent as the primary model.

**[No validation of file content]** → A malformed `SOUL.md` (e.g., prompt injection) could alter agent behavior. Mitigation: these are local files on the user's own machine — they're the admin. This is by design, not a vulnerability.
