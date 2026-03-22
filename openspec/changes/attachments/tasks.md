## 1. Type Definitions

- [x] 1.1 Add `Attachment` interface to `src/lib/types.ts`: `channelFileId`, `localPath`, `filename`, `mimeType`, `size?`
- [x] 1.2 Add `VisionInput` interface to `src/lib/types.ts`: `channelFileId`, `localPath`, `mimeType`
- [x] 1.3 Add optional `attachments?: Attachment[]` and `visionInputs?: VisionInput[]` fields to `MessageInput`
- [x] 1.4 Add optional `sendFile` method to `ChannelAdapter` interface: `sendFile?(target: DeliveryTarget, filePath: string, opts?: { filename?: string; mimeType?: string; caption?: string }): Promise<{ externalMessageId?: string }>`

## 2. Telegram Inbound (Photo + Document)

- [x] 2.1 Extend `TelegramUpdateSchema` in the webhook route to parse `msg.photo` (array of `{ file_id, width, height, file_size? }`), `msg.document` (`{ file_id, file_name?, mime_type? }`), `msg.animation`, and `msg.caption`
- [x] 2.2 Create a `downloadTelegramFile(bot, fileId, destDir, filename?)` utility in the telegram adapter that calls `bot.api.getFile()`, fetches via HTTPS, and saves to disk — returns the local path
- [x] 2.3 Update webhook route handler: when `msg.photo` is present, download the largest size, create a `VisionInput`, and pass it on the `MessageInput`. Use caption as `content` if present
- [x] 2.4 Update webhook route handler: when `msg.document` is present (and not `msg.animation`), download the file, create an `Attachment`, and pass it on the `MessageInput`. Use caption as `content` if present
- [x] 2.5 Update webhook route handler: when `msg.animation` is present, treat as `Attachment` (not vision input)
- [x] 2.6 Handle download failures gracefully: log error, exclude attachment from payload, still process text content
- [x] 2.7 Write tests for webhook route: photo message creates vision input, document message creates attachment, animation treated as attachment, text-only unchanged, download failure doesn't block text processing

## 3. Vision Input in Agent Executor

- [x] 3.1 Add vision capability detection: create a `supportsVision(modelId: string)` function that checks model catalog first, then falls back to a static set of known vision model IDs
- [x] 3.2 Update `AgentExecutor.executeTask()`: when task payload has `visionInputs` and model supports vision, build multi-part prompt with `[{ type: 'text', text: prompt }, { type: 'image', image: Buffer }]` content parts
- [x] 3.3 Handle non-vision model + image + text: run LLM with text-only prompt, enqueue a warning delivery to chat alongside the response
- [x] 3.4 Handle non-vision model + image only (no text content): skip LLM execution, enqueue error delivery to chat
- [x] 3.5 Update prompt builder: when task has `attachments`, add an "ATTACHED FILES" section listing each file's path, name, and mime type
- [ ] 3.6 Write tests for vision handling: vision model gets image content parts, non-vision model with text gets warning, non-vision model image-only gets error

## 4. Telegram Outbound (sendFile)

- [x] 4.1 Implement `sendFile()` on `TelegramAdapter`: call `bot.api.sendDocument(chatId, new InputFile(filePath), { caption })`, return `externalMessageId`
- [ ] 4.2 Write tests for Telegram sendFile: sends document, includes caption, handles missing chatId

## 5. WhatsApp Attachment Support

- [x] 5.1 Update WhatsApp `routeInbound()` to detect image/document messages and download via `socket.downloadMediaMessage()` — create appropriate `VisionInput` or `Attachment`
- [x] 5.2 Implement `sendFile()` on `WhatsAppAdapter`: call `socket.sendMessage(jid, { document: { url: filePath }, mimetype, fileName })`
- [ ] 5.3 Write tests for WhatsApp attachment handling

## 6. Delivery Service File Support

- [x] 6.1 Add Prisma migration: add `deliveryType` (string, default `'text'`) and `filePath` (string, nullable) columns to `OutboundDelivery` table
- [x] 6.2 Create `enqueueFileDelivery()` function in delivery service for file deliveries
- [x] 6.3 Update `dispatchDelivery()`: check `deliveryType`, call `sendFile()` for file deliveries, handle adapters without `sendFile` support
- [ ] 6.4 Write tests for file delivery dispatch: file delivery calls sendFile, adapter without sendFile fails gracefully

## 7. send_file_to_chat Tool

- [x] 7.1 Register `send_file_to_chat` tool in `src/lib/tools.ts`: takes `agentId`, `filePath` (relative to sandbox), optional `caption` and `mimeType` — resolves path within sandbox, validates file exists, enqueues file delivery
- [x] 7.2 Add path validation: reject paths that escape the sandbox using the sandbox service's path traversal guard
- [x] 7.3 Auto-detect mime type from file extension when not provided (use a simple extension→mime map)
- [x] 7.4 Write tests for send_file_to_chat: valid file enqueued, path traversal rejected, file not found error
