# mcp-config Specification

## Purpose
TBD - created by archiving change mcp-meta-tool. Update Purpose after archive.
## Requirements
### Requirement: MCP server declaration in config
The system SHALL support an `mcp.servers` section in `openclaw.json` for declaring MCP server connections.

#### Scenario: Stdio server declaration
- **GIVEN** `openclaw.json` contains:
  ```json
  {
    "mcp": {
      "servers": {
        "github": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-github"],
          "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" },
          "description": "GitHub API operations"
        }
      }
    }
  }
  ```
- **WHEN** the config is loaded
- **THEN** the system SHALL recognize `github` as a stdio-based MCP server with the specified command, args, and environment

#### Scenario: HTTP server declaration
- **GIVEN** `openclaw.json` contains:
  ```json
  {
    "mcp": {
      "servers": {
        "my-api": {
          "url": "http://localhost:3001/mcp",
          "headers": { "Authorization": "Bearer $MY_API_TOKEN" },
          "description": "Custom API server"
        }
      }
    }
  }
  ```
- **WHEN** the config is loaded
- **THEN** the system SHALL recognize `my-api` as an HTTP-based MCP server

#### Scenario: Server must have either command or url
- **GIVEN** `openclaw.json` contains an MCP server with neither `command` nor `url`
- **WHEN** the config is validated
- **THEN** validation SHALL fail with an error indicating that either `command` (stdio) or `url` (HTTP) is required

#### Scenario: Server cannot have both command and url
- **GIVEN** `openclaw.json` contains an MCP server with both `command` and `url`
- **WHEN** the config is validated
- **THEN** validation SHALL fail with an error indicating that `command` and `url` are mutually exclusive

### Requirement: Environment variable expansion
The system SHALL expand environment variable references in MCP server `env` and `headers` values.

#### Scenario: Dollar-sign expansion
- **GIVEN** a server env value is `"$GITHUB_TOKEN"` and `GITHUB_TOKEN=ghp_abc123` is set in the process environment
- **WHEN** the server connection is established
- **THEN** the env value SHALL be expanded to `ghp_abc123`

#### Scenario: Braces with fallback expansion
- **GIVEN** a server env value is `"${API_KEY:-default_key}"` and `API_KEY` is not set
- **WHEN** the server connection is established
- **THEN** the env value SHALL be expanded to `default_key`

#### Scenario: Missing env var without fallback
- **GIVEN** a server env value is `"$MISSING_VAR"` and `MISSING_VAR` is not set
- **WHEN** the server connection is established
- **THEN** the env value SHALL be expanded to an empty string

### Requirement: Server description field
Each MCP server declaration SHALL support an optional `description` field used for the system prompt directory.

#### Scenario: Server with description
- **GIVEN** a server is declared with `"description": "GitHub API operations"`
- **WHEN** the server directory is built for the system prompt
- **THEN** the entry SHALL show: `github — GitHub API operations`

#### Scenario: Server without description
- **GIVEN** a server is declared without a `description` field
- **WHEN** the server directory is built for the system prompt
- **THEN** the entry SHALL show only the server name: `github`

### Requirement: Empty MCP config is valid
The system SHALL accept configs with no `mcp` section or an empty `mcp.servers` object.

#### Scenario: No mcp section
- **GIVEN** `openclaw.json` does not contain an `mcp` key
- **WHEN** the config is validated
- **THEN** validation SHALL pass and no MCP servers SHALL be available

#### Scenario: Empty servers object
- **GIVEN** `openclaw.json` contains `"mcp": { "servers": {} }`
- **WHEN** the config is validated
- **THEN** validation SHALL pass and no MCP servers SHALL be available

