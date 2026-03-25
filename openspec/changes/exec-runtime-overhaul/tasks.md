## 1. Runtime config and startup behavior

- [ ] 1.1 Extend the runtime exec config schema to support `defaultTier`, `maxTier`, `containerRuntime`, `mounts`, session limits, and launch defaults
- [ ] 1.2 Encode privilege ordering consistently for `locked-down < sandbox < host`
- [ ] 1.3 Add startup diagnostics that report container runtime availability and default-tier viability
- [ ] 1.4 Fail startup validation when the configured default tier requires containers but no supported runtime is available

## 2. Container runtime detection and isolated execution

- [ ] 2.1 Implement container runtime detection: prefer `docker`, fallback to `podman`, otherwise return null
- [ ] 2.2 Create container execution module for `sandbox` and `locked-down` tiers
- [ ] 2.3 Implement tier-specific isolation profiles:
  - `sandbox`: approved mounts, writable where permitted, network enabled
  - `locked-down`: read-only mounts, minimal env, `--network none`
- [ ] 2.4 Reject isolated launches clearly when no supported container runtime is available

## 3. Mounts and working directory resolution

- [ ] 3.1 Implement config validation for execution mounts: alias, host path, permissions, optional `createIfMissing`
- [ ] 3.2 Implement mount-aware cwd resolution and invalid-path rejection
- [ ] 3.3 Define and implement overlap/symlink/path-normalization rules for mounts
- [ ] 3.4 Add tests for mount validation, read-only enforcement, and cwd resolution

## 4. Process supervisor and PTY runtime

- [ ] 4.1 Create a singleton process supervisor with child-process and PTY adapters
- [ ] 4.2 Implement in-memory session tracking, lifecycle states, bounded buffers, and truncation rules
- [ ] 4.3 Implement PTY spawning, input writing, and terminal defaults
- [ ] 4.4 Add tests for session creation, PTY IO, timeout handling, and missing-session behavior

## 5. Tool surface redesign

- [ ] 5.1 Expand `exec_command` input to support tier selection, launch mode, backgrounding, and mount-aware cwd
- [ ] 5.2 Preserve allowlist enforcement for direct argv mode
- [ ] 5.3 Define and implement shell-mode policy by tier
- [ ] 5.4 Add the `process` tool with canonical actions: `list`, `poll`, `log`, `write`, `kill`
- [ ] 5.5 Add tool-level tests for synchronous completion, background handoff, PTY sessions, and tier-specific behavior

## 6. Output surfacing and delivery

- [ ] 6.1 Decide the first output handoff strategy for files generated outside the legacy sandbox
- [ ] 6.2 Implement that strategy so generated files can be delivered safely to chat
- [ ] 6.3 Add tests for surfaced files from mounted workspaces

## 7. Verification

- [ ] 7.1 Run the relevant exec/runtime test suites after implementation
- [ ] 7.2 Confirm the OpenSpec artifacts remain aligned and ready for `/opsx:apply`
