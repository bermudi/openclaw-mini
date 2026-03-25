## 1. Runtime config and dependency setup

- [ ] 1.1 Add `@lydell/node-pty` dependency to the project
- [ ] 1.2 Extend the runtime exec config schema to support `defaultTier`, `maxTier`, `containerRuntime`, `mounts`, session limits, and PTY defaults
- [ ] 1.3 Add startup diagnostics that report which container runtime (Docker/Podman) is available

## 2. Container runtime detection and execution

- [ ] 2.1 Implement container runtime detection: check for `docker`, then `podman`, return null if neither available
- [ ] 2.2 Create container execution module that builds Docker/Podman CLI args for `sandbox` and `locked-down` tiers
- [ ] 2.3 Implement tier-specific container profiles:
  - `sandbox`: mounts with read/write, network enabled
  - `locked-down`: read-only mounts, `--network none`, minimal env
- [ ] 2.4 Fail `sandbox`/`locked-down` launches when no container runtime is available (clear error, not silent fallback)

## 3. Mount management

- [ ] 3.1 Implement config validation for execution mounts with alias, host path, permissions, and optional `createIfMissing`
- [ ] 3.2 Build mount-aware working directory resolution for commands (resolve alias to container path)
- [ ] 3.3 Generate container mount arguments from mount config
- [ ] 3.4 Add tests for mount validation, read-only enforcement, and working directory resolution

## 4. Process supervisor and PTY runtime

- [ ] 4.1 Create a singleton process supervisor service with adapters for child-process and PTY execution
- [ ] 4.2 Implement in-memory session tracking with lifecycle states, bounded output buffers, truncation rules
- [ ] 4.3 Implement PTY spawning with `@lydell/node-pty`, stdin write support, and terminal sizing defaults
- [ ] 4.4 Add tests for session creation, PTY IO, timeout handling, and missing-session behavior

## 5. Tool surface redesign

- [ ] 5.1 Expand `exec_command` input to support tier selection, PTY mode, backgrounding, and mount-aware cwd
- [ ] 5.2 Add the `process` tool with actions for `list`, `poll`, `write`, `kill`
- [ ] 5.3 Implement tier routing: `host` → direct spawn, `sandbox`/`locked-down` → container execution
- [ ] 5.4 Add tool-level tests for foreground completion, background handoff, PTY sessions, and tier-specific behavior

## 6. Cross-change cleanup and verification

- [ ] 6.1 Run the relevant test suites for exec and runtime config after implementation
- [ ] 6.2 Validate the OpenSpec change status and confirm all artifacts are ready for `/opsx:apply`
