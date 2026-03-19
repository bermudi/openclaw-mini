## Why

The dashboard exists (~1280 lines in `page.tsx`) with tabs for agents, tasks, triggers, audit, tools, and live events — but it's a single monolithic component with no real-time updates wired to actual data flow, no session/memory visibility, no workspace file editor, and no conversation view. The WS service broadcasts events but the dashboard doesn't react to them to update state. The dashboard is the primary way an operator understands what their agents are doing, and right now it's a static snapshot that requires manual refresh.

## What Changes

- **Real-time state sync**: Wire WS events (`task:created`, `task:completed`, `agent:status`, etc.) to actually update dashboard state instead of just appending to the events log
- **Conversation view**: Add a session inspector that shows the conversation history for any agent session — the messages, which channel they came from, and timestamps
- **Workspace editor**: Inline editor for workspace files (IDENTITY.md, SOUL.md, USER.md, AGENTS.md, etc.) using the existing `/api/workspace` endpoints
- **Memory browser**: View and edit agent memories, see the history log, browse memory files
- **Component decomposition**: Break the monolithic `page.tsx` into focused components (AgentCard, TaskList, TriggerPanel, etc.) for maintainability
- **Task detail view**: Expand a task to see its full payload, tool calls, result, and delivery status

## Capabilities

### New Capabilities
- `dashboard-realtime`: WebSocket-driven live updates that reflect agent activity in real-time without manual refresh
- `dashboard-sessions`: Session inspector showing conversation history, channel tags, and context metadata
- `dashboard-workspace`: Inline workspace file browser and editor with live preview

### Modified Capabilities

## Impact

- **Files**: `src/app/page.tsx` (decompose), new components in `src/components/`, `src/hooks/` for WS integration
- **Dependencies**: No new external dependencies — uses existing shadcn/ui, socket.io-client, and Next.js
- **APIs**: May add `/api/sessions/:agentId` for session listing, existing workspace and memory APIs are sufficient
- **Schema**: No schema changes
