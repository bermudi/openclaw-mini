## MODIFIED Requirements

### Requirement: Internal auth for webhook processing
External-facing webhook and channel endpoints (`/api/webhooks/[source]`, `/api/channels/telegram/webhook`) SHALL be protected by `withInit()` to ensure services are initialized before processing. These endpoints SHALL continue to accept unauthenticated external requests (they are ingress points) but SHALL return 503 if the service is not yet initialized.

#### Scenario: Webhook processed after initialization
- **WHEN** an external webhook arrives and services are initialized
- **THEN** the webhook is processed normally

#### Scenario: Webhook rejected during cold start failure
- **WHEN** an external webhook arrives and initialization fails
- **THEN** the endpoint returns 503, and the external service can retry per its own retry policy