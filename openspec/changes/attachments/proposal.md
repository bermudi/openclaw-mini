## Why

Agents can only receive and send plain text. Users frequently share images, documents, and other files through messaging platforms, and agents have no way to process them. Likewise, agents cannot send files back — a sub-agent that generates a report or a main agent that creates a file has no path to deliver it to the user. This limits the system to text-only workflows.

## What Changes

- **Inbound attachment handling**: Channel adapters download files from the messaging platform and save them to the agent's sandbox. Attachment metadata (path, mime type, filename) is included in the task payload so tools can reference the files.
- **Vision input detection**: Telegram photos sent as compressed images (`msg.photo`) are treated as vision inputs and passed directly to the LLM as image content parts. Photos sent as documents (`msg.document`) are treated as file attachments. If the active model doesn't support vision, the system sends an error message to chat explaining the limitation — unless the message also contains text, in which case the visionless text response is returned alongside the warning.
- **Outbound file sending**: `ChannelAdapter` interface gains a `sendFile()` method. A new `send_file_to_chat` tool lets agents send files from their sandbox to the user's chat.
- **Attachment types**: New `Attachment` and `VisionInput` type definitions. `MessageInput` gains optional `attachments` and `visionInputs` fields.

## Capabilities

### New Capabilities
- `inbound-attachments`: Download and store inbound file attachments from messaging platforms, inject paths into task payload
- `vision-input`: Detect compressed photos as vision inputs, pass to multimodal LLMs, handle non-vision model fallback with error messaging
- `outbound-files`: Send files from agent sandbox to user chat via channel adapters

### Modified Capabilities
- `telegram-adapter`: Handle `msg.photo` (vision) and `msg.document` (attachment) in webhook, download files via bot API
- `outbound-delivery`: Support `file` delivery type alongside `text`, route to `adapter.sendFile()`

## Impact

- **Files**: Type changes in `src/lib/types.ts`, adapter changes in `src/lib/adapters/telegram-adapter.ts` and `src/lib/adapters/whatsapp-adapter.ts`, delivery service changes, new tool in `src/lib/tools.ts`, executor changes for vision content parts
- **Dependencies**: None new — grammy and baileys already support file download/upload
- **Schema**: `OutboundDelivery` table may need a `deliveryType` column (`text` | `file`) and a `filePath` column
- **APIs**: Telegram webhook route needs to handle photo and document message types
- **Depends on**: `agent-workspace-exec` change (uses `sandbox-service` for file storage)
