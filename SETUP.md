# OpenClaw Agent Runtime - Setup Guide

## Quick Start

1. **Install dependencies:**
   ```bash
   bun install
   ```

2. **Initialize the database:**
   ```bash
   bun run db:push
   ```

3. **Start the development server:**
   ```bash
   bun run dev
   ```

4. **Start the background services** (in separate terminals):
   ```bash
   # Terminal 1: WebSocket service
   cd mini-services/openclaw-ws && bun install && bun run dev
   
   # Terminal 2: Scheduler service  
   cd mini-services/scheduler && bun install && bun run dev
   ```

5. **Open the dashboard:**
   Navigate to http://localhost:3000

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Application                       │
│                      (Port 3000)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Gateway   │  │ Input Mgr   │  │   Dashboard │         │
│  │    APIs     │  │   Service   │  │      UI     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Prisma/SQLite  │  │  Memory Files   │  │  WebSocket      │
│    Database     │  │   (Markdown)    │  │  (Port 3003)    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                                                  │
                                          ┌───────▼───────┐
                                          │   Scheduler   │
                                          │   (Worker)    │
                                          └───────────────┘
```

## API Endpoints

### Agents
- `GET /api/agents` - List all agents
- `POST /api/agents` - Create agent
- `GET /api/agents/[id]` - Get agent with stats
- `PUT /api/agents/[id]` - Update agent
- `DELETE /api/agents/[id]` - Delete agent
- `GET /api/agents/[id]/memory` - Get agent memories
- `POST /api/agents/[id]/memory` - Update memory

### Tasks
- `GET /api/tasks` - List tasks (with filters)
- `POST /api/tasks` - Create task
- `POST /api/tasks/[id]/execute` - Execute task

### Triggers
- `GET /api/triggers` - List triggers
- `POST /api/triggers` - Create trigger
- `PUT /api/triggers/[id]` - Update trigger
- `DELETE /api/triggers/[id]` - Delete trigger

### Input
- `POST /api/input` - Process any input type (message, heartbeat, cron, webhook, hook, a2a)

### Webhooks
- `GET /api/webhooks/[source]` - Webhook verification
- `POST /api/webhooks/[source]` - Receive webhook

### Tools
- `GET /api/tools` - List available tools
- `POST /api/tools` - Execute tool directly

### Audit
- `GET /api/audit` - Get audit logs with stats

## Using Tools in Messages

Agents can use tools by including them in messages using this syntax:

```
What time is it? [TOOL: get_datetime()]
Calculate 2 + 2: [TOOL: calculate(expression: "2 + 2")]
Write a note: [TOOL: write_note(agentId: "your-agent-id", title: "My Note", content: "Hello world")]
```

## Creating Triggers

### Heartbeat (Interval-based)
```json
{
  "name": "Daily Check-in",
  "type": "heartbeat",
  "config": { "interval": 30 }
}
```

### Cron (Scheduled)
```json
{
  "name": "Morning Report",
  "type": "cron", 
  "config": { "cronExpression": "0 9 * * *" }
}
```

### Webhook
```json
{
  "name": "GitHub Events",
  "type": "webhook",
  "config": { "endpoint": "github", "secret": "your-secret" }
}
```

## Troubleshooting

### Database errors (500 on API calls)
Run: `bun run db:push`

### WebSocket not connecting
Start the WebSocket service: `cd mini-services/openclaw-ws && bun run dev`

### Tasks not executing automatically
Start the scheduler: `cd mini-services/scheduler && bun run dev`

### Tools not working
Some tools require specific skills on the agent. Add skills when creating:
- `research` → web_search, read_file
- `writing` → write_note, read_file
- `coding` → calculate, read_file, write_note
- `communication` → send_message_to_agent, log_event
- `general` → get_datetime, calculate, random, files

## Sub-agent overrides

Sub-agents are currently defined through `skills/<name>/SKILL.md`. That skill manifest is the bridge to a future dedicated agent manifest layer, and it already supports a frontmatter `overrides` block for runtime specialization.

Supported override fields:

- `model`
- `provider`
- `credentialRef`
- `systemPrompt`
- `maxIterations`
- `allowedSkills`
- `allowedTools`
- `maxToolInvocations`

Precedence is resolved in this order:

1. Gateway defaults from the environment (`AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`)
2. Parent agent runtime context (for example the agent's allowed skills)
3. Sub-agent skill defaults from `SKILL.md` (`tools` and the skill body instructions)
4. `overrides` from the same `SKILL.md`

Only fields present in `overrides` replace upstream values. Unspecified fields continue to inherit from the earlier layers.

Example frontmatter:

```yaml
---
name: planner
description: High-context planning specialist
tools:
  - get_datetime
  - spawn_subagent
overrides:
  provider: openrouter
  model: openrouter/openai/gpt-4.1
  credentialRef: providers/openrouter/planner
  systemPrompt: You are the planning specialist. Produce plans, not final execution.
  maxIterations: 8
  allowedSkills:
    - executor
  allowedTools:
    - get_datetime
    - spawn_subagent
  maxToolInvocations: 3
---
```

Security notes:

- Secrets must be referenced through `credentialRef`; do not place raw API keys in `SKILL.md`.
- `credentialRef` resolves from either `env:YOUR_ENV_VAR` or `OPENCLAW_CREDENTIAL_<SANITIZED_REF>`.
- For example, `providers/openrouter/planner` maps to `OPENCLAW_CREDENTIAL_PROVIDERS_OPENROUTER_PLANNER`.
- Audit logs record `overrideFieldsApplied`, but never the secret value itself.
- Invalid overrides disable the skill and surface the validation error through skill loading and the `/api/skills` endpoint.

## Environment Variables

Create a `.env` file if needed:
```
DATABASE_URL="file:./db/custom.db"
AI_PROVIDER="poe"
AI_MODEL="gpt-5-pro"
POE_API_KEY="your-poe-api-key"
AI_FALLBACK_MODEL="openai/gpt-4.1-mini"
```

Provider notes:

- `POE_API_KEY` authenticates requests when `AI_PROVIDER=poe`.
- `AI_FALLBACK_MODEL` is optional and must use `provider/model` format, for example `openai/gpt-4.1-mini` or `poe/claude-opus-4.6`.
- Poe routes `claude-*` models through Poe's Anthropic-compatible endpoint, `gpt-*`/`o3`/`o4-*` through Poe's Responses endpoint, and other models through Poe's chat-completions endpoint.

Example Poe configuration:
```
DATABASE_URL="file:./db/custom.db"
AI_PROVIDER="poe"
AI_MODEL="claude-opus-4.6"
POE_API_KEY="your-poe-api-key"
AI_FALLBACK_MODEL="openai/gpt-4.1-mini"
```
