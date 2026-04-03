## ADDED Requirements

### Requirement: Scheduler API calls use retry with exponential backoff
All scheduler-to-app HTTP API calls SHALL use retry with exponential backoff on transient failures. The retry utility SHALL support configurable max retries (default 3) and base delay (default 500ms). Each retry attempt SHALL double the delay from the previous attempt (500ms, 1s, 2s).

#### Scenario: executeTaskViaApi succeeds on first attempt
- **WHEN** the main app responds with 200 and valid JSON
- **THEN** the function returns the parsed response without any retries

#### Scenario: executeTaskViaApi retries on connection failure
- **WHEN** the main app is temporarily unreachable (network error)
- **THEN** the function retries up to 3 times with exponential backoff before returning failure

#### Scenario: fireTriggerViaApi retries on connection failure
- **WHEN** the main app is temporarily unreachable (network error)
- **THEN** the function retries up to 3 times with exponential backoff before returning failure

#### Scenario: createTaskViaApi retries on connection failure
- **WHEN** the main app is temporarily unreachable (network error)
- **THEN** the function retries up to 3 times with exponential backoff before returning failure

#### Scenario: Non-retryable server response failure
- **WHEN** the API responds with a non-success status (e.g., 400, 500) with valid JSON
- **THEN** the function returns the error immediately without retrying

#### Scenario: Retry logging avoids spam
- **WHEN** retries occur
- **THEN** a warning is logged only on the first retry, not on subsequent retries

### Requirement: API responses are validated before JSON parsing
All scheduler API call functions SHALL validate that the response is JSON-parseable before calling `response.json()`. If the response is not valid JSON, the function SHALL read the response as text and include it in the error message.

#### Scenario: Non-JSON response handling
- **WHEN** the API returns an HTML error page (e.g., 502 from reverse proxy)
- **THEN** the function reads the response as text and includes a truncated version in the error message

#### Scenario: Valid JSON response parsing
- **WHEN** the API returns a valid JSON response
- **THEN** the function parses and returns the JSON body normally

### Requirement: Dead function recordTriggerFireViaApi is removed
The `recordTriggerFireViaApi` function SHALL be removed from the scheduler service. It is never called and provides no value over `fireTriggerViaApi`.

#### Scenario: Function removal
- **WHEN** the scheduler module is loaded
- **THEN** `recordTriggerFireViaApi` is not exported and does not exist in the module