## Context

OpenClaw-Mini stores time-based triggers in the `Trigger` table using `type`, `config`, `lastTriggered`, and `nextTrigger`. Heartbeat and cron triggers are then polled by the standalone scheduler service, which enqueues work for agents.

Today, time-based trigger behavior is scattered across multiple places:
- `src/lib/services/trigger-service.ts` computes the initial `nextTrigger` when a trigger is created or updated
- `mini-services/scheduler/index.ts` recomputes `nextTrigger` after a scheduled fire
- `src/lib/services/input-manager.ts` still contains `processHeartbeat`, `processCron`, and ad-hoc scheduling helpers even though nothing calls those paths for scheduled execution

Cron support is especially inconsistent. Trigger creation uses a fixed `+1 day` fallback, scheduler rescheduling attempts to call a non-existent parser API on `node-cron` and falls back to `+1 hour`, and the dead `InputManager` path has its own `+24 hours` fallback. The project therefore has no unified cron system today; it has several partial implementations with different semantics.

The scheduler is also split across two separate write paths when a scheduled trigger fires:
- create task via `POST /api/tasks`
- update trigger timestamps via `POST /api/internal/triggers/:id/fire`

That split is acceptable for simple heartbeats, but it makes cron correctness and future manual fire behavior harder to reason about because task creation and schedule mutation are not owned by one service boundary.

## Goals / Non-Goals

**Goals:**
- Use one canonical cron implementation for trigger validation and `nextTrigger` calculation
- Make trigger creation/update and scheduled execution compute the same next run from the same expression and reference time
- Eliminate dead or misleading time-trigger code paths
- Add a manual fire operation for enabled heartbeat and cron triggers that supports testing and one-off override
- Keep manual fire and scheduled fire behavior consistent without duplicating task-shaping logic

**Non-Goals:**
- Per-trigger timezone configuration
- Manual fire for webhook or hook triggers
- Replacing the polling scheduler architecture
- Redesigning the `Trigger` data model beyond using existing fields correctly

## Decisions

### D1: Use `croner` as the single cron engine

`croner` will be used for cron validation and next-run calculation through a shared utility module. That utility will be the only place that understands cron syntax and will be used by both trigger write boundaries and scheduled execution boundaries.

Cron evaluation will use UTC in this change. The project does not currently store a per-trigger timezone, so host-local evaluation would be nondeterministic across environments.

**Alternatives considered:**
- `cron` package: viable, but brings in Luxon and is less direct for parse-only use cases
- Keep `node-cron` and add another parser library: rejected because it preserves conceptual duplication
- Host-local timezone evaluation: rejected because behavior would vary by deployment environment

### D2: Make trigger firing authoritative in `triggerService`

Time-based trigger firing will be consolidated behind one authoritative service method in the app process. That method will load the trigger, validate that it is an enabled heartbeat/cron trigger, build the task payload/source, enqueue the task, and apply schedule mutations only when the fire mode is `scheduled`.

This keeps the rules for "what a time-based trigger fire does" in one place instead of spreading them across scheduler code, API routes, and dead `InputManager` paths.

**Alternatives considered:**
- Keep scheduler split across `/api/tasks` plus `/api/internal/triggers/:id/fire`: rejected because it duplicates fire semantics across boundaries
- Route scheduler through `/api/input`: rejected because cron/heartbeat are not real external inputs and the existing `InputManager` path is unwired
- Implement separate manual-fire logic in the route handler: rejected because it would introduce a second execution path

### D3: Scheduled fire and manual fire share execution semantics but not schedule mutation

The authoritative trigger-firing service will support two modes:
- `scheduled`: enqueue the task, set `lastTriggered`, and compute the next `nextTrigger`
- `manual`: enqueue the same kind of task, but do not rewrite `lastTriggered` or `nextTrigger`

Manual fire is therefore an operator action, not a scheduler event. This preserves the schedule, avoids drift, and keeps testing/override from changing when the next scheduled run will happen.

Manual fires should stamp distinctive task metadata or source values so operators and tests can distinguish them from scheduled executions.

**Alternatives considered:**
- Update `lastTriggered` on manual fire only: rejected because it mixes operator testing with scheduler bookkeeping
- Recompute `nextTrigger` on manual fire: rejected because it changes schedule state based on an override action

### D4: Limit manual fire to enabled heartbeat and cron triggers

The manual fire route will only support `heartbeat` and `cron` triggers. `webhook` and `hook` triggers are event-driven and do not represent queued time-based work in the same way.

Disabled triggers and missing triggers will be rejected. This keeps the route focused on time-based trigger testing/override rather than becoming a general-purpose event injection mechanism.

**Alternatives considered:**
- Support all trigger types: rejected because it blurs the distinction between scheduled triggers and event ingress
- Allow firing disabled triggers for testing: rejected because it sidesteps the operator's enabled/disabled intent

### D5: New manual fire route follows the control-plane auth model

`POST /api/triggers/[id]/fire` is a control-plane operation and should use the same internal-auth model as other trigger administration routes. If `auth-route-hardening` lands first, this route should follow that established helper. If it has not landed yet, the new route should still be implemented with `requireInternalAuth` so it does not become another unprotected admin endpoint.

**Alternatives considered:**
- Leave manual fire unauthenticated for convenience: rejected as unsafe
- Hide manual fire behind scheduler-only internal APIs: rejected because operators need a direct testing/override entry point

## Risks / Trade-offs

**Cross-process refactor of scheduler fire flow**
- The scheduler currently creates tasks and updates triggers through two calls.
- Moving to one authoritative fire path changes an internal contract between the scheduler and app process.
-> Mitigation: add integration tests that prove a due trigger produces the expected task and next `nextTrigger` through the new boundary.

**UTC scheduling may surprise users expecting local time**
- Existing UI examples imply "daily at 9" but the system has no timezone model.
-> Mitigation: document UTC as the current deterministic policy and defer per-trigger timezone support to a future change.

**Manual fire will not update dashboard `lastTriggered` timestamps**
- Operators may expect a manual test to show up as "last fired".
-> Mitigation: preserve schedule correctness and expose manual execution through task source/metadata instead of schedule bookkeeping.

**Concurrent work with `auth-route-hardening`**
- Another in-progress change touches trigger route authentication.
-> Mitigation: keep this design aligned with `requireInternalAuth` and rebase route changes carefully during implementation.

## Migration Plan

1. Add `croner` and introduce a shared cron/time-trigger utility with UTC validation and `nextTrigger` calculation helpers.
2. Extend `triggerService` with an authoritative time-trigger fire method for `scheduled` and `manual` execution modes.
3. Refactor `/api/internal/triggers/[id]/fire` so scheduled trigger execution uses the authoritative service path.
4. Update the scheduler to call the authoritative scheduled-fire endpoint instead of separate task-creation and trigger-update APIs.
5. Add `POST /api/triggers/[id]/fire` for authenticated manual fire of enabled heartbeat/cron triggers.
6. Remove dead `InputManager` heartbeat/cron execution paths and any unused supporting helpers.
7. Add deterministic tests for cron validation, cron next-run calculation, scheduled execution, and manual fire schedule preservation.

**Rollback:** revert the change, restoring the prior scheduler behavior and removing the manual fire route.

## Open Questions

- Should the dashboard eventually expose manual fire history separately from scheduled fire history? This change assumes task metadata or source is sufficient for now.
