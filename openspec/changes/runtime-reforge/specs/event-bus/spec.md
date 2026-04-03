## MODIFIED Requirements

### Requirement: Publish/subscribe
The event bus SHALL provide an `emit(type, data)` method to publish events and an `on(type, listener)` method to subscribe to events. The `emit()` method SHALL return a `Promise<void>` that resolves after local listeners have run and any runtime-owned realtime broadcaster has been notified. The `on()` method SHALL return an unsubscribe function that removes the listener when called.

#### Scenario: Subscribe and receive event
- **WHEN** a listener subscribes to `task:completed` via `eventBus.on('task:completed', handler)` and a `task:completed` event is emitted
- **THEN** the handler SHALL be called with the event data

#### Scenario: Unsubscribe stops delivery
- **WHEN** a listener unsubscribes by calling the function returned from `on()` and a matching event is subsequently emitted
- **THEN** the listener SHALL NOT be called

#### Scenario: Multiple listeners on same event
- **WHEN** two or more listeners subscribe to the same event type and that event is emitted
- **THEN** all subscribed listeners SHALL be called with the event data

#### Scenario: Emit forwards to runtime realtime broadcaster
- **WHEN** a service calls `eventBus.emit('task:created', { taskId, agentId, taskType, priority })`
- **THEN** the event SHALL be delivered to local listeners and forwarded to the runtime-owned realtime broadcaster without an HTTP hop to a separate service

## REMOVED Requirements

### Requirement: Cross-process event delivery
**Reason**: The runtime reset removes the backplane architecture and treats event delivery as a runtime-owned concern inside one process.
**Migration**: Delete backplane client wiring and move realtime fanout into the standalone runtime.
