## 1. WebSocket Service Updates

- [x] 1.1 Add `internal` room support to WebSocket service for backplane client subscriptions
- [x] 1.2 Broadcast events to `internal` room in addition to agent-specific rooms
- [x] 1.3 Add `subscribe:internal` and `unsubscribe:internal` Socket.IO event handlers

## 2. Backplane Client Implementation

- [x] 2.1 Create `src/lib/services/backplane-client.ts` with Socket.IO client
- [x] 2.2 Implement `start()` method with connection and `subscribe:internal` join
- [x] 2.3 Implement `stop()` method for clean disconnect
- [x] 2.4 Implement `isConnected()` method returning connection status
- [x] 2.5 Add event forwarding: receive from WS service, dispatch locally without rebroadcast
- [x] 2.6 Add self-origin filtering using source field to prevent duplicate delivery
- [x] 2.7 Add reconnection handling with logging
- [x] 2.8 Initialize backplane client in Next.js startup (instrumentation.ts or similar)

## 3. Event Bus Rewrite

- [x] 3.1 Update `eventBus.emit()` to broadcast via `wsClient.broadcast()` instead of EventEmitter
- [x] 3.2 Make `emit()` return `Promise<void>` (async)
- [x] 3.3 Add process-unique source identifier to emitted events
- [x] 3.4 Keep `on()` method using local EventEmitter for in-process listeners
- [x] 3.5 Update TypeScript types for async emit

## 4. Scheduler Integration

- [x] 4.1 Create authenticated `POST /api/tasks` endpoint that calls `taskQueue.createTask()` with full side effects
- [x] 4.2 Update scheduler `processDueTriggers()` to call `POST /api/tasks` instead of direct Prisma
- [x] 4.3 Add error handling for API call failures in scheduler
- [x] 4.4 Remove direct `prisma.task.create()` from scheduler

## 5.1 Emission Observability

- [x] 5.1.1 Add structured logging for event broadcast failures (event type, source, error class)
- [x] 5.1.2 Add failure counter/metric for failed WebSocket event broadcasts

## 5. Caller Updates

- [x] 5.1 Audit all `eventBus.emit()` call sites for async compatibility
- [x] 5.2 Update callers that need delivery confirmation to await emit
- [x] 5.3 Ensure fire-and-forget callers handle the Promise appropriately (void operator or catch)

## 6. Testing

- [x] 6.1 Add unit tests for backplane client connection and reconnection
- [x] 6.2 Add unit tests for self-origin filtering
- [x] 6.3 Add integration test: scheduler-created task triggers hook in Next.js
- [x] 6.4 Add integration test: event from one process reaches listener in another
- [x] 6.5 Verify WebSocket dashboard still receives events after changes

## 7. Documentation

- [x] 7.1 Update README or architecture docs with cross-process event flow diagram
- [x] 7.2 Document the async emit API change for downstream consumers
