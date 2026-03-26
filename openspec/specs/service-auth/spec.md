# service-auth Specification

## Purpose
TBD - created by archiving change api-auth-hardening. Update Purpose after archive.
## Requirements
### Requirement: Scheduler-to-API authentication
Scheduler requests to internal Next.js task endpoints SHALL include a valid service bearer token.

#### Scenario: Scheduler request without token is rejected
- **WHEN** scheduler calls `POST /api/tasks/{id}/execute` without a valid token
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Scheduler request with valid token is accepted
- **WHEN** scheduler calls `POST /api/tasks` with a valid service token
- **THEN** the API SHALL create the task and perform normal side effects

