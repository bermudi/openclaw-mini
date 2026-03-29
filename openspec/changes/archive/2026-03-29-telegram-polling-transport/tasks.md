## 1. Shared Telegram Ingest Path

- [x] 1.1 Extract the Telegram update parsing, delivery-target construction, media download, and `InputManager.processInput()` call from the webhook route into a shared ingestion module.
- [x] 1.2 Refactor `/api/channels/telegram/webhook` to keep secret validation in the route and delegate all update normalization to the shared ingestion module.
- [x] 1.3 Add a small transport-selection helper for Telegram that resolves `TELEGRAM_TRANSPORT` with `webhook` as the default.

## 2. Telegram Polling Lifecycle

- [x] 2.1 Update `TelegramAdapter` to register grammY polling handlers that forward raw updates into the shared ingestion module.
- [x] 2.2 Implement polling-mode startup in `TelegramAdapter.start()`, including removing any existing webhook before long polling begins.
- [x] 2.3 Implement clean polling shutdown and accurate `isConnected()` behavior for both webhook and polling modes.

## 3. Tests And Documentation

- [x] 3.1 Add regression coverage proving webhook and polling use the same normalized Telegram ingest behavior for text and media updates.
- [x] 3.2 Add adapter lifecycle tests for default webhook mode, explicit polling mode, webhook removal on polling startup, and polling shutdown behavior.
- [x] 3.3 Update setup and environment documentation to describe `TELEGRAM_TRANSPORT`, its default value, and the single-instance constraint for polling mode.

## 4. Verification

- [x] 4.1 Run the relevant Telegram/channel adapter and attachment test suites and fix any regressions.
- [x] 4.2 Manually validate the OpenSpec change status is apply-ready after the implementation checklist is complete.
