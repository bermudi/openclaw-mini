# cron-scheduling Delta Specification

## ADDED Requirements

### Requirement: Canonical cron parsing
The system SHALL use one canonical cron parsing implementation for both trigger ingestion and scheduler execution.

#### Scenario: Input manager and scheduler agree on next run
- **WHEN** both components calculate next run time for the same cron expression and reference timestamp
- **THEN** they SHALL produce the same `nextRunAt` value

### Requirement: Cron expression validation
Invalid cron expressions SHALL be rejected at trigger write boundaries.

#### Scenario: Invalid cron rejected on create
- **WHEN** a trigger is created with an invalid cron expression
- **THEN** the API SHALL reject the request with a validation error

#### Scenario: Invalid cron rejected on update
- **WHEN** a trigger update includes an invalid cron expression
- **THEN** the API SHALL reject the update with a validation error

### Requirement: Accurate next-run calculation
`nextRunAt` SHALL be derived from the configured cron expression and reference time, not from fixed fallback intervals.

#### Scenario: Daily cron schedules next day boundary
- **WHEN** cron expression `0 9 * * *` is evaluated at `2026-03-26T10:00:00Z`
- **THEN** `nextRunAt` SHALL be `2026-03-27T09:00:00Z`

#### Scenario: Hourly cron schedules next hour boundary
- **WHEN** cron expression `0 * * * *` is evaluated at `2026-03-26T10:15:00Z`
- **THEN** `nextRunAt` SHALL be `2026-03-26T11:00:00Z`
