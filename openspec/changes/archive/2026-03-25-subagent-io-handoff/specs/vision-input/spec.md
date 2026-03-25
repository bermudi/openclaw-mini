## ADDED Requirements

### Requirement: Vision inputs passed through task hierarchies
The system SHALL support passing `visionInputs` through parent and sub-agent task payloads.

#### Scenario: Top-level message forwards vision inputs to a sub-agent
- **WHEN** a parent task spawns a child with inherited `visionInputs`
- **THEN** the child task SHALL preserve those `visionInputs` and the executor SHALL treat them as multimodal input
