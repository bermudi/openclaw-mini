## MODIFIED Requirements

### Requirement: Session detail API endpoint

The system SHALL expose runtime session endpoints for the dashboard, and the dashboard SHALL access them through the configured runtime client instead of assuming same-origin API routes.

#### Scenario: Fetch sessions by agent ID

- **WHEN** the dashboard requests sessions for an agent through the runtime client
- **THEN** the request SHALL target the configured runtime base URL for the sessions endpoint
- **AND** the response SHALL include an array of session summaries with `id`, `channel`, `channelKey`, `lastActive`, and `messageCount`

#### Scenario: Fetch session detail

- **WHEN** the dashboard requests a specific session through the runtime client
- **THEN** the response SHALL include the full session context with all messages, each containing `role`, `content`, `sender`, `channel`, `channelKey`, and `timestamp`
