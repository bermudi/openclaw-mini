## 1. Persistence and config

- [ ] 1.1 Add a durable `CodingAgentSession` model to `prisma/schema.prisma` with ownership, parent-task linkage, controller status, backend, working-directory metadata, backing `processSessionId`, and recovery/error fields
- [ ] 1.2 Generate and apply the Prisma migration for the new coding-agent session storage
- [ ] 1.3 Extend the runtime config schema and typed accessors to support `runtime.codingAgents.enabled`, `defaultBackend`, `maxConcurrentSessionsPerAgent`, `outputTailLimit`, and `idleInterruptSeconds`

## 2. Coding-agent controller service

- [ ] 2.1 Create a coding-agent controller service that can create, read, list, message, and cancel durable coding-agent sessions
- [ ] 2.2 Implement controller-side status projection from durable coding-agent sessions plus backing process-session snapshots
- [ ] 2.3 Persist parent-task linkage and ownership metadata when a coding-agent session is spawned from task context

## 3. Process-runtime integration and recovery

- [ ] 3.1 Launch coding-agent sessions through the existing PTY-capable process supervisor and store the returned `processSessionId`
- [ ] 3.2 Update controller state on backing process termination, timeout, or kill so coding-agent sessions reach the correct terminal status
- [ ] 3.3 Add runtime startup/recovery handling that marks orphaned `starting` or `running` coding-agent sessions as `interrupted` when their backing process session is missing

## 4. Tool and skill surface

- [ ] 4.1 Register `spawn_coding_agent`, `check_coding_agent`, `message_coding_agent`, `cancel_coding_agent`, and `list_coding_agents` in `src/lib/tools.ts`
- [ ] 4.2 Enforce feature gating and per-agent concurrency limits in the coding-agent tool surface
- [ ] 4.3 Update `skills/coder/SKILL.md` to include `process` in frontmatter and rewrite the instructions around managed coding-session workflows

## 5. Verification

- [ ] 5.1 Add tests for runtime config parsing/defaults and feature-disabled behavior for coding-agent control
- [ ] 5.2 Add controller tests covering spawn, inspect, message, list, cancel, and parent-task linkage
- [ ] 5.3 Add runtime integration tests covering process-session binding, terminal-state projection, and orphaned-session recovery
- [ ] 5.4 Run the relevant Prisma, controller, exec/process, and skill regression suites and confirm the change is ready for `/opsx:apply`
