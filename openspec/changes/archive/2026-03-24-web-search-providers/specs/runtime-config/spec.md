# runtime-config (Delta)

## ADDED Requirements

### Requirement: Search configuration section
The system SHALL accept an optional `search` section at the top level of `openclaw.json` for web search provider configuration.

#### Scenario: Config with search API keys
- **WHEN** `openclaw.json` contains `"search": { "braveApiKey": "...", "tavilyApiKey": "..." }`
- **THEN** the config schema SHALL validate it and make API keys available to the search service

#### Scenario: Config without search section
- **WHEN** `openclaw.json` does not contain a `search` section
- **THEN** config validation SHALL pass and the search service SHALL fall back to environment variables and then DuckDuckGo

#### Scenario: Environment variables take precedence
- **GIVEN** `BRAVE_API_KEY` env var is set and `search.braveApiKey` is also set in config
- **WHEN** the search provider is resolved
- **THEN** the env var value SHALL take precedence
