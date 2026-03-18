# Plan 4: Session Lifecycle (Daily Reset, Idle Timeout, LLM Compaction)

## Goal

Replace the naive 50-message ring buffer with OpenClaw's proper session lifecycle: daily reset, idle timeout, and LLM-based context compaction.

## Files to Change

### 1. Add session config to src/lib/types.ts

Add a new config type:

```typescript
export interface SessionConfig {
  dailyResetHour: number;        // default 4 (4 AM local)
  idleMinutes: number | null;    // null = disabled, e.g. 120
  maxMessages: number;           // default 100 (before compaction kicks in)
  compactionEnabled: boolean;    // default true
  compactionModel?: string;      // optional: use cheaper model for summaries
  dmScope: 'main' | 'per-peer' | 'per-channel-peer';  // default 'main'
}
```

### 2. Update Prisma schema (prisma/schema.prisma)

Add fields to the `Session` model:

```prisma
model Session {
  // ... existing fields ...
  compactionCount  Int      @default(0)
  compactedContext  String?  // Compacted summary of older messages
  expiresAt        DateTime? // When this session should reset
  sessionScope     String   @default("main") // main, per-peer, per-channel-peer
}
```

Run `bunx prisma db push` after schema change.

### 3. Rewrite src/lib/services/session-service.ts

#### 3a. Add session expiry check

Add a method `isSessionExpired(session)` that checks:

1.  **Daily reset:** Has 4 AM (configurable) passed since `lastActive`?
2.  **Idle reset:** Has `idleMinutes` elapsed since `lastActive`?

```typescript
isSessionExpired(session: { lastActive: Date }, config: SessionConfig): boolean {
  const now = new Date();

  // Daily reset check
  const resetToday = new Date(now);
  resetToday.setHours(config.dailyResetHour, 0, 0, 0);
  if (now > resetToday && session.lastActive < resetToday) {
    return true;
  }

  // Idle reset check
  if (config.idleMinutes) {
    const idleCutoff = new Date(now.getTime() - config.idleMinutes * 60_000);
    if (session.lastActive < idleCutoff) {
      return true;
    }
  }

  return false;
}
```

#### 3b. Update getOrCreateSession()

Before returning an existing session, check `isSessionExpired()`. If expired:

1.  Archive the old session (mark it, or keep for history)
2.  Create a new session with the same channel/channelKey
3.  Carry over compacted context if available

#### 3c. Add compaction logic

New method `compactSession(sessionId: string)`:

1.  Load all messages from `context.messages` 
2.  Take the older 75% of messages
3.  Call the LLM (via `generateText` from AI SDK) with a compaction prompt:

    ```
    Summarize the following conversation history into a concise summary.
    Preserve: key decisions, user preferences, action items, important facts.
    Discard: greetings, filler, redundant exchanges.
    ```

4.  Store the summary in `compactedContext` 
5.  Keep only the recent 25% of messages in `context.messages` 
6.  Increment `compactionCount` 

#### 3d. Auto-compaction trigger

In `appendToContext()`, after appending a message, check if `context.messages.length > maxMessages`. If so, call `compactSession()`.

#### 3e. Include compacted context in getSessionContext()

When building the session context string, prepend the `compactedContext` (if any) before the recent messages:

```
[Compacted Summary from earlier conversation]:
<summary>

[Recent Messages]:
user: ...
assistant: ...
```

### 4. Update src/lib/services/agent-executor.ts

-   When building the prompt, use the new session context format that includes compacted history
-   For heartbeat tasks, don't load full session context (it's not a conversation)

### 5. Add /compact slash command support

In `src/lib/services/input-manager.ts`, check if `input.content` starts with `/compact`, `/new`, or `/reset`:

```typescript
// In processMessage():
if (input.content.startsWith('/compact')) {
  const instructions = input.content.slice(8).trim();
  await sessionService.compactSession(session.id, instructions || undefined);
  // Return a "compaction complete" response without creating a task
}
if (input.content === '/new' || input.content === '/reset') {
  await sessionService.clearHistory(session.id);
  // Return a "session reset" response
}
```

### 6. Update the scheduler (mini-services/scheduler/index.ts)

Add a daily job that:

-   Finds all sessions past the daily reset cutoff
-   Marks them as expired / clears context
-   Runs at `dailyResetHour` (default 4 AM)

```typescript
// Add to the cron schedule
cron.schedule('0 4 * * *', async () => {
  console.log('[Scheduler] Running daily session reset');
  // Find and reset expired sessions
  const expiredSessions = await prisma.session.findMany({
    where: { lastActive: { lt: dailyResetCutoff } }
  });
  // Reset each expired session
});
```

### 7. Update dashboard

-   Show session `compactionCount` in the Sessions tab
-   Add a "Compact" button per session
-   Show session age and time until next reset
-   Add a `/status` response that shows compaction stats

## Verification

1.  Create a session, send 100+ messages → verify auto-compaction triggers
2.  Check that compacted context appears in subsequent prompts
3.  Wait past the daily reset hour → verify new session is created on next message
4.  Set `idleMinutes: 2`, wait 3 minutes, send a message → verify fresh session
5.  Send `/compact` in a message → verify manual compaction works
6.  Send `/new` → verify session resets
7.  Verify compacted sessions still have context from the summary
