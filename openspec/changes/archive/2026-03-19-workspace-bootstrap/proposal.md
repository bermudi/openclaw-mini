## Why

The agent's system prompt is currently a generic hardcoded string in `agent-executor.ts`. There's no way to configure the agent's persona, instructions, or user context without changing source code. The original OpenClaw solves this with workspace bootstrap files — plain Markdown files on disk that are read at session start and injected into the system prompt. This gives users full control over agent behavior through simple file editing.

## What Changes

- **Workspace directory**: A `data/workspace/` directory holds Markdown files that define the agent's identity, persona, instructions, and long-term memory
- **Bootstrap file loading**: A new `workspace-service` reads bootstrap files at prompt-build time, trims them to per-file and total character caps, and returns formatted prompt sections
- **System prompt rewrite**: `AgentExecutor.getSystemPrompt()` replaces its hardcoded persona with content from workspace files. The persona comes from `SOUL.md`, instructions from `AGENTS.md`, user context from `USER.md`
- **Heartbeat-specific context**: `HEARTBEAT.md` is only injected for heartbeat tasks, providing a checklist for maintenance runs
- **First-boot initialization**: On first startup with an empty workspace, sensible default files are created
- **Workspace API**: Endpoints for listing, reading, and updating workspace files so the dashboard can edit them

## Capabilities

### New Capabilities
- `workspace-bootstrap`: Loading, capping, and injecting workspace Markdown files into the agent system prompt

### Modified Capabilities

## Impact

- **AgentExecutor**: `getSystemPrompt()` and `buildPrompt()` rewritten to use workspace context instead of hardcoded strings
- **New service**: `src/lib/services/workspace-service.ts`
- **New API**: `/api/workspace` endpoints for CRUD on workspace files
- **Filesystem**: `data/workspace/` directory with default `.md` files
- **No schema changes**: This is purely a system prompt concern, no DB migrations
