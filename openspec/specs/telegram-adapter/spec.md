# telegram-adapter Specification

## Purpose
TBD - created by archiving change response-delivery. Update Purpose after archive.
## Requirements
### Requirement: Telegram inbound webhook receives messages
The system SHALL expose an API route at `/api/channels/telegram/webhook` that receives Telegram Bot API updates via POST and processes them as message inputs, including photos and documents, when Telegram transport is configured for webhook delivery.

#### Scenario: Text message received
- **WHEN** Telegram transport is unset or set to `webhook` and Telegram sends a webhook update containing a text message from chat 12345 with text "hello"
- **THEN** the system SHALL call `inputManager.processInput()` with type `message`, channel `telegram`, the chat identifier as `channelKey`, the message text as `content`, and a `deliveryTarget` with `metadata.chatId` = "12345"

#### Scenario: Photo message received (compressed image)
- **WHEN** Telegram transport is unset or set to `webhook` and Telegram sends a webhook update with `msg.photo` set (compressed JPEG, multiple sizes)
- **THEN** the system SHALL download the largest photo size via `bot.api.getFile()`, save it to the sandbox downloads directory, and include it as a `VisionInput` in the message input — with any caption text as `content`

#### Scenario: Document message received (file attachment)
- **WHEN** Telegram transport is unset or set to `webhook` and Telegram sends a webhook update with `msg.document` set and no `msg.animation`
- **THEN** the system SHALL download the document via `bot.api.getFile()`, save it to the sandbox downloads directory, and include it as an `Attachment` in the message input with the document's `mime_type` and `file_name`

#### Scenario: Animation message received
- **WHEN** Telegram transport is unset or set to `webhook` and Telegram sends a webhook update with `msg.animation` set (which co-sets `msg.document`)
- **THEN** the system SHALL treat it as an `Attachment` (not a vision input)

#### Scenario: Non-message update ignored
- **WHEN** Telegram transport is unset or set to `webhook` and Telegram sends a webhook update that is not a message (e.g., edited_message, callback_query)
- **THEN** the system SHALL respond with 200 OK and not create a task

#### Scenario: Invalid or missing secret token
- **WHEN** Telegram transport is unset or set to `webhook` and a POST request arrives at the webhook route without a valid `X-Telegram-Bot-Api-Secret-Token` header
- **THEN** the system SHALL respond with 401 Unauthorized

### Requirement: Telegram outbound adapter sends messages
The system SHALL implement a `ChannelAdapter` for Telegram that sends text messages via the Telegram Bot API `sendMessage` method using grammY.

#### Scenario: Send text to a chat
- **WHEN** `sendText()` is called with a delivery target containing `metadata.chatId` = "12345" and text "hello back"
- **THEN** the adapter SHALL call `bot.api.sendMessage("12345", "hello back")` and return the resulting `message_id` as `externalMessageId`

#### Scenario: Chat ID missing from target
- **WHEN** `sendText()` is called with a delivery target that has no `metadata.chatId`
- **THEN** the adapter SHALL throw an error indicating the chat ID is missing

### Requirement: Telegram adapter configuration
The Telegram adapter SHALL be configured via environment variables and SHALL only be active when configured. Telegram inbound transport SHALL be selected via `TELEGRAM_TRANSPORT`, defaulting to `webhook` when unset.

#### Scenario: Bot token configured with default transport
- **WHEN** `TELEGRAM_BOT_TOKEN` is set and `TELEGRAM_TRANSPORT` is unset
- **THEN** the Telegram adapter SHALL register itself with the delivery service and use webhook transport semantics for inbound delivery

#### Scenario: Polling transport configured
- **WHEN** `TELEGRAM_BOT_TOKEN` is set and `TELEGRAM_TRANSPORT` = `polling`
- **THEN** the Telegram adapter SHALL register itself with the delivery service and start in polling transport mode when the scheduler starts adapters

#### Scenario: Bot token not configured
- **WHEN** `TELEGRAM_BOT_TOKEN` environment variable is not set
- **THEN** the Telegram adapter SHALL NOT be registered and the system SHALL log a message indicating Telegram is not configured

### Requirement: Webhook secret validation
The Telegram webhook route SHALL validate inbound requests using a secret token to prevent spoofed updates when Telegram transport is configured for webhook delivery.

#### Scenario: Secret token matches
- **WHEN** `TELEGRAM_WEBHOOK_SECRET` is set, Telegram transport is unset or set to `webhook`, and the request includes a matching `X-Telegram-Bot-Api-Secret-Token` header
- **THEN** the request SHALL be processed normally

#### Scenario: Secret token not configured
- **WHEN** `TELEGRAM_WEBHOOK_SECRET` is not set and Telegram transport is unset or set to `webhook`
- **THEN** the webhook route SHALL process requests without secret validation (development mode)

### Requirement: Telegram adapter implements lifecycle interface
The Telegram adapter SHALL implement the `start()`, `stop()`, and `isConnected()` lifecycle methods from the extended `ChannelAdapter` interface, using webhook semantics in webhook mode and long-polling semantics in polling mode.

#### Scenario: Telegram adapter start in webhook mode
- **WHEN** `start()` is called on the Telegram adapter while `TELEGRAM_TRANSPORT` is unset or set to `webhook`
- **THEN** the adapter SHALL mark itself as connected and be ready to send messages without starting a Telegram long-polling loop

#### Scenario: Telegram adapter start in polling mode
- **WHEN** `start()` is called on the Telegram adapter while `TELEGRAM_TRANSPORT` = `polling`
- **THEN** the adapter SHALL start Telegram long polling and mark itself as connected once polling is active

#### Scenario: Telegram adapter stop in polling mode
- **WHEN** `stop()` is called on the Telegram adapter after polling mode has started
- **THEN** the adapter SHALL stop Telegram long polling and mark itself as disconnected

#### Scenario: Telegram adapter reports connected
- **WHEN** `isConnected()` is called after a successful `start()`
- **THEN** the adapter SHALL return `true`

#### Scenario: Telegram adapter reports disconnected before start
- **WHEN** `isConnected()` is called before `start()` has been called
- **THEN** the adapter SHALL return `false`

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

