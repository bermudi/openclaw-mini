# event-bus Delta Specification

## MODIFIED Requirements

### Requirement: Publish/subscribe
The event bus SHALL provide an `emit(type, data)` method to publish events and an `on(type, listener)` method to subscribe to events. The `emit()` method SHALL return a `Promise<void>` that resolves when the event has been broadcast to the WebSocket service. The `on()` method SHALL return an unsubscribe function that removes the listener when called. Events SHALL be distributed via the WebSocket service to enable cross-process delivery.

#### Scenario: Subscribe and receive event
- **WHEN** a listener subscribes to `task:completed` via `eventBus.on('task:completed', handler)` and a `task:completed` event is emitted (either locally or from another process)
- **THEN** the handler SHALL be called with the event data

#### Scenario: Unsubscribe stops delivery
- **WHEN** a listener unsubscribes by calling the function returned from `on()` and a matching event is subsequently emitted
- **THEN** the listener SHALL NOT be called

#### Scenario: Multiple listeners on same event
- **WHEN** two or more listeners subscribe to the same event type and that event is emitted
- **THEN** all subscribed listeners SHALL be called with the event data

#### Scenario: Emit broadcasts to WebSocket service
- **WHEN** a service calls `eventBus.emit('task:created', { taskId, agentId, taskType, priority })`
- **THEN** the event SHALL be sent to the WebSocket service via `POST /broadcast`
- **AND** the Promise SHALL resolve when the WebSocket service acknowledges the broadcast

#### Scenario: Emit fails gracefully when WebSocket service unavailable
- **WHEN** the WebSocket service is unavailable and `eventBus.emit()` is called
- **THEN** the Promise SHALL resolve without throwing
- **AND** the event SHALL be logged as failed to broadcast

### Requirement: Emit failure observability
Failed broadcasts SHALL produce structured telemetry so operators can detect stale real-time/event behavior.

#### Scenario: Emit failure increments failure signal
- **WHEN** an event broadcast fails in `eventBus.emit()`
- **THEN** the system SHALL record a structured error log containing event type and source
- **AND** the system SHALL increment a failure counter/metric for broadcast failures

### Requirement: Cross-process event delivery
Events emitted from any process (Next.js app, scheduler, future services) SHALL be delivered to listeners in all processes. The backplane client in each process SHALL receive events from the WebSocket service and forward them to local listeners.

#### Scenario: Event from scheduler reaches Next.js listener
- **WHEN** the scheduler process emits `task:created` via its event bus
- **THEN** the event SHALL be broadcast to the WebSocket service
- **AND** the backplane client in the Next.js process SHALL receive the event
- **AND** listeners subscribed in the Next.js process SHALL be called

#### Scenario: Event from Next.js reaches Next.js listener
- **WHEN** the Next.js process emits an event
- **THEN** the event SHALL be broadcast to the WebSocket service
- **AND** the backplane client SHALL receive the event
- **AND** the backplane client SHALL forward to local listeners
- **AND** the original emitter's local listeners SHALL NOT receive the event twice (self-origin filtering)

## ADDED Requirements

### Requirement: Async emit API
The `emit()` method SHALL be asynchronous and return a `Promise<void>`. Callers MAY await the Promise to ensure delivery, or MAY ignore it for fire-and-forget semantics.

#### Scenario: Await emit for delivery confirmation
- **WHEN** a caller awaits `eventBus.emit('task:created', data)`
- **THEN** the Promise SHALL resolve when the WebSocket service confirms receipt
- **OR** the Promise SHALL resolve immediately if the broadcast fails (graceful degradation)

#### Scenario: Fire-and-forget emit
- **WHEN** a caller calls `eventBus.emit('task:created', data)` without awaiting
- **THEN** the emit SHALL proceed asynchronously
- **AND** the caller SHALL continue without blocking

### Requirement: Event source tagging
Events emitted via `eventBus.emit()` SHALL include a `source` field identifying the emitting process. This enables the backplane client to filter out self-originated events and prevent duplicate delivery.

#### Scenario: Event includes source identifier
- **WHEN** a process emits an event via `eventBus.emit('task:created', data)`
- **THEN** the broadcast event SHALL include a `source` field with a unique process identifier
- **AND** the backplane client SHALL use this field to filter self-originated events
