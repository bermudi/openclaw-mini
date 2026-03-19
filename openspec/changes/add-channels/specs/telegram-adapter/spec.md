## MODIFIED Requirements

### Requirement: Telegram adapter implements lifecycle interface
The Telegram adapter SHALL implement the `start()`, `stop()`, and `isConnected()` lifecycle methods from the extended `ChannelAdapter` interface.

#### Scenario: Telegram adapter start
- **WHEN** `start()` is called on the Telegram adapter
- **THEN** the adapter SHALL mark itself as connected and be ready to send messages (Telegram uses stateless webhook mode, so no persistent connection is needed)

#### Scenario: Telegram adapter stop
- **WHEN** `stop()` is called on the Telegram adapter
- **THEN** the adapter SHALL mark itself as disconnected and release any resources held by the grammY bot instance

#### Scenario: Telegram adapter reports connected
- **WHEN** `isConnected()` is called after a successful `start()`
- **THEN** the adapter SHALL return `true`

#### Scenario: Telegram adapter reports disconnected before start
- **WHEN** `isConnected()` is called before `start()` has been called
- **THEN** the adapter SHALL return `false`
