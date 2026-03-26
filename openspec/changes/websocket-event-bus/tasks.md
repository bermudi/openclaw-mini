## 1. WebSocket Service Updates

- [ ] 1.1 Add `internal` room support to WebSocket service for backplane client subscriptions
- [ ] 1.2 Broadcast events to `internal` room in addition to agent-specific rooms
- [ ] 1.3 Add `subscribe:internal` and `unsubscribe:internal` Socket.IO event handlers

## 2. Backplane Client Implementation

- [ ] 2.1 Create `src/lib/services/backplane-client.ts` with Socket.IO client
- [ ] 2.2 Implement `start()` method with connection and `subscribe:internal` join
- [ ] 2.3 Implement `stop()` method for clean disconnect
- [ ] 2.4 Implement `isConnected()` method returning connection status
- [ ] 2.5 Add event forwarding: receive from WS service, dispatch locally without rebroadcast
- [ ] 2.6 Add self-origin filtering using source field to prevent duplicate delivery
- [ ] 2.7 Add reconnection handling with logging
- [ ] 2.8 Initialize backplane client in Next.js startup (instrumentation.ts or similar)

## 3. Event Bus Rewrite

- [ ] 3.1 Update `eventBus.emit()` to broadcast via `wsClient.broadcast()` instead of EventEmitter
- [ ] 3.2 Make `emit()` return `Promise<void>` (async)
- [ ] 3.3 Add process-unique source identifier to emitted events
- [ ] 3.4 Keep `on()` method using local EventEmitter for in-process listeners
- [ ] 3.5 Update TypeScript types for async emit

## 4. Scheduler Integration

- [ ] 4.1 Create authenticated `POST /api/tasks` endpoint that calls `taskQueue.createTask()` with full side effects
- [ ] 4.2 Update scheduler `processDueTriggers()` to call `POST /api/tasks` instead of direct Prisma
- [ ] 4.3 Add error handling for API call failures in scheduler
- [ ] 4.4 Remove direct `prisma.task.create()` from scheduler

## 5.1 Emission Observability

- [ ] 5.1.1 Add structured logging for event broadcast failures (event type, source, error class)
- [ ] 5.1.2 Add failure counter/metric for failed WebSocket event broadcasts

## 5. Caller Updates

- [ ] 5.1 Audit all `eventBus.emit()` call sites for async compatibility
- [ ] 5.2 Update callers that need delivery confirmation to await emit
- [ ] 5.3 Ensure fire-and-forget callers handle the Promise appropriately (void operator or catch)

## 6. Testing

- [ ] 6.1 Add unit tests for backplane client connection and reconnection
- [ ] 6.2 Add unit tests for self-origin filtering
- [ ] 6.3 Add integration test: scheduler-created task triggers hook in Next.js
- [ ] 6.4 Add integration test: event from one process reaches listener in another
- [ ] 6.5 Verify WebSocket dashboard still receives events after changes

## 7. Documentation

- [ ] 7.1 Update README or architecture docs with cross-process event flow diagram
- [ ] 7.2 Document the async emit API change for downstream consumers
