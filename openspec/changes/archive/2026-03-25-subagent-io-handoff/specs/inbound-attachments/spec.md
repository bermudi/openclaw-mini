## MODIFIED Requirements

### Requirement: Attachment paths in task payload
The task payload for message tasks SHALL include attachment metadata so agent tools and sub-agents can reference downloaded files.

#### Scenario: Task created with attachments
- **WHEN** a message with attachments is processed by the input manager
- **THEN** the created task payload SHALL include an `attachments` array with each attachment's `localPath`, `filename`, and `mimeType`

#### Scenario: Task created with vision inputs
- **WHEN** a message with vision inputs is processed by the input manager
- **THEN** the created task payload SHALL include a `visionInputs` array with each vision input's `localPath` and `mimeType`
