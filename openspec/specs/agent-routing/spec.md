# agent-routing Specification

## Purpose
TBD - created by archiving change agent-architecture. Update Purpose after archive.
## Requirements
### Requirement: Default agent designation
The system SHALL support marking exactly one Agent as the default. The `Agent` model SHALL have an `isDefault` boolean field (default `false`). When a new agent is set as default, any previously default agent SHALL be unset.

#### Scenario: First agent created is set as default
- **WHEN** an agent is created and no other agent has `isDefault: true`
- **THEN** the new agent SHALL be automatically set as the default agent

#### Scenario: Changing the default agent
- **WHEN** agent B is set as default and agent A was previously default
- **THEN** agent A's `isDefault` SHALL be set to `false` and agent B's `isDefault` SHALL be set to `true`

#### Scenario: Default agent cannot be unset without replacement
- **WHEN** the only agent with `isDefault: true` attempts to have `isDefault` set to `false` without another agent being set as default
- **THEN** the operation SHALL be rejected with an error

### Requirement: Channel binding model
The system SHALL store channel bindings in a `ChannelBinding` database model with fields: `channel` (string), `channelKey` (string, `"*"` for wildcard), and `agentId` (foreign key to Agent). The combination `(channel, channelKey)` SHALL be unique.

#### Scenario: Create an exact channel binding
- **WHEN** a binding is created with `channel: "discord"`, `channelKey: "server-123"`, `agentId: "agent_discord"`
- **THEN** all messages from Discord server-123 SHALL route to agent_discord

#### Scenario: Create a wildcard channel binding
- **WHEN** a binding is created with `channel: "discord"`, `channelKey: "*"`, `agentId: "agent_discord"`
- **THEN** all Discord messages without a more specific binding SHALL route to agent_discord

#### Scenario: Duplicate binding rejected
- **WHEN** a binding is created with `channel: "discord"`, `channelKey: "*"` and one already exists
- **THEN** the operation SHALL fail with a unique constraint error

### Requirement: Input routing resolution
The InputManager SHALL resolve an `agentId` for every incoming input using a three-step resolution order. The caller SHALL NOT be required to provide an `agentId` for message inputs.

#### Scenario: Exact match resolution
- **WHEN** a message arrives with `channel: "telegram"`, `channelKey: "chat-456"` and a binding exists for exactly `("telegram", "chat-456")`
- **THEN** the message SHALL route to the agent specified in that binding

#### Scenario: Channel wildcard resolution
- **WHEN** a message arrives with `channel: "discord"`, `channelKey: "server-789"` and no exact binding exists but a binding for `("discord", "*")` exists
- **THEN** the message SHALL route to the agent specified in the wildcard binding

#### Scenario: Default agent fallback
- **WHEN** a message arrives and no exact or wildcard binding matches
- **THEN** the message SHALL route to the agent marked `isDefault: true`

#### Scenario: No default agent configured
- **WHEN** a message arrives, no bindings match, and no agent has `isDefault: true`
- **THEN** the InputManager SHALL return `{ success: false, error: "No default agent configured" }`

#### Scenario: Explicit agentId still honored
- **WHEN** a caller provides an explicit `targetAgentId` to `processInput()`
- **THEN** the explicit ID SHALL take precedence over routing resolution

### Requirement: Unified sessions per agent
Sessions SHALL be keyed by `(agentId, sessionScope)` instead of `(channel, channelKey)`. Multiple channels routing to the same agent SHALL share the same session when `sessionScope` is `"main"`.

#### Scenario: Two channels share a session
- **WHEN** a Telegram message and a WhatsApp message both route to the default agent
- **THEN** both messages SHALL be appended to the same session (scope `"main"`) and the agent SHALL have context from both when responding

#### Scenario: Message carries channel metadata
- **WHEN** a message is appended to a shared session
- **THEN** the session context entry SHALL include the source `channel` and `channelKey` so the system knows where to send the reply

#### Scenario: Different agents get different sessions
- **WHEN** a Discord message routes to agent_discord and a Telegram message routes to agent_main
- **THEN** each agent SHALL have its own independent session

### Requirement: Session context storage as append-only message rows
The `Session.context` JSON blob pattern SHALL be replaced with a `SessionMessage` table. Each call to `appendToContext` SHALL insert a single row into `SessionMessage` with fields: `id`, `sessionId`, `role`, `content`, `sender`, `channel`, `channelKey`, and `createdAt`. The `Session.context` column SHALL be retained during migration but SHALL NOT be written to after migration completes.

#### Scenario: Appending a message inserts a row
- **WHEN** `appendToContext` is called with a user message
- **THEN** a single `INSERT` SHALL be executed against the `SessionMessage` table with the message fields and current timestamp
- **AND** no `SELECT` or `UPDATE` on `Session.context` SHALL occur

#### Scenario: Concurrent messages do not race
- **WHEN** two messages arrive simultaneously for the same session
- **THEN** both SHALL be inserted as separate `SessionMessage` rows without data loss, because each is an independent `INSERT`

#### Scenario: Reading session context queries message rows
- **WHEN** `getSessionContext` is called for a session
- **THEN** the system SHALL query `SessionMessage` rows for that session ordered by `createdAt` ascending, instead of deserializing `Session.context`

### Requirement: Migration of existing session context
Existing sessions with JSON blob context SHALL be migrated to `SessionMessage` rows. The migration SHALL parse each `Session.context` JSON value and insert individual `SessionMessage` rows for each message in the array. Sessions with malformed JSON SHALL be treated as empty (no rows inserted) with a warning logged.

#### Scenario: Valid JSON session is migrated
- **GIVEN** a session has `context` containing a JSON array with 15 messages
- **WHEN** the migration runs
- **THEN** 15 `SessionMessage` rows SHALL be created for that session with the original timestamps preserved

#### Scenario: Malformed JSON session is handled gracefully
- **GIVEN** a session has `context` containing invalid JSON
- **WHEN** the migration runs
- **THEN** no `SessionMessage` rows SHALL be created for that session, a warning SHALL be logged, and the migration SHALL continue with remaining sessions

### Requirement: Session message count uses row count
The `getAgentSessions` method's `messageCount` field SHALL be computed from a `COUNT` query on `SessionMessage` rows for each session, instead of parsing the JSON blob and measuring array length.

#### Scenario: Message count reflects row count
- **GIVEN** a session has 22 `SessionMessage` rows
- **WHEN** `getAgentSessions` is called
- **THEN** the `messageCount` for that session SHALL be 22

### Requirement: Channel binding CRUD API
The system SHALL expose API endpoints for managing channel bindings: list all bindings, create a binding, and delete a binding.

#### Scenario: List bindings
- **WHEN** a GET request is made to `/api/channels/bindings`
- **THEN** the response SHALL include all channel bindings with their channel, channelKey, and resolved agent name

#### Scenario: Create binding
- **WHEN** a POST request is made to `/api/channels/bindings` with `{ channel, channelKey, agentId }`
- **THEN** a new ChannelBinding record SHALL be created

#### Scenario: Delete binding
- **WHEN** a DELETE request is made to `/api/channels/bindings/:id`
- **THEN** the binding SHALL be removed and future messages for that channel/key SHALL fall through to the next resolution step

