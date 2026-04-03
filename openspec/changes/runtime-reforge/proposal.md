## Why

OpenClaw-Mini's biggest problem is not missing features, but the fact that the runtime is split across a Next.js app, a scheduler sidecar, and a WebSocket sidecar. That shape adds polling, extra HTTP hops, lazy startup, and SQLite contention to a system that wants to behave like a single long-running process.

## What Changes

- Create a standalone runtime process that owns startup, adapters, task execution, trigger processing, and realtime events.
- Merge the scheduler and WebSocket sidecars into the runtime process and delete the HTTP backplane between them.
- Replace request-triggered lazy initialization with explicit process startup, readiness checks, and graceful shutdown.
- Restore strict type-checking and remove build-time error suppression as part of the runtime reset.
- **BREAKING** Remove the assumption that Next.js API routes are the runtime host.
- **BREAKING** Remove the sidecar process model in `mini-services/`.

## Capabilities

### New Capabilities
- `runtime-process`: A standalone runtime process that owns initialization, scheduler loops, realtime broadcasting, and shutdown behavior.

### Modified Capabilities
- `adapter-lifecycle`: Adapter startup and shutdown move from the scheduler sidecar to the runtime process.
- `event-bus`: Events are delivered in-process by the runtime instead of crossing a WebSocket backplane hop.
- `startup-validation`: Startup checks move from Next.js instrumentation and lazy init to explicit runtime boot.
- `storage-concurrency`: SQLite write ownership changes from multi-process coordination to runtime-owned single-process access.
- `task-execution-durability`: Task claiming and recovery are re-centered around the runtime process rather than scheduler callbacks into Next.js.

## Impact

- Affected code: `src/lib/init/`, `src/lib/services/`, `src/lib/adapters/`, `mini-services/`, API routes, root scripts.
- Affected systems: runtime lifecycle, scheduler, realtime delivery, adapter ownership, SQLite access patterns.
- Dependencies: likely adds a small runtime HTTP layer and removes sidecar-specific plumbing.
