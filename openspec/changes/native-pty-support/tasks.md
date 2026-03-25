## 1. PTY backend integration

- [ ] 1.1 Add `@lydell/node-pty` dependency and verify it loads correctly with pre-built binaries on target platforms
- [ ] 1.2 Refactor the PTY adapter path to prefer the native backend while preserving the existing supervisor interface
- [ ] 1.3 Keep the current Unix wrapper implementation as an explicit fallback when the native backend is unavailable or fails to initialize

## 2. Session lifecycle and diagnostics

- [ ] 2.1 Ensure PTY session spawn, input forwarding, wait, and kill behavior remain consistent across native and fallback backends
- [ ] 2.2 Add logging for backend selection (native vs fallback) visible to operators
- [ ] 2.3 Add internal diagnostic for tests to query which backend was used for a session
- [ ] 2.4 Add `runtime.exec.forcePtyFallback` config flag to disable native PTY for debugging, with warning log when enabled

## 3. Verification

- [ ] 3.1 Add or update PTY-focused tests for native backend selection, Unix fallback behavior, and realistic failure modes (module load failure, ABI mismatch, unsupported platform)
- [ ] 3.2 Run the relevant exec/process test suite and confirm the change does not expand scope into resize APIs or Windows support
