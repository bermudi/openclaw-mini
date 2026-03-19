## Why

The agent runtime can receive inputs, route them to agents, queue tasks, and execute them with AI — but responses vanish into the task result column. There is no mechanism to deliver an agent's response back through the originating channel (Telegram, Slack, WhatsApp, etc). Without outbound delivery, the system is a processing engine with no output. This is the critical gap blocking any real-world usage.

## What Changes

- Add an `OutboundDelivery` model (durable outbox) in Prisma to persist pending responses as rows in SQLite before dispatching them to channels
- Capture a `DeliveryTarget` snapshot on each message entry in the session context so the system knows exactly where to send the reply (chatId, threadId, etc.)
- Introduce a `ChannelAdapter` interface with `sendText(target, text)` that each channel implements
- Build a generic `DeliveryService` that processes pending deliveries, routes to the correct adapter, handles retries with backoff, and tracks status
- Extend the existing scheduler with a `processPendingDeliveries()` loop — no new process needed
- Update `AgentExecutor.executeTask()` to transactionally insert an `OutboundDelivery` row when completing user-facing tasks
- Add a delivery policy: only `message` task types auto-deliver; `cron`, `heartbeat`, `hook`, `a2a`, and `subagent` results do not auto-notify unless explicitly configured
- Implement Telegram as the first channel adapter (inbound webhook route + outbound via Bot API `sendMessage`)

## Capabilities

### New Capabilities
- `outbound-delivery`: Durable outbox pattern for response delivery — schema, delivery service, adapter interface, retry logic, status tracking, and delivery policy by task type
- `telegram-adapter`: First channel adapter — inbound webhook receiver and outbound message sender via Telegram Bot API

### Modified Capabilities

## Impact

- **Schema**: New `OutboundDelivery` model in `prisma/schema.prisma`
- **Agent Executor**: `executeTask()` gains a transactional outbox write on task completion
- **Scheduler**: New `processPendingDeliveries()` polling loop added alongside existing loops
- **Types**: New `DeliveryTarget` and `ChannelAdapter` types in `src/lib/types.ts`
- **Dependencies**: `grammy` added for Telegram Bot API
- **API Routes**: New `/api/channels/telegram/webhook` route for inbound messages
- **Session model**: Unchanged — unified sessions per agent remain as designed; per-message `channel`/`channelKey` metadata (already stored) is used to route replies
