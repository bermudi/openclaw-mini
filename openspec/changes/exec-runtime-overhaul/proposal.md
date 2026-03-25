## Why

Our current `exec_command` runtime is intentionally narrow: it parses a command string, rejects shell operators, checks an allowlist, and runs `execFile()` inside the agent sandbox. That is good for low-risk single-shot commands, but it cannot support interactive coding workflows, background processes, or operator-approved access to selected project directories.

We do want a fuller execution runtime, but the original draft left too many security and API details implicit. This revision tightens the plan before implementation: it makes the `process` tool contract consistent, spells out the execution request shape more clearly, avoids treating the current sandboxed runtime as equivalent to unrestricted host execution, and forces explicit decisions around startup behavior and file surfacing.

## What Changes

- Replace the current single-mode execution model with a tiered runtime for `host`, `sandbox`, and `locked-down` execution
- Expand `exec_command` to support explicit execution mode selection, background handoff, PTY-backed sessions, and mount-aware working directories
- Add a new `process` tool with a single canonical control API for supervised sessions
- Add mount declarations in `runtime.exec.mounts` with alias, path, permission, and creation policy
- Add container runtime detection for Docker/Podman without silent fallback from isolated tiers to host tier
- Define how files produced outside the legacy sandbox are surfaced back to chat or copied into a deliverable location

## Capabilities

### New Capabilities
- `exec-isolation`: host, sandbox, and locked-down execution tiers with explicit privilege boundaries
- `exec-mounts`: operator-approved mounts for isolated execution
- `exec-process-control`: background sessions, PTY support, and a canonical `process` tool lifecycle

### Modified Capabilities
- `exec-command`: tier-aware launch, PTY support, background handoff, and mount-aware cwd resolution
- `runtime-config`: richer `runtime.exec` schema for tiers, mounts, session limits, and backend selection

## Impact

- **Runtime architecture**: command execution moves from a single `execFile()` path to a supervised runtime with child-process and PTY adapters
- **Security model**: current behavior is treated as a restricted legacy path, not as equivalent to unrestricted host execution
- **Config schema**: `runtime.exec` grows substantially and now needs stronger validation/default rules
- **Tool surface**: adds `process` and expands `exec_command`
- **Dependencies**: PTY support is already present in `package.json`; implementation still needs container integration and session supervision code
