# agent-routing Specification (Delta)

## Purpose
Session context storage changes from JSON blob read-modify-write to append-only message rows, modifying the existing agent-routing capability.

## MODIFIED Requirements

### Requirement: Session context storage as append-only message rows
The `Session.context` JSON blob pattern SHALL be replaced with a `SessionMessage` table. Each call to `appendToContext` SHALL insert a single row into `SessionMessage` with fields: `id`, `sessionId`, `role`, `content`, `sender`, `channel`, `channelKey`, and `createdAt`. The `Session.context` column SHALL be retained during migration but SHALL NOT be written to after migration completes.

#### Scenario: Appending a message inserts a row
- **WHEN** `appendToContext` is called with a user message
- **THEN** a single `INSERT` SHALL be executed against the `SessionMessage` table with the message fields and current timestamp
- **AND** no `SELECT` or `UPDATE` on `Session.context` SHALL occur

#### Scenario: Concurrent messages do not race
- **WHEN** two messages arrive simultaneously for the same session
- **THEN** both SHALL be inserted as separate `SessionMessage` rows without data loss, because each is an independent `INSERT`

#### Scenario: Reading session context queries message rows
- **WHEN** `getSessionContext` is called for a session
- **THEN** the system SHALL query `SessionMessage` rows for that session ordered by `createdAt` ascending, instead of deserializing `Session.context`

### Requirement: Migration of existing session context
Existing sessions with JSON blob context SHALL be migrated to `SessionMessage` rows. The migration SHALL parse each `Session.context` JSON value and insert individual `SessionMessage` rows for each message in the array. Sessions with malformed JSON SHALL be treated as empty (no rows inserted) with a warning logged.

#### Scenario: Valid JSON session is migrated
- **GIVEN** a session has `context` containing a JSON array with 15 messages
- **WHEN** the migration runs
- **THEN** 15 `SessionMessage` rows SHALL be created for that session with the original timestamps preserved

#### Scenario: Malformed JSON session is handled gracefully
- **GIVEN** a session has `context` containing invalid JSON
- **WHEN** the migration runs
- **THEN** no `SessionMessage` rows SHALL be created for that session, a warning SHALL be logged, and the migration SHALL continue with remaining sessions

### Requirement: Session message count uses row count
The `getAgentSessions` method's `messageCount` field SHALL be computed from a `COUNT` query on `SessionMessage` rows for each session, instead of parsing the JSON blob and measuring array length.

#### Scenario: Message count reflects row count
- **GIVEN** a session has 22 `SessionMessage` rows
- **WHEN** `getAgentSessions` is called
- **THEN** the `messageCount` for that session SHALL be 22
