## Context

OpenClaw-Mini currently supports only Telegram as a messaging channel. The adapter pattern exists — `ChannelAdapter` interface with `sendText()`, `DeliveryService` dispatching via registered adapters, and `initializeAdapters()` called at scheduler startup — but it was designed for stateless webhook-based channels. Telegram uses grammY in webhook mode: inbound updates arrive via HTTP POST to `/api/channels/telegram/webhook`, and outbound calls are simple `bot.api.sendMessage()` invocations with no persistent connection.

Adding WhatsApp via Baileys changes the game: Baileys maintains a persistent WebSocket connection to WhatsApp's servers, requires a QR pairing flow for authentication, stores ~50MB of auth state on disk, and needs reconnection logic when the connection drops. The current `ChannelAdapter` interface has no concept of lifecycle — no `start()`, no `stop()`, no health status. The scheduler calls `initializeAdapters()` at boot, which registers adapters with the delivery service, but there is no mechanism to start a long-lived connection or detect when an adapter is unhealthy.

WebChat is simpler: it can reuse the existing `/api/input` endpoint for sending messages and the WS service (`mini-services/openclaw-ws/`) on port 3003 for receiving real-time responses. No new backend infrastructure is needed — just a Next.js page with a chat component.

## Goals / Non-Goals

**Goals:**
- WhatsApp channel working end-to-end: QR pairing, inbound message → task, outbound delivery → WhatsApp
- WebChat UI working end-to-end: browser chat page, send via API, receive responses via WebSocket
- Adapter lifecycle management: `start()`, `stop()`, `isConnected()` on the `ChannelAdapter` interface
- Reconnection logic for long-lived adapters (Baileys exponential backoff)

**Non-Goals:**
- Discord adapter (stretch goal in proposal — deferred to a separate change)
- Signal, iMessage, or other channels
- Multi-account per channel (e.g., multiple WhatsApp numbers)
- Channel plugin system or dynamic adapter loading
- Media messages (images, voice notes, documents) — text only
- End-to-end encryption key management beyond what Baileys handles internally

## Decisions

### 1. WhatsApp via `@whiskeysockets/baileys`

**Decision:** Implement the WhatsApp adapter using `@whiskeysockets/baileys`, the same library the original OpenClaw project uses. Auth state is stored on disk in `data/whatsapp-auth/`. The QR pairing flow is exposed via a new API route that streams the QR code to the dashboard.

**Alternatives considered:**
- *WhatsApp Business API (Cloud API)*: Official, stable, but requires a Meta Business account, phone number verification, and costs money per conversation. Overkill for a personal assistant runtime.
- *whatsapp-web.js*: Another Baileys-like library, but less actively maintained and the original OpenClaw already uses Baileys.

**Rationale:** Baileys is the de-facto standard for unofficial WhatsApp Web clients in Node.js. It's free, works with personal WhatsApp accounts, and the original OpenClaw validates this choice. Auth state on disk keeps things simple — no database schema changes needed.

### 2. WebChat as a Next.js page reusing existing infrastructure

**Decision:** WebChat is a Next.js page at `/chat` with a React chat component. It sends messages via the existing `/api/input` endpoint (channel: `webchat`, channelKey: browser session ID) and receives responses by subscribing to the WS service on port 3003. No new backend adapter is needed for inbound — the API endpoint already handles all channel types.

**Alternatives considered:**
- *Dedicated WebSocket-based chat protocol*: More real-time, but adds complexity. The existing `/api/input` → task queue → agent → delivery → WS broadcast pipeline already works.
- *Separate chat microservice*: Violates the "mini" constraint. The whole point is reusing existing infrastructure.

**Rationale:** The WebChat adapter only needs `sendText()` for outbound — it broadcasts via the WS service so the browser can pick it up. Inbound goes through the standard API. This means zero new backend infrastructure.

### 3. Adapter lifecycle: `start()`, `stop()`, `isConnected()`

**Decision:** Extend the `ChannelAdapter` interface with three optional lifecycle methods:
```
start?(): Promise<void>;
stop?(): Promise<void>;
isConnected?(): boolean;
```

The scheduler calls `start()` on each adapter after `initializeAdapters()` at boot. The delivery service checks `isConnected()` before dispatching — if an adapter reports disconnected, the delivery is retried later rather than failing immediately. On SIGTERM/SIGINT, the scheduler calls `stop()` on all adapters for graceful shutdown.

Methods are optional so existing adapters (Telegram) continue to work without changes initially, though Telegram will be updated to implement them.

**Alternatives considered:**
- *Mandatory lifecycle methods*: Would break the existing Telegram adapter and force a migration. Optional methods are backward-compatible.
- *Separate `LifecycleAdapter` interface*: Over-engineered. A channel adapter either has lifecycle or it doesn't — optional methods express this cleanly.

**Rationale:** Optional methods on the existing interface keep things simple. TypeScript's optional method syntax (`method?(): T`) makes the contract clear without forcing every adapter to implement no-op stubs.

### 4. Inbound message routing

**Decision:** The WhatsApp adapter listens on Baileys socket events (`messages.upsert`) and POSTs to `/api/input` with channel `whatsapp`, the same pattern as the Telegram webhook. WebChat sends directly via the API from the browser. Both flows converge at `InputManager.processInput()`.

**Rationale:** Using `/api/input` as the single inbound entry point means the entire downstream pipeline (agent routing, session management, task creation) works unchanged. No new inbound infrastructure needed.

### 5. Baileys reconnection: exponential backoff with jitter

**Decision:** On disconnect, the WhatsApp adapter retries connection with exponential backoff (base 2s, multiplier 2x, max 5 retries) plus random jitter (0–1s). After max retries, the adapter marks itself as disconnected and logs an error. The scheduler's next health check can attempt a fresh reconnect.

**Rationale:** Baileys connections drop frequently (WhatsApp server restarts, network blips). Without reconnection, the adapter becomes a brick after the first disconnect. Jitter prevents thundering herd if multiple instances exist.

## Risks / Trade-offs

- **[Baileys stability]** Baileys is an unofficial WhatsApp Web client that reverse-engineers the protocol. WhatsApp protocol changes can break it without warning. → Mitigated by pinning the Baileys version and monitoring the upstream repo for breaking changes. The adapter is isolated behind the `ChannelAdapter` interface, so swapping implementations is straightforward.
- **[QR pairing UX]** The QR code expires after ~60 seconds. Users must scan it quickly. If they miss it, they need to trigger a re-scan. → Mitigated by streaming the QR to the dashboard with clear timeout messaging and a "regenerate" button.
- **[Auth state size]** Baileys auth state is ~50MB on disk. → Acceptable for a local-first system. Not suitable for serverless/ephemeral environments, but that's not our deployment target.
- **[WhatsApp rate limits]** WhatsApp may rate-limit or ban accounts that send too many messages. → The delivery service already has retry logic with backoff. For a personal assistant, message volume should be well within limits.
- **[WebChat security]** The WebChat page has no authentication — anyone with network access to the Next.js server can chat with the agent. → Acceptable for local-only deployment (the documented use case). If remote access is needed, it should go behind a reverse proxy with auth (future work).
