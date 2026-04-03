## MODIFIED Requirements

### Requirement: Single-writer discipline
Only the standalone runtime process SHALL be responsible for authoritative SQLite write operations for task and trigger lifecycle state.

#### Scenario: Runtime scheduler needs to mutate task state
- **WHEN** the runtime scheduler needs to create or transition task state
- **THEN** it SHALL call in-process runtime services against the runtime-owned storage client instead of issuing an HTTP callback to another process

#### Scenario: Auxiliary process attempts direct lifecycle write
- **WHEN** an auxiliary process outside the runtime attempts direct task lifecycle mutation
- **THEN** that architecture SHALL be considered non-compliant with the runtime reset
