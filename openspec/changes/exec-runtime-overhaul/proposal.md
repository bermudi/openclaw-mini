## Why

Our current `exec_command` runtime is too limited for the kind of agents we want to support. It only supports short-lived batch commands in a per-agent sandbox with no PTY, no background session lifecycle, no shell workflows, and no principled way to grant access to selected host directories like an Obsidian vault or project workspace.

We need a real execution runtime that can power coding agents such as Pi, Codex, and OpenCode while still preserving operator control. That means interactive terminals, process supervision, mount-based filesystem access, and multiple isolation levels ranging from direct host access to a locked-down sandbox.

## What Changes

- **REMOVE** the narrow `hostCwd`-based execution model proposed in `exec-command-execution-modes`; replace it with a mount-based execution model that can expose multiple operator-approved directories with explicit permissions
- **NEW** execution access tiers for command execution: direct host access, mounted sandbox, and locked-down isolation
- **NEW** pluggable isolation backends for sandboxed execution, with support for native lightweight isolation (for example Landlock or Firejail) and container backends such as Docker or Podman when available
- **NEW** execution mount config that maps operator-approved host paths into the command runtime with aliasing and read/write policy
- **NEW** PTY-capable process runtime for interactive commands, including background session management for long-running coding agents and CLIs
- **NEW** `process` tool for interacting with running sessions: poll output, read logs, write stdin, submit input, send terminal keys, and terminate sessions
- **MODIFY** `exec_command` to support shell-capable execution, PTY allocation, backgrounding, per-call execution tier requests, and mount-aware working directory resolution
- **MODIFY** skill loading to support agent-managed skills from `data/skills/` alongside built-in `skills/`, with agent-managed skills taking precedence on collisions
- **MODIFY** the skill-manager dependency story so `agent-skills-overhaul` depends on this new runtime change instead of `exec-command-execution-modes`

## Capabilities

### New Capabilities
- `exec-isolation`: execution isolation tiers and backend selection for direct, sandboxed, and locked-down command execution
- `exec-mounts`: declarative mounted host paths with aliases, permissions, and path validation for command execution
- `exec-process-control`: PTY sessions, background process supervision, and the `process` tool lifecycle

### Modified Capabilities
- `exec-command`: expand command execution requirements to cover shell-capable execution, PTY support, background sessions, per-call tier selection, and mount-aware working directories
- `runtime-config`: extend `runtime.exec` with tier, backend, mount, environment, and session-control settings
- `skill-loading`: discover both built-in and agent-managed skills, with precedence rules for `data/skills/`

## Impact

- **Runtime architecture**: command execution moves from a single `execFile()` path to a supervised execution runtime with child-process and PTY modes
- **Config schema**: `runtime.exec` grows substantially to express access tiers, backend preferences, mounts, environment rules, and session limits
- **Tool surface**: introduces a new `process` tool and expands `exec_command` beyond short-lived batch execution
- **Security model**: shifts from a simple per-agent sandbox to layered controls combining allowlists, mounts, environment filtering, and optional OS/container isolation
- **Skill system**: enables `skill-manager` and future coding skills to work with operator-approved host files while still supporting isolated execution modes
- **Cross-change dependencies**: `agent-skills-overhaul` must be updated to depend on `exec-runtime-overhaul` instead of `exec-command-execution-modes`
