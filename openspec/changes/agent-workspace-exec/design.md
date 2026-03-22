## Context

Agents currently operate with a narrow file model: `data/memories/{agentId}/` for markdown notes and `data/workspace/` for identity/config files. There's no general-purpose working directory where agents can receive downloaded files, generate artifacts, or execute commands. The existing `read_file`, `write_note`, and `list_files` tools are scoped to the memory directory and restricted to sanitized markdown filenames.

The original OpenClaw has a full exec system with Docker sandboxing, PTY support, background processes, and approval flows. OpenClaw-Mini needs something much simpler: an allowlisted command runner with a per-agent working directory.

## Goals / Non-Goals

**Goals:**
- Give each agent a persistent sandbox directory for general file work
- Provide a `exec_command` tool that runs allowlisted shell commands in the sandbox
- Make exec opt-in with safe defaults (disabled, empty allowlist)
- Keep the implementation minimal — synchronous execution, no background processes

**Non-Goals:**
- Docker/container sandboxing (just cwd restriction for now)
- Background/async command execution (original OpenClaw's `yieldMs` pattern)
- PTY support or interactive command sessions
- User approval flow for non-allowlisted commands
- Command history persistence

## Decisions

### 1. Sandbox directory structure: `data/sandbox/{agentId}/`

Separate from `data/memories/` because the sandbox serves a different purpose — it's a working directory for arbitrary files, not a curated knowledge store. Structure:

```
data/sandbox/{agentId}/
├── downloads/    ← reserved for inbound attachment downloads (used by attachments change)
└── output/       ← reserved for agent-generated files
```

The root of the sandbox IS the cwd for exec. Subdirectories are created on-demand.

**Alternative considered:** Putting everything under `data/memories/`. Rejected because memory files have strict naming rules (`isSafeWorkspaceFileName`) and are loaded into agent context — polluting them with arbitrary downloads would break the memory system.

### 2. Allowlist-based security with binary name matching

Commands are validated by extracting the first token (the binary name) and checking it against a configured allowlist. This is the simplest effective security model:

```json
{
  "runtime": {
    "exec": {
      "enabled": true,
      "allowlist": ["cat", "ls", "head", "tail", "grep", "wc", "sort", "uniq", "jq", "date", "echo"]
    }
  }
}
```

The allowlist matches the basename only — `cat` matches `/usr/bin/cat` or just `cat`. Pipe chains and shell operators (`|`, `&&`, `;`, `>`) are blocked by running commands with `execFile` (not through a shell) unless explicitly using an allowed shell wrapper.

**Alternative considered:** Regex-based command patterns. Rejected as too complex and error-prone for the mini approach.

### 3. execFile (no shell) for command execution

Using `child_process.execFile` instead of `exec` to avoid shell injection. The command string is split into binary + args. This means no pipes, redirects, or shell builtins — which is intentional for security. If the agent needs `grep foo file.txt | wc -l`, it should make two tool calls.

**Alternative considered:** Running through shell with sanitization. Rejected because shell escaping is a known footgun and we don't need shell features for the allowlisted command set.

### 4. Synchronous execution with timeout + output cap

Commands run synchronously within the tool call. No background process management. Enforced limits:
- `maxTimeout`: default 30 seconds, configurable
- `maxOutputSize`: default 10,000 characters, configurable — output is truncated from the beginning (keep the tail, which is usually more relevant)

### 5. Sandbox service as a thin utility module

A `sandbox-service.ts` that provides:
- `getSandboxDir(agentId)` — returns and ensures the sandbox path exists
- `getSandboxDownloadsDir(agentId)` — returns `sandbox/{agentId}/downloads/`
- `getSandboxOutputDir(agentId)` — returns `sandbox/{agentId}/output/`

No class, no state — just path resolution functions that create directories on-demand.

## Risks / Trade-offs

- **[No shell features]** → Agents can't use pipes or redirects. Mitigation: the allowlisted commands cover most read-only inspection needs. Agents can chain multiple tool calls. If this becomes limiting, we can add a `shell_pipeline` tool later with its own safety model.
- **[No cwd restriction enforcement]** → `execFile` with `cwd` set doesn't prevent `cat ../../../etc/passwd` if `cat` is allowlisted. Mitigation: for the mini use case (self-hosted, single-user), this is acceptable. A future change could add path validation on arguments.
- **[Synchronous blocking]** → Long-running commands block the agent's tool loop. Mitigation: the timeout cap (default 30s) prevents unbounded blocking. Background exec can be added later.
- **[Output truncation]** → Large outputs lose the beginning. Mitigation: keeping the tail is usually more useful (last lines of a log, end of a file listing). The agent can use `head`/`tail` explicitly for targeted reads.
