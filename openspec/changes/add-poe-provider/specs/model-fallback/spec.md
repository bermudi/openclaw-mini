## ADDED Requirements

### Requirement: Fallback model configuration
The system SHALL support configuring a fallback model via `AI_FALLBACK_MODEL` environment variable in `provider/model` format.

#### Scenario: Fallback model configured
- **WHEN** `AI_FALLBACK_MODEL` is set to `openai/gpt-4.1-mini`
- **THEN** the system SHALL use `openai` with model `gpt-4.1-mini` as the fallback

### Requirement: Fallback resolution
The system SHALL resolve fallback models using the same `resolveModelConfig()` path as primary models.

#### Scenario: Fallback uses same resolution path
- **WHEN** fallback model is `anthropic/claude-haiku-4.5`
- **THEN** the system SHALL resolve credentials and base URL using the Anthropic provider defaults

### Requirement: Primary model tried first
The system SHALL always attempt the primary model before falling back to the fallback model.

#### Scenario: Primary model attempted first
- **WHEN** a request is made with primary `poe/gpt-5-pro` and fallback `openai/gpt-4.1-mini`
- **THEN** the system SHALL first attempt `poe/gpt-5-pro`

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
The system SHALL support fallback from Poe to non-Poe providers and vice versa.

#### Scenario: Poe to OpenAI fallback
- **WHEN** primary is `poe/gpt-5-pro` and fallback is `openai/gpt-4.1-mini`
- **THEN** the system SHALL attempt OpenAI when Poe fails

#### Scenario: OpenAI to Poe fallback
- **WHEN** primary is `openai/gpt-4.1` and fallback is `poe/claude-opus-4.6`
- **THEN** the system SHALL attempt Poe when OpenAI fails
