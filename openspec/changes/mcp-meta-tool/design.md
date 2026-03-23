## Context

Our agent runtime has 9 built-in tools. Users want to extend capabilities via the MCP ecosystem (GitHub, Brave Search, databases, etc.) without bloating the context window. The MCP protocol requires listing all tool schemas upfront — a single server like `@modelcontextprotocol/server-github` dumps 30+ tool schemas (3-5K tokens) into every request.

The current config schema (`openclaw.json`) has `providers`, `agent`, and `runtime` sections. There is no MCP support. The tool registry in `src/lib/tools.ts` registers tools at startup via `registerTool()`.

## Goals / Non-Goals

**Goals:**
- Let users declare MCP servers in `openclaw.json` using the same format as Cursor/Claude Desktop
- Provide on-demand MCP tool discovery and invocation via two meta-tools (`mcp_list`, `mcp_call`)
- Keep context window overhead to ~200 tokens (server directory in system prompt) instead of ~5K+ (full schemas)
- Use mcporter as the transport/connection layer — don't reinvent stdio/HTTP/OAuth handling

**Non-Goals:**
- Keep-alive daemon for long-running MCP servers (spawn-per-call for now; upgrade path exists in mcporter)
- Dynamic tool routing based on semantic similarity (agent decides which server to query)
- Registering MCP tools as first-class tools in the tool registry (they stay behind the meta-tools)
- MCP server-side functionality (we are a client only)
- Per-agent MCP server restrictions (all agents see all configured servers for now)

## Decisions

### 1. Two meta-tools instead of tool-per-MCP-tool

Register `mcp_list` and `mcp_call` as native tools. The agent discovers available tools on-demand via `mcp_list(server)`, then invokes via `mcp_call(server, tool, arguments)`.

**Why not register each MCP tool individually?** Context window cost. A server with 30 tools would add 30 tool definitions to every LLM call. With meta-tools, the cost is 2 tool definitions (~200 tokens) plus a compact server directory in the system prompt (~1 line per server).

**Why not a single combined tool?** Separation lets the agent discover first, then call. The list result can be cached in conversation context so subsequent calls to the same server skip discovery.

### 2. Compact summaries from `mcp_list`

`mcp_list` returns tool name + description + required parameter names only. No full JSON Schema. This keeps the response small enough to fit in a single tool result without eating context.

Format per tool:
```
- tool_name: Description text (required: param1, param2)
```

**Why not full schemas?** A full schema for one tool can be 200+ tokens. For 30 tools, that's 6K tokens in a single tool result — defeating the purpose. The agent can infer parameter types from names/descriptions and the model generally knows common API patterns.

**Trade-off:** The agent may occasionally pass wrong parameter types for exotic MCP servers. Acceptable — the MCP server returns a clear error, the agent retries.

### 3. Spawn-per-call lifecycle

Each `mcp_call` invocation creates a fresh mcporter runtime, connects to the target server, executes the call, and tears down. No persistent connections.

**Why not keep-alive?** Simplicity. Spawn-per-call means no connection pool, no lifecycle management, no zombie process cleanup. For typical agent interactions (a few MCP calls per conversation), the overhead of spawning is negligible (~200ms for stdio servers).

**Upgrade path:** mcporter has a daemon mode with keep-alive. If spawn-per-call becomes a bottleneck, we can switch to `lifecycle: "keep-alive"` without changing the tool interface.

### 4. mcporter as a dependency

Use mcporter's `createRuntime()` and `callOnce()` APIs for transport negotiation, env var expansion, and schema caching.

**Why not `@modelcontextprotocol/sdk` directly?** mcporter handles stdio spawning, HTTP/SSE fallback, OAuth flows, and schema caching. Reimplementing these would be ~500 lines of transport code we'd have to maintain.

**Why not shell out to `mcporter` CLI?** In-process is faster, no serialization overhead, and we get typed responses.

### 5. Config format matches Cursor/Claude Desktop

Users declare MCP servers in `openclaw.json` under `mcp.servers` using the same `command`/`args`/`env` (stdio) or `url`/`headers` (HTTP) format that Cursor, Claude Desktop, and Codex use.

**Why?** Users can copy-paste their existing MCP configs. No new format to learn. env var expansion (`$VAR`, `${VAR:-fallback}`) handled by mcporter.

### 6. Server directory injected into system prompt

A compact listing of configured MCP servers is appended to the system prompt:

```
Available MCP servers (use mcp_list to discover tools):
• github — GitHub API operations
• brave-search — Web search via Brave
```

**Why in system prompt?** The agent needs to know what's available to decide when to use `mcp_list`. Without this, it would have no idea MCP servers exist. The cost is ~10 tokens per server — negligible.

## Risks / Trade-offs

- **Spawn-per-call latency** (~200ms per stdio server spawn) → Acceptable for now; mcporter daemon is the upgrade path if it becomes a problem
- **Agent may hallucinate tool names** before calling `mcp_list` → The `mcp_call` tool validates the tool exists on the server before invoking; clear error message guides the agent to use `mcp_list` first
- **mcporter dependency size** → It's a focused library; the alternative (reimplementing transports) is worse
- **No parameter validation before calling** → MCP servers validate inputs and return structured errors; the agent can self-correct from error messages
- **Stdio server crashes** are not retried → spawn-per-call naturally handles this since each call gets a fresh process
