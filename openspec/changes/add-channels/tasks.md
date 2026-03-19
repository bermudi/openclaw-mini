## 1. Adapter Lifecycle Interface

- [ ] 1.1 Extend `ChannelAdapter` in `src/lib/types.ts` with three optional lifecycle methods: `start?(): Promise<void>`, `stop?(): Promise<void>`, `isConnected?(): boolean`
- [ ] 1.2 Add `'webchat'` to the `ChannelType` union in `src/lib/types.ts`
- [ ] 1.3 Update `dispatchDelivery()` in `src/lib/services/delivery-service.ts` to check `adapter.isConnected?.()` before calling `sendText()` — if the adapter reports `false`, keep status `pending`, set `nextAttemptAt` for retry, and return `'retried'`; if `isConnected` is not implemented or returns `true`, proceed normally

## 2. Telegram Adapter Migration

- [ ] 2.1 Add a private `connected: boolean` field (default `false`) to `TelegramAdapter` in `src/lib/adapters/telegram-adapter.ts`
- [ ] 2.2 Implement `start()`: mark `connected = true` (Telegram is stateless webhook mode — no persistent connection needed)
- [ ] 2.3 Implement `stop()`: mark `connected = false` and release any resources held by the grammY `Bot` instance
- [ ] 2.4 Implement `isConnected()`: return the `connected` field
- [ ] 2.5 Verify existing Telegram adapter tests still pass with the new lifecycle methods

## 3. WhatsApp Adapter

- [ ] 3.1 Install `@whiskeysockets/baileys` dependency (`bun add @whiskeysockets/baileys`)
- [ ] 3.2 Add `WHATSAPP_ENABLED` to `.env.example` with a documentation comment
- [ ] 3.3 Create `src/lib/adapters/whatsapp-adapter.ts` implementing `ChannelAdapter` with lifecycle methods; constructor takes no args, reads auth state from `data/whatsapp-auth/` using Baileys `useMultiFileAuthState`
- [ ] 3.4 Implement `start()`: create Baileys socket with persisted auth state, register `connection.update` listener to track connection status and emit QR codes, register `creds.update` listener to persist auth; if auth state exists, reconnect automatically without QR
- [ ] 3.5 Implement inbound message handling: listen on `messages.upsert` event, ignore non-text messages and `status@broadcast`, POST to `/api/input` with type `message`, channel `whatsapp`, sender JID as `channelKey`, message text as `content`, and `deliveryTarget` with `metadata.chatId` set to sender JID
- [ ] 3.6 Implement `sendText()`: call Baileys `sendMessage(chatId, { text })` using `metadata.chatId` from the delivery target; throw if socket is not connected; return `{ externalMessageId }` from the message key
- [ ] 3.7 Implement `stop()`: close the Baileys socket cleanly and mark as disconnected
- [ ] 3.8 Implement `isConnected()`: return connection status based on Baileys socket state
- [ ] 3.9 Implement reconnection logic: on unexpected disconnect, retry with exponential backoff (base 2s, multiplier 2x, max 5 retries) plus random jitter (0–1s); after max retries, mark as disconnected and log error
- [ ] 3.10 Handle corrupted or expired auth state: catch auth failures, clear `data/whatsapp-auth/`, mark as disconnected, and require new QR pairing
- [ ] 3.11 Create `/api/channels/whatsapp/qr` API route that triggers a fresh Baileys connection if not connected, streams the QR code to the caller, and returns success status once pairing completes
- [ ] 3.12 Register the WhatsApp adapter in `src/lib/adapters/index.ts`: check `WHATSAPP_ENABLED === "true"`, instantiate `WhatsAppAdapter`, and register with the delivery service; log a skip message if not enabled

## 4. WebChat Frontend

- [ ] 4.1 Create `src/app/chat/page.tsx` — a Next.js page with a chat UI: message input field, submit button, scrollable message list showing sent messages and agent responses
- [ ] 4.2 Implement message sending: on submit, POST to `/api/input` with type `message`, channel `webchat`, a browser-generated session ID (stored in `sessionStorage`) as `channelKey`, and the message text as `content`; show the sent message immediately in the chat list
- [ ] 4.3 Implement real-time response display: subscribe to the WS service on port 3003 via WebSocket, filter for responses matching the current session, and append agent responses to the chat list
- [ ] 4.4 Handle WebSocket disconnection: auto-reconnect with backoff, show a connection status indicator in the UI
- [ ] 4.5 Implement chat history on page refresh: load previous messages for the current session from the API on mount and display them before new messages
- [ ] 4.6 Create WebChat outbound adapter in `src/lib/adapters/webchat-adapter.ts` implementing `ChannelAdapter`: `sendText()` POSTs the message to the WS service's `/broadcast` endpoint; `channel` is `'webchat'`; no lifecycle methods needed (stateless)
- [ ] 4.7 Register the WebChat adapter in `src/lib/adapters/index.ts`: always register (no env var gating — WebChat is always available)

## 5. Adapter Initialization & Shutdown

- [ ] 5.1 Update `initializeAdapters()` in `src/lib/adapters/index.ts` to return the list of registered adapters (or store them module-level) so the scheduler can call lifecycle methods on them
- [ ] 5.2 After `initializeAdapters()` in the scheduler startup, iterate over all registered adapters and call `start()` on each adapter that implements it; catch and log errors from individual adapters without crashing the scheduler
- [ ] 5.3 Register SIGTERM/SIGINT handlers in the scheduler that call `stop()` on all adapters that implement it, with a 5-second timeout per adapter; log warnings for adapters that don't shut down in time
- [ ] 5.4 Add periodic adapter health check to the scheduler: for adapters reporting `isConnected() === false` that were previously connected, attempt `start()` again to re-establish the connection; log recovery attempts and outcomes

## 6. Testing

- [ ] 6.1 Write adapter lifecycle tests: verify `ChannelAdapter` without lifecycle methods is treated as always connected; verify adapters with `isConnected() === false` cause deliveries to be deferred; verify adapters with `isConnected() === true` proceed normally
- [ ] 6.2 Write Telegram adapter lifecycle tests: `start()` sets connected, `stop()` sets disconnected, `isConnected()` returns correct state, `sendText()` still works after start
- [ ] 6.3 Write WhatsApp adapter unit tests: mock Baileys socket; test `start()` with existing auth (no QR), `start()` without auth (QR flow), `sendText()` success, `sendText()` when disconnected throws, inbound message routing POSTs to `/api/input`, non-text messages ignored, `status@broadcast` ignored, reconnection backoff logic, corrupted auth state handling
- [ ] 6.4 Write WebChat adapter unit test: `sendText()` POSTs to WS service `/broadcast` endpoint with correct payload
- [ ] 6.5 Write WebChat integration test: render `/chat` page, send a message, verify it appears in the chat list, mock WS response and verify it renders
- [ ] 6.6 Write adapter initialization tests: verify all adapters registered, `start()` called on each, single adapter failure doesn't crash others, graceful shutdown calls `stop()` on all
