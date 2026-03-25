## Context

The `exec-runtime-overhaul` introduces a singleton process supervisor with child-process and PTY adapters for interactive/background sessions. Cron jobs and hook handlers currently bypass this infrastructure entirely—tasks are created in the database but actual command execution happens via bare `execFile()` in `agent-executor.ts` with no supervision, no output buffering, no timeout enforcement, and no process visibility.

This design generalizes the process supervisor singleton to also serve cron/hook execution. The key question is whether cron/hook tasks should use the same supervised session model as interactive sessions or a lighter-weight adapter.

## Goals / Non-Goals

**Goals:**
- Extend the process supervisor singleton to serve both interactive sessions and scheduled/hook-triggered task execution
- Define a task execution adapter interface so cron/hook tasks use the child-process adapter without PTY overhead
- Provide output buffering, timeout enforcement, and exit code capture for all supervised task types
- Enable task output storage in memory for cron/hook history and recall
- Preserve the session registry's ephemeral nature for both session types

**Non-Goals:**
- Changing how interactive PTY sessions work
- Persisting process handles across server restarts (ephemeral registry remains)
- Adding retry logic, dead-letter queues, or complex task orchestration—those belong in a future task-workflow change
- Supporting Windows process supervision in the first iteration

## Decisions

### Decision 1: One singleton, two session types

The process supervisor singleton serves two distinct session types:

- **`session` sessions**: PTY or child-process sessions created by `exec_command`. Long-running, interactive, user-visible. Retained in registry until explicitly cleared or server restart.
- **`task` sessions**: short-lived child-process sessions created by cron/hook triggers. Supervised with timeout, output capture, and automatic cleanup after task completion.

Both session types share the same registry, bounded buffers, and lifecycle state machine. The adapter layer differs (PTY vs. child-process), but the supervision infrastructure is shared.

**Alternative considered**: Separate process supervisors for sessions vs. tasks. Rejected because it duplicates lifecycle management, buffer limits, and registry logic that are already identical between the two use cases.

### Decision 2: Task execution adapter for cron/hook

Cron and hook tasks use a new `TaskExecutionAdapter` interface on the process supervisor instead of the PTY adapter:

```typescript
interface TaskExecutionAdapter {
  readonly type: 'task-shell';
  launch(
    session: SessionHandle,
    spec: TaskExecutionSpec
  ): Promise<TaskExecutionResult>;
}

interface TaskExecutionSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  outputBufferLimit?: number;
}
```

The `child-process` adapter used for batch `exec_command` and the `task-shell` adapter for cron/hook share the same `ChildProcessAdapter` implementation but with different defaults:
- `task-shell` always uses shell-capable execution (bash/sh)
- `task-shell` enforces timeout with automatic kill
- `task-shell` captures all stdout/stderr to the session buffer

**Alternative considered**: Reuse the same `child` adapter for both interactive batch and task execution. Rejected because cron/hook tasks need shell interpretation (globbing, pipes) and timeout enforcement that interactive batch commands may not want.

### Decision 3: Task sessions are fire-and-forget with optional await

The scheduler's `processDueTriggers()` creates a supervised task session and immediately returns the task to the queue. It does **not** wait for the shell command to complete inside the scheduler loop (which would block heartbeat intervals). Instead:

- The task runs asynchronously under supervision
- On completion, the supervisor emits `task:completed` or `task:failed` events
- Output is stored in the session buffer and optionally persisted to memory

A caller (scheduler, hook trigger, or API) can optionally `await` a task session via the process supervisor's `awaitTask(sessionId, timeoutMs)` method if it needs synchronous completion.

**Alternative considered**: Make all cron/hook tasks synchronous (await completion in scheduler). Rejected because a long-running shell command (e.g., `git pull` + `npm install`) would block the heartbeat interval for all other triggers.

### Decision 4: Session registry serves both with type-safe routing

The existing session registry in `exec-runtime-overhaul` is extended with a `sessionType: 'session' | 'task'` discriminator:

```typescript
interface ProcessSession {
  id: string;
  type: 'session' | 'task';
  adapterType: 'pty' | 'child-process' | 'task-shell';
  state: SessionState;
  createdAt: Date;
  finishedAt?: Date;
  exitCode?: number;
  outputBuffer: RingBuffer;
  metadata: SessionMetadata | TaskMetadata;
}
```

Session listing, polling, and cleanup operations filter by type. The `process` tool's `list` action accepts an optional `type` filter.

**Alternative considered**: Separate registries for session vs. task sessions. Rejected because the existing registry already handles both lifecycle states identically; duplicating it adds maintenance burden.

### Decision 5: Hook trigger execution becomes supervised async

Currently, `hookSubscriptionManager` calls `inputManager.processHook()` synchronously and the hook task runs inline during event emission. Under supervised execution:

1. Event fires → `processHook()` creates a supervised task session
2. Task session is tracked in registry with `type: 'task'`
3. `processHook()` returns immediately with the session ID
4. Hook handler's output is captured to the session buffer
5. On session exit, `task:completed`/`task:failed` is emitted with output

This preserves the event-bus's fire-and-forget semantics while adding visibility into hook execution.

**Alternative considered**: Keep hook execution synchronous. Rejected because we lose output capture, timeout enforcement, and process visibility—benefits that justify the generalization effort.

## Risks / Trade-offs

- **[Risk] Task sessions increase memory pressure** → Mitigation: bounded output buffers per session, session TTL for finished tasks (default 5 minutes), and global max task sessions limit
- **[Risk] Timeout enforcement requires reliable SIGKILL** → Mitigation: tested on Linux; SIGKILL behavior is deterministic; document that sub-second timeouts are not guaranteed
- **[Risk] Shell command output may be large** → Mitigation: ring buffer with truncation policy (drop oldest), not unbounded concatenation
- **[Trade-off] Session registry is ephemeral** → Acceptable: both session and task sessions are lost on restart; this is consistent with the existing design and acceptable for the first version
- **[Trade-off] Hook triggers become async** → Acceptable: event bus listener isolation already ensures hook firing doesn't block the emitter; supervised async execution is a natural extension

## Migration Plan

1. Create `process-supervisor-singleton` artifacts alongside `exec-runtime-overhaul`
2. Add `TaskExecutionAdapter` interface and `task-shell` adapter implementation to the existing process supervisor
3. Extend session registry with `type` discriminator and task-specific metadata
4. Add `supervisor.awaitTask()` method for optional synchronous wait
5. Update `scheduler.processDueTriggers()` to create supervised task sessions
6. Update `hookSubscriptionManager` to use supervised execution
7. Add task output persistence to memory service for cron/hook history
8. Update tests for supervised task execution, timeout handling, and output capture

## Open Questions

- Should task sessions support stdin input (for future interactive hook workflows), or is output-only sufficient for v1?
- What should the default timeout be for task-shell execution? Should it be configurable per-trigger or global?
- Should we emit a distinct `task:output` event when a task session produces significant output, or only on completion?
