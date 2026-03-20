# model-fallback Specification

## MODIFIED Requirements

### Requirement: Fallback model configuration
The system SHALL support configuring a fallback model via the `agent.fallbackProvider` and `agent.fallbackModel` fields in the config file.

#### Scenario: Fallback from config file
- **WHEN** config file specifies `fallbackProvider: "openai"` and `fallbackModel: "gpt-4.1-mini"`
- **THEN** the system SHALL use OpenAI with model `gpt-4.1-mini` as the fallback

### Requirement: Fallback resolution
The system SHALL resolve fallback models using the same provider registry as primary models.

#### Scenario: Fallback uses registry
- **WHEN** fallback model is configured
- **THEN** the system SHALL look up the fallback provider in the registry and use its credentials

### Requirement: Primary model tried first
The system SHALL always attempt the primary model before falling back to the fallback model.

#### Scenario: Primary model attempted first
- **WHEN** a request is made with primary from config and fallback configured
- **THEN** the system SHALL first attempt the primary model

### Requirement: Fallback on provider error
The system SHALL attempt the fallback model when the primary provider fails with a retryable error:
- HTTP 429 (rate limit)
- HTTP 500 (server error)
- HTTP 502 (upstream error)
- HTTP 503 (service unavailable)
- Network errors (ECONNREFUSED, ETIMEDOUT, DNS failures)

#### Scenario: Rate limit triggers fallback
- **WHEN** primary model returns HTTP 429 (rate limit)
- **THEN** the system SHALL immediately retry with the fallback model

#### Scenario: Server error triggers fallback
- **WHEN** primary model returns HTTP 500 (provider error)
- **THEN** the system SHALL retry with the fallback model

#### Scenario: Network error triggers fallback
- **WHEN** primary model fails with ECONNREFUSED or ETIMEDOUT
- **THEN** the system SHALL retry with the fallback model

### Requirement: Non-retryable errors do not fallback
The system SHALL NOT attempt fallback for non-retryable errors (401 authentication, 403 permission denied, 400 bad request).

#### Scenario: Auth error does not trigger fallback
- **WHEN** primary model returns HTTP 401 (authentication error)
- **THEN** the system SHALL NOT attempt the fallback model

### Requirement: Fallback failures surface original error
The system SHALL propagate the original error if the fallback model also fails.

#### Scenario: Both primary and fallback fail
- **WHEN** primary returns 429 and fallback returns 401
- **THEN** the system SHALL throw an error indicating the fallback also failed, including details of both failures

### Requirement: Cross-provider fallback
The system SHALL support fallback between any two providers in the registry.

#### Scenario: OpenRouter to OpenAI fallback
- **WHEN** primary is `openrouter` with model `openai/gpt-5.4-mini` and fallback is `openai`
- **THEN** the system SHALL attempt OpenAI when OpenRouter fails

## ADDED Requirements

### Requirement: Deprecated fallback environment variable compatibility
The system SHALL continue to support configuring fallback via `AI_FALLBACK_MODEL` environment variable in `provider/model` format for backwards compatibility.

#### Scenario: Fallback from env var (deprecated)
- **WHEN** `AI_FALLBACK_MODEL` is set to `openai/gpt-4.1-mini`
- **THEN** the system SHALL use `openai` with model `gpt-4.1-mini` as the fallback
- **AND** a deprecation warning SHALL be logged
