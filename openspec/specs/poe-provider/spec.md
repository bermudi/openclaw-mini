# poe-provider Specification

## Purpose
TBD - created by archiving change add-poe-provider. Update Purpose after archive.
## Requirements
### Requirement: Poe provider routing
The system SHALL route Poe API requests to the appropriate endpoint based on model family:
- `claude-*` models SHALL use the Anthropic-compatible API (`/v1/messages`)
- `gpt-*, o3, o4-*` models SHALL use the Responses API (`/v1/responses`)
- All other models SHALL use the Chat Completions API (`/v1/chat/completions`)

#### Scenario: Claude model routed to Anthropic endpoint
- **WHEN** a request is made with provider `poe` and model `claude-opus-4.6`
- **THEN** the system SHALL use the Anthropic-compatible endpoint with base URL `https://api.poe.com`

#### Scenario: OpenAI model routed to Responses endpoint
- **WHEN** a request is made with provider `poe` and model `gpt-5-pro`
- **THEN** the system SHALL use the Responses API endpoint with base URL `https://api.poe.com/v1`

#### Scenario: Other model routed to Chat Completions
- **WHEN** a request is made with provider `poe` and model `grok-4`
- **THEN** the system SHALL use the Chat Completions endpoint with base URL `https://api.poe.com/v1`

### Requirement: Poe API key resolution
The system SHALL resolve the Poe API key from `POE_API_KEY` environment variable when provider is `poe`.

#### Scenario: Poe provider uses environment variable
- **WHEN** `AI_PROVIDER` is set to `poe` and `POE_API_KEY` is set in environment
- **THEN** the system SHALL use the value of `POE_API_KEY` for authentication

### Requirement: Subagent Poe configuration
The system SHALL allow subagent overrides to specify Poe provider and model using `provider: 'poe'` with a Poe model ID.

#### Scenario: Subagent overrides Poe model
- **WHEN** a subagent override specifies `provider: 'poe'` and `model: 'claude-sonnet-4.5'`
- **THEN** the system SHALL route the request to Poe's Anthropic endpoint using that model

### Requirement: Poe models work with existing model config resolution
The system SHALL integrate Poe into the existing `resolveModelConfig()` and `getLanguageModel()` flow without breaking other providers.

#### Scenario: Poe alongside existing providers
- **WHEN** `AI_PROVIDER` is `poe`
- **THEN** existing OpenAI, Anthropic, Ollama, and OpenRouter providers SHALL continue to work unchanged

