# mcp-integration Specification

## ADDED Requirements

### Requirement: mcp_list meta-tool
The system SHALL register an `mcp_list` tool that returns a compact summary of available tools for a given MCP server.

#### Scenario: List tools for a configured server
- **GIVEN** `openclaw.json` declares an MCP server named `github`
- **WHEN** the agent calls `mcp_list` with `server: "github"`
- **THEN** the system SHALL connect to the `github` MCP server, fetch its tool list, and return each tool as `name: description (required: param1, param2)`

#### Scenario: List tools for an unconfigured server
- **WHEN** the agent calls `mcp_list` with `server: "nonexistent"`
- **THEN** the system SHALL return an error: `MCP server 'nonexistent' is not configured`

#### Scenario: List tools when server connection fails
- **GIVEN** `openclaw.json` declares an MCP server `broken` with an invalid command
- **WHEN** the agent calls `mcp_list` with `server: "broken"`
- **THEN** the system SHALL return an error describing the connection failure

#### Scenario: Compact summary format
- **GIVEN** a server has a tool `create_issue` with description "Create a new issue" and required parameters `title` and `body`, and optional parameter `labels`
- **WHEN** `mcp_list` returns that tool's summary
- **THEN** the summary SHALL include the tool name, description, and only required parameter names: `create_issue: Create a new issue (required: title, body)`

#### Scenario: List all servers when no server specified
- **GIVEN** `openclaw.json` declares MCP servers `github` and `brave-search`
- **WHEN** the agent calls `mcp_list` without a `server` argument
- **THEN** the system SHALL return a list of configured server names and their descriptions

### Requirement: mcp_call meta-tool
The system SHALL register an `mcp_call` tool that invokes a specific tool on a specific MCP server.

#### Scenario: Successful tool invocation
- **GIVEN** `openclaw.json` declares an MCP server `github`
- **WHEN** the agent calls `mcp_call` with `server: "github"`, `tool: "create_issue"`, `arguments: {"title": "Bug", "body": "Details"}`
- **THEN** the system SHALL connect to the `github` server, invoke `create_issue` with the provided arguments, and return the tool's response

#### Scenario: Call tool on unconfigured server
- **WHEN** the agent calls `mcp_call` with `server: "nonexistent"`
- **THEN** the system SHALL return an error: `MCP server 'nonexistent' is not configured`

#### Scenario: Call nonexistent tool
- **GIVEN** `openclaw.json` declares an MCP server `github`
- **WHEN** the agent calls `mcp_call` with `server: "github"`, `tool: "nonexistent_tool"`
- **THEN** the system SHALL return the error from the MCP server indicating the tool does not exist

#### Scenario: Tool invocation with invalid arguments
- **GIVEN** `openclaw.json` declares an MCP server `github` with a tool `create_issue` requiring `title`
- **WHEN** the agent calls `mcp_call` with `server: "github"`, `tool: "create_issue"`, `arguments: {}`
- **THEN** the system SHALL return the validation error from the MCP server

#### Scenario: Tool invocation timeout
- **WHEN** an MCP tool invocation takes longer than 30 seconds
- **THEN** the system SHALL abort the call, tear down the connection, and return a timeout error

### Requirement: Spawn-per-call lifecycle
The system SHALL create a fresh mcporter runtime connection for each `mcp_list` or `mcp_call` invocation and tear it down after the call completes.

#### Scenario: Fresh connection per call
- **WHEN** the agent calls `mcp_call` twice for the same server
- **THEN** each call SHALL spawn a new connection and close it after completion

#### Scenario: Connection cleanup on error
- **WHEN** an MCP call fails with a connection error
- **THEN** the system SHALL ensure the spawned process is terminated and resources are released

### Requirement: Server directory in system prompt
The system SHALL inject a compact directory of configured MCP servers into the agent's system prompt.

#### Scenario: System prompt with MCP servers
- **GIVEN** `openclaw.json` declares MCP servers `github` (description: "GitHub API operations") and `brave-search` (description: "Web search via Brave")
- **WHEN** the agent's system prompt is assembled
- **THEN** the prompt SHALL include a section listing available MCP servers with their descriptions and a note to use `mcp_list` for discovery

#### Scenario: System prompt without MCP servers
- **GIVEN** `openclaw.json` has no `mcp` section or an empty `mcp.servers`
- **WHEN** the agent's system prompt is assembled
- **THEN** no MCP directory section SHALL be added to the prompt

### Requirement: Meta-tools respect sub-agent tool restrictions
The `mcp_list` and `mcp_call` tools SHALL be subject to the same tool allowlist/denylist enforcement as other tools.

#### Scenario: Sub-agent without MCP access
- **GIVEN** a sub-agent is spawned with `allowedTools: ["read_file", "write_note"]`
- **WHEN** the sub-agent attempts to call `mcp_call`
- **THEN** the tool registry SHALL reject the call with a permission error
