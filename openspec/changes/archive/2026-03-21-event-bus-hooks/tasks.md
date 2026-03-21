## 1. Event Bus Core

- [x] 1.1 Create `src/lib/services/event-bus.ts` with a typed `EventBus` class wrapping `EventEmitter`: define the `EventMap` type mapping event names (`task:completed`, `task:failed`, `task:created`, `session:created`, `memory:updated`, `subagent:completed`, `subagent:failed`) to their payload shapes; export typed `emit()` and `on()` methods where `on()` returns an unsubscribe function
- [x] 1.2 Implement listener error isolation: wrap each listener call in try/catch, log errors via `console.error`, ensure other listeners still execute and `emit()` never throws
- [x] 1.3 Export a singleton `eventBus` instance from the module

## 2. System Event Emission

- [x] 2.1 Instrument `TaskQueue.completeTask()` and `completeTaskSideEffects()` in `src/lib/services/task-queue.ts` to emit `task:completed` with `{ taskId, agentId, taskType, result }` after DB commit
- [x] 2.2 Instrument `TaskQueue.failTask()` and `failTaskSideEffects()` to emit `task:failed` with `{ taskId, agentId, taskType, error }` after DB commit
- [x] 2.3 Instrument `TaskQueue.createTask()` to emit `task:created` with `{ taskId, agentId, taskType, priority }` after DB commit
- [x] 2.4 Instrument `AgentExecutor.runPostCommitSideEffects()` in `src/lib/services/agent-executor.ts` to emit `subagent:completed` with `{ taskId, parentTaskId, skillName, agentId }` when a sub-agent task completes
- [x] 2.5 Instrument `AgentExecutor` failure path to emit `subagent:failed` with `{ taskId, parentTaskId, skillName, agentId, error }` when a sub-agent task fails
- [x] 2.6 Emit `session:created` from `SessionService.getOrCreateSession()` in `src/lib/services/session-service.ts` when a new session is created (not on cache hit)
- [x] 2.7 Emit `memory:updated` from `MemoryService` in `src/lib/services/memory-service.ts` after memory writes commit

## 3. Hook Trigger Subscription

- [x] 3.1 Create a `HookSubscriptionManager` (in event-bus.ts or a new file) that loads enabled hook triggers from the DB, subscribes each to the event bus matching `config.event`, and stores unsubscribe handles keyed by trigger ID
- [x] 3.2 Implement condition-based filtering: when a hook trigger has `config.condition`, check all key-value pairs against event data using shallow `===` equality; skip `processHook()` call if any pair doesn't match
- [x] 3.3 Wire `HookSubscriptionManager.initialize()` into the scheduler startup after `initializeAdapters()`
- [x] 3.4 Add `subscribeHookTrigger(triggerId)` and `unsubscribeHookTrigger(triggerId)` methods for runtime trigger changes; call them from trigger service create/update/delete operations

## 4. Testing

- [x] 4.1 Write event bus unit tests: emit/receive typed events, unsubscribe stops delivery, multiple listeners all called, listener error isolation (throwing listener doesn't block others, emit doesn't throw)
- [x] 4.2 Write hook subscription tests: trigger with matching event fires `processHook()`, disabled trigger not subscribed, condition filtering (match/no-match/no-condition), multiple conditions all must match
- [x] 4.3 Write integration tests: task completion triggers hook trigger → task created for hook agent; sub-agent completion emits `subagent:completed` event picked up by hook trigger
