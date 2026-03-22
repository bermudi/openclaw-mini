# inbound-attachments Specification

## Purpose
TBD - created by archiving change attachments. Update Purpose after archive.
## Requirements
### Requirement: Attachment type definition
The system SHALL define an `Attachment` type representing a downloaded file from a messaging platform.

#### Scenario: Attachment structure
- **WHEN** a file is received from a channel
- **THEN** the system SHALL represent it as an `Attachment` with `channelFileId` (string), `localPath` (string), `filename` (string), `mimeType` (string), and optional `size` (number)

### Requirement: MessageInput attachment fields
The `MessageInput` type SHALL support optional `attachments` and `visionInputs` arrays.

#### Scenario: Message with file attachment
- **WHEN** a user sends a document via a messaging platform
- **THEN** the `MessageInput` SHALL include the file in its `attachments` array with the local download path

#### Scenario: Message with vision input
- **WHEN** a user sends a compressed photo via Telegram
- **THEN** the `MessageInput` SHALL include the image in its `visionInputs` array

#### Scenario: Message with text only
- **WHEN** a user sends a text-only message
- **THEN** the `MessageInput` SHALL have `attachments` and `visionInputs` as undefined or empty

### Requirement: Attachment download to sandbox
The system SHALL download inbound file attachments to the agent's sandbox downloads directory.

#### Scenario: File downloaded successfully
- **WHEN** a message with a file attachment is received
- **THEN** the system SHALL download the file to `data/sandbox/{agentId}/downloads/{filename}` and set the `localPath` on the attachment

#### Scenario: Duplicate filename handling
- **WHEN** a file is downloaded and a file with the same name already exists in the downloads directory
- **THEN** the system SHALL append a numeric suffix to avoid overwriting (e.g., `report-1.pdf`)

#### Scenario: Download failure
- **WHEN** file download fails (network error, file too large)
- **THEN** the system SHALL log the error and exclude the attachment from the payload, but still process the text content of the message

### Requirement: Attachment paths in task payload
The task payload for message tasks SHALL include attachment metadata so agent tools can reference the files.

#### Scenario: Task created with attachments
- **WHEN** a message with attachments is processed by the input manager
- **THEN** the task payload SHALL include an `attachments` array with each attachment's `localPath`, `filename`, and `mimeType`

#### Scenario: Attachment paths in prompt
- **WHEN** the agent executor builds a prompt for a task with attachments
- **THEN** the prompt SHALL include a section listing the attached files with their paths and types

