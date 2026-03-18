# OpenClaw-Mini

We are creating a lightweight clone of the original OpenClaw project. The original project is at https://github.com/openclaw/openclaw. For more information you can also check INSPIRATION.md

## 1. Executive Summary
OpenClaw is an open-source, event-driven AI agent runtime. It provides a gateway architecture that routes diverse inputs to AI agents, enabling them to execute tasks, maintain persistent state, and interact with the user's digital environment. Its "autonomous" behavior is the result of elegant engineering involving queues, scheduled triggers, and persistent memory. The problem with it is that it needs around 1 GB of RAM just to sit comfortably idling and we are attempting to present a more lightweight alternative.

## 2. Problem Statement
Users require AI assistants that go beyond simple chat interfaces to perform proactive tasks (e.g., managing calendars, responding to emails, monitoring systems) without constant human manual input.

## 4. Functional Requirements

### 4.1 System Architecture

1.  **Gateway:** A long-running process that manages traffic and routes inputs to agents.
2.  **Input Manager:** A unified interface for five specific input types.
3.  **Task Queue:** An ordered buffer that ensures agent tasks are processed sequentially without context collision.
4.  **Persistent Storage:** A local file-based memory system (Markdown) that stores preferences, history, and context.

### 4.2 Input Sources
The system must be capable of receiving and processing the following inputs:
*   **Messages:** Direct interactions from messaging platforms (Telegram, Whatsapp, Discord, Slack, iMessage, etc).
*   **Heartbeats:** Timer-based triggers (default 30-min intervals) to execute maintenance or check-in tasks.
*   **Cron Jobs:** Scheduled event triggers for precise timing (e.g., "9:00 AM daily").
*   **Internal Hooks:** Triggers based on system state (e.g., app startup, task completion).
*   **Webhooks:** External triggers from APIs (GitHub, Jira, email providers).
*   **Agent-to-Agent Messaging:** Ability for one agent to queue tasks for another.

### 4.3 Core Behaviors
*   **Session Management:** All communication channels (e.g., Slack vs. WhatsApp) must maintain a the same session context.
*   **Sequential Execution:** Requests within a single conversation must be queued and processed in order, ensuring the agent finishes one thought before starting the next.
*   **State Persistence:** Agents must load context from local files (Markdown) upon waking, allowing for continuity across sessions.
*   **Sub Agents:** Speciallized (through skills and tools) sub-agents that can perform specific tasks and return results to the parent agent.

## 5. User Experience
*   **Perceived Autonomy:** Through the combination of Heartbeats and Cron jobs, the agent must appear proactive.
*   **Transparency:** Users must have the ability to configure, audit, and disable any trigger or skill.

### 5.1 The "Formula" for Proactivity
*   **Time** → Produces Events (Heartbeats/Crons)
*   **Events** → Trigger Agents
*   **Agents** → Access Tools & Persistent Files
*   **Result** → A system that feels autonomous while being strictly reactive.