# session-compaction (Delta)

## ADDED Requirements

### Requirement: Post-compaction reflector hook
After session compaction successfully generates a summary and flushes history, the system SHALL invoke the memory reflector with the summary text. The reflector call SHALL be non-blocking — if it fails, compaction is still considered successful.

#### Scenario: Reflector invoked after compaction
- **GIVEN** session compaction summarizes 30 messages into a summary
- **WHEN** the summary is generated and history is flushed
- **THEN** the system SHALL call the memory reflector with the summary text and the agent ID

#### Scenario: Reflector failure does not affect compaction
- **GIVEN** the memory reflector throws an error
- **WHEN** compaction is in progress
- **THEN** compaction SHALL complete normally and return the correct `summarized` and `remaining` counts
