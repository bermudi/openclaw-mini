## 1. Component Decomposition

- [ ] 1.1 Create `src/components/dashboard/` directory; extract `StatusBadge`, `SeverityBadge`, and `TaskTypeIcon` helper components from `page.tsx` into `src/components/dashboard/status-badges.tsx` — keep the same props and rendering logic
- [ ] 1.2 Extract the Agents tab content (agent grid, create agent dialog, empty state) into `src/components/dashboard/agent-card.tsx` as an `AgentCard` component for individual cards and `AgentList` for the grid; pass `agents`, `onCreateAgent`, `onDeleteAgent`, `onToggleAgent`, `onSendMessage` as props
- [ ] 1.3 Extract the Tasks tab content (task table with status badges, priority, type icons, execute button, expandable detail) into `src/components/dashboard/task-list.tsx` as `TaskList`; pass `tasks`, `stats`, `agents`, `onExecuteTask` as props
- [ ] 1.4 Extract the Triggers tab content (trigger list with enable/disable toggles, create trigger dialog, delete button) into `src/components/dashboard/trigger-panel.tsx` as `TriggerPanel`; pass `triggers`, `agents`, `selectedAgent`, `onCreateTrigger`, `onDeleteTrigger`, `onToggleTrigger` as props
- [ ] 1.5 Extract the Audit Log tab content (scrollable log with severity badges, timestamps) into `src/components/dashboard/audit-log.tsx` as `AuditLog`; pass `auditLogs` as props
- [ ] 1.6 Extract the Live Events tab content (WS event stream with type badges, JSON data display) into `src/components/dashboard/event-stream.tsx` as `EventStream`; pass `wsEvents`, `wsConnected` as props
- [ ] 1.7 Slim down `page.tsx` to a thin shell: tab navigation, shared state (`agents`, `tasks`, `triggers`, `selectedAgent`, `wsConnected`), `fetchData()` orchestration, and imports of the extracted components; verify all tabs still render correctly

## 2. Real-Time Hook

- [ ] 2.1 Create `src/hooks/use-openclaw-events.ts` with `useOpenClawEvents` hook — connect to `localhost:3003` via `socket.io-client` (already a transitive dep of the WS service), emit `subscribe:all` on connect, expose `connected: boolean` state, auto-disconnect on unmount
- [ ] 2.2 Define the handler callback interface: `{ onTaskCreated?, onTaskStarted?, onTaskCompleted?, onTaskFailed?, onAgentStatus?, onTriggerFired?, onStatsUpdate?, onSessionUpdated? }` matching `WSEventType` from `ws-client.ts`; dispatch incoming socket events to the matching handler
- [ ] 2.3 Add reconnection behavior: on reconnect, re-emit `subscribe:all` and call an `onReconnect` callback (used by the dashboard to trigger a full `fetchData()` refetch to reconcile missed events)
- [ ] 2.4 Replace the raw WebSocket connection in `page.tsx` (lines 253–301) with `useOpenClawEvents`; wire handlers to update `agents`, `tasks`, `triggers`, `stats`, and `wsEvents` state in-place instead of calling `fetchData()` for every event; keep `fetchData()` on reconnect and initial mount
- [ ] 2.5 Update the connection status indicator in the header to use the `connected` state from `useOpenClawEvents`; add a "reconnecting" visual state (pulsing yellow dot) using socket.io's reconnect events

## 3. Session Inspector

- [ ] 3.1 Create `src/app/api/sessions/route.ts` — `GET` handler that accepts `?agentId=X` (returns session summaries via `sessionService.getAgentSessions`) and `?sessionId=X` (returns full session context with messages via `sessionService.getSession`); return `{ success: true, data }` format matching existing API conventions
- [ ] 3.2 Create `src/components/dashboard/session-inspector.tsx` with a `SessionInspector` component — left panel shows session list (channel badge, channelKey, message count, last active), right panel shows conversation thread; accept `selectedAgent` as prop
- [ ] 3.3 Implement the conversation thread view: render messages in chronological order, visually distinguish user/assistant/system roles (alignment + color), show channel source badge per message, format timestamps as relative for recent ("5m ago") and absolute for older messages
- [ ] 3.4 Add a "Sessions" tab to the dashboard `TabsList` in `page.tsx`; render `SessionInspector` in the tab content with the currently selected agent; handle empty state when no agent is selected ("Select an agent to view sessions")

## 4. Workspace Editor

- [ ] 4.1 Create `src/components/dashboard/workspace-editor.tsx` with `WorkspaceEditor` component — left panel lists files from `GET /api/workspace` (name + size, sorted alphabetically), right panel shows a `Textarea` with the selected file's content from `GET /api/workspace?file=X`
- [ ] 4.2 Implement save: "Save" button sends `PUT /api/workspace` with `{ file, content }`; show success/error feedback using the existing `useToast` hook from `src/hooks/use-toast.ts`; update file size in the list after save
- [ ] 4.3 Implement create new file: "New File" button opens an input for the filename; validate against `^[A-Za-z0-9_-]+\.md$` client-side before sending; auto-append `.md` if not present; save via the same PUT endpoint; refresh file list on success
- [ ] 4.4 Add a "Workspace" tab to the dashboard `TabsList` in `page.tsx`; render `WorkspaceEditor` in the tab content; handle empty workspace state

## 5. Memory Browser

- [ ] 5.1 Create `src/components/dashboard/memory-browser.tsx` with `MemoryBrowser` component — fetches memories from `GET /api/agents/{agentId}/memory` for the selected agent; displays memory entries grouped by category with key, value preview, and timestamps
- [ ] 5.2 Add memory detail view: clicking a memory entry expands it to show the full value; for `history` category memories, render the entries as a scrollable timeline
- [ ] 5.3 Add a "Memory" tab to the dashboard `TabsList` in `page.tsx`; render `MemoryBrowser` with the currently selected agent; show "Select an agent to browse memories" when no agent is selected

## 6. Integration & Verification

- [ ] 6.1 Wire all new components into `page.tsx`: ensure `AgentList`, `TaskList`, `TriggerPanel`, `AuditLog`, `EventStream`, `SessionInspector`, `WorkspaceEditor`, and `MemoryBrowser` are all imported and rendered in their respective tabs with correct props
- [ ] 6.2 Wire real-time updates end-to-end: verify that `useOpenClawEvents` handlers correctly update the state consumed by `TaskList` (task:created prepends, task:completed updates status), `AgentCard` (agent:status updates badge), and `TriggerPanel` (trigger:fired updates lastTriggered)
- [ ] 6.3 Test the full flow manually: create an agent, send a message, observe the task appear in TaskList via WS event, watch the agent status change to "busy" then back to "idle", verify the session appears in SessionInspector, edit a workspace file and confirm save, browse agent memories
- [ ] 6.4 Verify `socket.io-client` is in `package.json` dependencies (add via `bun add socket.io-client` if not already present); run `bun run build` to confirm no type errors or build failures
