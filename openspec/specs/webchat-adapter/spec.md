# webchat-adapter Specification

## Purpose
TBD - created by archiving change add-channels. Update Purpose after archive.
## Requirements
### Requirement: Browser chat UI
The system SHALL serve a WebChat page at `/chat` as a Next.js route that provides a browser-based chat interface for interacting with the agent.

#### Scenario: User sends message via chat UI
- **WHEN** a user types a message in the WebChat input and submits it
- **THEN** the UI SHALL POST the message to `/api/input` with type `message`, channel `webchat`, a browser-generated session ID as `channelKey`, and the message text as `content`

#### Scenario: Message appears in chat history
- **WHEN** the user sends a message
- **THEN** the message SHALL appear immediately in the chat UI as a sent message before the agent responds

### Requirement: Real-time response display via WebSocket
The WebChat UI SHALL subscribe to the WS service on port 3003 to receive agent responses in real-time.

#### Scenario: Agent responds to a message
- **WHEN** the agent completes a task triggered by a WebChat message and the delivery service dispatches the response
- **THEN** the response SHALL appear in the WebChat UI in real-time via the WebSocket connection

#### Scenario: WebSocket connection lost
- **WHEN** the WebSocket connection between the browser and the WS service drops
- **THEN** the UI SHALL attempt to reconnect automatically and display a connection status indicator

### Requirement: WebChat message send via existing API
The WebChat UI SHALL use the existing `/api/input` endpoint for sending messages. No new inbound API routes SHALL be created for WebChat.

#### Scenario: Message routed through standard pipeline
- **WHEN** a WebChat message is sent to `/api/input`
- **THEN** it SHALL be processed by `InputManager.processInput()` using the same routing logic as any other channel (channel bindings → wildcard → default agent)

### Requirement: WebChat outbound adapter
The system SHALL implement a `ChannelAdapter` for WebChat that delivers responses by broadcasting them via the WS service.

#### Scenario: Delivery broadcasts to WS service
- **WHEN** `sendText()` is called on the WebChat adapter with a delivery target
- **THEN** the adapter SHALL POST the message to the WS service's `/broadcast` endpoint so that subscribed browser clients receive it

### Requirement: No authentication required for WebChat
The WebChat page SHALL NOT require authentication. It is designed for local-only access.

#### Scenario: Anonymous access
- **WHEN** a user navigates to `/chat` without any credentials
- **THEN** the page SHALL load and be fully functional

### Requirement: Chat history on page refresh
The WebChat UI SHALL load previous messages when the page is refreshed.

#### Scenario: Page refresh loads history
- **WHEN** a user refreshes the `/chat` page
- **THEN** the UI SHALL load the conversation history for the current session from the API and display previous messages

### Requirement: Independent browser sessions
Each browser tab SHALL operate as an independent chat session.

#### Scenario: Multiple browser tabs
- **WHEN** a user opens `/chat` in two separate browser tabs
- **THEN** each tab SHALL generate its own session ID and maintain an independent conversation with the agent

