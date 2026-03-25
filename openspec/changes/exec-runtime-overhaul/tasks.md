## 1. Runtime config and dependency setup

- [ ] 1.1 Add `@lydell/node-pty` and any required backend-detection utilities to the project dependencies
- [ ] 1.2 Extend the runtime exec config schema and typed runtime config to support `defaultTier`, `maxTier`, `backend`, `backendPreferenceOrder`, `mounts`, `denyPatterns`, `envPassthrough`, session limits, and PTY defaults
- [ ] 1.3 Add startup/runtime diagnostics that report which isolation backends are available on the host

## 2. Execution backend abstraction

- [ ] 2.1 Create an execution backend interface that can launch commands in `direct`, `sandbox`, and `isolated` tiers
- [ ] 2.2 Implement backend resolution for `none`, `auto`, `landlock`, `firejail`, `docker`, and `podman`
- [ ] 2.3 Implement tier/profile mapping so `sandbox` and `isolated` apply different environment, mount, and resource policies even on the same backend
- [ ] 2.4 Fail isolated launches when the required backend or capability is unavailable instead of silently degrading

## 3. Mount management

- [ ] 3.1 Implement config validation and resolution for execution mounts with alias, host path, permissions, and optional `createIfMissing`
- [ ] 3.2 Build mount-aware working directory resolution for commands and reject disallowed working directories in sandboxed and isolated execution
- [ ] 3.3 Create the synthetic runtime mount view used by shells, PTYs, and backend mount tables
- [ ] 3.4 Add tests for mount validation, read-only enforcement, and working directory resolution across tiers

## 4. Process supervisor and PTY runtime

- [ ] 4.1 Create a singleton process supervisor service with adapters for child-process and PTY execution
- [ ] 4.2 Implement in-memory session tracking with lifecycle states, bounded output buffers, truncation rules, and finished-session retention
- [ ] 4.3 Implement PTY spawning with `@lydell/node-pty`, stdin write support, and terminal sizing defaults
- [ ] 4.4 Add tests for session creation, PTY IO, timeout handling, and missing-session behavior

## 5. Tool surface redesign

- [ ] 5.1 Expand `exec_command` input and execution flow to support tier selection, PTY mode, backgrounding, shell-capable launches, mount-aware cwd, and synchronous-or-session results
- [ ] 5.2 Add the `process` tool with actions for `list`, `poll`, `log`, `write`, `submit`, `send_keys`, `kill`, and `clear`
- [ ] 5.3 Preserve direct argv allowlist enforcement and layer in deny-pattern and environment filtering for shell-capable launches
- [ ] 5.4 Add tool-level tests for foreground completion, background handoff, PTY sessions, and launch failures

## 6. Skill loading integration

- [ ] 6.1 Update skill discovery to scan both `skills/` and `data/skills/`
- [ ] 6.2 Implement precedence rules so agent-managed skills override built-in skills on name collisions
- [ ] 6.3 Add tests covering empty `data/skills/`, mixed built-in/managed loading, and collision behavior

## 7. Mount resolver service extraction

- [ ] 7.1 Extract mount resolution logic into a standalone `MountResolver` service
- [ ] 7.2 Define a clear `MountResolver` interface with `resolveAlias()`, `validatePath()`, and `checkPermission()` operations
- [ ] 7.3 Ensure the service can be used independently by exec_command and future file operations
- [ ] 7.4 Add unit tests for mount resolver in isolation

## 8. Feature flags for incremental rollout

- [ ] 8.1 Add `runtime.exec.featureFlags` to the config schema with typed flags:
  - `enablePty`: boolean (default: false)
  - `enableMounts`: boolean (default: false)
  - `enableIsolationBackends`: boolean (default: false)
  - `enableBackgroundSessions`: boolean (default: false)
- [ ] 8.2 Wire feature flags into the appropriate code paths so capabilities are gated
- [ ] 8.3 Document the flag behavior in runtime config specs
- [ ] 8.4 Ensure all existing behavior is preserved when flags are false (backward compatibility)

## 9. Cross-change cleanup and verification

- [ ] 9.1 Update `agent-skills-overhaul` to depend on `exec-runtime-overhaul` instead of `exec-command-execution-modes`
- [ ] 9.2 Remove or supersede the `exec-command-execution-modes` change artifacts so there is a single authoritative exec runtime proposal
- [ ] 9.3 Run the relevant test suites for exec, skill loading, and runtime config after implementation
- [ ] 9.4 Validate the new OpenSpec change status and confirm all artifacts are ready for `/opsx:apply`
