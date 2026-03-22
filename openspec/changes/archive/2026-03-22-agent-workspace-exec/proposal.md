## Why

Agents currently have no working directory for file operations and no ability to run shell commands. The memory dir (`data/memories/{agentId}/`) stores notes, but there's no general-purpose sandbox where agents can download files, create artifacts, or execute commands. This blocks attachments, command execution, and any workflow where the agent needs to manipulate files beyond markdown notes.

## What Changes

- **Agent sandbox directory**: Each agent gets a persistent working directory at `data/sandbox/{agentId}/` with `downloads/` (for inbound attachments) and `output/` (for agent-generated files) subdirectories
- **`exec_command` tool**: A new agent tool that runs allowlisted shell commands with the agent's sandbox as cwd, captures stdout/stderr, and enforces timeout + output size limits
- **Exec config section**: New `exec` section in runtime config with `enabled`, `allowlist` (array of allowed binary names), `maxTimeout`, and `maxOutputSize` fields
- **Sandbox lifecycle**: Sandbox directories are created on-demand when first accessed, with a helper to resolve and ensure the sandbox path for a given agent

## Capabilities

### New Capabilities
- `agent-sandbox`: Persistent per-agent working directory with structured subdirectories for downloads and output
- `exec-command`: Shell command execution tool with allowlist-based security, timeout enforcement, and output size capping

### Modified Capabilities
- `runtime-config`: Add `exec` section to runtime config schema for command execution settings

## Impact

- **Files**: New `src/lib/services/sandbox-service.ts`, new tool registration in `src/lib/tools.ts`, config schema changes in `src/lib/config/schema.ts` and `src/lib/config/runtime.ts`
- **Dependencies**: None — uses Node.js `child_process` built-in
- **Schema**: No database changes
- **APIs**: Existing tool discovery endpoint automatically exposes the new tool
- **Security**: Command execution is off by default, opt-in via config with strict allowlist
