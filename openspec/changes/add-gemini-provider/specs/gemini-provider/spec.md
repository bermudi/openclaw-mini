## ADDED Requirements

### Requirement: Gemini provider registration
The system SHALL support registering a provider with `apiType: 'gemini'`.

#### Scenario: Gemini provider registered
- **WHEN** a provider definition with `apiType: 'gemini'` is added to config
- **THEN** the registry SHALL accept it

### Requirement: Gemini SDK integration
The system SHALL use `@ai-sdk/google` to create language models for Gemini providers.

#### Scenario: Gemini language model created
- **WHEN** `getLanguageModel({ provider: 'gemini', model: 'gemini-2.5-pro' })` is called
- **THEN** the system SHALL use `createGoogle()` from "@ai-sdk/google"

### Requirement: Gemini API key
The system SHALL use the provider's `apiKey` for Gemini authentication.

#### Scenario: Gemini uses provider apiKey
- **WHEN** a Gemini provider with `apiKey: 'AI...'` is used
- **THEN** the Google AI SDK SHALL be initialized with that API key

### Requirement: Gemini base URL
The system SHALL support custom `baseURL` for Gemini (for Vertex AI or AI Studio endpoints).

#### Scenario: Custom Gemini baseURL
- **WHEN** a Gemini provider specifies `baseURL: 'https://language.googleapis.com/v1beta'`
- **THEN** the Google AI SDK SHALL use that base URL

### Requirement: Gemini model names
The system SHALL pass model names directly to the Google AI SDK.

#### Scenario: Gemini model name passed through
- **WHEN** model is `gemini-2.5-pro`
- **THEN** the SDK SHALL receive `gemini-2.5-pro` as the model name

### Requirement: Gemini streaming
The system SHALL support streaming responses from Gemini providers.

#### Scenario: Gemini streaming works
- **WHEN** a streaming request is made to Gemini
- **THEN** the response SHALL be streamed correctly
