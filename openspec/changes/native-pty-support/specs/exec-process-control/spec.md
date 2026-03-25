## MODIFIED Requirements

### Requirement: PTY-backed execution
The system SHALL support PTY-backed process sessions for interactive commands using a native PTY backend when available, with a supported fallback path on Unix-like hosts.

#### Scenario: Native PTY backend available
- **WHEN** `exec_command` launches a command with PTY enabled and the native PTY backend is available
- **THEN** the system SHALL spawn the process with the native pseudo-terminal adapter

#### Scenario: Native PTY backend unavailable on supported Unix host
- **WHEN** `exec_command` launches a command with PTY enabled on a supported Unix-like host and the native PTY backend is unavailable or fails to initialize
- **THEN** the system SHALL fall back to the supported wrapper-based PTY adapter

#### Scenario: No supported PTY backend available
- **WHEN** `exec_command` launches a command with PTY enabled and neither the native PTY backend nor a supported fallback backend is available for the host
- **THEN** the system SHALL fail the PTY launch with a clear error

#### Scenario: PTY input written
- **WHEN** a caller sends input to a PTY-backed session
- **THEN** the system SHALL forward that input to the running terminal session
