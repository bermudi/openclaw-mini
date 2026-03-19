# build-dashboard Design

## Context

The dashboard exists as a single 1282-line `src/app/page.tsx` component with tabs for agents, tasks, triggers, audit, tools, and live events. It fetches data via polling (`/api/agents`, `/api/tasks`, `/api/triggers`, `/api/audit`, `/api/tools`) and connects to the WS service at `ws://localhost:3003` using raw WebSocket. However, WS events are only appended to an in-memory events log — they do not update agent, task, or trigger state. The page calls `fetchData()` on certain event types, which is a full refetch rather than a targeted update.

There is no session viewer (the `SessionService.getAgentSessions` method exists but is not exposed in the dashboard), no workspace file editor (the `/api/workspace` GET/PUT endpoints exist but the dashboard doesn't use them), and no memory browser (the `MemoryService.getAgentMemories` method exists with no dashboard surface).

The monolithic component holds ~20 `useState` calls, multiple dialog states, and all rendering logic inline.

## Goals

- **Real-time reactivity**: Wire WS events (`task:created`, `task:completed`, `agent:status`, etc.) to update dashboard state in-place instead of refetching or only appending to the events log.
- **Session inspector**: Add a panel that lists sessions for a selected agent and shows the conversation thread with channel tags and timestamps.
- **Workspace editor**: Inline file browser and editor for workspace files (`IDENTITY.md`, `SOUL.md`, etc.) using the existing `/api/workspace` endpoints.
- **Component decomposition**: Break `page.tsx` into focused components in `src/components/dashboard/` for maintainability.

## Non-Goals

- Mobile-responsive design.
- Dark/light theme toggle.
- User auth/RBAC for the dashboard.
- Drag-and-drop agent builder.

## Decisions

### 1. Component decomposition

Break `page.tsx` into individual components in `src/components/dashboard/`:

| Component | Responsibility |
|---|---|
| `AgentCard` | Single agent display with status badge, skills, actions |
| `TaskList` | Filterable task table with status, type icons, expandable detail |
| `TriggerPanel` | Trigger list with enable/disable toggles, create dialog |
| `AuditLog` | Scrollable audit log with severity badges |
| `EventStream` | Live WS event stream (current "Live Events" tab) |
| `SessionInspector` | Session list per agent + conversation thread view |
| `WorkspaceEditor` | File list + content editor with save |
| `MemoryBrowser` | Memory list per agent with category filter |

The root `page.tsx` becomes a thin shell: tab navigation, shared state (selected agent, connection status), and data fetching orchestration. Shared types move to `src/lib/types/dashboard.ts` or stay in `src/lib/types.ts`.

### 2. Real-time hook

Create a `useOpenClawEvents` hook in `src/hooks/use-openclaw-events.ts` that:

- Connects to the WS service via `socket.io-client` (the WS service is a socket.io server — the current raw WebSocket approach requires manual protocol handling).
- Joins the `admin` room via `subscribe:all`.
- Exposes a callback-based API: `useOpenClawEvents(handlers: { onTaskCreated?, onAgentStatus?, ... })`.
- Provides `connected` state for the connection indicator.
- Auto-reconnects on disconnect (socket.io handles this natively).

Dashboard components subscribe to relevant events and update state optimistically (e.g., `task:created` → prepend to task list, `agent:status` → update badge) instead of full refetch.

### 3. Session inspector

New tab or panel that:

- Lists sessions for the selected agent using a new `GET /api/sessions?agentId=X` endpoint (wraps `sessionService.getAgentSessions`).
- Shows the conversation thread for a selected session via `GET /api/sessions/:sessionId` (wraps `sessionService.getSession`).
- Displays channel source tags (Slack, Telegram, etc.) and message timestamps.
- Uses existing `SessionContext` types from `session-service.ts`.

### 4. Workspace editor

- File list from `GET /api/workspace` (already exists).
- File content from `GET /api/workspace?file=X` (already exists).
- Save via `PUT /api/workspace` with `{ file, content }` (already exists).
- Uses a `Textarea` component for editing (simple, no heavy editor dependency).
- Create new file: same PUT endpoint with a new filename (validated by `isSafeWorkspaceFileName`).

### 5. Data fetching

Keep the current polling pattern for initial load. Overlay WS events for live updates. No SWR/React Query — keep it simple with `useState` + `useCallback` to match the existing codebase pattern. The `useOpenClawEvents` hook handles the WS layer; components merge WS updates into their local state.

## Risks / Trade-offs

- **Component decomposition is a large refactor** with risk of regressions in existing functionality. Mitigate by extracting one component at a time and verifying the dashboard still works after each extraction.
- **WS events may arrive before initial fetch completes** (race condition). Mitigate by buffering events received before the initial fetch resolves, then replaying them. Alternatively, refetch on first WS connect to ensure a consistent baseline.
- **socket.io-client vs raw WebSocket**: The WS service uses socket.io, but the current dashboard uses raw WebSocket with manual protocol handling. Switching to `socket.io-client` is correct (it's already a transitive dependency) but changes the connection code.
- **Textarea vs rich editor for workspace files**: A plain `Textarea` is lightweight and sufficient. MDXEditor or similar would be heavier and potentially overkill for Markdown files that are primarily configuration.
