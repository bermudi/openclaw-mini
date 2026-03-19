## Why

OpenClaw-Mini currently only delivers responses via Telegram. The entire value proposition is "use the chat app already in your pocket" — but right now you can only talk to it via curl or the Telegram bot. Adding WhatsApp (the most popular channel in the original OpenClaw) and a built-in WebChat UI would make the system immediately usable for daily interaction, and the WebChat doubles as a zero-setup demo and debugging surface.

## What Changes

- **WhatsApp adapter**: Implement `ChannelAdapter` using Baileys for WhatsApp Web, including QR pairing flow, message send/receive, and session persistence
- **WebChat adapter**: A simple browser-based chat UI served by the Next.js app that sends messages through the existing `/api/input` endpoint and receives responses — no external dependencies needed
- **Webhook ingestion per channel**: Each channel adapter registers its own webhook/polling route for receiving inbound messages (WhatsApp via Baileys event listener, WebChat via the existing WS service)
- **Adapter lifecycle management**: Start/stop/reconnect lifecycle for long-lived adapters (Baileys maintains a persistent connection), integrated with the scheduler service
- **Discord adapter** (stretch): Implement `ChannelAdapter` using discord.js for Discord bot support

## Capabilities

### New Capabilities
- `whatsapp-adapter`: WhatsApp channel adapter using Baileys with QR pairing, inbound message routing, and outbound delivery
- `webchat-adapter`: Built-in browser chat UI that connects to the agent runtime via the existing API and WebSocket infrastructure
- `adapter-lifecycle`: Start/stop/health management for long-lived channel adapters with reconnection logic

### Modified Capabilities
- `outbound-delivery`: Delivery service needs adapter initialization at startup and health-aware routing (skip adapters that aren't connected)
- `telegram-adapter`: Refactor webhook registration to follow the new adapter lifecycle pattern

## Impact

- **Files**: New adapter files in `src/lib/adapters/`, new WebChat page/component, updates to `delivery-service.ts` and scheduler
- **Dependencies**: `@whiskeysockets/baileys` for WhatsApp, possibly `discord.js` for Discord
- **Schema**: May need a `ChannelAccount` table for multi-account support (WhatsApp session state, Baileys auth keys)
- **APIs**: New routes for WhatsApp QR pairing flow, WebChat message endpoint
- **Infrastructure**: WhatsApp requires persistent Baileys auth state on disk
