## Context

The system currently processes only text messages. Channel adapters (Telegram, WhatsApp, WebChat) ignore photos, documents, voice messages, and all other non-text content. The `MessageInput` type has a single `content: string` field. The `ChannelAdapter` interface only has `sendText()` for outbound. The agent executor builds a text-only prompt.

The `agent-workspace-exec` change introduces a per-agent sandbox directory at `data/sandbox/{agentId}/` — this gives us a natural place to store downloaded attachments and agent-generated files.

The model catalog already tracks vision capability via `inputModalities.includes('image')`, so we can detect whether the active model supports vision inputs.

## Goals / Non-Goals

**Goals:**
- Receive file attachments from Telegram (photo vs document distinction) and WhatsApp
- Download inbound files to the agent's sandbox downloads directory
- Pass compressed photos as vision inputs to multimodal LLMs
- Handle non-vision models gracefully with a user-facing error message
- Let agents send files from their sandbox back to chat
- Keep the delivery pipeline working for both text and file deliveries

**Non-Goals:**
- Audio/voice message transcription (future change)
- Video processing
- Inline image generation (e.g., DALL-E integration)
- WebChat file upload (can be added later once the core plumbing exists)
- File format conversion or thumbnail generation

## Decisions

### 1. Telegram photo vs document detection using grammy message fields

Telegram uses `msg.photo` (compressed JPEG, no filename, multiple sizes) for images sent "as photo" and `msg.document` (original quality, has mime_type and file_name) for images sent "as file". This maps perfectly to the vision vs attachment distinction:

- `msg.photo` → `VisionInput` → passed as image content part to LLM
- `msg.document` → `Attachment` → downloaded to sandbox, path in payload
- `msg.animation` → `Attachment` (GIFs co-set `msg.document`, check `msg.animation` first)

The webhook route schema needs to be extended to parse these fields. File download uses grammy's `bot.api.getFile()` + HTTPS fetch.

### 2. Vision input handling in the agent executor

The AI SDK's `generateText` supports multi-part content in the prompt. When `visionInputs` are present in the task payload:

1. Check if the active model supports vision (via model catalog or a simple lookup)
2. If yes: build prompt with `[{ type: 'image', image: Buffer }]` content parts alongside text
3. If no and message has text: proceed with text-only prompt, deliver warning message to chat: "⚠️ Your current model doesn't support vision. Send images as file attachments, or switch to a vision-capable model."
4. If no and message is image-only (no text content): deliver error message to chat: "❌ Your current model doesn't support vision. Send images as file attachments, or switch to a vision-capable model." — do not run the LLM

Vision capability detection: use model catalog's `modelSupportsCapability(model, 'vision')` where available (Poe models). For direct API providers, maintain a static set of known vision models (gpt-4o, gpt-4.1, claude-3-*-*) or default to attempting vision and catching errors.

### 3. File download as a shared utility

A `downloadChannelFile` function that takes a channel-specific file ID and saves it to the sandbox downloads dir. Each adapter implements its own download logic:

- **Telegram**: `bot.api.getFile(fileId)` returns a `File` with `file_path`, then HTTPS GET from `https://api.telegram.org/file/bot{token}/{file_path}`
- **WhatsApp**: `socket.downloadMediaMessage(msg)` returns a Buffer

The function returns the local path where the file was saved. File naming: `{originalFilename}` if available, otherwise `{fileId}.{ext}` derived from mime type.

### 4. Outbound file delivery via `sendFile()` on ChannelAdapter

The `ChannelAdapter` interface gets a new optional method:

```typescript
sendFile?(target: DeliveryTarget, filePath: string, opts?: {
  filename?: string;
  mimeType?: string;
  caption?: string;
}): Promise<{ externalMessageId?: string }>;
```

Optional because not all adapters may support it initially. The delivery service checks for `sendFile` support before attempting file delivery.

Telegram: `bot.api.sendDocument(chatId, new InputFile(filePath), { caption })` — always sends as document since the agent is sharing a file, not a photo.

WhatsApp: `socket.sendMessage(jid, { document: { url: filePath }, mimetype, fileName })`.

### 5. Delivery table extension for file deliveries

The `OutboundDelivery` table needs to support both text and file deliveries. Add:
- `deliveryType`: `'text' | 'file'` (default `'text'`)
- `filePath`: nullable string for file deliveries

The `dispatchDelivery` function checks `deliveryType` and calls `sendText` or `sendFile` accordingly.

### 6. `send_file_to_chat` tool

A new agent tool that enqueues a file delivery:

```
send_file_to_chat({
  agentId: string,
  filePath: string,     // relative to sandbox or absolute within sandbox
  caption?: string,
  mimeType?: string     // auto-detected if not provided
})
```

The tool resolves `filePath` relative to the agent's sandbox, validates the file exists and is within the sandbox boundary, then enqueues a file delivery to the current session's delivery target.

## Risks / Trade-offs

- **[Telegram file size limits]** → Telegram Bot API limits file downloads to 20MB and uploads to 50MB. Mitigation: document the limits; reject oversized files with a user-facing error.
- **[Disk usage from downloads]** → Inbound attachments accumulate in sandbox/downloads. Mitigation: not addressed in this change; a future cleanup policy change can handle retention.
- **[Vision detection is imperfect]** → For non-Poe providers we may not know if a model supports vision. Mitigation: maintain a static allowlist of known vision models; default to attempting vision for unknown models and surface the error if it fails.
- **[No WebChat file support]** → WebChat adapter won't support file upload/download initially. Mitigation: WebChat is primarily for debugging; file support can be added later via multipart form upload.
