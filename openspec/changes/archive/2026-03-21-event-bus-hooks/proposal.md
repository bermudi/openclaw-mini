## Why

AGENTS.md defines Internal Hooks as a first-class trigger type and `HookInput` exists in `types.ts`, but there is no system that *publishes* hook events. `processHook()` in `InputManager` accepts a `HookInput` and creates a task — but nothing in the codebase ever calls it. The audit service logs lifecycle events (`task_completed`, `task_failed`, `memory_updated`) to the database, but nothing subscribes to those events reactively. Without an event bus, the agent cannot trigger hooks on task completion, memory updates, session events, or adapter state changes — making the entire "internal hooks" capability dead code.

## What Changes

- **Event bus**: A lightweight in-process pub/sub (`EventBus`) that services can publish typed events to and hook triggers can subscribe to. No new dependencies — uses Node.js `EventEmitter` under the hood.
- **System event emission**: Instrument existing services (`AgentExecutor`, `TaskQueue`, `SessionService`, `MemoryService`) to emit events at key lifecycle points (task completed, task failed, memory updated, session created, etc.).
- **Hook trigger subscription**: The scheduler subscribes hook-type triggers to the event bus at startup. When a matching event fires, the trigger calls `inputManager.processHook()` to create a task for the bound agent.
- **Hook trigger matching**: Each hook trigger's `config.event` field is matched against emitted event types. Optional `config.condition` supports simple field-level filtering on event data.

## Capabilities

### New Capabilities
- `event-bus`: In-process typed event bus with publish/subscribe, event type registry, and listener lifecycle management

### Modified Capabilities
- `sub-agents`: Sub-agent task completion/failure should emit events that hook triggers can subscribe to (adds `subagent:completed` and `subagent:failed` event types)

## Impact

- **Files**: New `src/lib/services/event-bus.ts`, updates to `agent-executor.ts`, `task-queue.ts`, `session-service.ts`, `memory-service.ts`, scheduler startup
- **Dependencies**: None — uses Node.js built-in `EventEmitter`
- **Schema**: No database changes — hook triggers already have `config.event` and `config.condition` fields in the `TriggerConfig` type
- **APIs**: No new API routes — hooks are internal-only
