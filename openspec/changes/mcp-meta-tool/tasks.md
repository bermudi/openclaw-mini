## 1. Add mcporter dependency

- [ ] 1.1 Run `bun add mcporter` and verify it resolves in the lockfile
- [ ] 1.2 Verify mcporter imports work: `import { createRuntime, callOnce } from 'mcporter'` compiles without errors

## 2. Config schema — MCP section

- [ ] 2.1 Add MCP server Zod schemas to `src/lib/config/schema.ts`: stdio server schema (`command`, `args`, `env`, `description`) and HTTP server schema (`url`, `headers`, `description`) with a discriminated union requiring exactly one of `command` or `url`
- [ ] 2.2 Add optional `mcp` section to `runtimeConfigSchema` with `servers: z.record(serverSchema)` — remove `.strict()` or update it to allow `mcp`
- [ ] 2.3 Export `McpServerConfig` type and add `getMcpServers()` helper that reads from parsed config and returns `Record<string, McpServerConfig>` (empty record if no `mcp` section)
- [ ] 2.4 Write unit tests: valid stdio config, valid HTTP config, reject both `command` + `url`, reject neither, empty `mcp.servers`, missing `mcp` section

## 3. MCP service — server lifecycle

- [ ] 3.1 Create `src/lib/services/mcp-service.ts` with a `McpService` class that wraps mcporter's `createRuntime()` and `callOnce()`
- [ ] 3.2 Implement `listTools(serverName: string)` — looks up server config, creates a mcporter runtime, calls `listTools` with `includeSchema: false`, maps results to compact format (`name: description (required: param1, param2)`), closes runtime
- [ ] 3.3 Implement `listServers()` — returns configured server names and descriptions from config
- [ ] 3.4 Implement `callTool(serverName: string, toolName: string, args: Record<string, unknown>)` — creates mcporter runtime, calls the tool, returns the result, closes runtime. Enforce 30s timeout
- [ ] 3.5 Add error handling: unknown server name → clear error, connection failure → descriptive error, timeout → abort and cleanup
- [ ] 3.6 Write unit tests with mocked mcporter runtime: successful list, successful call, unknown server, connection failure, timeout

## 4. Register meta-tools

- [ ] 4.1 Register `mcp_list` tool in `src/lib/tools.ts` with input schema `{ server: z.string().optional() }` — when server is provided, call `mcpService.listTools(server)`; when omitted, call `mcpService.listServers()`. Risk level: `low`
- [ ] 4.2 Register `mcp_call` tool in `src/lib/tools.ts` with input schema `{ server: z.string(), tool: z.string(), arguments: z.record(z.unknown()).optional() }` — call `mcpService.callTool(server, tool, arguments)`. Risk level: `medium`
- [ ] 4.3 Write unit tests: mcp_list with server, mcp_list without server, mcp_call success, mcp_call with unknown server, mcp_call with missing tool

## 5. System prompt — server directory

- [ ] 5.1 Add a `buildMcpDirectory()` function in `mcp-service.ts` that returns the compact server listing string (or empty string if no servers configured)
- [ ] 5.2 Integrate `buildMcpDirectory()` into the system prompt assembly in `agent-executor.ts` — append after existing bootstrap context, only when non-empty
- [ ] 5.3 Write unit test: verify system prompt includes MCP directory when servers are configured and excludes it when none are configured

## 6. Integration test

- [ ] 6.1 Add an integration test that declares a mock stdio MCP server in config, calls `mcp_list` to discover tools, then calls `mcp_call` to invoke one, verifying the full round-trip
