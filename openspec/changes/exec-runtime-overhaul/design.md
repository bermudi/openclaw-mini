## Context

The current `exec_command` implementation is intentionally minimal: it parses a command string, rejects shell operators, checks a binary allowlist, and calls `execFile()` inside `data/sandbox/{agentId}/` with a tiny curated environment. That model is simple and safe, but it cannot support interactive coding agents or operator-approved access to real host files.

The new requirement is broader. We want to support agents that behave more like Pi, Codex, and OpenCode:

1. They need PTY-backed interactive terminals for REPLs, package managers, CLIs, and coding assistants.
2. They need long-running background sessions that can be polled, written to, and terminated across multiple tool calls.
3. They need a filesystem access model based on explicit operator-approved mounts rather than a single sandbox directory.
4. They need multiple execution tiers so trusted local use can be fast while higher-risk tasks can run under stronger isolation.

## Goals / Non-Goals

**Goals:**
- Support three execution tiers: `host`, `sandbox`, and `locked-down`
- Introduce mount-based filesystem access with aliases and read/write policy
- Support both child-process and PTY-backed execution
- Add a supervised process registry and `process` tool for background sessions
- Preserve a typed runtime config API for tier selection, mounts, and session limits
- Use Docker or Podman for container isolation (auto-detect available runtime)

**Non-Goals:**
- Persisting background process handles across server restarts
- Full Windows parity in the first iteration; initial implementation can target Linux-first behavior
- Reproducing every OpenClaw execution feature such as interactive approval flows in this change
- Solving remote execution or distributed worker execution
- Replacing `read_file`/`write_note` with the exec runtime; this change is about command/process execution
- Supporting multiple isolation backends beyond Docker/Podman
- Skill loading changes (handled separately in `agent-skills-overhaul`)

## Decisions

### Decision 1: Three execution tiers with distinct use cases

The runtime will expose three execution tiers:

- **`host`**: Naked execution on the host with no container isolation. For trusted agents acting as personal assistants that need full filesystem access. No mounts enforcement—agent can access any path the user can.

- **`sandbox`**: Container isolation (Docker/Podman) with operator-approved mounts. For coding agents that need controlled access to specific projects. Mounts define accessible directories; agent cannot escape to sensitive paths.

- **`locked-down`**: Container isolation with strictest defaults: read-only mounts, no network access (`--network none`), minimal environment. For experiments and untrusted code. Maximum containment.

The runtime config will define both a default tier and a maximum privilege tier. A tool call may request a more restrictive tier than default, but never a less restrictive tier than allowed by config.

### Decision 2: Container runtime is Docker or Podman

For `sandbox` and `locked-down` tiers, the runtime uses a container runtime:

- Auto-detect available runtime on startup: check for `docker` first, then `podman`
- Both use identical CLI syntax, so the same code path works for either
- If no container runtime is available, `sandbox` and `locked-down` tiers fail with a clear error message

```typescript
// Detection logic
async function detectContainerRuntime(): Promise<'docker' | 'podman' | null> {
  if (await commandExists('docker')) return 'docker';
  if (await commandExists('podman')) return 'podman';
  return null;
}
```

**Alternative considered**: Support Landlock, Firejail, Bubblewrap as alternatives. Rejected because it creates significant complexity for marginal benefit. Docker/Podman provide complete isolation (filesystem, network, resources) in one package.

### Decision 3: Mounts are first-class and alias-based

`runtime.exec.mounts` will declare a list of approved host paths:

- `alias`: stable name exposed to the command runtime (e.g., `project`, `data`)
- `hostPath`: absolute or config-relative host path
- `permissions`: `read-only` or `read-write`
- optional `createIfMissing`: for managed paths

Commands in `sandbox` and `locked-down` tiers see mounts through stable aliases at `/mnt/<alias>`. The container runtime enforces these as the only accessible paths.

```yaml
# Example config
runtime:
  exec:
    mounts:
      - alias: project
        hostPath: /home/user/myapp
        permissions: read-write
      - alias: secrets
        hostPath: /home/user/.config/keys
        permissions: read-only
```

In `host` tier, mounts are advisory (agent can still access any path). In `sandbox` and `locked-down`, mounts are hard boundaries enforced by the container.

### Decision 4: Separate launch from session control

`exec_command` will become the launch API. It starts a command in one of two execution modes:

- `child`: non-interactive child process
- `pty`: pseudo-terminal process for interactive workflows

If the command completes inside the configured foreground window, `exec_command` returns the final result directly. If it is backgrounded explicitly or exceeds the foreground yield window, `exec_command` returns a session handle.

A new `process` tool becomes the control API for running sessions. It manages `list`, `poll`, `write`, `kill` operations.

### Decision 5: Introduce a singleton process supervisor service

The server will own a singleton process supervisor with:

- child-process adapter for batch execution
- PTY adapter backed by `@lydell/node-pty`
- in-memory session registry for running and finished sessions
- bounded stdout/stderr buffers and truncation policy
- lifecycle transitions (`running`, `exited`, `failed`, `killed`, `timed_out`)

The registry is intentionally ephemeral. If the server restarts, running sessions are lost and any later `process` call should report the session as missing.

### Decision 6: Shell-capable execution is supported

The old model used binary allowlisting plus shell rejection. Coding agents need shell semantics and PTY support, so the policy model must expand:

- `host` tier: shell-capable, agent is trusted
- `sandbox` tier: shell-capable, containment via container
- `locked-down` tier: shell-capable, strictest containment

The container provides the security boundary, not application-layer regexes.

## Risks / Trade-offs

- **[Risk] Host tier provides no containment** → Mitigation: document clearly, keep it opt-in, reserve for trusted use cases
- **[Risk] PTY sessions increase server complexity and memory pressure** → Mitigation: bounded buffers, per-session limits, explicit cleanup, and session TTLs
- **[Risk] Container runtime dependency for sandbox/locked-down** → Mitigation: auto-detect, clear error when unavailable, host tier always works
- **[Risk] Shell-capable execution increases attack surface** → Mitigation: container isolation for sandbox/locked-down, host tier reserved for trusted agents
- **[Trade-off] In-memory session registry loses state on restart** → Acceptable for v1; durable process reattachment is much more complex

## Migration Plan

1. Add `@lydell/node-pty` dependency
2. Implement container runtime detection (Docker/Podman)
3. Implement mount config parsing and validation
4. Implement process supervisor with child-process and PTY adapters
5. Expand `exec_command` to support tiers, PTY, backgrounding
6. Add `process` tool for session control
7. Update runtime config schema
8. Preserve current behavior as default (existing sandbox behavior maps to `host` tier initially)

## Open Questions

- Should `sandbox` tier allow network access by default, or require explicit `network: true` in mount config?
- What container image should `sandbox` and `locked-down` use? (minimal base like `alpine` or `debian-slim`?)
- Should mounts be global or per-agent? Global is simpler; per-agent requires more config surface.
