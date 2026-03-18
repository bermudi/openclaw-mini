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

## Environment Variables

Create a `.env` file if needed:
```
DATABASE_URL="file:./db/custom.db"
```
