# process-supervisor-singleton Specification

## Purpose

Extend the `exec-runtime-overhaul` process supervisor singleton to serve both interactive command sessions (PTY/child-process) and scheduled/hook-triggered task execution (task-shell) under a unified session registry with type-safe routing.

## ADDED Requirements

### Requirement: Unified session registry with type discriminator
The process supervisor SHALL maintain an in-memory session registry that tracks both `session` type (interactive/PTY) and `task` type (cron/hook) sessions.

#### Scenario: Registry tracks session-type session
- **WHEN** `exec_command` creates a PTY or child-process session
- **THEN** the session SHALL be registered with `type: 'session'` and `adapterType` set appropriately

#### Scenario: Registry tracks task-type session
- **WHEN** a cron trigger or hook handler creates a supervised task session
- **THEN** the session SHALL be registered with `type: 'task'` and `adapterType: 'task-shell'`

#### Scenario: List sessions filtered by type
- **WHEN** a caller queries the session registry with `type: 'task'`
- **THEN** only sessions with `type: 'task'` SHALL be returned

### Requirement: Type-safe session routing
The session registry SHALL enforce type-safe routing so PTY-only operations fail on task sessions and task-specific operations fail on session sessions.

#### Scenario: PTY write rejected on task session
- **WHEN** a caller attempts to send keys to a session with `type: 'task'`
- **THEN** the system SHALL return an error indicating PTY operations are not supported for task sessions

#### Scenario: Task await rejected on session session
- **WHEN** a caller attempts to await completion of a session with `type: 'session'`
- **THEN** the system SHALL return an error indicating task await is only valid for task sessions

### Requirement: Shared lifecycle state machine
Both session types SHALL share the same lifecycle state machine: `running`, `exited`, `failed`, `killed`, `timed_out`.

#### Scenario: Task session transitions to timed_out
- **WHEN** a task session's timeout expires before the process exits
- **THEN** the system SHALL send SIGKILL, transition the session to `timed_out`, and record the exit code as non-zero

#### Scenario: Task session transitions to killed
- **WHEN** a caller kills a task session via the `process` tool
- **THEN** the system SHALL send SIGKILL, transition the session to `killed`, and record the exit code as non-zero

### Requirement: Shared bounded output buffers
Both session types SHALL share the same bounded output buffer infrastructure with configurable per-session limits and global limits.

#### Scenario: Task output truncated at buffer limit
- **WHEN** a task session produces output exceeding its buffer limit
- **THEN** the system SHALL apply the configured truncation policy (drop oldest) and mark the buffer as truncated

### Requirement: Task session TTL for finished sessions
Finished task sessions SHALL be retained in the registry for a configurable TTL (default 5 minutes) then automatically purged.

#### Scenario: Task session purged after TTL
- **WHEN** a task session has been in a terminal state (`exited`, `failed`, `killed`, `timed_out`) for longer than the TTL
- **THEN** the system SHALL remove the session from the registry and free its buffer memory
