## MODIFIED Requirements

### Requirement: Command allowlist enforcement
The system SHALL enforce command policy before launching `exec_command`.

#### Scenario: Allowed direct command
- **WHEN** an agent calls `exec_command` in direct argv mode with a command whose binary name is in `runtime.exec.allowlist`
- **THEN** the system SHALL permit launch of the command

#### Scenario: Disallowed direct command
- **WHEN** an agent calls `exec_command` in direct argv mode with a command whose binary name is NOT in `runtime.exec.allowlist`
- **THEN** the system SHALL return a tool error indicating the command is not allowed

#### Scenario: Empty allowlist for direct argv mode
- **WHEN** `runtime.exec.allowlist` is empty or not configured and a direct argv command is requested
- **THEN** the system SHALL reject the command

### Requirement: Execution timeout
The system SHALL enforce configurable timing limits on foreground and background command execution.

#### Scenario: Foreground command completes within timeout
- **WHEN** a foreground command finishes before `runtime.exec.maxTimeout` seconds
- **THEN** the system SHALL return the command result directly

#### Scenario: Foreground command exceeds timeout without backgrounding
- **WHEN** a foreground command does not finish within `runtime.exec.maxTimeout` seconds and is not allowed to continue in the background
- **THEN** the system SHALL kill the process and return a timeout error

#### Scenario: Background session exceeds timeout
- **WHEN** a background session exceeds its configured session timeout
- **THEN** the system SHALL terminate the session and mark it as timed out

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

## REMOVED Requirements

### Requirement: Command execution in agent sandbox
**Reason**: Command execution is no longer defined by a single fixed sandbox directory; it is determined by the selected execution tier, backend, mounts, and working directory policy.
**Migration**: Configure `runtime.exec` tiers and mounts, then request the appropriate execution tier and working directory at launch time.

### Requirement: No shell execution
**Reason**: Interactive coding agents and PTY-backed workflows require shell-capable execution semantics.
**Migration**: Use the tiered execution policy, allowlists for argv launches, and backend-backed isolation for higher-risk shell execution.

## ADDED Requirements

### Requirement: Tier-aware command launch
The system SHALL launch `exec_command` using the selected execution tier and resolved backend policy.

#### Scenario: Per-call tier selection
- **WHEN** a caller requests a permitted execution tier for `exec_command`
- **THEN** the system SHALL launch the command using that tier

#### Scenario: Default tier selection
- **WHEN** a caller does not specify an execution tier
- **THEN** the system SHALL use the configured default tier

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
