# telegram-adapter Specification

## Purpose
TBD - created by archiving change response-delivery. Update Purpose after archive.
## Requirements
### Requirement: Telegram inbound webhook receives messages
The system SHALL expose an API route at `/api/channels/telegram/webhook` that receives Telegram Bot API updates via POST and processes them as message inputs.

#### Scenario: Text message received
- **WHEN** Telegram sends a webhook update containing a text message from chat 12345 with text "hello"
- **THEN** the system SHALL call `inputManager.processInput()` with type `message`, channel `telegram`, the chat identifier as `channelKey`, the message text as `content`, and a `deliveryTarget` with `metadata.chatId` = "12345"

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

### Requirement: Telegram adapter configuration
The Telegram adapter SHALL be configured via environment variables and SHALL only be active when configured.

#### Scenario: Bot token configured
- **WHEN** `TELEGRAM_BOT_TOKEN` environment variable is set
- **THEN** the Telegram adapter SHALL register itself with the delivery service

#### Scenario: Bot token not configured
- **WHEN** `TELEGRAM_BOT_TOKEN` environment variable is not set
- **THEN** the Telegram adapter SHALL NOT be registered and the system SHALL log a message indicating Telegram is not configured

### Requirement: Webhook secret validation
The Telegram webhook route SHALL validate inbound requests using a secret token to prevent spoofed updates.

#### Scenario: Secret token matches
- **WHEN** `TELEGRAM_WEBHOOK_SECRET` is set and the request includes a matching `X-Telegram-Bot-Api-Secret-Token` header
- **THEN** the request SHALL be processed normally

#### Scenario: Secret token not configured
- **WHEN** `TELEGRAM_WEBHOOK_SECRET` is not set
- **THEN** the webhook route SHALL process requests without secret validation (development mode)

