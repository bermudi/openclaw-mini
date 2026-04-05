## ADDED Requirements

### Requirement: Coding-agent session lifecycle
The system SHALL expose a first-class coding-agent control surface that creates durable coding-agent sessions rather than treating long-lived coding work as anonymous process sessions.

#### Scenario: Spawn coding-agent session
- **WHEN** a caller invokes `spawn_coding_agent` with a valid task, backend selection, and working directory target while coding-agent control is enabled
- **THEN** the system SHALL create a durable coding-agent session record with a unique session identifier
- **AND** it SHALL launch a supervised PTY-backed worker for that session
- **AND** it SHALL return the coding-agent session identifier and initial status to the caller

#### Scenario: Spawn rejected when feature disabled
- **WHEN** a caller invokes `spawn_coding_agent` while `runtime.codingAgents.enabled` is `false`
- **THEN** the system SHALL reject the request with a clear feature-disabled error

#### Scenario: Spawn rejected when concurrency limit exceeded
- **WHEN** a caller invokes `spawn_coding_agent` for an agent that already has the configured maximum number of non-terminal coding-agent sessions
- **THEN** the system SHALL reject the request without creating a new coding-agent session record

### Requirement: Coding-agent session inspection
The system SHALL provide inspection operations for an existing coding-agent session, including lifecycle state and recent output.

#### Scenario: Check running session
- **WHEN** a caller invokes `check_coding_agent` for a running coding-agent session
- **THEN** the system SHALL return the durable session status, backend, working directory, parent linkage, and a recent output tail if available

#### Scenario: Check terminal session
- **WHEN** a caller invokes `check_coding_agent` for a completed, failed, cancelled, or interrupted coding-agent session
- **THEN** the system SHALL return the terminal status and the most recent termination reason or error if present

#### Scenario: List visible sessions
- **WHEN** a caller invokes `list_coding_agents`
- **THEN** the system SHALL return the visible coding-agent sessions with their identifiers, statuses, backends, and last-activity summary fields

### Requirement: Coding-agent follow-up messaging
The system SHALL allow callers to send follow-up instructions to a running coding-agent session through the controller.

#### Scenario: Message running session
- **WHEN** a caller invokes `message_coding_agent` for a coding-agent session whose status is `running`
- **THEN** the controller SHALL append the follow-up instruction to the coding-agent session history
- **AND** it SHALL forward the instruction to the backing PTY process using the controller-managed input path

#### Scenario: Message terminal session rejected
- **WHEN** a caller invokes `message_coding_agent` for a coding-agent session whose status is terminal
- **THEN** the system SHALL reject the request with an error indicating the session is no longer running

### Requirement: Coding-agent cancellation
The system SHALL allow callers to cancel a non-terminal coding-agent session.

#### Scenario: Cancel running session
- **WHEN** a caller invokes `cancel_coding_agent` for a coding-agent session whose status is `starting` or `running`
- **THEN** the system SHALL terminate the backing supervised process session
- **AND** it SHALL mark the durable coding-agent session status as `cancelled`

#### Scenario: Cancel terminal session rejected
- **WHEN** a caller invokes `cancel_coding_agent` for a coding-agent session whose status is already terminal
- **THEN** the system SHALL reject the request without changing the durable record

### Requirement: Coding-agent recovery projection
The runtime SHALL reconcile durable coding-agent session state against backing process-session state during startup and recovery sweeps.

#### Scenario: Backing process missing during recovery
- **WHEN** the runtime observes a coding-agent session marked `starting` or `running` whose `processSessionId` no longer exists
- **THEN** the runtime SHALL mark the coding-agent session as `interrupted`
- **AND** it SHALL record a recovery reason explaining that the backing process session was lost

#### Scenario: Backing process exits naturally
- **WHEN** the backing supervised process session for a coding-agent session exits
- **THEN** the controller SHALL project the terminal process outcome onto the durable coding-agent session status
