## Context

OpenClaw Mini already has most of the low-level machinery needed for coding-agent control: durable tasks, isolated sessions, a runtime loop, supervised PTY/background processes, and focused subagent delegation. What it does not have is a durable controller layer that turns those primitives into a first-class product surface for long-lived coding work.

Today the system has two mismatched abstractions. `spawn_subagent` is good for short, blocking delegation, and `exec_command` plus `process` are good for raw command execution and terminal supervision. Neither gives users a managed coding session they can start, inspect, steer, and cancel over time. That gap is exactly where OpenClaw's coding-agent control feels more complete.

The feature needs to stay aligned with the current architecture instead of introducing a parallel runtime. The design therefore has to reuse the task loop, process supervisor, config system, and skill system while adding a durable control plane above them.

## Goals / Non-Goals

**Goals:**
- introduce a first-class `CodingAgentSession` concept with durable lifecycle state
- expose explicit control-plane operations to spawn, inspect, message, cancel, and list coding-agent sessions
- back each managed coding session with a supervised PTY process session rather than ad hoc shell launches
- preserve parent-task linkage so supervisors can delegate work into a persistent coding session without losing traceability
- integrate coding-agent recovery and health projection into the existing runtime lifecycle
- expand the built-in coder skill so it matches the managed-session execution model

**Non-Goals:**
- full OpenClaw ACP parity, including remote gateways or multi-runtime orchestration
- automatic resumption of an in-flight coding process after host or runtime restart
- distributed or multi-node control of the same coding session
- a complete dashboard implementation in the same change
- arbitrary backend plugins beyond the initial supervised-process-backed implementation

## Decisions

### Decision 1: Introduce a durable `CodingAgentSession` record separate from tasks and process sessions

The controller needs its own durable entity instead of overloading `Task` or `process` session state.

The new record stores the product-level lifecycle and metadata:
- owning `agentId`
- optional `parentTaskId`
- optional `sessionId` for transcript/context linkage
- controller status such as `starting`, `running`, `completed`, `failed`, `cancelled`, or `interrupted`
- selected backend identifier
- working directory or workspace target
- backing `processSessionId`
- timestamps for creation, last activity, and last observed output
- last error / termination reason

This keeps the controller durable even if the underlying process session is transient, missing, or rotated.

Alternatives considered:
- Reuse `Task` as the durable record: rejected because tasks represent one execution unit, not a steerable session with follow-up messages.
- Reuse `process` sessions directly: rejected because they are runtime primitives, not durable product entities.

### Decision 2: Coding-agent control is exposed through dedicated tools, not by asking callers to stitch together `exec_command` and `process`

The feature surface is a small controller API:
- `spawn_coding_agent`
- `check_coding_agent`
- `message_coding_agent`
- `cancel_coding_agent`
- `list_coding_agents`

These tools operate on `CodingAgentSession` records and only use `process` internally. Callers no longer need to reason about PTY buffering, handoff timing, or process-session ownership in order to manage a coding worker.

Alternatives considered:
- Tell users to compose `exec_command` and `process` manually: rejected because it leaks implementation details and prevents durable state projection.

### Decision 3: Each managed coding session is backed by one supervised PTY process session at a time

The runtime already has a good PTY/session substrate. The controller should reuse it instead of building a second terminal abstraction.

When a coding-agent session is spawned, the controller launches a PTY-backed process session and stores the returned `processSessionId`. The controller projects process state into coding-session state:
- running process -> `running`
- normal exit -> `completed` or `failed` depending on exit status
- explicit cancel -> `cancelled`
- missing backing process during recovery -> `interrupted`

This gives us durable status without pretending the controller can magically resume terminal state after restart.

Alternatives considered:
- Build persistent coding sessions on top of child tasks only: rejected because the current gap is specifically around long-lived interactive control.

### Decision 4: Parent linkage is preserved, but coding-agent sessions are not subagent tasks

The parent task that launches a coding session is recorded on the `CodingAgentSession`, but the session itself is not represented as a long-lived `Task`. Tasks remain discrete execution units; coding-agent sessions are controlled runtimes that may outlive the parent interaction.

This keeps the supervisor story strong without distorting the task model.

Alternatives considered:
- Model every follow-up message as a child subagent task only: rejected because it collapses a persistent session back into repeated one-shot work.

### Decision 5: Follow-up instructions flow through the controller and are translated into PTY input

`message_coding_agent` is the only public way to send additional instructions to a running coding session. The controller validates session status, appends audit history, and writes the instruction to the backing PTY session using the runtime's canonical process-input path.

This preserves control-plane ownership and avoids bypassing session policy through raw `process.write` calls.

Alternatives considered:
- Let callers write directly to `process` sessions: rejected because it bypasses durable lifecycle tracking and ownership rules.

### Decision 6: Configuration lives under `runtime.codingAgents`

The feature needs explicit configuration for enablement, concurrency, and defaults, but it should not overload `runtime.exec` with controller-specific policy.

The initial config surface should include:
- `enabled`
- `defaultBackend`
- `maxConcurrentSessionsPerAgent`
- `outputTailLimit`
- `idleInterruptSeconds`

`runtime.exec` remains responsible for the execution substrate, while `runtime.codingAgents` governs the product feature.

### Decision 7: Startup recovery marks orphaned running sessions as `interrupted` instead of trying to resume them

Automatic reattachment to a prior PTY session is not a realistic v1 guarantee. On runtime startup and periodic recovery sweeps, any coding-agent session still marked `starting` or `running` whose backing process session is gone is transitioned to `interrupted` with a recorded recovery reason.

That gives operators clear truth without overpromising restart durability.

## Risks / Trade-offs

- [Feature adds a second durable controller model] -> Mitigation: keep `CodingAgentSession` narrow and explicitly layered above the existing process supervisor rather than inventing a parallel execution runtime.
- [PTY-backed workers can become protocol-specific] -> Mitigation: keep the initial backend contract minimal and controller-owned so future backend-specific adapters can evolve without changing user-facing tools.
- [Long-lived sessions increase cleanup pressure] -> Mitigation: add explicit idle interruption and runtime recovery sweeps under `runtime.codingAgents` limits.
- [Parent task linkage could confuse task semantics] -> Mitigation: store linkage on the coding-session record instead of promoting sessions to durable tasks.
- [Controller tools may overlap conceptually with `process`] -> Mitigation: document `process` as substrate/debug surface and coding-agent tools as the supported product workflow.

## Migration Plan

1. Add `CodingAgentSession` persistence and runtime config schema updates.
2. Implement a controller service that can create, inspect, list, message, and cancel sessions.
3. Bind controller sessions to supervised PTY process sessions and status projection.
4. Integrate recovery/interruption handling into the runtime lifecycle.
5. Register the coding-agent control tools.
6. Update the coder skill to reflect managed-session workflows and tool access.
7. Add targeted tests for lifecycle, recovery, linkage, and config validation.

Rollback strategy:
- disable `runtime.codingAgents.enabled`
- stop exposing the control tools
- leave existing `exec_command`, `process`, and `spawn_subagent` behavior untouched

## Open Questions

- Should the first backend command be fully config-driven, or should we ship one built-in backend profile for local coding workers?
- Do we want a dedicated transcript/history table for coding-session messages, or is audit-plus-tail inspection enough for v1?
- Should a completed coding-agent session be messageable again via relaunch semantics, or must operators spawn a fresh session?
