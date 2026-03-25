## Why

The `exec-runtime-overhaul` introduces a singleton process supervisor for interactive and background command execution. However, cron jobs and hook handlers also need to run commands—currently they run bare `execFile()` calls with no supervision, no output buffering, no timeout handling, and no visibility into running processes. Generalizing the process supervisor to serve cron/hook execution as well eliminates duplicated execution infrastructure and provides consistent lifecycle management for all command types.

## What Changes

- **NEW** `process-supervisor-singleton` capability that generalizes the `exec-runtime-overhaul` process supervisor to serve both interactive sessions and scheduled/hook-triggered tasks
- **NEW** `supervised-task-execution` capability for running cron/hook tasks under process supervision with output buffering, timeout enforcement, and lifecycle tracking
- **NEW** `task-execution-adapter` pluggable adapter interface so cron/hook tasks can use the child-process adapter (while interactive sessions use PTY or child-process)
- **MODIFY** `cron` and `hook` task handling to route through the process supervisor instead of bare `execFile()`
- **MODIFY** scheduler to optionally await task completion and capture supervised output for cron/hook results
- **NEW** `task-output` capability for storing and retrieving supervised task execution results in persistent memory

## Capabilities

### New Capabilities
- `process-supervisor-singleton`: unified singleton that serves both interactive sessions (PTY/child-process) and scheduled/hook-triggered task execution (child-process). Provides in-memory session registry, bounded output buffers, lifecycle states, and adapter abstraction.
- `task-execution-adapter`: pluggable adapter interface on the process supervisor for launching supervised tasks. Initial adapters: `child-process` (batch) and `task-shell` (for cron/hook shell commands).
- `supervised-task-execution`: cron/hook tasks run as supervised sessions with output buffering, timeout enforcement, exit code capture, and result storage in memory. Enables task retry, timeout handling, and output inspection for scheduled work.

### Modified Capabilities
- `exec-process-control`: extend session registry to track both `session` type (interactive/PTY) and `task` type (cron/hook) sessions with appropriate retention policies
- `event-bus`: hook triggers currently call `inputManager.processHook()` synchronously; under supervised execution this becomes async with session tracking and output capture
- `trigger-service`: `getDueTriggers()` behavior unchanged, but trigger firing now creates supervised task sessions rather than bare task records

## Impact

- **Process supervisor**: grows from serving only `exec_command` sessions to also handling cron/hook execution. Adapter pattern ensures PTY-only features don't leak into scheduled tasks.
- **Scheduler**: `processDueTriggers()` can optionally await supervised task completion and emit `task:completed`/`task:failed` events with output.
- **Hook subscription manager**: hook triggers fire supervised sessions instead of inline `processHook()` calls.
- **Memory service**: supervised task output is stored as task artifacts in memory, enabling output recall for cron/hook history.
- **Config schema**: `runtime.exec` gains task-specific limits (max concurrent supervised tasks, task output buffer size, task timeout defaults).
