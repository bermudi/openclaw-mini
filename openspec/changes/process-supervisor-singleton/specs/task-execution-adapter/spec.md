# task-execution-adapter Specification

## Purpose

Define a pluggable adapter interface on the process supervisor for launching supervised tasks. This separates task-specific execution semantics (shell, timeout, output capture) from the core supervisor infrastructure.

## ADDED Requirements

### Requirement: TaskExecutionAdapter interface
The process supervisor SHALL expose a `TaskExecutionAdapter` interface with `type: 'task-shell'` for cron/hook task execution.

#### Scenario: Task execution adapter launches shell command
- **WHEN** `supervisor.launchTask(spec)` is called with a `TaskExecutionSpec`
- **THEN** the `task-shell` adapter SHALL spawn a shell process (bash -c) with the specified command

### Requirement: TaskExecutionSpec structure
Task execution SHALL be configured via a `TaskExecutionSpec` containing command, args, cwd, env, timeout, and buffer limits.

#### Scenario: Task spec with environment variables
- **WHEN** a task is launched with `env: { "FOO": "bar" }`
- **THEN** the shell process SHALL receive `FOO=bar` in its environment

#### Scenario: Task spec with working directory
- **WHEN** a task is launched with `cwd: "/tmp"`
- **THEN** the shell process SHALL execute in `/tmp`

### Requirement: Task timeout enforcement
The task-shell adapter SHALL enforce timeout by sending SIGKILL if the process does not exit within the specified timeout.

#### Scenario: Task times out
- **WHEN** a task is launched with `timeoutMs: 5000` and the command runs longer than 5 seconds
- **THEN** the system SHALL send SIGKILL to the process tree, transition the session to `timed_out`, and return a non-zero exit code

### Requirement: Output capture to session buffer
The task-shell adapter SHALL write all stdout and stderr to the session's output buffer as the process runs.

#### Scenario: Task output captured
- **WHEN** a task command writes to stdout
- **THEN** the output SHALL appear in the session's buffered output and be retrievable via `process log`

### Requirement: Exit code capture
The task-shell adapter SHALL capture the process exit code and record it on the session.

#### Scenario: Task exits successfully
- **WHEN** a task command exits with code 0
- **THEN** the session SHALL transition to `exited` with `exitCode: 0`

#### Scenario: Task exits with error
- **WHEN** a task command exits with code non-zero
- **THEN** the session SHALL transition to `failed` with the non-zero exit code
