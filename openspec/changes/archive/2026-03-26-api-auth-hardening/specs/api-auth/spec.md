# api-auth Delta Specification

## ADDED Requirements

### Requirement: Admin API authentication
Administrative API routes SHALL require a valid bearer token in the `Authorization` header.

#### Scenario: Missing token rejected
- **WHEN** a request is sent to `/api/tasks` without an `Authorization` header
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Invalid token rejected
- **WHEN** a request is sent to `/api/agents` with an invalid bearer token
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Valid token accepted
- **WHEN** a request is sent to `/api/sessions` with a valid bearer token
- **THEN** the API SHALL continue normal route handling

### Requirement: Secure-by-default startup
When running outside explicit insecure-local mode, the system SHALL require configured auth secrets at startup.

#### Scenario: Missing auth secret blocks startup
- **WHEN** runtime starts with `OPENCLAW_ALLOW_INSECURE_LOCAL` unset/false and no auth secret configured
- **THEN** startup validation SHALL fail with a clear configuration error

#### Scenario: Insecure local override allowed
- **WHEN** runtime starts with `OPENCLAW_ALLOW_INSECURE_LOCAL=true`
- **THEN** startup SHALL permit unauthenticated mode and log a prominent warning

### Requirement: Authentication failure observability
Authentication failures SHALL be logged with enough context for incident analysis without leaking secrets.

#### Scenario: Failed auth is logged
- **WHEN** a request is rejected due to missing or invalid token
- **THEN** the system SHALL record a security log including route and reason
- **AND** the log SHALL NOT contain the raw token value
