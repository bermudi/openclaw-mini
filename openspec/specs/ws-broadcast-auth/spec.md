# ws-broadcast-auth Specification

## Purpose
TBD - created by archiving change api-auth-hardening. Update Purpose after archive.
## Requirements
### Requirement: Broadcast ingress authentication
The WebSocket mini-service `POST /broadcast` endpoint SHALL require a valid bearer token and reject unauthenticated requests.

#### Scenario: Unauthenticated broadcast rejected
- **WHEN** a client calls `POST /broadcast` without a valid token
- **THEN** the service SHALL return `401 Unauthorized`
- **AND** no event SHALL be broadcast to Socket.IO clients

#### Scenario: Authenticated broadcast accepted
- **WHEN** a trusted process calls `POST /broadcast` with a valid token
- **THEN** the service SHALL broadcast the event to subscribed clients

