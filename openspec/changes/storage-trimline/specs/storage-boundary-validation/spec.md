## ADDED Requirements

### Requirement: Structured persistence boundary validation
The system SHALL validate structured persistence payloads before writing them to storage and before returning them to callers as typed objects.

#### Scenario: Valid structured payload is accepted
- **WHEN** a service writes a structured field such as task payload, trigger config, or session context with data that satisfies its schema
- **THEN** the value SHALL be persisted successfully and returned as the expected typed structure

#### Scenario: Invalid structured payload is rejected
- **WHEN** a service attempts to write malformed structured data that does not satisfy the schema for that field
- **THEN** the write SHALL fail explicitly instead of silently persisting malformed JSON

#### Scenario: Malformed stored data fails loudly on read
- **WHEN** the system encounters malformed structured data while reading from storage
- **THEN** it SHALL surface a typed error or validation failure instead of returning unchecked data as if it were valid
