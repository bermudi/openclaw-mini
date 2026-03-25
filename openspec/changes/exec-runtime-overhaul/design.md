## Context

The current `exec_command` implementation is intentionally minimal: it parses a command string, rejects shell operators, checks a binary allowlist, and calls `execFile()` inside `data/sandbox/{agentId}/` with a tiny curated environment. That model is simple and safe, but it cannot support interactive coding agents or operator-approved access to real host files.

The new requirement is broader. We want to support agents that behave more like Pi, Codex, and OpenCode:

1. They need PTY-backed interactive terminals for REPLs, package managers, CLIs, and coding assistants.
2. They need long-running background sessions that can be polled, written to, and terminated across multiple tool calls.
3. They need a filesystem access model based on explicit operator-approved mounts rather than a single sandbox directory.
4. They need multiple execution tiers so trusted local use can be fast while higher-risk tasks can run under stronger isolation.

We also have an existing downstream dependency: `agent-skills-overhaul` currently assumes a future `skill-manager` can write to `data/skills/` via host execution. That dependency needs to move to this new runtime design.

## Goals / Non-Goals

**Goals:**
- Support three execution tiers: `direct`, `sandbox`, and `isolated`
- Introduce mount-based filesystem access with aliases and read/write policy
- Support both child-process and PTY-backed execution
- Add a supervised process registry and `process` tool for background sessions
- Preserve a typed runtime config API for backend selection, mounts, policies, and limits
- Allow agent-managed skills in `data/skills/` to coexist with built-in skills in `skills/`
- Keep the security model explicit: direct is fastest but least contained; isolated is strictest but may require extra dependencies

**Non-Goals:**
- Persisting background process handles across server restarts
- Full Windows parity in the first iteration; initial implementation can target Linux-first behavior
- Reproducing every OpenClaw execution feature such as interactive approval flows in this change
- Solving remote execution or distributed worker execution
- Replacing `read_file`/`write_note` with the exec runtime; this change is about command/process execution

## Decisions

### Decision 1: Three execution tiers with monotonic restriction

The runtime will expose three execution tiers:

- `direct`: execute on the host with no OS-level isolation backend
- `sandbox`: execute under an isolation backend with operator-approved mounts and standard restrictions
- `isolated`: execute under an isolation backend with stricter defaults (minimal env, tighter resource limits, read-only-by-default mounts, and no silent fallback)

The runtime config will define both a default tier and a maximum privilege tier. A tool call may request a more restrictive tier than default, but never a less restrictive tier than allowed by config.

This preserves the useful "ceiling" idea from the old `exec-command-execution-modes` change while making the privilege model clearer than `sandbox/host/auto`.

**Alternative considered**: A single `mode` enum with `host`, `sandbox`, and `auto`. Rejected because `auto` is ambiguous once we add PTY, mounts, and multiple isolation backends; it hides too much policy in one word.

### Decision 2: Mounts are first-class and alias-based

`runtime.exec.mounts` will declare a list of approved host paths:

- `alias`: stable name exposed to the command runtime
- `hostPath`: absolute or config-relative host path
- `permissions`: `read-only` or `read-write`
- optional `createIfMissing`: for managed paths like `data/skills/`

Commands will see mounts through stable aliases rather than raw host paths. The runtime will build a synthetic working area rooted under an internal runtime directory and expose mounts beneath a predictable path such as `/mnt/<alias>` in PTY/shell prompts and backend mount tables.

In `sandbox` and `isolated` tiers, mounts are enforced boundaries by the backend. In `direct`, mounts are advisory rather than hard containment: they provide discoverability, working-directory convenience, and policy metadata, but a trusted direct command can still reference absolute host paths unless further guards reject it. This trade-off is explicit and documented.

**Alternative considered**: A single `hostCwd` path. Rejected because it cannot represent multiple approved roots such as `data/`, an Obsidian vault, and a project workspace.

### Decision 3: Separate launch from session control

`exec_command` will become the launch API. It starts a command in one of two execution modes:

- `child`: non-interactive child process
- `pty`: pseudo-terminal process for interactive workflows

If the command completes inside the configured foreground window, `exec_command` returns the final result directly. If it is backgrounded explicitly or exceeds the foreground yield window, `exec_command` returns a session handle.

A new `process` tool becomes the control API for running sessions. It manages `list`, `poll`, `log`, `write`, `submit`, `send_keys`, `kill`, and `clear` operations.

This mirrors the architecture used by OpenClaw and avoids overloading one tool with both launch and lifecycle semantics.

**Alternative considered**: Keep everything inside `exec_command` with action flags. Rejected because background PTY sessions are stateful and deserve a dedicated control surface.

