## ADDED Requirements

### Requirement: Compaction failures emit audit log entries
When session compaction fails due to LLM call failure or empty LLM response, the system SHALL emit an audit log entry with action `session_compaction_failed`, severity `warning`, and details including the session ID, agent ID, and error description.

#### Scenario: LLM call fails during compaction
- **WHEN** the LLM call during compaction throws an error
- **THEN** an audit entry is created with action `session_compaction_failed` and the error message

#### Scenario: LLM returns empty response
- **WHEN** the LLM returns an empty or whitespace-only response
- **THEN** an audit entry is created with action `session_compaction_failed` and description "Empty LLM response"

### Requirement: Session cleanup emits audit log entry
When `cleanupOldSessions` deletes sessions, the system SHALL emit an audit log entry with action `sessions_cleaned`, severity `info`, and details including the count of sessions deleted and the cutoff date.

#### Scenario: Sessions are cleaned up
- **WHEN** `cleanupOldSessions` deletes one or more sessions
- **THEN** an audit entry is created with the count of deleted sessions

#### Scenario: No sessions to clean
- **WHEN** `cleanupOldSessions` finds no sessions older than the cutoff
- **THEN** no audit entry is created

### Requirement: Session deletion emits audit log entry
When `deleteSession` successfully deletes a session, the system SHALL emit an audit log entry with action `session_deleted`, severity `info`, and details including the session ID.

#### Scenario: Session is deleted
- **WHEN** `deleteSession` successfully deletes a session
- **THEN** an audit entry is created with the session ID

### Requirement: Corrupted async task registry logs warning
When `getAsyncTaskRegistry` encounters unparseable JSON in the database, it SHALL log a warning with the session ID in addition to returning an empty map.

#### Scenario: JSON is corrupted
- **WHEN** the `asyncTaskRegistry` column contains invalid JSON
- **THEN** a warning is logged and an empty map is returned

#### Scenario: JSON is valid
- **WHEN** the `asyncTaskRegistry` column contains valid JSON
- **THEN** the parsed map is returned normally