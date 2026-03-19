# dashboard-sessions Specification

## Purpose

Session inspector for the dashboard that shows conversation history per agent, with channel source tags and message timestamps, enabling operators to see what their agents have been saying across all communication channels.

## ADDED Requirements

### Requirement: Session list per agent

The dashboard SHALL display a list of sessions for the currently selected agent. Each session entry SHALL show the channel type (e.g., Slack, Telegram), channel key, last active timestamp, and message count. Sessions SHALL be ordered by most recently active first.

#### Scenario: Select agent shows sessions

- **GIVEN** the dashboard has agents loaded
- **WHEN** the operator selects an agent and navigates to the sessions tab/panel
- **THEN** the dashboard SHALL fetch sessions from `GET /api/sessions?agentId={agentId}`
- **AND** each session SHALL display channel type, channel key, last active time, and message count

#### Scenario: Agent has no sessions

- **GIVEN** the selected agent has never had a conversation
- **WHEN** the sessions panel is displayed
- **THEN** the dashboard SHALL show an empty state message (e.g., "No sessions yet")

#### Scenario: Agent has sessions across multiple channels

- **GIVEN** the selected agent has sessions from Slack, Telegram, and webhook inputs
- **WHEN** the sessions panel is displayed
- **THEN** all sessions SHALL be listed regardless of channel type
- **AND** each session SHALL display a channel badge identifying its source

### Requirement: Session detail API endpoint

The system SHALL expose a `GET /api/sessions` endpoint that supports:
- `?agentId={id}` — returns all sessions for the given agent (wraps `sessionService.getAgentSessions`).
- `?sessionId={id}` — returns the full session context including messages (wraps `sessionService.getSession`).

#### Scenario: Fetch sessions by agent ID

- **WHEN** a GET request is made to `/api/sessions?agentId={id}`
- **THEN** the response SHALL include an array of session summaries with `id`, `channel`, `channelKey`, `lastActive`, and `messageCount`

#### Scenario: Fetch session detail

- **WHEN** a GET request is made to `/api/sessions?sessionId={id}`
- **THEN** the response SHALL include the full session context with all messages, each containing `role`, `content`, `sender`, `channel`, `channelKey`, and `timestamp`

#### Scenario: No matching sessions

- **WHEN** a GET request is made to `/api/sessions?agentId={nonexistent}`
- **THEN** the response SHALL return an empty array with `success: true`

### Requirement: Conversation thread view

When the operator selects a session, the dashboard SHALL display the conversation thread showing all messages in chronological order. Each message SHALL display the role (user/assistant/system), content, and timestamp.

#### Scenario: Click session shows conversation

- **GIVEN** the session list is displayed with sessions
- **WHEN** the operator clicks on a session
- **THEN** the dashboard SHALL fetch the full session context via `GET /api/sessions?sessionId={id}`
- **AND** messages SHALL be displayed in chronological order (oldest first)
- **AND** user messages and assistant messages SHALL be visually distinguishable

#### Scenario: Session with system messages

- **GIVEN** a session contains system, user, and assistant messages
- **WHEN** the conversation thread is displayed
- **THEN** system messages SHALL be visually distinct from user and assistant messages

### Requirement: Channel source tags

Each message in the conversation thread SHALL display a channel source tag indicating which communication channel the message originated from (e.g., "slack", "telegram", "webhook"). The tag SHALL include the channel key when available.

#### Scenario: Messages show channel origin

- **GIVEN** a session has messages from Slack channel `#general`
- **WHEN** the conversation thread is displayed
- **THEN** each message SHALL show a badge with the channel type (e.g., "slack")
- **AND** the channel key (e.g., `#general`) SHALL be displayed when present

### Requirement: Message timestamps

Each message in the conversation thread SHALL display its timestamp in a human-readable format. Timestamps SHALL be formatted relative to the current time for recent messages (e.g., "2 minutes ago") or as absolute dates for older messages.

#### Scenario: Recent message shows relative time

- **GIVEN** a message was sent 5 minutes ago
- **WHEN** the conversation thread is displayed
- **THEN** the timestamp SHALL show a relative format (e.g., "5m ago")

#### Scenario: Old message shows absolute time

- **GIVEN** a message was sent 3 days ago
- **WHEN** the conversation thread is displayed
- **THEN** the timestamp SHALL show an absolute date/time format
