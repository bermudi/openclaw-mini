## ADDED Requirements

### Requirement: All database-accessing routes use init guard
Every API route that accesses the database, session service, memory service, audit service, task queue, or tool registry SHALL be wrapped with `withInit()` to ensure lazy initialization completes before the handler executes.

#### Scenario: Route with init guard succeeds when initialized
- **WHEN** a request hits a protected route after initialization has completed
- **THEN** the handler executes normally with full access to services

#### Scenario: Route with init guard returns 503 during initialization failure
- **WHEN** a request hits a protected route and initialization fails
- **THEN** the route returns 503 with `{ success: false, error: "Service initialization failed" }`

#### Scenario: Route with init guard is idempotent
- **WHEN** a request hits a protected route that has already been initialized by a previous request
- **THEN** `ensureInitialized()` returns immediately with the cached result and no re-initialization occurs

### Requirement: External webhook routes are init-protected
Routes that can receive requests from external services (`/api/webhooks/[source]`, `/api/channels/telegram/webhook`) SHALL be wrapped with `withInit()` to handle cold-start scenarios where no prior request has triggered initialization.

#### Scenario: Webhook arrives on cold start
- **WHEN** an external service sends a webhook to a cold-started app
- **THEN** the route initializes services before processing the webhook

#### Scenario: Webhook arrives after initialization
- **WHEN** an external service sends a webhook after the app is already initialized
- **THEN** the route processes the webhook without re-initialization delay

### Requirement: JSON parse errors return 400
Routes that parse JSON from request bodies SHALL handle `SyntaxError` from `JSON.parse()` and return a 400 Bad Request response instead of allowing an unhandled exception.

#### Scenario: Malformed JSON in request body
- **WHEN** a request body contains invalid JSON
- **THEN** the route returns 400 with `{ success: false, error: "Invalid JSON in request body" }`

#### Scenario: Valid JSON in request body
- **WHEN** a request body contains valid JSON
- **THEN** the route parses and processes the body normally

### Requirement: Trigger update validates input schema
The `PUT /api/triggers/[id]` endpoint SHALL validate the request body against a schema that accepts only known trigger fields (name, type, schedule, enabled, agentId, config). Unknown fields SHALL be rejected.

#### Scenario: Valid trigger update
- **WHEN** the request body contains only known trigger fields with valid types
- **THEN** the update proceeds normally

#### Scenario: Invalid trigger update
- **WHEN** the request body contains unknown fields or invalid types
- **THEN** the route returns 400 with a description of the validation error

### Requirement: Channel binding creation validates input
The `POST /api/channels/bindings` endpoint SHALL validate that `channel` is a valid `ChannelType`, `channelKey` is non-empty, and `agentId` is non-empty before creating a binding.

#### Scenario: Valid channel binding
- **WHEN** the request contains a valid channel type, non-empty channelKey, and non-empty agentId
- **THEN** the binding is created

#### Scenario: Invalid channel type
- **WHEN** the request contains a channel type not in the `ChannelType` union
- **THEN** the route returns 400 with a description of valid channel types