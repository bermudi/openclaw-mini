## ADDED Requirements

### Requirement: Process session lifecycle
The system SHALL support supervised process sessions for background and interactive command execution.

#### Scenario: Background session created
- **WHEN** a launched command is backgrounded explicitly or exceeds the foreground yield window
- **THEN** the system SHALL create a process session with a unique session identifier

#### Scenario: Session transitions to finished state
- **WHEN** a supervised process exits
- **THEN** the system SHALL record its terminal state and retain its buffered output for later inspection

### Requirement: PTY-backed execution
The system SHALL support PTY-backed process sessions for interactive commands.

#### Scenario: PTY requested
- **WHEN** `exec_command` launches a command with PTY enabled
- **THEN** the system SHALL spawn the process with a pseudo-terminal adapter

#### Scenario: PTY input written
- **WHEN** a caller sends input to a PTY-backed session
- **THEN** the system SHALL forward that input to the running terminal session

### Requirement: Process tool session control
The system SHALL expose a `process` tool for interacting with supervised sessions.

#### Scenario: Poll session output
- **WHEN** a caller invokes the `process` tool with action `poll`
- **THEN** the system SHALL return new buffered output and current status for the session

#### Scenario: Read session log
- **WHEN** a caller invokes the `process` tool with action `log`
- **THEN** the system SHALL return buffered session output with offset and limit support

#### Scenario: Submit session input
- **WHEN** a caller invokes the `process` tool with action `submit`
- **THEN** the system SHALL write the provided input followed by a newline to the session

#### Scenario: Kill session
- **WHEN** a caller invokes the `process` tool with action `kill`
- **THEN** the system SHALL terminate the running session and report the new status

### Requirement: Session buffer limits
The system SHALL bound buffered output for supervised sessions.

#### Scenario: Session output exceeds buffer limit
- **WHEN** a supervised session produces more output than the configured session buffer limit
- **THEN** the system SHALL truncate buffered output according to the configured retention policy

### Requirement: Missing session handling
The system SHALL return a clear error when a caller references an unknown or expired session.

#### Scenario: Session not found
- **WHEN** a caller invokes the `process` tool for a session identifier that does not exist
- **THEN** the system SHALL return a not-found error for that session
