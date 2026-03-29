# telegram-polling-transport Specification

## Purpose
TBD - created by archiving change telegram-polling-transport. Update Purpose after archive.
## Requirements
### Requirement: Telegram polling transport receives inbound messages
The system SHALL support receiving Telegram updates via long polling when `TELEGRAM_TRANSPORT` is set to `polling`.

#### Scenario: Polling mode processes a text message
- **WHEN** the scheduler starts the Telegram adapter with `TELEGRAM_BOT_TOKEN` set and `TELEGRAM_TRANSPORT` = `polling`
- **THEN** the adapter SHALL begin long polling and process a polled Telegram text update through the same `InputManager.processInput()` pipeline used by webhook delivery

#### Scenario: Polling mode processes media updates through the shared ingest path
- **WHEN** a polled Telegram update contains `msg.photo`, `msg.document`, or `msg.animation`
- **THEN** the system SHALL apply the same vision-input and attachment handling used by webhook delivery before creating the message task

### Requirement: Telegram polling transport is exclusive with webhook delivery
The system SHALL ensure polling mode does not attempt to receive updates while an outgoing webhook is still configured for the same bot token.

#### Scenario: Polling startup removes webhook integration
- **WHEN** the Telegram adapter starts in polling mode
- **THEN** it SHALL remove any configured outgoing webhook before requesting updates via long polling

#### Scenario: Webhook transport does not start a poller
- **WHEN** `TELEGRAM_TRANSPORT` is unset or set to `webhook`
- **THEN** the Telegram adapter SHALL NOT start a Telegram long-polling loop

