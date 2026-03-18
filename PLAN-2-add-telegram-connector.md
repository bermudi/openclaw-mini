# Plan 2: Add Telegram Channel Connector via grammY

## Goal

Add a real messaging channel — Telegram — using the grammY library. This connects the existing input pipeline to an actual chat app, making the system functional end-to-end.

## Why Telegram

The PRD says Telegram is the "simplest setup — just a bot token." No QR codes, no phone number pairing, no complex auth flows. Just `TELEGRAM_BOT_TOKEN` and you're live.

## Files to Create/Change

### 1. Install dependency

```bash
bun add grammy
```

### 2. Create src/lib/channels/telegram.ts (NEW)

This is the Telegram channel adapter. It:

-   Creates a grammY `Bot` instance
-   Listens for incoming messages (text, photos, documents)
-   Translates them into the existing `MessageInput` type
-   Calls `inputManager.processInput()` to create tasks
-   Polls for completed tasks and sends responses back to Telegram

```typescript
import { Bot, Context } from 'grammy';
import { inputManager } from '@/lib/services/input-manager';
import { db } from '@/lib/db';

let bot: Bot | null = null;

export async function startTelegramBot(agentId: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Telegram] No TELEGRAM_BOT_TOKEN set, skipping');
    return;
  }

  bot = new Bot(token);

  bot.on('message:text', async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const senderId = String(ctx.from!.id);
    const senderName = ctx.from!.first_name || senderId;
    const text = ctx.message!.text!;

    const result = await inputManager.processInput({
      type: 'message',
      channel: 'telegram',
      channelKey: chatId,
      content: text,
      sender: senderName,
      metadata: {
        telegramChatId: chatId,
        telegramUserId: senderId,
        messageId: ctx.message!.message_id,
      },
    }, agentId);

    if (result.success && result.taskId) {
      // Wait for task completion and send reply
      const response = await waitForTaskCompletion(result.taskId, 120_000);
      if (response) {
        await ctx.reply(response, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply('⏳ Still thinking... (timed out waiting for response)');
      }
    }
  });

  bot.start();
  console.log('[Telegram] Bot started');
}

async function waitForTaskCompletion(taskId: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await db.task.findUnique({ where: { id: taskId } });
    if (task?.status === 'completed' && task.result) {
      const result = JSON.parse(task.result);
      return result.response || null;
    }
    if (task?.status === 'failed') return `❌ Error: ${task.error}`;
    await new Promise(r => setTimeout(r, 1000)); // Poll every 1s
  }
  return null;
}

export function stopTelegramBot() {
  bot?.stop();
  bot = null;
}
```

**Design note:** The polling-for-completion pattern is a pragmatic MVP. The scheduler sidecar processes tasks via `POST /api/tasks/:id/execute`; this connector polls the DB for the result. A future improvement would use the WS event bus to push completion events.

### 3. Create src/lib/channels/index.ts (NEW)

Channel registry and lifecycle manager:

```typescript
import { startTelegramBot, stopTelegramBot } from './telegram';

export async function startChannels(defaultAgentId: string) {
  await startTelegramBot(defaultAgentId);
  // Future: startWhatsApp(), startDiscord(), etc.
}

export async function stopChannels() {
  stopTelegramBot();
}
```

### 4. Create mini-services/telegram/index.ts (NEW)

A standalone sidecar process that runs the Telegram bot:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Inline the Telegram logic here (not importing from Next.js src)
// Or: run it as part of the scheduler sidecar
```

**Alternative (simpler):** Instead of a separate sidecar, integrate Telegram into the scheduler sidecar since it already has a Prisma client and a run loop. Add a `startTelegramBot()` call in `mini-services/scheduler/index.ts` after `start()`.

This avoids creating a 4th process. The scheduler already polls tasks — the Telegram bot just adds messages to the queue.

### 5. Update mini-services/scheduler/index.ts

Add Telegram bot startup:

```typescript
import { startTelegramBot } from './telegram-bot'; // local file, not @/ import

// At the end of start():
await startTelegramBot();
```

Create `mini-services/scheduler/telegram-bot.ts` with the grammY bot logic (duplicated from the channel adapter but using `prisma` directly instead of `db` from Next.js).

### 6. Update src/lib/types.ts

The `ChannelType` already includes `'telegram'` — no change needed.

### 7. Update src/app/page.tsx

-   Add a Telegram status indicator in the dashboard header or a new "Channels" tab
-   Show whether the Telegram bot is connected (check via a new API endpoint or WS event)

### 8. Create src/app/api/channels/status/route.ts (NEW)

```typescript
// GET /api/channels/status — returns which channels are active
// Check if TELEGRAM_BOT_TOKEN is set, if bot is running, etc.
```

### 9. Add channel-specific response formatting

In `mini-services/scheduler/telegram-bot.ts`, handle:

-   Long responses: split at 4096 chars (Telegram's max message length)
-   Markdown escaping: Telegram uses a subset of Markdown — escape special chars
-   Error formatting: send errors as a formatted message

## Verification

1.  Set `TELEGRAM_BOT_TOKEN` env var to a valid BotFather token
2.  Start the scheduler sidecar (`cd mini-services/scheduler && bun run index.ts`)
3.  Send a message to the bot on Telegram
4.  Verify: a task is created in the DB, the scheduler picks it up, executes it, and the response appears in Telegram
5.  Verify: session is created with `channel: 'telegram'` and `channelKey: <chatId>` 
6.  Verify: multi-turn works (send two messages, the second should have session context)

## Environment Variables

```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...  # from @BotFather
```
