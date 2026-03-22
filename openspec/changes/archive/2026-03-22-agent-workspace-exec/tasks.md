## 1. Sandbox Service

- [x] 1.1 Create `src/lib/services/sandbox-service.ts` with `getSandboxDir(agentId)`, `getSandboxDownloadsDir(agentId)`, `getSandboxOutputDir(agentId)` functions that resolve and ensure directories exist under `data/sandbox/{agentId}/`
- [x] 1.2 Add path traversal guard — validate that resolved paths do not escape the sandbox root (`data/sandbox/`)
- [x] 1.3 Write tests for sandbox-service: directory creation, idempotency, path traversal rejection

## 2. Exec Config Schema

- [x] 2.1 Add `runtimeExecSchema` to `src/lib/config/schema.ts` with fields: `enabled` (boolean, optional), `allowlist` (string array, optional), `maxTimeout` (positive int, optional), `maxOutputSize` (positive int, optional)
- [x] 2.2 Add `exec` field to `runtimeSectionSchema` using the new exec schema
- [x] 2.3 Add `ExecConfig` interface to schema types and include in `RuntimeSectionConfig`
- [x] 2.4 Update `getRuntimeConfig()` in `src/lib/config/runtime.ts` to return `exec` section with defaults: `enabled: false`, `allowlist: []`, `maxTimeout: 30`, `maxOutputSize: 10000`
- [x] 2.5 Write tests for config parsing: valid exec config, missing exec section defaults, invalid values rejected

## 3. exec_command Tool

- [x] 3.1 Add `exec_command` tool registration in `src/lib/tools.ts`, gated by `getRuntimeConfig().exec.enabled` — tool schema takes `command` (string) and optional `surfaceOutput` (boolean, for future use by surface-directive change)
- [x] 3.2 Implement command parsing: split command string into binary name + arguments array, reject if command contains shell operators (`|`, `&&`, `||`, `;`, `>`, `<`, `` ` ``)
- [x] 3.3 Implement allowlist check: extract binary basename, compare against `getRuntimeConfig().exec.allowlist`
- [x] 3.4 Implement execution via `child_process.execFile` with `cwd` set to `getSandboxDir(agentId)`, `timeout` from config, capture stdout and stderr
- [x] 3.5 Implement output capping: if combined output exceeds `maxOutputSize`, truncate from beginning keeping tail, prepend `[output truncated]` notice
- [x] 3.6 Return structured result: `{ success: true, data: { stdout, stderr, exitCode } }` for completed commands, `{ success: false, error }` for spawn failures
- [x] 3.7 Write tests for exec_command: allowed command runs, disallowed command rejected, shell operators rejected, timeout kills process, output truncation, exit code passthrough

## 4. Integration

- [x] 4.1 Ensure `exec_command` tool is only registered when exec is enabled — verify `getAvailableTools()` excludes it when `exec.enabled` is false
- [x] 4.2 Verify agent executor can use exec_command end-to-end: configure allowlist, send a message asking agent to run a command, confirm result flows back
