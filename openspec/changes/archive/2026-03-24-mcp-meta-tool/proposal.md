## Why

Our agents currently have 9 built-in tools — fine for basics, but users want to bring their own capabilities via MCP servers (GitHub, Brave Search, filesystem, databases, etc.). Native MCP integration dumps all tool schemas into context, costing 3-5K+ tokens per server before the user even speaks. For a lightweight runtime targeting low RAM and fast responses, that's unacceptable.

We need MCP support that gives users full access to the MCP ecosystem without the context window tax.

## What Changes

- Add **two meta-tools** (`mcp_list` and `mcp_call`) that let agents discover and invoke any MCP tool on-demand, instead of registering all MCP tools upfront into context
- Add an **MCP section to `openclaw.json`** for users to declare their MCP servers (stdio and HTTP), using the same format as Cursor/Claude Desktop for easy copy-paste
- Add **mcporter** as a dependency for transport, connection management, and schema caching
- Add an **MCP server lifecycle manager** that spawns stdio servers on first use and tears them down after the call (spawn-per-call)
- Inject a **compact server directory** into the system prompt so agents know what's available without seeing full schemas

## Capabilities

### New Capabilities

- `mcp-integration`: Core MCP support — config schema, server lifecycle, meta-tool registration, compact discovery, and on-demand tool invocation via mcporter
- `mcp-config`: Configuration schema for declaring MCP servers in `openclaw.json` with env var expansion

### Modified Capabilities

- `runtime-config`: Add `mcp` section to the config schema for server declarations

## Impact

- **Config**: `openclaw.json` gains an `mcp.servers` section — additive, not breaking
- **Dependencies**: `mcporter` added to `package.json`
- **Tools**: Two new tools registered (`mcp_list`, `mcp_call`) — additive
- **System prompt**: Small appendix listing available MCP servers (~1 line per server)
- **Code**: New `src/lib/services/mcp-service.ts` for lifecycle management; edits to `src/lib/tools.ts` for tool registration; edits to config schema
