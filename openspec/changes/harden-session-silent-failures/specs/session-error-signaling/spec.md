## ADDED Requirements

### Requirement: appendToContext throws when session not found
When `appendToContext` is called with a session ID that does not exist in the database, it SHALL throw an Error with message "Session not found: <sessionId>" instead of silently returning.

#### Scenario: Session exists
- **WHEN** `appendToContext` is called with a valid session ID
- **THEN** the message is appended to the session normally

#### Scenario: Session does not exist
- **WHEN** `appendToContext` is called with a non-existent session ID
- **THEN** it throws an Error with message "Session not found: <sessionId>"

### Requirement: appendToContext throws when agent not found
When `appendToContext` is called with a session whose agent ID does not exist in the database, it SHALL throw an Error with message "Agent not found for session <sessionId>" instead of silently returning.

#### Scenario: Agent exists
- **WHEN** `appendToContext` is called for a session with a valid agent
- **THEN** the message is appended normally

#### Scenario: Agent does not exist
- **WHEN** `appendToContext` is called for a session whose agent has been deleted
- **THEN** it throws an Error with message "Agent not found for session <sessionId>"