## ADDED Requirements

### Requirement: Parent task linkage for coding-agent delegation
The system SHALL preserve parent-task linkage when a task delegates work into a persistent coding-agent session.

#### Scenario: Coding-agent session spawned from task context
- **WHEN** a caller invokes `spawn_coding_agent` from an executing task context
- **THEN** the created coding-agent session SHALL record the parent task identifier and owning agent identifier

#### Scenario: Linked coding-agent session remains inspectable after parent turn ends
- **WHEN** the parent task that spawned a coding-agent session completes
- **THEN** the coding-agent session SHALL remain independently inspectable and controllable through the coding-agent control surface
