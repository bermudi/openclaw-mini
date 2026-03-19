# model-catalog Specification

## Purpose
TBD - created by archiving change add-poe-provider. Update Purpose after archive.
## Requirements
### Requirement: Model catalog fetch
The system SHALL fetch the model catalog from `GET https://api.poe.com/v1/models` without requiring authentication.

#### Scenario: Catalog fetched successfully
- **WHEN** the system requests the model catalog from Poe
- **THEN** the system SHALL receive a list of available models with their metadata

#### Scenario: Catalog fetch handles HTTP errors
- **WHEN** the catalog fetch returns a non-2xx status code
- **THEN** the system SHALL throw an appropriate error with the status code

### Requirement: Model catalog caching
The system SHALL cache the model catalog for 24 hours by default.

#### Scenario: Subsequent requests use cache
- **WHEN** the catalog has been fetched within the last 24 hours
- **THEN** subsequent calls to get catalog SHALL return the cached data without making a network request

#### Scenario: Cache expiration after 24 hours
- **WHEN** the catalog cache is older than 24 hours
- **THEN** the next catalog request SHALL trigger a fresh fetch

### Requirement: Force refresh
The system SHALL provide a mechanism to force refresh the catalog cache before expiration.

#### Scenario: Force refresh clears cache
- **WHEN** `catalog.refresh(force: true)` is called
- **THEN** the cached data SHALL be discarded and a fresh fetch SHALL occur

### Requirement: Model metadata extraction
The system SHALL extract model metadata including: `id`, `context_length`, `input_modalities`, `output_modalities`, `supported_features`, `reasoning`.

#### Scenario: Extract context window from catalog
- **WHEN** the catalog contains a model with `context_window.context_length`
- **THEN** the system SHALL use that value for `getContextWindowSize()`

#### Scenario: Extract capabilities from catalog
- **WHEN** the catalog contains a model with `architecture.input_modalities` and `supported_features`
- **THEN** the system SHALL expose those for capability filtering

### Requirement: Capability-based filtering
The system SHALL allow filtering models by required capabilities.

#### Scenario: Filter for vision-capable models
- **WHEN** `catalog.getModels({ capabilities: ['vision'] })` is called
- **THEN** the system SHALL return only models where `input_modalities` includes `"image"`

#### Scenario: Filter for reasoning models
- **WHEN** `catalog.getModels({ capabilities: ['reasoning'] })` is called
- **THEN** the system SHALL return only models where `supported_features` includes `"extended_thinking"` or `reasoning` is not null

#### Scenario: Filter for web search models
- **WHEN** `catalog.getModels({ capabilities: ['web-search'] })` is called
- **THEN** the system SHALL return only models where `supported_features` includes `"web_search"`

### Requirement: Context window lookup
The system SHALL use the catalog to look up context window sizes when available.

#### Scenario: Context window found in catalog
- **WHEN** `getContextWindowSize('claude-opus-4.6')` is called and the model is in the cached catalog
- **THEN** the system SHALL return the value from the catalog

#### Scenario: Context window not in catalog
- **WHEN** the model is not in the catalog
- **THEN** the system SHALL fall back to the hardcoded `MODEL_CONTEXT_WINDOWS` map with default of 8192

