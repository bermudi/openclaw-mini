## 1. Process supervisor extensions for task sessions

- [ ] 1.1 Add `sessionType: 'session' | 'task'` discriminator and `TaskMetadata` interface to the session registry schema
- [ ] 1.2 Add `adapterType` field to `ProcessSession` interface covering `pty`, `child-process`, and `task-shell`
- [ ] 1.3 Implement type-safe routing in session registry methods so PTY-only operations reject task sessions
- [ ] 1.4 Add `taskSessionTTL` config (default 5 minutes) and automatic purge of finished task sessions after TTL
- [ ] 1.5 Add `maxConcurrentTasks` config (default 10) and enforce at task launch time
- [ ] 1.6 Extend `process` tool `list` action to accept optional `type` filter

## 2. TaskExecutionAdapter interface and task-shell adapter

- [ ] 2.1 Define `TaskExecutionSpec` interface with `command`, `args`, `cwd`, `env`, `timeoutMs`, `outputBufferLimit`
- [ ] 2.2 Define `TaskExecutionAdapter` interface with `type: 'task-shell'` and `launch(session, spec)` method
- [ ] 2.3 Implement `TaskShellAdapter` using `child_process.spawn` with shell (`bash -c`) and full environment forwarding
- [ ] 2.4 Wire `TaskShellAdapter` into the process supervisor alongside existing PTY and child-process adapters
- [ ] 2.5 Implement timeout enforcement in `TaskShellAdapter` using `setTimeout` + SIGKILL

## 3. Supervisor awaitTask method

- [ ] 3.1 Add `supervisor.awaitTask(sessionId: string, timeoutMs: number): Promise<TaskSession>` method
- [ ] 3.2 Implement polling loop that checks session state until terminal or timeout
- [ ] 3.3 Define `TaskTimeoutError` and throw on timeout
- [ ] 3.4 Add tests for awaitTask success, timeout, and missing session

## 4. Scheduler integration

- [ ] 4.1 Update `scheduler.processDueTriggers()` to call `supervisor.launchTask()` instead of directly creating a task record
- [ ] 4.2 Pass trigger config (command, timeout, env) as `TaskExecutionSpec` to the supervisor
- [ ] 4.3 Update trigger firing to store session ID on the task record for output correlation
- [ ] 4.4 Verify heartbeat interval is not blocked by long-running task shells (fire-and-forget model)

## 5. Hook subscription manager integration

- [ ] 5.1 Update `hookSubscriptionManager` to call `supervisor.launchTask()` instead of synchronous `processHook()`
- [ ] 5.2 Ensure `processHook()` returns immediately with session ID without waiting for shell completion
- [ ] 5.3 Update hook trigger cleanup to unsubscribe listener and kill any running task sessions

## 6. Task output persistence

- [ ] 6.1 Add `storeTaskOutput(taskId: string, output: string)` method to memory service
- [ ] 6.2 Subscribe supervisor to session terminal transitions and persist output on task completion
- [ ] 6.3 Emit `task:completed` or `task:failed` events via event bus with output in payload
- [ ] 6.4 Add task output recall in memory service for `task:<taskId>:output` keys

## 7. Config schema updates

- [ ] 7.1 Extend `runtime.exec` config with `taskSessionTTL`, `maxConcurrentTasks`, `taskOutputBufferLimit`, and `taskDefaultTimeout`
- [ ] 7.2 Add runtime config validation that `taskDefaultTimeout` is positive and `maxConcurrentTasks` > 0
- [ ] 7.3 Add startup diagnostics reporting current task session count and limits

## 8. Testing

- [ ] 8.1 Add unit tests for session registry type routing and task session TTL cleanup
- [ ] 8.2 Add unit tests for TaskShellAdapter launch, timeout, output capture, and exit code
- [ ] 8.3 Add integration tests for scheduler trigger firing creating supervised task sessions
- [ ] 8.4 Add integration tests for hook trigger execution creating supervised task sessions
- [ ] 8.5 Add tests for awaitTask success, timeout, and missing session error
- [ ] 8.6 Run full test suite to verify no regressions in exec-runtime-overhaul behavior