### Decision 4: Introduce a singleton process supervisor service

The server will own a singleton process supervisor with:

- child-process adapter for batch execution
- PTY adapter backed by `@lydell/node-pty`
- in-memory session registry for running and finished sessions
- bounded stdout/stderr buffers and truncation policy
- lifecycle transitions (`running`, `exited`, `failed`, `killed`, `timed_out`)

The registry is intentionally ephemeral. If the server restarts, running sessions are lost and any later `process` call should report the session as missing. This keeps the first implementation small and avoids pretending we have durable orchestration when we do not.

**Alternative considered**: Persist process metadata in the database. Rejected for the first iteration because the hard part is not metadata persistence but safe recovery/re-attachment to OS processes.

### Decision 5: Isolation backends are pluggable and profile-driven

The runtime will define a backend abstraction with implementations for:

- `landlock`
- `firejail`
- `docker`
- `podman`
- `none` (used only for `direct` tier)
- `auto` (resolve first available backend from configured preference order)

`sandbox` and `isolated` tiers use the same abstraction but different security profiles. `sandbox` favors usability; `isolated` favors confinement. If an isolated tier is requested and the required backend is unavailable, the command fails rather than silently degrading to `direct`.

This gives us a Linux-first path that stays lightweight by default while still allowing container-grade isolation where available.

**Alternative considered**: Hardcode Docker as the only sandbox backend. Rejected because it violates the lightweight goals of OpenClaw-Mini and excludes environments where Docker is unavailable.

### Decision 6: Shell-capable execution is supported, but policy becomes layered

The old model used binary allowlisting plus shell rejection. Coding agents need shell semantics and PTY support, so the policy model must expand:

- direct argv execution can continue to use binary allowlists
- shell-capable execution uses deny patterns, env filtering, mount policy, and tier restrictions
- PTY mode implies shell-capable execution semantics

The system still keeps application-layer guardrails, but the stronger protection comes from tier choice and backend enforcement, not regexes alone.

**Alternative considered**: Keep rejecting shell operators even in the new runtime. Rejected because it would block the very CLIs and coding workflows this change is meant to enable.

### Decision 7: Skill discovery merges built-in and managed skills

`skill-loading` will scan both:

- `skills/` for built-in skills
- `data/skills/` for agent-managed skills

When names collide, the agent-managed skill wins. This gives `skill-manager` a stable writable location without mutating repository-owned skill definitions.

**Alternative considered**: Copy built-in skills into `data/skills/` on first boot. Rejected because it creates drift and upgrade complexity.

## Risks / Trade-offs

- **[Risk] Direct tier can never provide real filesystem containment** → Mitigation: document it clearly, keep it opt-in, and reserve hard containment claims for `sandbox` and `isolated`
- **[Risk] PTY sessions increase server complexity and memory pressure** → Mitigation: bounded buffers, per-session limits, explicit cleanup, and session TTLs for finished processes
- **[Risk] Native/backend variability makes behavior inconsistent across machines** → Mitigation: backend capability checks, explicit status reporting, and deterministic `auto` selection order
- **[Risk] Shell-capable execution increases command injection surface** → Mitigation: tiered security model, mount restrictions, env filtering, deny patterns, and no silent fallback from isolated execution
- **[Risk] Landlock and Firejail may not cover every desired restriction uniformly** → Mitigation: abstract backend capabilities behind common policy profiles and document capability gaps in runtime diagnostics
- **[Trade-off] In-memory session registry loses state on restart** → Acceptable for the first version because durable process reattachment is much more complex than interactive control during a single server lifetime

## Migration Plan

1. Create the new runtime artifacts and spec deltas under `exec-runtime-overhaul`
2. Supersede `exec-command-execution-modes` and remove it once the new change is accepted
3. Update `agent-skills-overhaul` to depend on `exec-runtime-overhaul` instead of `exec-command-execution-modes`
4. Implement the new process supervisor and tool surface behind feature-gated runtime config
5. Preserve current behavior as the default by shipping `direct`/`sandbox` features behind explicit config, then promote stronger defaults once backend support is proven

## Open Questions

- Should `sandbox` default to `landlock` or `firejail` on Linux when both are available?
- Should direct tier expose mount aliases through a synthetic workspace directory only, or also rewrite/validate raw cwd requests against mount policy?
- Do we want one `exec_command` input shape with optional `pty`/`background` flags, or should shell/PTY launch become a separate `exec_session` tool in a later refinement?
- What default resource limits make sense for `isolated` without breaking common coding workflows like package installation and builds?
