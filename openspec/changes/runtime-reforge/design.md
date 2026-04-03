## Context

OpenClaw-Mini currently behaves like one runtime split across three processes: a Next.js app, a scheduler service, and a WebSocket service. The split adds delay and fragility because task creation, task execution, trigger firing, and realtime fanout cross process boundaries even though all three processes share the same codebase and the same SQLite file.

There are no production deployments and no external compatibility obligations. That means the right optimization target is simpler runtime shape, not migration safety for an API or package layout that has not shipped.

## Goals / Non-Goals

**Goals:**
- Establish one standalone runtime process as the source of truth for initialization, scheduling, adapters, task execution, and realtime events.
- Remove scheduler-to-app and app-to-WS HTTP hops.
- Replace first-request lazy initialization with eager startup and readiness semantics.
- Restore type-checking and build correctness as part of the reset.
- Keep the existing business behavior intact where practical while deleting topology-specific scaffolding.

**Non-Goals:**
- Preserving current internal route shapes or file layout.
- Splitting the dashboard in the same change.
- Replacing SQLite or the ORM in the same change.
- Introducing a hosted control plane such as Convex.

## Decisions

### Decision 1: Standalone Bun runtime over Next-hosted runtime

**Choice:** Create a dedicated runtime package/process and move runtime ownership out of Next.js.

**Rationale:** The agent system needs explicit startup, background loops, adapter ownership, and graceful shutdown. Those map naturally to a long-running runtime process, not to request-triggered initialization inside API routes.

**Alternatives considered:**
- Keep Next.js as the runtime host and patch around it: keeps the same lifecycle mismatch.
- Move to Convex: adds an external platform without removing the need for a real local runtime.

### Decision 2: Merge scheduler and realtime into the runtime process

**Choice:** Run scheduler loops and realtime broadcasting in-process.

**Rationale:** The current sidecars share code and storage with the app. In-process execution removes the 5-second task pickup delay, duplicate DB clients, and the HTTP callback chain.

**Alternatives considered:**
- Keep sidecars and switch to IPC: still preserves unnecessary process boundaries.
- Keep polling only: easier to preserve, but leaves avoidable latency in the core execution path.

### Decision 3: Event-driven dispatch with reconciliation fallback

**Choice:** Trigger task pickup immediately on task creation while keeping a periodic reconciliation loop for safety.

**Rationale:** Immediate dispatch fixes the responsiveness problem, while a low-frequency sweep protects against missed signals, crashes, or partial failures.

**Alternatives considered:**
- Pure polling: simpler but slower.
- Pure event-driven dispatch: faster, but less forgiving when startup and failure paths are still evolving.

### Decision 4: Delete compatibility scaffolding instead of wrapping it

**Choice:** Remove `mini-services/` ownership and backplane plumbing rather than preserve it behind compatibility wrappers.

**Rationale:** There are no prod consumers to protect. Wrappers would keep old assumptions alive and make the reset larger and harder to verify.

### Decision 5: Defer storage-layer replacement

**Choice:** Keep SQLite and the current ORM during the runtime reset unless a concrete blocker appears.

**Rationale:** The highest-risk problem is runtime topology. Solving that first yields a smaller, easier-to-debug change and gives a cleaner baseline for later storage work.

## Risks / Trade-offs

- **[Risk] Runtime extraction becomes an unbounded rewrite** → Mitigation: keep focus on process ownership, lifecycle, and deletion of old sidecars; defer storage and dashboard redesign.
- **[Risk] Event-driven dispatch misses edge cases during transition** → Mitigation: keep a reconciliation sweep that claims runnable work periodically.
- **[Risk] Adapter startup ownership becomes duplicated** → Mitigation: centralize adapter startup and shutdown in the runtime lifecycle manager.
- **[Risk] Removing build suppressions exposes many type errors** → Mitigation: make type-safety restoration an explicit first implementation phase.

## Migration Plan

1. Restore build correctness and strict type-checking.
2. Scaffold the standalone runtime package and move startup/config ownership into it.
3. Move scheduler loops into the runtime and replace HTTP callbacks with direct service calls.
4. Move realtime broadcasting into the runtime and delete backplane client plumbing.
5. Delete sidecars and old runtime-host assumptions from the root package.
6. Verify with the runtime test suite and local end-to-end execution.

## Open Questions

- Should the runtime expose a minimal HTTP API immediately, or can the first cut focus on process ownership and tests before re-adding operator endpoints?
- Should the first runtime reset keep Socket.IO for dashboard compatibility, or is this a good moment to switch to a lighter realtime transport?
