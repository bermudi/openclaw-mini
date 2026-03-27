## MODIFIED Requirements

### Requirement: Admin API authentication

Administrative API routes SHALL require a valid bearer token in the `Authorization` header.

Protected routes include:
- `/api/agents/*` - agent CRUD operations
- `/api/tasks/*` - task queue management
- `/api/sessions/*` - session management
- `/api/skills` - skills listing
- `/api/tools` - tools listing
- `/api/workspace` - workspace operations
- `/api/audit` - audit log access
- `/api/scheduler/health` - scheduler healthcheck
- `/api/input` - unified input processing
- `/api/triggers/*` - trigger CRUD operations
- `/api/channels/bindings/*` - channel binding management

#### Scenario: Missing token rejected

- **WHEN** a request is sent to `/api/input` without an `Authorization` header
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Invalid token rejected

- **WHEN** a request is sent to `/api/triggers` with an invalid bearer token
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Trigger creation requires auth

- **WHEN** a request is sent to `/api/triggers` (POST) without a valid token
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Trigger modification requires auth

- **WHEN** a request is sent to `/api/triggers/[id]` (PUT/PATCH/DELETE) without a valid token
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Channel bindings require auth

- **WHEN** a request is sent to `/api/channels/bindings` (GET/POST) without a valid token
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Channel binding deletion requires auth

- **WHEN** a request is sent to `/api/channels/bindings/[id]` (DELETE) without a valid token
- **THEN** the API SHALL return `401 Unauthorized`

#### Scenario: Valid token accepted on input route

- **WHEN** a request is sent to `/api/input` with a valid bearer token
- **THEN** the API SHALL continue normal route handling

#### Scenario: Valid token accepted on triggers route

- **WHEN** a request is sent to `/api/triggers` with a valid bearer token
- **THEN** the API SHALL continue normal route handling