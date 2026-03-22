## ADDED Requirements

### Requirement: send_file_to_chat tool
The system SHALL register a `send_file_to_chat` tool that allows agents to send files from their sandbox to the user's chat.

#### Scenario: Send file successfully
- **WHEN** an agent calls `send_file_to_chat` with a valid `filePath` within its sandbox
- **THEN** the system SHALL enqueue a file delivery to the current session's delivery target

#### Scenario: File not found
- **WHEN** an agent calls `send_file_to_chat` with a path to a non-existent file
- **THEN** the tool SHALL return `{ success: false, error: "File not found" }`

#### Scenario: Path traversal attempt
- **WHEN** an agent calls `send_file_to_chat` with a path that escapes the sandbox
- **THEN** the tool SHALL return `{ success: false, error: "Path outside sandbox" }`

#### Scenario: Send with caption
- **WHEN** an agent calls `send_file_to_chat` with a `caption` parameter
- **THEN** the file delivery SHALL include the caption as accompanying text

### Requirement: sendFile method on ChannelAdapter
The `ChannelAdapter` interface SHALL support an optional `sendFile` method for delivering files to users.

#### Scenario: Adapter with sendFile support
- **WHEN** a file delivery is dispatched to an adapter that implements `sendFile`
- **THEN** the delivery service SHALL call `sendFile(target, filePath, opts)` and mark delivery as sent

#### Scenario: Adapter without sendFile support
- **WHEN** a file delivery is dispatched to an adapter that does not implement `sendFile`
- **THEN** the delivery service SHALL mark the delivery as failed with error "Channel does not support file delivery"
