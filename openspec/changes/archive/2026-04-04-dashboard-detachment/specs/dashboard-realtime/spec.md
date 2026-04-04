## MODIFIED Requirements

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

### Requirement: Automatic reconnection

The dashboard SHALL automatically reconnect to the runtime realtime endpoint when the connection is lost. Upon reconnection, the dashboard SHALL re-subscribe and perform a full data refetch to ensure state consistency.

#### Scenario: WS disconnects and reconnects

- **GIVEN** the dashboard is connected
- **WHEN** the runtime realtime endpoint becomes unavailable and then recovers
- **THEN** the socket.io client SHALL automatically reconnect
- **AND** the client SHALL re-subscribe as an operator client
- **AND** a full data refetch SHALL be triggered to reconcile any missed events
