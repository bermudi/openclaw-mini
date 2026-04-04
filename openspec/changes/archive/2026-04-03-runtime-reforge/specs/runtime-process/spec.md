## ADDED Requirements

### Requirement: Standalone runtime ownership
The system SHALL start a standalone runtime process that owns initialization, adapter lifecycle, task execution, trigger processing, and realtime event fanout.

#### Scenario: Runtime boot owns core services
- **WHEN** the runtime process starts
- **THEN** it SHALL initialize configuration, storage access, adapters, scheduler loops, and realtime broadcasting before serving runtime traffic

#### Scenario: No Next.js request is required to wake the runtime
- **WHEN** the process has started successfully
- **THEN** task execution and scheduler behavior SHALL be active without waiting for an HTTP request to hit a Next.js route

### Requirement: In-process task dispatch
The runtime SHALL attempt to dispatch newly created runnable tasks immediately in-process and SHALL also run a periodic reconciliation sweep for pending work.

#### Scenario: New task triggers immediate dispatch
- **WHEN** a task is created for an idle agent
- **THEN** the runtime SHALL attempt to claim and execute that task without waiting for an external polling cycle

#### Scenario: Reconciliation sweep catches missed work
- **WHEN** a runnable task was not picked up by the immediate dispatch path
- **THEN** the periodic reconciliation sweep SHALL detect and dispatch it later

### Requirement: Integrated realtime broadcasting
The runtime SHALL own realtime event broadcasting for connected operator clients without relying on a separate backplane service.

#### Scenario: Runtime emits operator event
- **WHEN** the runtime emits a supported lifecycle event such as `task:created` or `task:completed`
- **THEN** connected operator clients SHALL receive the event from the runtime process directly

### Requirement: Runtime health and shutdown lifecycle
The runtime SHALL expose readiness information and SHALL shut down core services in an orderly sequence.

#### Scenario: Runtime reports readiness after startup
- **WHEN** initialization completes successfully
- **THEN** the runtime SHALL expose a ready state that distinguishes successful startup from boot-in-progress or failed startup

#### Scenario: Runtime shuts down gracefully
- **WHEN** the runtime receives a termination signal
- **THEN** it SHALL stop accepting new work, finish or time out in-flight work according to configuration, stop adapters, and close storage resources before exit
