## Context

The agent runtime has a complete inbound pipeline: `InputManager` routes messages to agents via channel bindings, `TaskQueue` orders them by priority, and `AgentExecutor` runs them through the AI SDK with tools. But when execution finishes, the response is stored in the task's `result` column and nothing else happens. There is no outbound path.

The system already has patterns we should reuse:
- The **scheduler** (`mini-services/scheduler/`) polls for pending tasks and triggers on intervals — we can add delivery polling here
- The **ws-client** broadcasts events via HTTP POST to the WebSocket service — deliveries can emit events the same way
- Task payloads already carry `channel` and `channelKey` metadata from the originating message
- Sessions are unified per agent (`sessionScope: "main"`) with per-message channel metadata — delivery must read the channel info from the task payload, not the session

## Goals / Non-Goals

**Goals:**
- Durable delivery: responses survive crashes between task completion and channel send
- Generic adapter interface: adding a new channel means implementing one interface, not touching core logic
- Retry with backoff: transient failures (rate limits, network) are retried automatically
- Telegram as first working channel: inbound webhook + outbound sendMessage
- Delivery policy: only user-facing task types (`message`) auto-deliver

**Non-Goals:**
- Streaming/partial responses to channels (future work)
- Multi-bot / multi-account per channel (future work, `connectionId` field reserved)
- Message formatting (Markdown, rich embeds, media) — text-only for now
- Inbound media handling (photos, voice notes, documents)
- Editing or deleting previously sent messages
- Rate limiting or queue prioritization for outbound messages

## Decisions

### 1. Durable outbox over direct send

**Decision:** `AgentExecutor` writes an `OutboundDelivery` row in the same transaction as task completion. A separate polling loop dispatches it.

**Alternatives considered:**
- *Direct send from executor*: Simpler, but couples task completion to channel API health. If Telegram is down, the task fails even though the AI response was fine.
- *Event-driven via WebSocket service*: The WS service is for dashboard observability, not transport. Mixing concerns would complicate both.

**Rationale:** The outbox pattern is crash-safe, retryable, and decouples AI execution from delivery. It's the standard pattern for exactly this problem.

### 2. Extend the scheduler, don't add a new process

**Decision:** Add `processPendingDeliveries()` as a new polling loop in `mini-services/scheduler/index.ts`, polling every 2 seconds.

**Alternatives considered:**
- *Dedicated delivery worker process*: More isolation, but adds RAM overhead and operational complexity. Violates the "mini" constraint.
- *Next.js API route triggered by cron*: Serverless-unfriendly polling; would need external cron.

**Rationale:** The scheduler already polls tasks every 5s and triggers every 60s. Adding a delivery loop is trivial and keeps the process count at 3 (Next.js + WS + scheduler).

### 3. Channel adapter as a simple interface

**Decision:** Each channel implements:
```
interface ChannelAdapter {
  readonly channel: ChannelType;
  sendText(target: DeliveryTarget, text: string): Promise<{ externalMessageId?: string }>;
  sendTyping?(target: DeliveryTarget): Promise<void>;
}
```

**Rationale:** The delivery service handles retries, status tracking, and error logging. Adapters only know how to call their platform's API. This keeps adapters small and testable.

### 4. DeliveryTarget captured at ingress

**Decision:** When a message arrives (via `/api/channels/telegram/webhook` or `/api/input`), the inbound handler normalizes channel-specific identifiers into a `DeliveryTarget` and stores it on the task payload.

```
type DeliveryTarget = {
  channel: ChannelType;
  channelKey: string;
  metadata: {
    chatId?: string;      // Telegram
    channelId?: string;   // Slack
    threadId?: string;     // Slack thread, Telegram topic
    userId?: string;       // sender identifier
    replyToMessageId?: string;
  };
};
```

**Rationale:** Channel-specific reply info (Telegram `chat.id`, Slack `channel` + `thread_ts`) must be captured when the message arrives. By the time the executor finishes, the original webhook request is long gone.

### 5. Delivery policy by task type

**Decision:** Only `message` tasks auto-create `OutboundDelivery` rows. All other types (`heartbeat`, `cron`, `hook`, `webhook`, `a2a`, `subagent`) do not auto-deliver.

**Rationale:** Autonomous triggers (heartbeats, crons) should not spam users by default. If a cron job wants to notify the user, the agent can use a tool explicitly (future work).

### 6. Telegram adapter uses grammY in webhook mode

**Decision:** Use grammY library. Inbound: Next.js API route at `/api/channels/telegram/webhook` receives updates. Outbound: `bot.api.sendMessage()` called from the adapter.

**Alternatives considered:**
- *Raw fetch to Telegram API*: Works, but grammY handles serialization, error types, and rate limit info.
- *Long polling mode*: Requires a persistent process. Webhook mode fits the Next.js request model.

**Rationale:** grammY is the standard Telegram framework, lightweight, and the original OpenClaw uses it too. Webhook mode keeps inbound handling stateless.

## Risks / Trade-offs

- **[Delivery latency]** The scheduler polls every 2s, so worst-case delivery delay is ~2s after task completion. → Acceptable for MVP. Can add direct dispatch with outbox as fallback later.
- **[SQLite write contention]** The scheduler, Next.js app, and executor all write to SQLite. → SQLite handles this fine at low volume with WAL mode. Monitor if delivery polling causes lock contention.
- **[Telegram webhook security]** Anyone who discovers the webhook URL can send fake updates. → Validate the `X-Telegram-Bot-Api-Secret-Token` header. grammY supports this natively.
- **[Message splitting]** Telegram has a 4096-char limit per message. → Split long responses into multiple messages in the adapter. Not in MVP scope but the adapter interface supports it naturally.
- **[Retry storms]** If a channel is down for hours, retries accumulate. → Cap retries at 5 with exponential backoff (2s, 8s, 32s, 128s, 512s). Mark as `failed` after that.
