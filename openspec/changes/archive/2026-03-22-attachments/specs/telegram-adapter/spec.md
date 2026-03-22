## MODIFIED Requirements

### Requirement: Telegram inbound webhook receives messages
The system SHALL expose an API route at `/api/channels/telegram/webhook` that receives Telegram Bot API updates via POST and processes them as message inputs, including photos and documents.

#### Scenario: Text message received
- **WHEN** Telegram sends a webhook update containing a text message from chat 12345 with text "hello"
- **THEN** the system SHALL call `inputManager.processInput()` with type `message`, channel `telegram`, the chat identifier as `channelKey`, the message text as `content`, and a `deliveryTarget` with `metadata.chatId` = "12345"

#### Scenario: Photo message received (compressed image)
- **WHEN** Telegram sends a webhook update with `msg.photo` set (compressed JPEG, multiple sizes)
- **THEN** the system SHALL download the largest photo size via `bot.api.getFile()`, save it to the sandbox downloads directory, and include it as a `VisionInput` in the message input — with any caption text as `content`

#### Scenario: Document message received (file attachment)
- **WHEN** Telegram sends a webhook update with `msg.document` set and no `msg.animation`
- **THEN** the system SHALL download the document via `bot.api.getFile()`, save it to the sandbox downloads directory, and include it as an `Attachment` in the message input with the document's `mime_type` and `file_name`

#### Scenario: Animation message received
- **WHEN** Telegram sends a webhook update with `msg.animation` set (which co-sets `msg.document`)
- **THEN** the system SHALL treat it as an `Attachment` (not a vision input)

#### Scenario: Non-message update ignored
- **WHEN** Telegram sends a webhook update that is not a message (e.g., edited_message, callback_query)
- **THEN** the system SHALL respond with 200 OK and not create a task

#### Scenario: Invalid or missing secret token
- **WHEN** a POST request arrives at the webhook route without a valid `X-Telegram-Bot-Api-Secret-Token` header
- **THEN** the system SHALL respond with 401 Unauthorized

### Requirement: Telegram outbound adapter sends messages
The system SHALL implement a `ChannelAdapter` for Telegram that sends text messages via the Telegram Bot API `sendMessage` method using grammY.

#### Scenario: Send text to a chat
- **WHEN** `sendText()` is called with a delivery target containing `metadata.chatId` = "12345" and text "hello back"
- **THEN** the adapter SHALL call `bot.api.sendMessage("12345", "hello back")` and return the resulting `message_id` as `externalMessageId`

#### Scenario: Chat ID missing from target
- **WHEN** `sendText()` is called with a delivery target that has no `metadata.chatId`
- **THEN** the adapter SHALL throw an error indicating the chat ID is missing

## ADDED Requirements

### Requirement: Telegram outbound file sending
The Telegram adapter SHALL implement `sendFile()` to send files via the Bot API.

#### Scenario: Send file to chat
- **WHEN** `sendFile()` is called with a valid file path and delivery target
- **THEN** the adapter SHALL call `bot.api.sendDocument(chatId, new InputFile(filePath))` with the optional caption and return the `message_id` as `externalMessageId`

#### Scenario: Send file with caption
- **WHEN** `sendFile()` is called with a `caption` option
- **THEN** the adapter SHALL include the caption in the `sendDocument` call

### Requirement: Telegram file download utility
The Telegram adapter SHALL provide a function to download files from the Telegram Bot API.

#### Scenario: Download file by file_id
- **WHEN** `downloadTelegramFile(fileId, destPath)` is called
- **THEN** the system SHALL call `bot.api.getFile(fileId)` to get the file path, fetch the file via HTTPS from `https://api.telegram.org/file/bot{token}/{file_path}`, and save it to `destPath`
