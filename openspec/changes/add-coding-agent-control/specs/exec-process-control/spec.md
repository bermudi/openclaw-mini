## ADDED Requirements

### Requirement: Coding-agent sessions bind to supervised process sessions
The process-control runtime SHALL support a durable coding-agent session binding to one active supervised PTY process session.

#### Scenario: Controller stores backing process session
- **WHEN** a coding-agent session is launched successfully
- **THEN** the controller SHALL store the supervised `processSessionId` on the durable coding-agent session record

#### Scenario: Terminal process outcome updates coding-agent session
- **WHEN** the supervised process session bound to a coding-agent session exits, fails, times out, or is killed
- **THEN** the controller SHALL update the durable coding-agent session status to the corresponding terminal coding-agent state

### Requirement: Coding-agent controller owns PTY input path
The controller SHALL mediate PTY writes for managed coding-agent sessions instead of requiring callers to address raw process sessions directly.

#### Scenario: Follow-up instruction written through controller
- **WHEN** a caller sends a follow-up instruction through `message_coding_agent`
- **THEN** the controller SHALL write that instruction to the backing PTY session on the caller's behalf

#### Scenario: Raw process access does not replace controller state
- **WHEN** a coding-agent session is backed by a supervised process session
- **THEN** the durable coding-agent session status SHALL remain the source of truth for product-level inspection and cancellation operations
