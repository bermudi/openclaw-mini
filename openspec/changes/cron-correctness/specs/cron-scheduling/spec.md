# cron-scheduling Delta Specification

## ADDED Requirements

### Requirement: Canonical cron parsing
The system SHALL use one canonical cron parsing implementation for both trigger write boundaries and scheduled execution boundaries.

#### Scenario: Trigger write and scheduler execution agree on next run
- **WHEN** a cron expression is evaluated during trigger creation or update and later during scheduled trigger execution using the same reference timestamp
- **THEN** both boundaries SHALL produce the same `nextTrigger` value

### Requirement: Cron expression validation
Invalid cron expressions SHALL be rejected at trigger write boundaries.

#### Scenario: Invalid cron rejected on create
- **WHEN** a trigger is created with an invalid cron expression
- **THEN** the API SHALL reject the request with a validation error

#### Scenario: Invalid cron rejected on update
- **WHEN** a trigger update includes an invalid cron expression
- **THEN** the API SHALL reject the update with a validation error

### Requirement: Accurate next-run calculation
`nextTrigger` SHALL be derived from the configured cron expression and reference time, not from fixed fallback intervals.

#### Scenario: Daily cron schedules next day boundary
- **WHEN** cron expression `0 9 * * *` is evaluated at `2026-03-26T10:00:00Z`
- **THEN** `nextTrigger` SHALL be `2026-03-27T09:00:00Z`

#### Scenario: Hourly cron schedules next hour boundary
- **WHEN** cron expression `0 * * * *` is evaluated at `2026-03-26T10:15:00Z`
- **THEN** `nextTrigger` SHALL be `2026-03-26T11:00:00Z`

### Requirement: Deterministic timezone policy
Cron expressions SHALL be evaluated in UTC until per-trigger timezone configuration is introduced.

#### Scenario: Next run does not depend on host local timezone
- **WHEN** cron expression `0 9 * * *` is evaluated at `2026-03-26T08:30:00Z`
- **THEN** the next `nextTrigger` SHALL be `2026-03-26T09:00:00Z` regardless of the scheduler host timezone
