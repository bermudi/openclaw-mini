## Why

The current PTY implementation meets the archived `exec-runtime-overhaul` scope, but it relies on a lightweight `script` wrapper that gives coding agents a less faithful terminal environment than the original OpenClaw runtime. We need a narrower follow-up change that improves interactive shell compatibility for coding-agent workloads without expanding scope into terminal resizing or Windows parity yet.

## What Changes

- Prefer a native PTY backend for PTY-mode process sessions instead of relying only on the `script` wrapper
- Keep a Unix fallback path so PTY-backed execution still works when the native PTY package is unavailable
- Tighten PTY lifecycle behavior so interactive `exec_command` and `process write` flows behave more like a real terminal session for coding agents
- Defer dynamic resize APIs and Windows PTY support to later changes

## Capabilities

### New Capabilities

### Modified Capabilities
- `exec-process-control`: PTY-backed sessions will prefer a native PTY adapter and define fallback behavior when the native backend is unavailable

## Impact

- Affected code in the process supervisor PTY adapter, session lifecycle handling, and related exec/process tests
- Adds `@lydell/node-pty` (a pre-compiled fork that ships pre-built binaries, avoiding native compilation on user machines)
- Improves interactive shell fidelity for coding-agent workloads while keeping the existing tool surface unchanged
