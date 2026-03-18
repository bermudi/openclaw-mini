# Plan 1: Replace z-ai-web-dev-sdk with Vercel AI SDK (Multi-Provider)

## Goal

Replace the proprietary `z-ai-web-dev-sdk` dependency with the open-source `ai` (Vercel AI SDK) package. This gives native tool calling (no more `[TOOL: ...]` regex parsing), streaming, and multi-provider support out of the box.

## Why This Is First

Everything downstream — tool calling, compaction, workspace bootstrap injection — depends on having a real provider abstraction. The current `z-ai-web-dev-sdk` is a black box with no native function calling.

## Files to Change

### 1. Install dependencies

```bash
bun add ai @ai-sdk/openai @ai-sdk/anthropic
bun remove z-ai-web-dev-sdk
```

### 2. Create src/lib/services/model-provider.ts (NEW)

This is the provider abstraction layer. It:

-   Reads a `provider` and `model` from config (env vars for now: `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
-   Returns a configured AI SDK `LanguageModel` instance
-   Supports `openai` and `anthropic` providers initially, with an `ollama`\-compatible path via `@ai-sdk/openai` with a custom `baseURL` 

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

export type ProviderName = 'openai' | 'anthropic' | 'ollama';

interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export function getModelConfig(): ProviderConfig {
  const provider = (process.env.AI_PROVIDER || 'openai') as ProviderName;
  const model = process.env.AI_MODEL || 'gpt-4.1-mini';
  const baseURL = process.env.AI_BASE_URL;
  return { provider, model, baseURL };
}

export function getLanguageModel() {
  const config = getModelConfig();
  switch (config.provider) {
    case 'openai':
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: config.baseURL })
        (config.model);
    case 'anthropic':
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        (config.model);
    case 'ollama':
      return createOpenAI({ baseURL: config.baseURL || 'http://localhost:11434/v1', apiKey: 'ollama' })
        (config.model);
  }
}
```

### 3. Rewrite src/lib/tools.ts

Convert the tool registry from custom `Tool` interface to AI SDK `tool()` format. The key change: tools become AI SDK-compatible objects with Zod schemas.

**Keep the existing registry pattern** (`Map<string, Tool>`) but change `Tool` to use the AI SDK's `tool()` helper from `ai`. Each tool gets a `parameters` defined with Zod (already in `package.json`) and an `execute` function.

```typescript
import { tool } from 'ai';
import { z } from 'zod';

// Example: get_datetime becomes:
export const getDatetimeTool = tool({
  description: 'Get the current date and time',
  parameters: z.object({}),
  execute: async () => ({
    iso: new Date().toISOString(),
    unix: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
});
```

Convert ALL existing tools:

-   `get_datetime` → no params
-   `calculate` → `z.object({ expression: z.string() })` 
-   `read_file` → `z.object({ agentId: z.string(), filename: z.string() })` 
-   `write_note` → `z.object({ agentId: z.string(), title: z.string(), content: z.string() })` 
-   `list_files` → `z.object({ agentId: z.string() })` 
-   `web_search` → **REMOVE** (was z-ai specific). Replace with a stub that returns "web search not configured" or use a free API.
-   `wait` → `z.object({ seconds: z.number().max(60) })` 
-   `random` → `z.object({ type: z.enum(['number', 'uuid', 'string']), length: z.number().optional() })` 
-   `send_message_to_agent` → keep, convert params to Zod
-   `log_event` → keep, convert params to Zod

Export a `getToolsForAgent(skills: string[]): Record<string, CoreTool>` function that returns a tool map for the AI SDK.

Keep the existing `riskLevel` metadata by storing it in a separate `toolMeta` map — the AI SDK doesn't need it, but the dashboard does.

Export `getToolSchemas()` for the `/api/tools` endpoint (extract from Zod schemas).

### 4. Rewrite src/lib/services/agent-executor.ts

This is the biggest change. Replace the entire execution path:

**Before:** `zai.chat.completions.create()` → parse `[TOOL: ...]` from text → manually call tools
**After:** `generateText()` from `ai` with `tools` and `maxSteps` 

```typescript
import { generateText } from 'ai';
import { getLanguageModel } from './model-provider';
import { getToolsForAgent } from '@/lib/tools';

// In executeTask():
const model = getLanguageModel();
const tools = getToolsForAgent(agent.skills);

const result = await generateText({
  model,
  system: systemPrompt,
  prompt: userPrompt,
  tools,
  maxSteps: 5, // allow up to 5 tool-calling rounds
});

const response = result.text;
const toolCalls = result.steps.flatMap(s => s.toolCalls);
const toolResults = result.steps.flatMap(s => s.toolResults);
```

**Delete entirely:**

-   `private zai` field and `initAI()` method
-   `extractToolCalls()` method (the regex parser)
-   `formatToolsForPrompt()` method (AI SDK handles this natively)
-   All `[TOOL: tool_name(...)]` prompt instructions from `getSystemPrompt()` 

**Keep and adapt:**

-   `getAgentTools()` — rename to use the new `getToolsForAgent()` 
-   `buildPrompt()` — keep the task-type-specific prompt building
-   `getSystemPrompt()` — simplify: remove all tool-format instructions, keep persona/task-type context
-   Session context append logic
-   Memory append logic
-   Audit logging

### 5. Update src/app/api/tools/route.ts

The `GET` handler needs to extract tool info from AI SDK tools (name, description, Zod schema). The `POST` handler (test tool) still calls `tool.execute()` directly — this works the same way.

### 6. Update src/app/page.tsx

-   Remove all `[TOOL: tool_name(...)]` references from the UI text/descriptions
-   The "Send Message" dialog description should just say "Send a test message to this agent."

### 7. Update skills/LLM/SKILL.md

-   Replace all `z-ai-web-dev-sdk` references with AI SDK patterns
-   Or simply delete this skill — it was z-ai-specific

### 8. Clean up package.json

-   Remove `z-ai-web-dev-sdk` from dependencies

## Verification

1.  `bun run build` succeeds with no TypeScript errors
2.  Create an agent via the dashboard, send a message, verify it gets a response from OpenAI/Anthropic
3.  Verify tool calls work: send "what time is it?" and confirm `get_datetime` is called natively (visible in task result, not as `[TOOL: ...]` text)
4.  Verify the `/api/tools` endpoint still returns tool schemas
5.  Test with `AI_PROVIDER=anthropic` to confirm multi-provider works

## Environment Variables Required

```
AI_PROVIDER=openai        # or anthropic, ollama
AI_MODEL=gpt-4.1-mini     # or claude-sonnet-4-20250514, etc.
OPENAI_API_KEY=sk-...     # if using openai
ANTHROPIC_API_KEY=sk-...  # if using anthropic
AI_BASE_URL=              # optional, for ollama or proxies
```
