## MODIFIED Requirements

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
