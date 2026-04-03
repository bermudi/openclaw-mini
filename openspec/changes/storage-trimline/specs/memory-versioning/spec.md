## MODIFIED Requirements

### Requirement: Commit on every memory write
Every canonical memory write SHALL commit to SQLite before filesystem and git mirror work begins. The mirror workflow SHALL still write files and create git commits using the existing message format, but it SHALL do so asynchronously after the canonical write succeeds.

#### Scenario: Canonical write completes before mirror work
- **WHEN** `setMemory` creates or updates a memory
- **THEN** the canonical SQLite write SHALL complete successfully before filesystem or git work is awaited by the caller

#### Scenario: Mirror commit eventually appears
- **WHEN** a memory write succeeds and git mirroring is enabled
- **THEN** the corresponding file update and git commit SHALL be created asynchronously with the existing `{Action} {key}` message format

#### Scenario: Mirror failure does not roll back canonical write
- **WHEN** filesystem or git mirroring fails after the canonical write has succeeded
- **THEN** the system SHALL log the mirror failure and preserve the canonical SQLite write instead of reporting the overall write as failed
