# exec-command Specification

## Purpose
TBD - created by archiving change agent-workspace-exec. Update Purpose after archive.
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
The system SHALL only execute commands whose binary name appears in the configured allowlist.

#### Scenario: Allowed command
- **WHEN** an agent calls `exec_command` with a command whose binary name is in `runtime.exec.allowlist`
- **THEN** the system SHALL execute the command

#### Scenario: Disallowed command
- **WHEN** an agent calls `exec_command` with a command whose binary name is NOT in `runtime.exec.allowlist`
- **THEN** the system SHALL return a tool error indicating the command is not allowed

#### Scenario: Empty allowlist
- **WHEN** `runtime.exec.allowlist` is empty or not configured
- **THEN** ALL commands SHALL be rejected

### Requirement: Command execution in agent sandbox
The system SHALL execute commands with the agent's sandbox directory as the working directory.

#### Scenario: Working directory
- **WHEN** an agent calls `exec_command`
- **THEN** the command SHALL execute with cwd set to `data/sandbox/{agentId}/`

#### Scenario: File access relative to sandbox
- **WHEN** an agent runs `cat myfile.txt`
- **THEN** the command SHALL read `data/sandbox/{agentId}/myfile.txt`

### Requirement: No shell execution
The system SHALL execute commands using `execFile` (direct binary invocation) without a shell.

#### Scenario: Shell operator rejection
- **WHEN** an agent calls `exec_command` with a command containing shell operators (`|`, `&&`, `;`, `>`, `<`, `||`)
- **THEN** the system SHALL return a tool error indicating shell operators are not supported

#### Scenario: Direct binary execution
- **WHEN** an agent calls `exec_command` with `grep pattern file.txt`
- **THEN** the system SHALL invoke the `grep` binary directly with `["pattern", "file.txt"]` as arguments

### Requirement: Execution timeout
The system SHALL enforce a configurable timeout on command execution.

#### Scenario: Command completes within timeout
- **WHEN** a command finishes before `runtime.exec.maxTimeout` seconds
- **THEN** the system SHALL return the command's stdout and exit code

#### Scenario: Command exceeds timeout
- **WHEN** a command does not finish within `runtime.exec.maxTimeout` seconds
- **THEN** the system SHALL kill the process and return a tool error indicating timeout

#### Scenario: Default timeout
- **WHEN** `runtime.exec.maxTimeout` is not configured
- **THEN** the system SHALL use a default timeout of 30 seconds

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

### Requirement: Tool result structure
The `exec_command` tool SHALL return structured results including stdout, stderr, and exit code.

#### Scenario: Successful command
- **WHEN** a command exits with code 0
- **THEN** the tool SHALL return `{ success: true, data: { stdout, stderr, exitCode: 0 } }`

#### Scenario: Failed command
- **WHEN** a command exits with a non-zero exit code
- **THEN** the tool SHALL return `{ success: true, data: { stdout, stderr, exitCode } }` (non-zero exit is not a tool error — the command ran successfully, it just returned a non-zero code)

#### Scenario: Execution error
- **WHEN** the command binary cannot be found or cannot be spawned
- **THEN** the tool SHALL return `{ success: false, error: "<message>" }`

