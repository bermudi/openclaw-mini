# Plan 3: Workspace Bootstrap Files (AGENTS.md, SOUL.md, USER.md)

## Goal

Implement OpenClaw's workspace bootstrap system: load persona/instructions files from disk and inject them into the system prompt at session start.

## Workspace Layout

Create a workspace directory at `data/workspace/` (per the existing `data/` convention in this project) with these files:

```
data/workspace/
├── AGENTS.md      # Operating instructions, rules, priorities
├── SOUL.md        # Persona, tone, boundaries
├── USER.md        # Who the user is
├── IDENTITY.md    # Agent name, vibe, emoji
├── TOOLS.md       # Local tool notes and conventions
├── HEARTBEAT.md   # Heartbeat run checklist (optional)
└── MEMORY.md      # Curated long-term memory (optional)
```

## Files to Create/Change

### 1. Create src/lib/services/workspace-service.ts (NEW)

This service:

-   Reads bootstrap files from the workspace directory
-   Trims large files (configurable per-file cap: 20,000 chars, total cap: 150,000 chars)
-   Returns formatted system prompt sections
-   Creates default templates if files are missing (only on first init, not every boot)

```typescript
import * as fs from 'fs';
import * as path from 'path';

const WORKSPACE_DIR = path.join(process.cwd(), 'data', 'workspace');

interface BootstrapConfig {
  maxCharsPerFile: number;   // default 20000
  maxCharsTotal: number;     // default 150000
}

const DEFAULT_CONFIG: BootstrapConfig = {
  maxCharsPerFile: 20000,
  maxCharsTotal: 150000,
};

// Ordered list of bootstrap files to inject
const BOOTSTRAP_FILES = [
  { filename: 'IDENTITY.md', label: 'Identity', required: false },
  { filename: 'SOUL.md',     label: 'Persona & Tone', required: false },
  { filename: 'USER.md',     label: 'User Profile', required: false },
  { filename: 'AGENTS.md',   label: 'Operating Instructions', required: false },
  { filename: 'TOOLS.md',    label: 'Tool Notes', required: false },
  { filename: 'MEMORY.md',   label: 'Long-Term Memory', required: false },
];

export function loadBootstrapContext(config = DEFAULT_CONFIG): string {
  // Read each file, trim, concatenate
  const sections: string[] = [];
  let totalChars = 0;

  for (const file of BOOTSTRAP_FILES) {
    const filePath = path.join(WORKSPACE_DIR, file.filename);
    if (!fs.existsSync(filePath)) {
      continue; // Skip missing files silently
    }
    let content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) continue; // Skip empty files

    // Per-file cap
    if (content.length > config.maxCharsPerFile) {
      content = content.slice(0, config.maxCharsPerFile) + '\n\n[... truncated, read full file for details]';
    }

    // Total cap check
    if (totalChars + content.length > config.maxCharsTotal) {
      break;
    }

    sections.push(`## ${file.label} (${file.filename})\n\n${content}`);
    totalChars += content.length;
  }

  if (sections.length === 0) return '';
  return `# Workspace Context\n\n${sections.join('\n\n---\n\n')}`;
}

export function loadHeartbeatContext(): string {
  const filePath = path.join(WORKSPACE_DIR, 'HEARTBEAT.md');
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8').trim();
}

export function initializeWorkspace(): void {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
  // Only create defaults if workspace is completely empty
  const existing = fs.readdirSync(WORKSPACE_DIR).filter(f => f.endsWith('.md'));
  if (existing.length > 0) return;

  const defaults: Record<string, string> = {
    'AGENTS.md': `# Operating Instructions\n\n- Be helpful and concise\n- Use tools when appropriate\n- Always check memory before answering questions about past conversations\n`,
    'SOUL.md': `# Persona\n\nYou are a capable AI assistant. Be direct, thoughtful, and helpful.\n`,
    'USER.md': `# User Profile\n\n- Name: (configure me)\n- Preferences: (configure me)\n`,
    'IDENTITY.md': `# Identity\n\n- Name: Claw\n- Emoji: 🦞\n`,
    'TOOLS.md': `# Tool Notes\n\nNo custom tool notes configured yet.\n`,
  };

  for (const [filename, content] of Object.entries(defaults)) {
    const filePath = path.join(WORKSPACE_DIR, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}
```

### 2. Update src/lib/services/agent-executor.ts

Modify `getSystemPrompt()` to inject workspace context:

```typescript
import { loadBootstrapContext, loadHeartbeatContext } from './workspace-service';

// In getSystemPrompt():
private getSystemPrompt(agent, task, tools): string {
  const workspaceContext = loadBootstrapContext();
  const heartbeatContext = task.type === 'heartbeat' ? loadHeartbeatContext() : '';

  return `You are ${agent.name}.

${workspaceContext}

${heartbeatContext ? `## Heartbeat Checklist\n\n${heartbeatContext}` : ''}

Current task type: ${task.type}
Your Agent ID: ${task.agentId}
`;
}
```

**Key change:** Remove the generic hardcoded persona from `getSystemPrompt()`. The persona now comes from `SOUL.md`. The instructions come from `AGENTS.md`. This matches OpenClaw's design.

### 3. Update buildPrompt() in agent-executor.ts

The memory context loading should also include `MEMORY.md` for main sessions (not group sessions). Check `task.type === 'message'` and session type before including it.

### 4. Create default workspace files

Create `data/workspace/` directory with the 5 default files listed above. These should be committed to the repo as sensible defaults.

### 5. Add workspace API endpoint: src/app/api/workspace/route.ts (NEW)

```typescript
// GET /api/workspace — list workspace files with contents
// PUT /api/workspace — update a specific file
// POST /api/workspace/init — initialize workspace with defaults
```

This lets the dashboard edit workspace files.

### 6. Update dashboard (src/app/page.tsx)

Add a "Workspace" tab that:

-   Lists all `.md` files in `data/workspace/` 
-   Shows file contents in a textarea editor
-   Allows saving changes
-   Shows file sizes and truncation warnings

### 7. Call initializeWorkspace() at startup

Add to `src/app/api/route.ts` or create a startup hook that calls `initializeWorkspace()` on first boot.

## Verification

1.  Delete `data/workspace/`, restart app — verify defaults are created
2.  Edit `SOUL.md` to say "You are a pirate" — send a message, verify the agent responds like a pirate
3.  Edit `AGENTS.md` to add a rule — verify it's followed
4.  Create a large (>20KB) `AGENTS.md` — verify truncation works
5.  Check that `HEARTBEAT.md` content only appears in heartbeat task prompts
6.  Verify the Workspace tab in the dashboard works for viewing/editing
