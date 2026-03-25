## Context

`exec-runtime-overhaul` intentionally shipped PTY support with a lightweight Unix `script` wrapper so the broader execution model could land without taking on native PTY packaging complexity. This change adopts `@lydell/node-pty`, a fork of `node-pty` that ships pre-built binaries for common platforms, avoiding native compilation issues on user machines. That kept the first change small, but it also means PTY-backed sessions are less faithful to the terminal behavior expected by coding agents and by the original OpenClaw runtime, which uses `@lydell/node-pty`.

This follow-up change is intentionally narrower than a full PTY redesign. The goal is to improve interactive terminal fidelity for coding-agent workloads while preserving the existing `exec_command` and `process` tool surfaces. Dynamic resize support and Windows parity are explicitly deferred so the implementation can focus on backend selection, lifecycle handling, and fallback behavior.

## Goals / Non-Goals

**Goals:**
- prefer a native PTY backend for PTY-mode process sessions when the dependency is available
- preserve a fallback PTY path on Unix-like hosts when the native backend cannot be loaded
- define observable fallback behavior so PTY session failures are clear and predictable
- keep the current tool contracts stable for `exec_command` and `process`

**Non-Goals:**
- adding terminal resize APIs or session dimension updates after spawn
- delivering Windows PTY support in this change
- changing execution-tier policy, mount policy, or process tool verbs
- removing the fallback path entirely

## Decisions

### Decision 1: Use a native PTY adapter as the primary backend

The process supervisor will try to create PTY sessions through `@lydell/node-pty` first.

Why:
- it is the closest match to the original OpenClaw runtime
- it provides more faithful interactive terminal behavior than a `script` wrapper
- it keeps PTY concerns inside the existing supervisor abstraction rather than leaking backend details into tool handlers

Alternative considered:
- keep the `script` wrapper as the only backend
- rejected because it leaves the known fidelity gap in place for coding-agent sessions

### Decision 2: Keep a Unix fallback backend with explicit behavior

If the native PTY module is unavailable or fails to initialize on a supported Unix host, the runtime will fall back to the existing `script`-based PTY path instead of disabling PTY outright.

Why:
- it preserves the behavior shipped in `exec-runtime-overhaul`
- it reduces deployment risk from native module packaging issues
- it allows incremental rollout while still improving the default path

Alternative considered:
- fail closed whenever the native module is missing
- rejected because it would regress environments that currently rely on the wrapper path

### Decision 3: Defer resize and Windows parity

The change will not add a resize API or commit to Windows PTY behavior.

Why:
- current user need is better interactive fidelity for coding agents, not terminal UI management
- resize support would require new session APIs and broader spec changes
- Windows support introduces a separate packaging and platform-validation track

Alternative considered:
- bundle resize and Windows work into the same change
- rejected to keep this proposal small, testable, and easier to ship

### Decision 4: Treat backend selection as an internal implementation detail, but specify fallback outcomes

The public tools will not expose which PTY backend was used, but the spec will require that PTY sessions either launch with a pseudo-terminal adapter or fail with a clear error when no supported backend is available.

Why:
- callers care about terminal semantics, not backend branding
- backend opacity gives room to evolve implementation later
- fallback behavior still needs to be testable and well-defined

## Risks / Trade-offs

- **Native dependency packaging can fail** → `@lydell/node-pty` ships pre-built binaries, eliminating node-gyp build steps for most platforms. Remaining failure modes (unsupported architectures, Node ABI mismatches, corrupted installs) are covered by the Unix fallback path and should be tested
- **Different PTY backends may emit slightly different output** → normalize behavior at the supervisor boundary and assert only stable semantics in tests
- **Users may assume resize or Windows now work** → state both deferrals clearly in proposal, design, and tasks
- **Fallback can mask deployment drift** → log which backend was selected so operators can diagnose unexpected fallback behavior

## Migration Plan

1. Add the native PTY dependency and wire a primary adapter path behind the existing supervisor abstraction
2. Preserve the current `script` wrapper as the Unix fallback path
3. Update PTY-focused tests to cover native backend selection, fallback, and unsupported-platform behavior
4. Roll out without changing tool contracts or config shape

## Resolved Questions

### Backend selection visibility

Backend selection is logged for operators but not exposed to production callers. Tests may access backend selection via an internal diagnostic to assert native vs fallback behavior.

Why:
- Production callers care about terminal semantics, not backend branding (Decision 4)
- Operators need visibility to diagnose unexpected fallback behavior
- Tests need to verify the correct backend was selected without relying on output differences

### Force-fallback config flag

A `runtime.exec.forcePtyFallback` config flag will allow operators to disable the native PTY backend for debugging.

Why:
- Low implementation cost (one boolean flag)
- High diagnostic value when native PTY behaves unexpectedly
- Allows opt-out without uninstalling the native dependency
- Should log a warning when enabled to indicate non-default behavior
