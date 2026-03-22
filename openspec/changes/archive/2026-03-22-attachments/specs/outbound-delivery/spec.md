## MODIFIED Requirements

### Requirement: Channel adapter interface
Each channel adapter SHALL implement a `ChannelAdapter` interface with at minimum a `sendText(target, text)` method that returns a promise resolving to an object with an optional `externalMessageId`. The interface SHALL also support an optional `sendFile` method.

#### Scenario: Adapter sends text successfully
- **WHEN** `sendText()` is called with a valid target and text
- **THEN** it SHALL send the message via the channel's API and return `{ externalMessageId: "<platform-message-id>" }`

#### Scenario: Adapter send fails
- **WHEN** `sendText()` is called and the channel API returns an error
- **THEN** it SHALL throw an error that the delivery service can catch and retry

#### Scenario: Adapter sends file successfully
- **WHEN** `sendFile()` is called with a valid target and file path
- **THEN** it SHALL send the file via the channel's API and return `{ externalMessageId: "<platform-message-id>" }`

#### Scenario: Adapter does not support files
- **WHEN** a file delivery is dispatched to an adapter without `sendFile` implemented
- **THEN** the delivery service SHALL mark the delivery as failed

### Requirement: Generic delivery service dispatches pending deliveries
A `DeliveryService` SHALL poll for pending `OutboundDelivery` rows, resolve the correct `ChannelAdapter` by channel type, and call `sendText()` or `sendFile()` to dispatch the message based on delivery type.

#### Scenario: Successful text delivery
- **WHEN** the delivery service finds a pending delivery with `deliveryType` = `text` for channel `telegram`
- **THEN** it SHALL call the Telegram adapter's `sendText()`, update the delivery status to `sent`, and record `sentAt` timestamp

#### Scenario: Successful file delivery
- **WHEN** the delivery service finds a pending delivery with `deliveryType` = `file` for channel `telegram`
- **THEN** it SHALL call the Telegram adapter's `sendFile()` with the stored `filePath`, update the delivery status to `sent`, and record `sentAt` timestamp

#### Scenario: Adapter not found for channel
- **WHEN** the delivery service finds a pending delivery for an unregistered channel
- **THEN** it SHALL mark the delivery as `failed` with error "No adapter registered for channel: <channel>"

## ADDED Requirements

### Requirement: OutboundDelivery supports file delivery type
The `OutboundDelivery` table SHALL support both text and file delivery types.

#### Scenario: Text delivery record
- **WHEN** a text delivery is enqueued
- **THEN** the `OutboundDelivery` row SHALL have `deliveryType` = `text` and `text` containing the message

#### Scenario: File delivery record
- **WHEN** a file delivery is enqueued
- **THEN** the `OutboundDelivery` row SHALL have `deliveryType` = `file`, `filePath` containing the file path, and optionally `text` containing a caption
