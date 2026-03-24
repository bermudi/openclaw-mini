# token-budget (Delta)

## MODIFIED Requirements

### Requirement: Priority ordering for context allocation
The prompt budget SHALL be allocated in the following priority order:

1. **System prompt** (workspace bootstrap context) — always included in full
2. **Task-specific content** (the message/event payload section) — always included in full
3. **Session context** — filled up to the remaining budget after system prompt and task content
4. **Pinned memory section** — filled from the remaining budget after session context using always-preferred memory entries
5. **Recalled memory section** — filled from any budget remaining after pinned memory using dynamically recalled memories

If pinned or recalled memories do not fully fit, the system SHALL omit lower-priority memory entries first and SHALL report the omitted count in the assembled memory section metadata.

#### Scenario: Pinned and recalled memory both fit within remaining budget
- **GIVEN** the system prompt, task content, and session context leave sufficient room for pinned memory and recalled memory
- **WHEN** the prompt is assembled
- **THEN** both memory sections SHALL be included in full without omissions

#### Scenario: Recalled memory omitted after pinned memory consumes remaining memory budget
- **GIVEN** the system prompt, task content, and session context leave enough room for pinned memory but not enough room for all recalled memories
- **WHEN** the prompt is assembled
- **THEN** the pinned memory section SHALL be included first and the recalled memory section SHALL omit lower-priority entries until the remaining budget is respected

#### Scenario: Memory sections omitted when session exhausts remaining budget
- **GIVEN** session context consumes all remaining budget after system prompt and task content
- **WHEN** the prompt is assembled
- **THEN** both pinned memory and recalled memory sections SHALL be omitted
