---
name: LLM
description: Implement large language model (LLM) interactions using the Vercel AI SDK. Use this skill for chatbots, assistants, summarization, and tool-calling workflows.
license: MIT
---

# LLM (Large Language Model) Skill

Use the Vercel AI SDK (`ai`) with provider packages (e.g. `@ai-sdk/openai`, `@ai-sdk/anthropic`) to build LLM features. In this repo, the provider abstraction lives in `src/lib/services/model-provider.ts`.

## Prerequisites

- `ai` + provider packages installed (see `package.json`)
- Set env vars: `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_BASE_URL`

## Example: Simple Text Generation

```ts
import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/services/model-provider';

const { text } = await generateText({
  model: getLanguageModel(),
  prompt: 'Summarize the latest task status.',
});
```

## Example: Tool Calling

```ts
import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/services/model-provider';
import { getToolsForAgent } from '@/lib/tools';

const { text, steps } = await generateText({
  model: getLanguageModel(),
  prompt: 'What time is it? Write a short log entry.',
  tools: getToolsForAgent(['datetime', 'communication']),
});

const toolCalls = steps.flatMap(step => step.toolCalls ?? []);
```

## Best Practices

- Keep prompts concise and task-focused.
- Use tools for I/O or external side effects.
- Validate user inputs before persisting or executing.
- Never expose provider API keys in client-side code.
