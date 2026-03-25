# supervised-task-execution Specification

## Purpose

Enable cron and hook tasks to run as supervised sessions with output buffering, timeout enforcement, and result storage. This replaces the current bare `execFile()` approach for scheduled and event-driven task execution.

## ADDED Requirements

### Requirement: Cron tasks run as supervised sessions
When a cron trigger fires, the scheduler SHALL create a supervised task session and route the task's shell command through the process supervisor.

#### Scenario: Cron trigger creates supervised session
- **WHEN** `processDueTriggers()` finds a due cron trigger
- **THEN** the scheduler SHALL call `supervisor.launchTask()` with the trigger's configured command
- **AND** the task session SHALL be registered with `type: 'task'` and `source: 'cron:<triggerName>'`

### Requirement: Hook tasks run as supervised sessions
When a hook trigger fires, the hook subscription manager SHALL create a supervised task session instead of calling `processHook()` synchronously.

#### Scenario: Hook trigger creates supervised session
- **WHEN** a hook trigger's event is emitted and the condition matches
- **THEN** the hook subscription manager SHALL call `supervisor.launchTask()` with the hook's configured command
- **AND** `processHook()` SHALL return immediately with the session ID

### Requirement: Task output stored as task artifact
Upon task session completion, the captured output SHALL be stored as a task artifact in memory.

#### Scenario: Task output persisted
- **WHEN** a task session transitions to a terminal state
- **THEN** the output buffer SHALL be stored as a memory artifact with key `task:<taskId>:output`

### Requirement: Optional synchronous await
A caller MAY await task completion by calling `supervisor.awaitTask(sessionId, timeoutMs)`.

#### Scenario: Caller awaits task
- **WHEN** a caller calls `supervisor.awaitTask(sessionId, 30000)` and the task completes within 30 seconds
- **THEN** the method SHALL return the final session state and output

#### Scenario: Caller awaits task with timeout
- **WHEN** a caller calls `supervisor.awaitTask(sessionId, 5000)` but the task does not complete within 5 seconds
- **THEN** the method SHALL throw a `TaskTimeoutError`

### Requirement: Task completion events
Upon task session terminal transition, the event bus SHALL emit `task:completed` or `task:failed` with output.

#### Scenario: Task completes successfully
- **WHEN** a task session transitions to `exited` with `exitCode: 0`
- **THEN** the event bus SHALL emit `task:completed` with `taskId`, `agentId`, `exitCode`, and `output`

#### Scenario: Task fails
- **WHEN** a task session transitions to `failed`, `killed`, or `timed_out`
- **THEN** the event bus SHALL emit `task:failed` with `taskId`, `agentId`, `exitCode`, `reason`, and `output`

### Requirement: Task session limits
The system SHALL enforce global limits on concurrent task sessions (default 10) and reject new task launches when the limit is reached.

#### Scenario: Task limit reached
- **WHEN** a new task launch is requested but `maxConcurrentTasks` task sessions are already running
- **THEN** the launch SHALL be rejected with a `ResourceLimitError`
