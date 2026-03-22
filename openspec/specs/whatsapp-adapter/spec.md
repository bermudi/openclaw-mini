# whatsapp-adapter Specification

## Purpose
TBD - created by archiving change add-channels. Update Purpose after archive.
## Requirements
### Requirement: WhatsApp QR pairing flow
The system SHALL provide a QR-based pairing mechanism for connecting a WhatsApp account via Baileys. The QR code SHALL be exposed through an API route that the dashboard can consume.

#### Scenario: Fresh pairing via QR
- **WHEN** no WhatsApp auth state exists in `data/whatsapp-auth/` and the QR pairing API route is called
- **THEN** the system SHALL generate a QR code via Baileys and stream it to the caller, allowing the user to scan it with their WhatsApp mobile app to authenticate

#### Scenario: QR code expires before scanning
- **WHEN** the QR code is not scanned within the timeout period (~60 seconds)
- **THEN** the system SHALL allow the user to request a new QR code without restarting the service

#### Scenario: Pairing completes successfully
- **WHEN** the user scans the QR code and WhatsApp confirms authentication
- **THEN** the adapter SHALL persist the auth state to `data/whatsapp-auth/`, mark itself as connected, and begin listening for inbound messages

### Requirement: WhatsApp inbound message routing
The WhatsApp adapter SHALL listen for incoming messages via Baileys socket events and route them through the standard input pipeline.

#### Scenario: Receive WhatsApp text message
- **WHEN** a WhatsApp message arrives via Baileys `messages.upsert` event with sender JID `5511999998888@s.whatsapp.net` and text "hello"
- **THEN** the adapter SHALL POST to `/api/input` with type `message`, channel `whatsapp`, the sender JID as `channelKey`, the message text as `content`, and a `deliveryTarget` with `metadata.chatId` set to the sender JID

#### Scenario: Non-text message ignored
- **WHEN** a WhatsApp message arrives that is not a text message (e.g., image, sticker, location)
- **THEN** the adapter SHALL ignore the message and not create a task

#### Scenario: Status broadcast ignored
- **WHEN** a WhatsApp status broadcast message arrives (from `status@broadcast`)
- **THEN** the adapter SHALL ignore the message

### Requirement: WhatsApp outbound text delivery
The WhatsApp adapter SHALL implement `ChannelAdapter.sendText()` to send text messages via Baileys.

#### Scenario: Send text to a WhatsApp chat
- **WHEN** `sendText()` is called with a delivery target containing `metadata.chatId` = `5511999998888@s.whatsapp.net` and text "hello back"
- **THEN** the adapter SHALL call Baileys `sendMessage()` with the JID and text content, and return the resulting message key as `externalMessageId`

#### Scenario: Send fails when adapter is disconnected
- **WHEN** `sendText()` is called and the Baileys socket is not connected
- **THEN** the adapter SHALL throw an error indicating the WhatsApp connection is not active

### Requirement: WhatsApp auth state persistence
The WhatsApp adapter SHALL persist Baileys authentication state to disk so that the connection survives service restarts.

#### Scenario: Auth state survives restart
- **WHEN** the service restarts and valid auth state exists in `data/whatsapp-auth/`
- **THEN** the adapter SHALL load the persisted auth state and reconnect to WhatsApp without requiring a new QR scan

#### Scenario: Auth state corrupted or expired
- **WHEN** the persisted auth state is invalid or the WhatsApp session has been revoked
- **THEN** the adapter SHALL clear the corrupted state, mark itself as disconnected, and require a new QR pairing

### Requirement: WhatsApp reconnection on disconnect
The WhatsApp adapter SHALL automatically attempt to reconnect when the Baileys connection drops, using exponential backoff with jitter.

#### Scenario: Connection drops and auto-reconnects
- **WHEN** the Baileys connection closes unexpectedly (e.g., network error, WhatsApp server restart)
- **THEN** the adapter SHALL attempt reconnection with exponential backoff (base 2s, multiplier 2x) plus random jitter (0–1s), up to a maximum of 5 retries

#### Scenario: Max reconnection retries exceeded
- **WHEN** all 5 reconnection attempts fail
- **THEN** the adapter SHALL mark itself as disconnected, log an error, and stop retrying until the next scheduler health check or manual intervention

#### Scenario: Successful reconnection restores message flow
- **WHEN** a reconnection attempt succeeds
- **THEN** the adapter SHALL resume listening for inbound messages and be available for outbound delivery

### Requirement: WhatsApp adapter configuration
The WhatsApp adapter SHALL be configured via environment variables and SHALL only be active when enabled.

#### Scenario: WhatsApp enabled
- **WHEN** `WHATSAPP_ENABLED` environment variable is set to `"true"`
- **THEN** the WhatsApp adapter SHALL be registered with the delivery service and started by the scheduler

#### Scenario: WhatsApp not enabled
- **WHEN** `WHATSAPP_ENABLED` is not set or is not `"true"`
- **THEN** the WhatsApp adapter SHALL NOT be registered and the system SHALL log a message indicating WhatsApp is not configured

