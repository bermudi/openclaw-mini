# provider-registry Specification

## Purpose
TBD - created by archiving change runtime-provider-registry. Update Purpose after archive.
## Requirements
### Requirement: Provider registry initialization
The system SHALL initialize a provider registry at startup by loading provider definitions from the runtime config.

#### Scenario: Registry loads providers from config
- **WHEN** the system starts with a config file containing providers
- **THEN** the provider registry SHALL contain all defined providers

#### Scenario: Registry is empty when no providers defined
- **WHEN** the config contains no providers section
- **THEN** the provider registry SHALL be empty

### Requirement: Provider lookup
The system SHALL allow looking up a provider by its ID.

#### Scenario: Get existing provider
- **WHEN** `registry.get('openai')` is called
- **THEN** the provider definition for openai SHALL be returned

#### Scenario: Get non-existent provider
- **WHEN** `registry.get('nonexistent')` is called
- **THEN** `undefined` SHALL be returned

### Requirement: Provider listing
The system SHALL allow listing all registered providers.

#### Scenario: List all providers
- **WHEN** `registry.list()` is called
- **THEN** an array of all provider definitions SHALL be returned

### Requirement: Provider reload
The system SHALL support reloading the registry with new provider definitions.

#### Scenario: Reload replaces providers
- **WHEN** `registry.reload(newConfig)` is called with new provider definitions
- **THEN** subsequent `get()` calls SHALL return the new provider definitions

### Requirement: Provider validation
The system SHALL validate provider definitions when registering them.

#### Scenario: Valid provider registration
- **WHEN** a provider with valid `apiType` and `apiKey` is registered
- **THEN** registration SHALL succeed

#### Scenario: Invalid apiType rejected
- **WHEN** a provider with unknown `apiType` is registered
- **THEN** registration SHALL fail with an error

### Requirement: SDK adapter selection
The system SHALL select the correct SDK adapter based on `apiType`.

#### Scenario: openai-chat uses OpenAI SDK
- **WHEN** a provider with `apiType: 'openai-chat'` is used to create a language model
- **THEN** the OpenAI SDK SHALL be used

#### Scenario: gemini uses Google SDK
- **WHEN** a provider with `apiType: 'gemini'` is used to create a language model
- **THEN** the Google AI SDK SHALL be used

#### Scenario: anthropic uses Anthropic SDK
- **WHEN** a provider with `apiType: 'anthropic'` is used to create a language model
- **THEN** the Anthropic SDK SHALL be used

### Requirement: SDK caching
The system SHALL cache created SDK clients to avoid recreating them for each request.

#### Scenario: Same provider reuses SDK client
- **WHEN** `getLanguageModel()` is called twice with the same provider
- **THEN** the SDK client SHALL be reused (not recreated)

### Requirement: SDK cache invalidation on reload
The system SHALL invalidate the SDK cache when the provider registry is reloaded.

#### Scenario: Reload clears SDK cache
- **WHEN** `registry.reload(newConfig)` is called
- **THEN** subsequent `getLanguageModel()` calls SHALL create new SDK clients

