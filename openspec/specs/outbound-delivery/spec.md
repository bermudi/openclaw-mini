# outbound-delivery Specification

## Purpose
TBD - created by archiving change response-delivery. Update Purpose after archive.
## Requirements
### Requirement: Durable outbound delivery via outbox pattern
The system SHALL persist every outbound response as an `OutboundDelivery` row in SQLite before attempting to send it to the target channel. The row SHALL be created in the same database transaction that marks the task as completed.

#### Scenario: Task completes and delivery is enqueued
- **WHEN** `AgentExecutor.executeTask()` completes a task of type `message` with a non-empty response
- **THEN** the system SHALL create an `OutboundDelivery` row with status `pending` in the same transaction that updates the task status to `completed`

#### Scenario: Task completes but response is empty
- **WHEN** `AgentExecutor.executeTask()` completes a task of type `message` with an empty response
- **THEN** the system SHALL NOT create an `OutboundDelivery` row

### Requirement: Delivery policy restricts auto-delivery by task type
Only tasks of type `message` SHALL automatically create outbound delivery rows. All other task types (`heartbeat`, `cron`, `hook`, `webhook`, `a2a`, `subagent`) SHALL NOT auto-create delivery rows.

#### Scenario: Message task auto-delivers
- **WHEN** a task of type `message` completes with a response
- **THEN** an `OutboundDelivery` row SHALL be created

#### Scenario: Heartbeat task does not auto-deliver
- **WHEN** a task of type `heartbeat` completes with a response
- **THEN** no `OutboundDelivery` row SHALL be created

#### Scenario: Cron task does not auto-deliver
- **WHEN** a task of type `cron` completes with a response
- **THEN** no `OutboundDelivery` row SHALL be created

### Requirement: DeliveryTarget captured at ingress
The system SHALL capture channel-specific reply information (e.g., Telegram `chatId`, Slack `channelId` + `threadTs`) when a message first arrives and store it on the task payload as a `deliveryTarget` object.

#### Scenario: Telegram message captures delivery target
- **WHEN** a message arrives from Telegram with `chat.id` = 12345
- **THEN** the task payload SHALL include a `deliveryTarget` with `channel: "telegram"`, `channelKey` matching the chat identifier, and `metadata.chatId` = "12345"

#### Scenario: API input without delivery target
- **WHEN** a message arrives via `/api/input` without channel-specific metadata
- **THEN** the task payload SHALL include a `deliveryTarget` with the provided `channel` and `channelKey`, and an empty `metadata` object

### Requirement: Generic delivery service dispatches pending deliveries
The delivery service SHALL check adapter health before attempting to dispatch a delivery. This modifies the existing "Generic delivery service dispatches pending deliveries" requirement.

#### Scenario: Adapter is connected — delivery proceeds
- **WHEN** the delivery service finds a pending delivery for a channel whose adapter reports `isConnected() === true` or does not implement `isConnected()`
- **THEN** it SHALL proceed with calling the adapter's `sendText()` as normal

#### Scenario: Adapter is disconnected — delivery deferred
- **WHEN** the delivery service finds a pending delivery for a channel whose adapter reports `isConnected() === false`
- **THEN** it SHALL NOT call `sendText()`, SHALL keep the delivery status as `pending`, and SHALL set `nextAttemptAt` to defer the delivery for a later retry cycle

#### Scenario: Adapter becomes connected after deferral
- **WHEN** a previously deferred delivery is picked up again and the adapter now reports `isConnected() === true`
- **THEN** the delivery service SHALL proceed with dispatching the message normally

### Requirement: Retry with exponential backoff
When a delivery attempt fails with a transient error, the system SHALL retry with exponential backoff. The system SHALL make a maximum of 5 attempts.

#### Scenario: Transient failure triggers retry
- **WHEN** a delivery attempt fails with a transient error (network error, rate limit)
- **THEN** the system SHALL increment the `attempts` counter, set `nextAttemptAt` using exponential backoff (attempt^3 * 2 seconds), and keep status as `pending`

#### Scenario: Max retries exceeded
- **WHEN** a delivery has failed 5 times
- **THEN** the system SHALL mark the delivery as `failed` and stop retrying

### Requirement: Delivery deduplication
Each `OutboundDelivery` row SHALL have a `dedupeKey` field. The delivery service SHALL NOT create a duplicate delivery for the same `dedupeKey`.

#### Scenario: Duplicate delivery prevented
- **WHEN** a delivery with `dedupeKey` = "task:abc123" already exists
- **THEN** the system SHALL NOT create another delivery with the same key

### Requirement: Scheduler processes deliveries
The existing scheduler service SHALL poll for pending deliveries on a 2-second interval alongside its existing task and trigger loops.

#### Scenario: Scheduler picks up pending delivery
- **WHEN** the scheduler's `processPendingDeliveries()` loop runs
- **THEN** it SHALL find all deliveries with status `pending` and `nextAttemptAt` <= now (or null), and dispatch each via the delivery service

### Requirement: Channel adapter interface
Each channel adapter SHALL implement a `ChannelAdapter` interface with at minimum a `sendText(target, text)` method that returns a promise resolving to an object with an optional `externalMessageId`.

#### Scenario: Adapter sends text successfully
- **WHEN** `sendText()` is called with a valid target and text
- **THEN** it SHALL send the message via the channel's API and return `{ externalMessageId: "<platform-message-id>" }`

#### Scenario: Adapter send fails
- **WHEN** `sendText()` is called and the channel API returns an error
- **THEN** it SHALL throw an error that the delivery service can catch and retry

