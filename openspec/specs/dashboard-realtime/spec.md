# dashboard-realtime Specification

## Purpose
TBD - created by archiving change build-dashboard. Update Purpose after archive.
## Requirements
### Requirement: WS event subscription via socket.io-client

The dashboard SHALL connect to the runtime's realtime endpoint using `socket.io-client`. Upon connection, the dashboard SHALL subscribe as an operator client through the dashboard runtime client layer instead of assuming a hard-coded sibling WS service.

#### Scenario: Dashboard connects and subscribes on mount

- **WHEN** the dashboard page mounts
- **THEN** a socket.io connection SHALL be established to the configured runtime realtime endpoint
- **AND** the client SHALL subscribe as an operator client
- **AND** the hook SHALL expose a `connected: boolean` state

#### Scenario: Dashboard disconnects on unmount

- **WHEN** the dashboard page unmounts
- **THEN** the socket.io connection SHALL be closed
- **AND** no event listeners SHALL remain active

### Requirement: State updates on WS events

The dashboard SHALL update component state in response to WS events without performing a full data refetch. The following event-to-action mappings SHALL be supported:

| Event | Action |
|---|---|
| `task:created` | Prepend task to task list, increment pending count |
| `task:started` | Update task status to `processing` |
| `task:completed` | Update task status to `completed`, increment completed count |
| `task:failed` | Update task status to `failed`, increment failed count |
| `agent:status` | Update the agent's status badge |
| `trigger:fired` | Update trigger's `lastTriggered` timestamp |

#### Scenario: Task created event updates task list

- **GIVEN** the dashboard is connected and displaying the task list
- **WHEN** a `task:created` event is received with `{ taskId, taskType }`
- **THEN** the task list SHALL show the new task without a page refresh
- **AND** the pending task count SHALL increment by 1

#### Scenario: Agent status change updates badge

- **GIVEN** the dashboard is connected and displaying agent cards
- **WHEN** an `agent:status` event is received with `{ agentId, status: "busy" }`
- **THEN** the corresponding agent card's status badge SHALL update to "busy"
- **AND** no other agent cards SHALL be affected

#### Scenario: Task completed updates stats

- **GIVEN** the dashboard is connected with stats showing `{ pending: 3, completed: 10 }`
- **WHEN** a `task:completed` event is received
- **THEN** stats SHALL update to reflect the completion (pending decrements, completed increments)

### Requirement: Connection status indicator

The dashboard SHALL display a visible connection status indicator showing whether the WS connection is active. The indicator MUST distinguish between connected, disconnected, and reconnecting states.

#### Scenario: Connected state

- **GIVEN** the socket.io connection is established
- **THEN** the connection indicator SHALL show a "connected" state (e.g., green dot or badge)

#### Scenario: Disconnected state

- **GIVEN** the socket.io connection drops
- **THEN** the connection indicator SHALL show a "disconnected" state
- **AND** the indicator SHALL be visible without navigating to a specific tab

### Requirement: Automatic reconnection

The dashboard SHALL automatically reconnect to the runtime realtime endpoint when the connection is lost. Upon reconnection, the dashboard SHALL re-subscribe and perform a full data refetch to ensure state consistency.

#### Scenario: WS disconnects and reconnects

- **GIVEN** the dashboard is connected
- **WHEN** the runtime realtime endpoint becomes unavailable and then recovers
- **THEN** the socket.io client SHALL automatically reconnect
- **AND** the client SHALL re-subscribe as an operator client
- **AND** a full data refetch SHALL be triggered to reconcile any missed events

