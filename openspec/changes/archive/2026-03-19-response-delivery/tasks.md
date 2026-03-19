## 1. Schema & Types
 
- [x] 1.1 Add `OutboundDelivery` model to `prisma/schema.prisma` with fields: `id`, `taskId`, `channel`, `channelKey`, `targetJson`, `text`, `status` (pending/sent/failed), `attempts` (default 0), `nextAttemptAt`, `lastError`, `sentAt`, `externalMessageId`, `dedupeKey` (unique), `createdAt`, `updatedAt`; add indexes on `(status, nextAttemptAt, createdAt)` and `(taskId)`
- [x] 1.2 Add `DeliveryTarget` type to `src/lib/types.ts` with `channel`, `channelKey`, and `metadata` object (chatId, channelId, threadId, userId, replyToMessageId)
- [x] 1.3 Add `ChannelAdapter` interface to `src/lib/types.ts` with `readonly channel: ChannelType`, `sendText(target, text)` returning `Promise<{ externalMessageId?: string }>`, and optional `sendTyping(target)`
- [x] 1.4 Run `bunx prisma db push` and verify schema applies cleanly

## 2. Transaction Refactor
 
- [x] 2.1 Extract `taskQueue.completeTask()` DB update logic into a transaction-safe helper `completeTaskTx(tx, taskId, result)` that only does the Prisma update (no WS broadcast, no audit log); keep the existing `completeTask()` as a wrapper that calls the helper then does side effects after commit
- [x] 2.2 Similarly extract `taskQueue.failTask()` into `failTaskTx(tx, taskId, error)` for consistency

## 3. Delivery Service
 
- [x] 3.1 Create `src/lib/services/delivery-service.ts` with adapter registry: `registerAdapter(adapter)`, `getAdapter(channel)`, and a `Map<ChannelType, ChannelAdapter>` backing store
- [x] 3.2 Implement `enqueueDelivery(taskId, channel, channelKey, targetJson, text, dedupeKey)` that inserts an `OutboundDelivery` row with status `pending`; skip silently if `dedupeKey` already exists
- [x] 3.3 Implement `enqueueDeliveryTx(tx, ...)` — same as above but accepts a Prisma transaction client for use inside `$transaction` blocks
- [x] 3.4 Implement `processPendingDeliveries()` that queries deliveries where status = `pending` and (`nextAttemptAt` is null or <= now), ordered by `createdAt` asc, limit 10
- [x] 3.5 Implement `dispatchDelivery(delivery)` that resolves the adapter, calls `sendText()`, and on success updates status to `sent` with `sentAt` and `externalMessageId`; on failure: if error is retryable, increment `attempts` and set `nextAttemptAt` with exponential backoff (attempt^3 * 2s); if error is permanent or attempts >= 5, mark as `failed` with `lastError`

## 4. Executor Integration
 
- [x] 4.1 Update `AgentExecutor.executeTask()` to extract `deliveryTarget` from the task payload for `message` type tasks
- [x] 4.2 For `message` tasks with non-empty responses, wrap task completion + outbound delivery insert in a single `db.$transaction()` using `completeTaskTx` and `enqueueDeliveryTx`; do WS broadcast, audit log, and memory append after the transaction commits
- [x] 4.3 Use `dedupeKey` = `task:<taskId>` to prevent duplicate deliveries on retries
- [x] 4.4 Document in a code comment that delivery semantics are at-least-once (duplicate sends possible if crash occurs between channel API success and DB status update)

## 5. Telegram Adapter
 
- [x] 5.1 Add `grammy` dependency (`bun add grammy`)
- [x] 5.2 Create `src/lib/adapters/telegram-adapter.ts` implementing `ChannelAdapter` — constructor takes bot token, `sendText()` calls `bot.api.sendMessage(target.metadata.chatId ?? target.channelKey, text)` and returns `{ externalMessageId: result.message_id.toString() }`; split messages at 4096 chars (send multiple, return last message ID)
- [x] 5.3 Add `isRetryableError(error)` helper in the Telegram adapter that classifies errors: retryable = network errors, timeouts, 429 rate limit, 5xx; permanent = 400, 403 (bot blocked), 404; export the classification so the delivery service can use it
- [x] 5.4 Create `/api/channels/telegram/webhook` route that receives Telegram updates, validates `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET` env var (skip validation if env var not set), extracts message text and chat info, builds `deliveryTarget`, and calls `inputManager.processInput()`
- [x] 5.5 Create adapter initialization in `src/lib/adapters/index.ts` that checks for `TELEGRAM_BOT_TOKEN` env var and registers the Telegram adapter with the delivery service if present; export an `initializeAdapters()` function callable from both Next.js app and scheduler

## 6. Scheduler Extension
 
- [x] 6.1 Import `initializeAdapters()` and call it at scheduler startup before any polling begins
- [x] 6.2 Import and call `processPendingDeliveries()` from `delivery-service` in the scheduler's main loop; use recursive `setTimeout` (not `setInterval`) with a 2-second delay after each completion to prevent overlapping runs
- [x] 6.3 Add delivery stats tracking (`deliveriesSent`, `deliveriesFailed`) to the scheduler's status log

## 7. Environment & Configuration
 
- [x] 7.1 Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` to `.env.example` with documentation comments
- [x] 7.2 Verify `ChannelType` in `types.ts` includes `'telegram'` (it already does — confirm no changes needed)

## 8. Tests & Verification
 
- [x] 8.1 Write tests for delivery service: enqueue, deduplication, dispatch success, transient failure with retry, permanent failure skips retry, max retries exceeded, adapter not found marks failed
- [x] 8.2 Write tests for transaction refactor: `completeTaskTx` works inside a transaction, side effects (WS, audit) happen after commit not inside
- [x] 8.3 Write tests for executor integration: message task creates delivery, non-message task does not, empty response does not create delivery, dedupeKey prevents duplicates
- [x] 8.4 Write tests for Telegram adapter: sendText success, missing chatId error, long message splitting at 4096 chars, error classification (retryable vs permanent)
- [x] 8.5 Write tests for Telegram webhook route: processes text message, ignores non-message updates, rejects invalid secret token, accepts when no secret configured
- [x] 8.6 Manual verification: set up a Telegram bot, configure webhook, send a message, confirm round-trip (message in → agent processes → response delivered back to Telegram)
