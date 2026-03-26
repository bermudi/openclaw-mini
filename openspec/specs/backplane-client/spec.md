# backplane-client Specification

## Purpose
TBD - created by archiving change websocket-event-bus. Update Purpose after archive.
## Requirements
### Requirement: WebSocket connection to event service
The backplane client SHALL connect to the WebSocket service at startup using Socket.IO client. The connection URL SHALL be configurable via `OPENCLAW_WS_URL` environment variable, defaulting to `http://localhost:3003`.

#### Scenario: Successful connection at startup
- **WHEN** the Next.js process starts
- **THEN** the backplane client SHALL connect to the WebSocket service within 5 seconds
- **AND** the client SHALL log a successful connection message

#### Scenario: Connection failure with retry
- **WHEN** the WebSocket service is unavailable at startup
- **THEN** the backplane client SHALL retry connection every 2 seconds
- **AND** the client SHALL log retry attempts without throwing errors

#### Scenario: Reconnection after disconnect
- **WHEN** the WebSocket service disconnects during operation
- **THEN** the backplane client SHALL automatically reconnect using Socket.IO's built-in reconnection
- **AND** the client SHALL log disconnection and reconnection events

### Requirement: Event subscription
The backplane client SHALL subscribe to receive all events from the WebSocket service. It SHALL join the `internal` room on the Socket.IO server to distinguish internal subscribers from browser clients.

#### Scenario: Subscribe to internal room
- **WHEN** the backplane client connects to the WebSocket service
- **THEN** it SHALL emit `subscribe:internal` to join the internal event distribution room
- **AND** it SHALL receive all events broadcast to the internal room

#### Scenario: Receive event from WebSocket service
- **WHEN** a process emits an event via `POST /broadcast` to the WebSocket service
- **THEN** the backplane client SHALL receive the event via its Socket.IO connection
- **AND** the event SHALL include `type`, `data`, and `timestamp` fields

### Requirement: Local-only event dispatch
The backplane client SHALL forward received events to local listeners using a local-dispatch path that does not broadcast back to the WebSocket service.

#### Scenario: Forward event to local listeners without rebroadcast
- **WHEN** the backplane client receives an event with type `task:created` from the WebSocket service
- **THEN** it SHALL call a local dispatch method on the event bus (non-broadcast)
- **AND** any in-process listeners subscribed to `task:created` SHALL receive the event

#### Scenario: Ignore events from self
- **WHEN** the backplane client receives an event that was originally emitted by the same process
- **THEN** it SHALL NOT forward the event to avoid duplicate delivery
- **AND** the event SHALL be identified as self-emitted via a `source` field in the event envelope

### Requirement: Lifecycle management
The backplane client SHALL provide `start()` and `stop()` methods for lifecycle control. The `start()` method SHALL initiate the WebSocket connection. The `stop()` method SHALL disconnect cleanly.

#### Scenario: Start initiates connection
- **WHEN** `backplaneClient.start()` is called
- **THEN** the client SHALL begin connecting to the WebSocket service
- **AND** the method SHALL return a Promise that resolves when connected (or immediately if async)

#### Scenario: Stop disconnects cleanly
- **WHEN** `backplaneClient.stop()` is called
- **THEN** the client SHALL disconnect from the WebSocket service
- **AND** the client SHALL log the disconnection

### Requirement: Health status
The backplane client SHALL expose an `isConnected()` method that returns `true` when connected to the WebSocket service and `false` otherwise.

#### Scenario: Check connection status
- **WHEN** code calls `backplaneClient.isConnected()`
- **THEN** it SHALL return `true` if the Socket.IO connection is active
- **AND** it SHALL return `false` if disconnected or connecting

