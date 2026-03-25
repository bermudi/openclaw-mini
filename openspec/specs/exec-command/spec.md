# exec-command Specification

## Purpose
Command execution tool for agents with tier-aware execution, PTY support, background sessions, and mount-aware working directory resolution.
## Requirements
### Requirement: exec_command tool registration
The system SHALL register an `exec_command` tool available to agents when exec is enabled in config.

#### Scenario: Exec enabled in config
- **WHEN** `runtime.exec.enabled` is `true` in the runtime config
- **THEN** the `exec_command` tool SHALL be registered and available to agents

#### Scenario: Exec disabled in config
- **WHEN** `runtime.exec.enabled` is `false` or not set
- **THEN** the `exec_command` tool SHALL NOT be registered

### Requirement: Command allowlist enforcement
The system SHALL enforce command policy before launching `exec_command`.

#### Scenario: Allowed direct command
- **WHEN** an agent calls `exec_command` in direct argv mode with a command whose binary name is in `runtime.exec.allowlist`
- **THEN** the system SHALL permit launch of the command

#### Scenario: Disallowed direct command
- **WHEN** an agent calls `exec_command` in direct argv mode with a command whose binary name is not in `runtime.exec.allowlist`
- **THEN** the system SHALL return a tool error indicating the command is not allowed

#### Scenario: Empty allowlist for direct argv mode
- **WHEN** `runtime.exec.allowlist` is empty or not configured and a direct argv command is requested
- **THEN** the system SHALL reject the command

### Requirement: Execution timeout
The system SHALL enforce configurable timing limits on foreground and background command execution.

#### Scenario: Foreground command completes within timeout
- **WHEN** a foreground command finishes before `runtime.exec.maxTimeout`
- **THEN** the system SHALL return the command result directly

#### Scenario: Foreground command exceeds timeout without backgrounding
- **WHEN** a foreground command does not finish within `runtime.exec.maxTimeout` and is not allowed to continue in the background
- **THEN** the system SHALL kill the process and return a timeout error

#### Scenario: Background session exceeds timeout
- **WHEN** a background session exceeds its configured session timeout
- **THEN** the system SHALL terminate the session and mark it as timed out

### Requirement: Output size capping
The system SHALL enforce a configurable maximum on captured output size.

#### Scenario: Output within limit
- **WHEN** command output (stdout + stderr) is within `runtime.exec.maxOutputSize` characters
- **THEN** the system SHALL return the full output

#### Scenario: Output exceeds limit
- **WHEN** command output exceeds `runtime.exec.maxOutputSize` characters
- **THEN** the system SHALL truncate from the beginning, keeping the last `maxOutputSize` characters, and prepend a truncation notice

#### Scenario: Default output size
- **WHEN** `runtime.exec.maxOutputSize` is not configured
- **THEN** the system SHALL use a default limit of 10000 characters

### Requirement: Tier-aware command launch
The system SHALL launch `exec_command` using the selected execution tier and resolved backend policy.

#### Scenario: Per-call tier selection
- **WHEN** a caller requests a permitted execution tier for `exec_command`
- **THEN** the system SHALL launch the command using that tier

#### Scenario: Default tier selection
- **WHEN** a caller does not specify an execution tier
- **THEN** the system SHALL use the configured default tier

### Requirement: Launch mode selection
The system SHALL support both direct argv execution and shell-capable execution according to tier policy.

#### Scenario: Direct argv mode
- **WHEN** a caller launches `exec_command` in direct argv mode
- **THEN** the system SHALL parse the command into binary and args and apply allowlist validation before launch

#### Scenario: Shell-capable mode
- **WHEN** a caller launches `exec_command` in shell mode
- **THEN** the system SHALL apply the configured shell policy for the selected tier before launch

### Requirement: Mount-aware working directory resolution
The system SHALL resolve `exec_command` working directories against the execution runtime mount policy.

#### Scenario: Working directory resolved inside a mount
- **WHEN** a caller requests a working directory inside a configured mount
- **THEN** the system SHALL launch the command with that resolved working directory

#### Scenario: Working directory rejected by mount policy
- **WHEN** a caller requests a working directory disallowed by the selected tier or mount policy
- **THEN** the system SHALL reject the command before launch

### Requirement: PTY-capable command launch
The system SHALL support PTY-backed `exec_command` launches for interactive commands.

#### Scenario: PTY launch requested
- **WHEN** a caller requests PTY-backed execution
- **THEN** the system SHALL launch the command in PTY mode

### Requirement: Background session handoff
The system SHALL support background execution for long-running commands.

#### Scenario: Explicit background launch
- **WHEN** a caller requests background execution
- **THEN** the system SHALL return a supervised session handle without waiting for the command to exit

### Requirement: Output file surfacing
The execution runtime SHALL define a supported path for surfacing output files produced outside the legacy sandbox.

#### Scenario: Output file created in mounted workspace
- **WHEN** a command produces a file in an approved mounted workspace that must be delivered to chat
- **THEN** the runtime SHALL either copy the file into a deliverable location or expose it through an approved outbound-file path

### Requirement: Tool result structure
The `exec_command` tool SHALL return either a completed command result or a supervised session handle.

#### Scenario: Synchronous completion
- **WHEN** a launched command completes during the foreground execution window
- **THEN** the tool SHALL return structured output including stdout, stderr, exitCode, and truncation metadata

#### Scenario: Background handoff
- **WHEN** a launched command is backgrounded or remains running past the foreground yield window
- **THEN** the tool SHALL return a session identifier and session status instead of waiting for final exit

#### Scenario: Launch error
- **WHEN** the command cannot be launched
- **THEN** the tool SHALL return `{ success: false, error: "<message>" }`

