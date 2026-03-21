## ADDED Requirements

### Requirement: Event type registry
The event bus SHALL support a typed event map where each event type has a defined payload shape. Initial event types: `task:completed`, `task:failed`, `task:created`, `session:created`, `memory:updated`, `subagent:completed`, `subagent:failed`. The TypeScript compiler SHALL reject attempts to emit an event type not in the registry or to pass a payload that does not match the event type's defined shape.

#### Scenario: Emit known event type with valid payload
- **WHEN** a service calls `eventBus.emit('task:completed', { taskId, agentId, taskType, result })` with a payload matching the defined shape
- **THEN** all listeners subscribed to `task:completed` SHALL receive the typed payload

#### Scenario: Emit unknown event type rejected at compile time
- **WHEN** a developer writes `eventBus.emit('unknown:event', data)` where `unknown:event` is not in the event map
- **THEN** the TypeScript compiler SHALL produce a type error, preventing the code from compiling

### Requirement: Publish/subscribe
The event bus SHALL provide an `emit(type, data)` method to publish events and an `on(type, listener)` method to subscribe to events. The `on()` method SHALL return an unsubscribe function that removes the listener when called.

#### Scenario: Subscribe and receive event
- **WHEN** a listener subscribes to `task:completed` via `eventBus.on('task:completed', handler)` and a `task:completed` event is emitted
- **THEN** the handler SHALL be called with the event data

#### Scenario: Unsubscribe stops delivery
- **WHEN** a listener unsubscribes by calling the function returned from `on()` and a matching event is subsequently emitted
- **THEN** the listener SHALL NOT be called

#### Scenario: Multiple listeners on same event
- **WHEN** two or more listeners subscribe to the same event type and that event is emitted
- **THEN** all subscribed listeners SHALL be called with the event data

### Requirement: Listener error isolation
If a listener throws an error, the error SHALL be caught and logged. Other listeners for the same event SHALL still execute. The emitting service SHALL NOT receive the error.

#### Scenario: Throwing listener does not block others
- **WHEN** the first of two listeners for `task:completed` throws an error
- **THEN** the second listener SHALL still be called with the event data

#### Scenario: Emitter continues after listener error
- **WHEN** a listener throws an error during event handling
- **THEN** the `emit()` call SHALL return without throwing, and the emitting service SHALL continue normal execution

### Requirement: System event emission
Services SHALL emit events after database commits at key lifecycle points. `TaskQueue` SHALL emit `task:created` when a task is added, `task:completed` when a task completes, and `task:failed` when a task fails. `AgentExecutor` SHALL emit `subagent:completed` and `subagent:failed` for sub-agent tasks. Event payloads SHALL include sufficient context for hook triggers to filter on.

#### Scenario: Task completes emits event
- **WHEN** a task's status is updated to `completed` in the database
- **THEN** the `TaskQueue` SHALL emit a `task:completed` event with `taskId`, `agentId`, `taskType`, and `result`

#### Scenario: Task fails emits event
- **WHEN** a task's status is updated to `failed` in the database
- **THEN** the `TaskQueue` SHALL emit a `task:failed` event with `taskId`, `agentId`, `taskType`, and `error`

#### Scenario: Sub-agent task completes emits event
- **WHEN** a sub-agent task completes
- **THEN** the `AgentExecutor` SHALL emit a `subagent:completed` event with `taskId`, `parentTaskId`, `skillName`, and `agentId`

### Requirement: Hook trigger subscription
The scheduler SHALL subscribe all enabled hook triggers to the event bus at startup. Each hook trigger's `config.event` field SHALL be matched against emitted event types using exact string equality. When a match occurs, the system SHALL call `inputManager.processHook()` with the event data to create a task for the trigger's bound agent.

#### Scenario: Hook trigger fires on matching event
- **WHEN** a hook trigger has `config.event: "task:completed"` and a `task:completed` event is emitted
- **THEN** the system SHALL call `inputManager.processHook()` with a `HookInput` containing `event: "task:completed"` and the event data

#### Scenario: Disabled hook trigger is not subscribed
- **WHEN** a hook trigger exists in the database with `enabled: false`
- **THEN** the scheduler SHALL NOT subscribe it to the event bus at startup

#### Scenario: Hook trigger created at runtime
- **WHEN** a new hook trigger is created via the trigger service while the scheduler is running
- **THEN** the scheduler SHALL dynamically subscribe the new trigger to the event bus without requiring a restart

#### Scenario: Hook trigger updated at runtime
- **WHEN** an existing hook trigger's `config.event` is changed via the trigger service
- **THEN** the scheduler SHALL unsubscribe the old listener and subscribe a new one matching the updated event type

#### Scenario: Hook trigger deleted at runtime
- **WHEN** a hook trigger is deleted via the trigger service
- **THEN** the scheduler SHALL unsubscribe its listener from the event bus

### Requirement: Condition-based filtering
If a hook trigger has `config.condition` set, the system SHALL only fire the hook when all key-value pairs in the condition match the corresponding fields in the event data using shallow equality (`===`). If `config.condition` is not set or is empty, the hook SHALL fire for all events of the matching type.

#### Scenario: Condition matches event data
- **WHEN** a hook trigger has `config.condition: { taskType: "message" }` and a `task:completed` event is emitted with `taskType: "message"`
- **THEN** the system SHALL fire the hook and call `inputManager.processHook()`

#### Scenario: Condition does not match event data
- **WHEN** a hook trigger has `config.condition: { taskType: "message" }` and a `task:completed` event is emitted with `taskType: "heartbeat"`
- **THEN** the system SHALL NOT fire the hook

#### Scenario: No condition means unconditional
- **WHEN** a hook trigger has no `config.condition` set and a matching event is emitted
- **THEN** the system SHALL fire the hook for every event of that type

#### Scenario: Multiple condition fields must all match
- **WHEN** a hook trigger has `config.condition: { taskType: "message", agentId: "agent-1" }` and a `task:completed` event is emitted with `taskType: "message"` and `agentId: "agent-2"`
- **THEN** the system SHALL NOT fire the hook because `agentId` does not match
