# memory-rotation (Delta)

## ADDED Requirements

### Requirement: Rotation preserves confidence metadata
When memory history is rotated to an archive file, the active history memory's confidence and `lastReinforcedAt` fields SHALL be preserved (not reset). Rotation changes the value content but does not alter the memory's quality signals.

#### Scenario: Confidence preserved after rotation
- **GIVEN** the `system/history` memory has confidence 0.8 and `lastReinforcedAt` set to 3 days ago
- **WHEN** rotation triggers and resets the history value
- **THEN** the confidence SHALL remain 0.8 and `lastReinforcedAt` SHALL remain unchanged
