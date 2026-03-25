## Why

Our current `exec_command` runtime is too limited for the kind of agents we want to support. It only supports short-lived batch commands in a per-agent sandbox with no PTY, no background session lifecycle, no shell workflows, and no principled way to grant access to selected host directories like an Obsidian vault or project workspace.

We need a real execution runtime that can power coding agents such as Pi, Codex, and OpenCode while still preserving operator control. That means interactive terminals, process supervision, mount-based filesystem access, and multiple isolation levels ranging from direct host access to a locked-down sandbox.

## What Changes

- **REMOVE** the narrow `hostCwd`-based execution model; replace it with a mount-based execution model that can expose multiple operator-approved directories with explicit permissions
- **NEW** three execution tiers: `host` (naked execution for trusted assistants), `sandbox` (container isolation with mounts for coding agents), and `locked-down` (strictest containment for untrusted code)
- **NEW** container runtime support (Docker or Podman) for `sandbox` and `locked-down` tiers, with auto-detection
- **NEW** execution mount config that maps operator-approved host paths into the container runtime with aliasing and read/write policy
- **NEW** PTY-capable process runtime for interactive commands, including background session management for long-running coding agents and CLIs
- **NEW** `process` tool for interacting with running sessions: poll output, read logs, write stdin, and terminate sessions
- **MODIFY** `exec_command` to support shell-capable execution, PTY allocation, backgrounding, per-call execution tier requests, and mount-aware working directory resolution

## Capabilities

### New Capabilities
- `exec-isolation`: execution isolation tiers (host/sandbox/locked-down) with container runtime selection
- `exec-mounts`: declarative mounted host paths with aliases, permissions, and path validation for command execution
- `exec-process-control`: PTY sessions, background process supervision, and the `process` tool lifecycle

### Modified Capabilities
- `exec-command`: expand command execution requirements to cover shell-capable execution, PTY support, background sessions, per-call tier selection, and mount-aware working directories
- `runtime-config`: extend `runtime.exec` with tier, container runtime, mounts, environment, and session-control settings

## Impact

- **Runtime architecture**: command execution moves from a single `execFile()` path to a supervised execution runtime with child-process and PTY modes, plus container isolation for sandbox tiers
- **Config schema**: `runtime.exec` grows to express access tiers, container runtime selection, mounts, environment rules, and session limits
- **Tool surface**: introduces a new `process` tool and expands `exec_command` beyond short-lived batch execution
- **Security model**: shifts from a simple per-agent sandbox to three tiers: trusted host execution, containerized coding environments, and locked-down isolation for untrusted code
- **Container dependency**: `sandbox` and `locked-down` tiers require Docker or Podman; `host` tier works without containers
