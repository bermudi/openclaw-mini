# task-execution-durability Delta Specification

## ADDED Requirements

### Requirement: Durable per-agent task execution lock
Task execution coordination SHALL be durable across process restarts and SHALL NOT rely exclusively on in-memory maps.

#### Scenario: Process restarts during task execution
- **WHEN** a process restarts while a task is marked `processing`
- **THEN** the system SHALL NOT start a second concurrent task for the same agent until recovery logic resolves the stale state

#### Scenario: Concurrent claim attempts
- **WHEN** two workers attempt to claim runnable tasks for the same agent
- **THEN** at most one task SHALL transition to `processing`

### Requirement: Stale busy-agent recovery
The scheduler SHALL periodically detect and recover stale agent status that no longer matches task reality.

#### Scenario: Agent busy without active processing task
- **WHEN** an agent is `busy` and has no active `processing` task past the recovery threshold
- **THEN** the system SHALL reset the agent status to `idle`

#### Scenario: Recovery failure surfaces explicit error
- **WHEN** stale-state recovery cannot safely restore an agent to `idle`
- **THEN** the system SHALL set status to `error` and record an audit/log entry

### Requirement: Single parent-failure cascade
Parent task failure SHALL cascade to child tasks exactly once.

#### Scenario: Parent task fails
- **WHEN** a parent task transitions to `failed`
- **THEN** pending and processing child tasks SHALL be failed exactly once with a parent-failure reason
