## ADDED Requirements

### Requirement: getOrCreateSession validates inputs
The `getOrCreateSession` method SHALL validate that `agentId`, `sessionScope`, and `channelKey` are non-empty strings. If any parameter is empty or whitespace-only, it SHALL throw an Error describing the invalid parameter.

#### Scenario: Valid inputs
- **WHEN** all parameters are non-empty strings
- **THEN** the session is created or retrieved normally

#### Scenario: Empty agentId
- **WHEN** `agentId` is an empty string
- **THEN** it throws an Error with message "agentId must be non-empty"

#### Scenario: Empty sessionScope
- **WHEN** `sessionScope` is an empty string
- **THEN** it throws an Error with message "sessionScope must be non-empty"

### Requirement: appendToContext validates content
The `appendToContext` method SHALL validate that `content` is non-empty and does not exceed 100,000 characters. If content is empty, it SHALL throw an Error. If content exceeds the limit, it SHALL throw an Error with the content length.

#### Scenario: Valid content
- **WHEN** content is a non-empty string under 100,000 characters
- **THEN** the message is appended normally

#### Scenario: Empty content
- **WHEN** content is an empty string
- **THEN** it throws an Error with message "Message content must be non-empty"

#### Scenario: Content exceeds limit
- **WHEN** content exceeds 100,000 characters
- **THEN** it throws an Error with message "Message content exceeds maximum length of 100000 characters (got <actual>)"

### Requirement: compactSession validates options
The `compactSession` method SHALL validate that `retainCount` and `threshold` options, if provided, are positive integers. If either is zero or negative, it SHALL throw an Error.

#### Scenario: Valid retainCount
- **WHEN** `retainCount` is a positive integer
- **THEN** compaction proceeds with that retain count

#### Scenario: Negative retainCount
- **WHEN** `retainCount` is zero or negative
- **THEN** it throws an Error with message "retainCount must be a positive integer"