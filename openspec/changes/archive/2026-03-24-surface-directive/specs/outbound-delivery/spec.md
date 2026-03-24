## MODIFIED Requirements

### Requirement: Durable outbound delivery via outbox pattern
The system SHALL persist every outbound response as an `OutboundDelivery` row in SQLite before attempting to send it to the target channel. The row SHALL be created in the same database transaction that marks the task as completed. Surface directive deliveries SHALL also be persisted as `OutboundDelivery` rows.

#### Scenario: Task completes and delivery is enqueued
- **WHEN** `AgentExecutor.executeTask()` completes a task of type `message` with a non-empty response
- **THEN** the system SHALL create an `OutboundDelivery` row with status `pending` in the same transaction that updates the task status to `completed`

#### Scenario: Task completes with surface directives
- **WHEN** `AgentExecutor.executeTask()` completes a task that produced surface directives
- **THEN** the system SHALL create `OutboundDelivery` rows for each surface directive, ordered before the LLM response delivery

#### Scenario: Task completes but response is empty
- **WHEN** `AgentExecutor.executeTask()` completes a task of type `message` with an empty response
- **THEN** the system SHALL NOT create an `OutboundDelivery` row for the response (surface directive deliveries, if any, are still created)
