# runtime-config (Delta)

## ADDED Requirements

### Requirement: MCP section in config schema
The system SHALL accept an optional `mcp` section at the top level of `openclaw.json` for MCP server declarations.

#### Scenario: Config with mcp section
- **WHEN** `openclaw.json` contains an `mcp` section with valid server declarations
- **THEN** the config schema SHALL validate it and make server definitions available via `getMcpServers()`

#### Scenario: Config without mcp section
- **WHEN** `openclaw.json` does not contain an `mcp` section
- **THEN** config validation SHALL pass and `getMcpServers()` SHALL return an empty record

#### Scenario: Unknown fields in mcp section rejected
- **WHEN** `openclaw.json` contains `"mcp": { "servers": {}, "unknownField": true }`
- **THEN** config validation SHALL fail due to strict schema enforcement
