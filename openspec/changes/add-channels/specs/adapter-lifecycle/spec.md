## ADDED Requirements

### Requirement: Lifecycle interface on ChannelAdapter
The `ChannelAdapter` interface SHALL be extended with three optional lifecycle methods: `start()`, `stop()`, and `isConnected()`.

#### Scenario: Adapter with lifecycle methods
- **WHEN** a `ChannelAdapter` implementation provides `start()`, `stop()`, and `isConnected()` methods
- **THEN** the system SHALL call these methods at the appropriate lifecycle stages (boot, shutdown, delivery dispatch)

#### Scenario: Adapter without lifecycle methods
- **WHEN** a `ChannelAdapter` implementation does not provide lifecycle methods
- **THEN** the system SHALL treat it as always connected and skip lifecycle calls, maintaining backward compatibility

### Requirement: Adapter startup initialization
The scheduler SHALL call `start()` on each registered adapter that implements the lifecycle interface after `initializeAdapters()` runs at boot.

#### Scenario: Adapter starts at boot
- **WHEN** the scheduler service starts and calls `initializeAdapters()`
- **THEN** the system SHALL iterate over all registered adapters and call `start()` on each adapter that implements it

#### Scenario: Adapter start failure is non-fatal
- **WHEN** an adapter's `start()` method throws an error
- **THEN** the system SHALL log the error, mark the adapter as not connected, and continue starting other adapters without crashing the scheduler

### Requirement: Health-aware delivery routing
The delivery service SHALL check an adapter's connection health before attempting to dispatch a delivery.

#### Scenario: Delivery skips disconnected adapter
- **WHEN** `dispatchDelivery()` is called for a channel whose adapter reports `isConnected() === false`
- **THEN** the delivery service SHALL NOT attempt to send, SHALL keep the delivery status as `pending`, and SHALL set `nextAttemptAt` for a later retry

#### Scenario: Delivery proceeds for connected adapter
- **WHEN** `dispatchDelivery()` is called for a channel whose adapter reports `isConnected() === true` or does not implement `isConnected()`
- **THEN** the delivery service SHALL proceed with the `sendText()` call as normal

### Requirement: Graceful shutdown
The scheduler SHALL call `stop()` on all registered adapters that implement the lifecycle interface when receiving SIGTERM or SIGINT.

#### Scenario: Adapter stop on SIGTERM
- **WHEN** the scheduler receives a SIGTERM signal
- **THEN** the system SHALL call `stop()` on each adapter that implements it, allowing adapters to close connections cleanly before the process exits

#### Scenario: Adapter stop timeout
- **WHEN** an adapter's `stop()` method does not resolve within 5 seconds
- **THEN** the system SHALL log a warning and proceed with shutdown without waiting further

### Requirement: Unhealthy adapter recovery
The system SHALL periodically check adapter health and attempt recovery for adapters that have become disconnected.

#### Scenario: Unhealthy adapter retries connection
- **WHEN** an adapter reports `isConnected() === false` and was previously connected
- **THEN** the system SHALL attempt to call `start()` again to re-establish the connection

#### Scenario: Recovery attempt logged
- **WHEN** the system attempts to recover a disconnected adapter
- **THEN** the system SHALL log the recovery attempt including the adapter's channel name and the outcome (success or failure)
