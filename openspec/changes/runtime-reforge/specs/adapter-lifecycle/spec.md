## MODIFIED Requirements

### Requirement: Adapter startup initialization
The runtime SHALL call `start()` on each registered adapter that implements the lifecycle interface after runtime boot initializes adapters.

#### Scenario: Adapter starts during runtime boot
- **WHEN** the runtime process starts and initializes adapters
- **THEN** the system SHALL iterate over all registered adapters and call `start()` on each adapter that implements it

#### Scenario: Adapter start failure is non-fatal
- **WHEN** an adapter's `start()` method throws an error during runtime boot
- **THEN** the system SHALL log the error, mark the adapter as not connected, and continue starting other adapters without crashing the runtime

### Requirement: Graceful shutdown
The runtime SHALL call `stop()` on all registered adapters that implement the lifecycle interface when receiving SIGTERM or SIGINT.

#### Scenario: Adapter stop on SIGTERM
- **WHEN** the runtime receives a SIGTERM signal
- **THEN** the system SHALL call `stop()` on each adapter that implements it, allowing adapters to close connections cleanly before the process exits

#### Scenario: Adapter stop timeout
- **WHEN** an adapter's `stop()` method does not resolve within the configured shutdown timeout
- **THEN** the system SHALL log a warning and proceed with shutdown without waiting further

### Requirement: Unhealthy adapter recovery
The runtime SHALL periodically check adapter health and attempt recovery for adapters that have become disconnected.

#### Scenario: Unhealthy adapter retries connection
- **WHEN** an adapter reports `isConnected() === false` and was previously connected
- **THEN** the runtime SHALL attempt to call `start()` again to re-establish the connection

#### Scenario: Recovery attempt logged
- **WHEN** the runtime attempts to recover a disconnected adapter
- **THEN** the system SHALL log the recovery attempt including the adapter's channel name and the outcome
