## 1. Interface Definition

- [ ] 1.1 Create `src/runtime/exec/backends/types.ts` with `IsolationBackend` interface, `BackendId`, `BackendCapabilities`, `LaunchConfig`, `LaunchResult`, `Mount`, `SecurityProfile`, `SecurityConstraints`, `NetworkMode`, `ResourceLimits`, `FsRestriction`, `NetRestriction`, `ValidationResult`, `PtyConfig`
- [ ] 1.2 Create `src/runtime/exec/backends/errors.ts` with `BackendUnavailableError` and `BackendConstraintError` classes
- [ ] 1.3 Export all backend types from `src/runtime/exec/backends/index.ts`

## 2. None Backend (Direct Execution)

- [ ] 2.1 Create `src/runtime/exec/backends/none.ts` implementing `IsolationBackend` for direct execution
- [ ] 2.2 Implement `detectCapabilities()` returning `isAvailable: true` with empty restrictions
- [ ] 2.3 Implement `launch()` spawning process directly without isolation
- [ ] 2.4 Implement `cleanup()` as no-op (no resources to release)
- [ ] 2.5 Add unit tests verifying direct spawn and no-op cleanup

## 3. Landlock Backend

- [ ] 3.1 Create `src/runtime/exec/backends/landlock.ts` implementing `IsolationBackend`
- [ ] 3.2 Implement `detectCapabilities()` checking kernel version >= 5.13 and `/sys/kernel/security/landlock` accessibility
- [ ] 3.3 Implement `getSecurityConstraints(profile)` returning landlock-specific constraints
- [ ] 3.4 Implement `launch()` using landlock syscall interface
- [ ] 3.5 Implement `cleanup()` removing landlock ruleset
- [ ] 3.6 Add unit tests for capability detection on supported/unsupported kernels

## 4. Firejail Backend

- [ ] 4.1 Create `src/runtime/exec/backends/firejail.ts` implementing `IsolationBackend`
- [ ] 4.2 Implement `detectCapabilities()` checking `firejail` binary on PATH
- [ ] 4.3 Implement `validateMounts()` checking mount count against `maxMounts`
- [ ] 4.4 Implement `getSecurityConstraints(profile)` returning firejail flags for sandbox/isolated
- [ ] 4.5 Implement `launch()` spawning firejail with appropriate flags
- [ ] 4.6 Implement `cleanup()` terminating firejail process tree
- [ ] 4.7 Add unit tests for binary detection and flag generation

## 5. Docker Backend

- [ ] 5.1 Create `src/runtime/exec/backends/docker.ts` implementing `IsolationBackend`
- [ ] 5.2 Implement `detectCapabilities()` checking docker binary and socket accessibility
- [ ] 5.3 Implement `validateMounts()` mapping alias mounts to docker volume flags
- [ ] 5.4 Implement `getSecurityConstraints(profile)` generating docker security options
- [ ] 5.5 Implement `launch()` creating container with mounts and constraints
- [ ] 5.6 Implement `cleanup()` stopping and removing container
- [ ] 5.7 Add unit tests for volume flag generation and container lifecycle

## 6. Podman Backend

- [ ] 6.1 Create `src/runtime/exec/backends/podman.ts` implementing `IsolationBackend`
- [ ] 6.2 Implement `detectCapabilities()` checking podman binary and socket accessibility
- [ ] 6.3 Implement `validateMounts()` mapping alias mounts to podman volume flags
- [ ] 6.4 Implement `getSecurityConstraints(profile)` generating podman security options
- [ ] 6.5 Implement `launch()` creating podman container with mounts and constraints
- [ ] 6.6 Implement `cleanup()` stopping and removing podman container
- [ ] 6.7 Add unit tests for volume flag generation and container lifecycle

## 7. Backend Registry and Resolution

- [ ] 7.1 Create `src/runtime/exec/backends/registry.ts` with `BackendRegistry` class
- [ ] 7.2 Implement `register(backend: IsolationBackend)` adding backend to registry
- [ ] 7.3 Implement `detectAll()` returning capabilities for all registered backends
- [ ] 7.4 Create `src/runtime/exec/backends/resolve.ts` with `resolveBackend()` function
- [ ] 7.5 Implement `resolveBackend(preference, tier, capabilities)` per decision 3
- [ ] 7.6 Add unit tests for backend selection with auto and explicit modes

## 8. Runtime Integration

- [ ] 8.1 Update `src/runtime/exec/runtime.ts` to accept `IsolationBackend` in constructor
- [ ] 8.2 Update tier resolution to use `resolveBackend()` instead of hardcoded logic
- [ ] 8.3 Update launch path to call `validateMounts()` if backend exposes it
- [ ] 8.4 Update error handling to catch and surface `BackendUnavailableError` with suggestions
- [ ] 8.5 Update startup logging to report available backends and capabilities
- [ ] 8.6 Add integration tests verifying tier ceiling enforcement

## 9. Configuration Updates

- [ ] 9.1 Add `runtime.exec.backendPreference` to config schema with `mode` and `order`/`backends` fields
- [ ] 9.2 Update `runtime-config/spec.md` with backend preference configuration scenarios
- [ ] 9.3 Add validation that `order`/`backends` contains only valid `BackendId` values

## 10. Spec Compliance Verification

- [ ] 10.1 Verify all `IsolationBackend` implementations satisfy mandatory interface contract
- [ ] 10.2 Verify `detectCapabilities()` is synchronous for all backends
- [ ] 10.3 Verify mount validation errors include actionable suggestions
- [ ] 10.4 Verify `isolated` tier fails with `BackendUnavailableError` when no backend available
- [ ] 10.5 Verify `none` backend is used exclusively for `direct` tier
