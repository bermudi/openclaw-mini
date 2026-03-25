## Context

Today, `exec_command` is a constrained helper: no shell semantics, allowlisted binaries only, and execution rooted in `data/sandbox/{agentId}`. The target runtime is much broader: interactive terminals, background sessions, operator-approved workspace mounts, and stronger isolation modes.

The original proposal had the right destination but still left several sharp edges unresolved:

- it blurred the difference between the current restricted runtime and unrestricted host execution
- it described the `process` tool with multiple competing verb sets
- it did not define enough of the request/response contract for `exec_command`
- it left file-surfacing behavior underspecified for commands that run outside the legacy sandbox

This revision narrows those ambiguities before implementation.

## Goals / Non-Goals

**Goals:**
- support three execution tiers: `host`, `sandbox`, and `locked-down`
- support both direct child execution and PTY-backed interactive sessions
- provide a canonical `process` control API
- support mount-based working directories and operator-approved filesystem access
- make startup and runtime behavior explicit when Docker/Podman is unavailable
- define how generated files become deliverable artifacts

**Non-Goals:**
- durable session recovery after server restart
- Windows-first parity in v1
- distributed execution
- replacing the rest of the sandbox/file APIs in this change

## Decisions

### Decision 1: Three tiers remain, but current behavior does not map to `host`

The tiers stay:

- `host`: direct host execution for explicitly trusted workflows
- `sandbox`: containerized execution with approved mounts and normal network access
- `locked-down`: containerized execution with read-only mounts and no network

Important clarification: the current allowlisted sandboxed `exec_command` behavior is **not** equivalent to the new `host` tier. Migration must be explicit rather than assuming the current implementation already behaves like host execution.

### Decision 2: Canonical `process` tool verbs

The `process` tool uses one verb set everywhere:

- `list`
- `poll`
- `log`
- `write`
- `kill`

`write` sends raw input to a PTY-backed session. `log` reads buffered output with offset/limit support. `poll` is the lightweight status-plus-new-output call.

### Decision 3: `exec_command` request shape is explicit

`exec_command` needs to support two launch modes:

- **direct argv mode**: command is parsed into binary + args and checked against the allowlist
- **shell mode**: shell-capable execution for PTY or complex workflows, governed by tier policy

It also needs explicit fields for:

- requested tier
- requested execution mode (`child` or `pty`)
- backgrounding
- working directory

The spec does not need to freeze exact TypeScript today, but it must freeze these concepts and their validation rules before implementation.

### Decision 4: Startup behavior is explicit when containers are unavailable

If Docker/Podman is unavailable:

- startup still succeeds if `defaultTier` does not require containers
- startup logs clear diagnostics about missing container support
- `sandbox` and `locked-down` launches fail clearly at call time
- if `defaultTier` is `sandbox` or `locked-down`, startup validation should fail fast rather than leaving the server in a broken default state

### Decision 5: File surfacing must be part of the design

Commands in mounted workspaces may produce files outside `data/sandbox/{agentId}`. The runtime therefore needs a defined handoff path for deliverable files.

For the first iteration, the design assumes one of two explicit strategies:

1. copy surfaced files into a sandbox/output-compatible location before delivery, or
2. extend outbound file delivery to accept approved absolute paths

This must be decided before implementation, not during it.

### Decision 6: Runtime config needs explicit defaults and ordering

`defaultTier` and `maxTier` rely on an implicit privilege ordering:

```text
locked-down < sandbox < host
```

That ordering must be encoded consistently in config validation and runtime checks.

Safer defaults matter here; the prior draft's implicit `defaultTier: host` is too sharp for a first rollout.

## Risks / Trade-offs

- **Host tier is powerful** -> keep it explicit and opt-in
- **PTY + session supervision increase complexity** -> mitigate with bounded buffers and clear lifecycle rules
- **Container runtime differences are real** -> the code path can be shared, but Docker and Podman behavior should not be assumed identical in every edge case
- **File delivery outside sandbox adds complexity** -> better to specify this now than discover it halfway through implementation

## Migration Plan

1. Tighten config schema and defaults for the new exec model
2. Implement runtime/container detection and startup diagnostics
3. Implement mount validation and cwd resolution
4. Implement process supervisor with child + PTY adapters
5. Expand `exec_command`
6. Add canonical `process` tool
7. Add explicit file-surfacing support for outputs outside the legacy sandbox
8. Run focused exec/runtime regression suites

## Open Questions

- Which file-surfacing strategy should be used first: sandbox copy or absolute-path outbound delivery?
- What container image baseline should isolated tiers use?
- Should `defaultTier` default to `sandbox` rather than `host` once the runtime is implemented?
