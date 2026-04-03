## MODIFIED Requirements

### Requirement: Graceful degradation on LLM failure
When the LLM call during compaction fails or returns an empty response, the system SHALL NOT delete any messages and SHALL return `{ summarized: 0, remaining: snapshot.length }`. The system SHALL log a warning to the console AND emit an audit log entry with action `session_compaction_failed`, severity `warning`, and details including session ID, agent ID, and error description.

#### Scenario: LLM call fails
- **WHEN** the LLM call during compaction throws an error
- **THEN** no messages are deleted, the method returns `{ summarized: 0, remaining: snapshot.length }`, a console warning is logged, AND an audit entry is created

#### Scenario: LLM returns empty response
- **WHEN** the LLM returns an empty or whitespace-only response
- **THEN** no messages are deleted, the method returns `{ summarized: 0, remaining: snapshot.length }`, a console warning is logged, AND an audit entry is created