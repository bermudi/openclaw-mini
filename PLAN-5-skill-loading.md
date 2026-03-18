# Plan 5: Skill SKILL.md Parsing and Loading

## Goal

Implement the skill loading system that reads `SKILL.md` files with YAML frontmatter from the `skills/` directory, filters them by gating rules, and makes their instructions available to agents.

## Current State

There are 18 skill directories in `skills/` (ASR, LLM, TTS, VLM, docx, finance, frontend-design, fullstack-dev, gift-evaluator, image-generation, pdf, podcast-generate, pptx, video-generation, video-understand, web-reader, web-search, xlsx). Each has a `SKILL.md` with YAML frontmatter (`name`, `description`, `license`). None are loaded or parsed.

## Files to Create/Change

### 1. Install dependency

```bash
bun add gray-matter
```

`gray-matter` parses YAML frontmatter from Markdown files. Tiny, well-tested, no deps.

### 2. Create src/lib/services/skill-service.ts (NEW)

```typescript
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  // Gating fields (from AgentSkills spec)
  requires?: {
    binaries?: string[];     // e.g. ['ffmpeg', 'python3']
    env?: string[];          // e.g. ['OPENAI_API_KEY']
    config?: string[];       // e.g. ['tools.web.search.apiKey']
    platform?: string[];     // e.g. ['darwin', 'linux']
  };
}

interface LoadedSkill {
  metadata: SkillMetadata;
  instructions: string;      // Markdown body (after frontmatter)
  path: string;              // Directory path
  source: 'workspace' | 'managed' | 'bundled';
  enabled: boolean;          // After gating check
  gatingReason?: string;     // Why it was disabled
}

const SKILL_DIRS = [
  { path: path.join(process.cwd(), 'skills'), source: 'workspace' as const },
  // Future: ~/.openclaw/skills for managed skills
];
```

#### Core methods:

**`loadAllSkills(): LoadedSkill[]`**

1.  Scan each skill directory for subdirectories
2.  For each subdirectory, look for `SKILL.md` 
3.  Parse YAML frontmatter with `gray-matter` 
4.  Run gating checks:
    -   `requires.binaries`: use `which` / `execSync('which <binary>')` to check
    -   `requires.env`: check `process.env[key]` 
    -   `requires.platform`: check `process.platform` 
5.  Return array of `LoadedSkill` objects

**`getSkillsForAgent(agentSkillNames: string[]): LoadedSkill[]`**
If the agent has explicit skill names configured, filter to only those. If empty, return all enabled skills.

**`getSkillInstructions(skills: LoadedSkill[]): string`**
Concatenate skill instructions into a prompt section:

```
## Available Skills

### web-search
<instructions from SKILL.md body>

### LLM
<instructions from SKILL.md body>
```

With a per-skill cap (e.g., 5000 chars) and total cap (e.g., 30000 chars) to avoid blowing up the context window.

**`getSkillSummaries(): Array<{ name, description, enabled, gatingReason }>`**
For the dashboard.

### 3. Update src/lib/services/agent-executor.ts

In `getSystemPrompt()`, include skill instructions:

```typescript
import { loadAllSkills, getSkillsForAgent, getSkillInstructions } from './skill-service';

// In getSystemPrompt():
const allSkills = loadAllSkills();
const agentSkills = getSkillsForAgent(agent.skills); // filter by agent config
const skillInstructions = getSkillInstructions(agentSkills);

// Append to system prompt:
return `...
${skillInstructions}
...`;
```

**Cache skills in memory** — don't re-parse SKILL.md files on every request. Use a module-level cache with a file-watcher or TTL (e.g., reload every 60s).

### 4. Create API endpoint: src/app/api/skills/route.ts (NEW)

```typescript
// GET /api/skills — list all skills with metadata, enabled status, gating info
// POST /api/skills/:name/enable — enable a skill
// POST /api/skills/:name/disable — disable a skill
```

### 5. Update dashboard (src/app/page.tsx)

Add a "Skills" tab that:

-   Lists all discovered skills with name, description, source, enabled/disabled
-   Shows gating reasons (e.g., "missing binary: ffmpeg")
-   Shows skill instruction preview (first 200 chars)
-   Toggle enable/disable per skill (stored in a config file or DB)

### 6. Update src/lib/types.ts

Add skill-related types:

```typescript
export interface Skill {
  name: string;
  description: string;
  enabled: boolean;
  source: 'workspace' | 'managed' | 'bundled';
  gatingReason?: string;
}
```

### 7. Add per-agent skill configuration

The `Agent` model already has a `skills` column (JSON string array). Currently it maps to tool names (research, writing, coding, etc.). Repurpose this:

-   If `skills` is empty → load all enabled skills
-   If `skills` contains specific names → load only those

Update the agent creation form in the dashboard to allow selecting from discovered skills.

### 8. Handle z-ai-specific skills

Many existing skills reference `z-ai-web-dev-sdk`. After Plan 1 removes that dependency:

-   Skills that require `z-ai-web-dev-sdk` should be gated by `requires.env: ['Z_AI_API_KEY']` or similar
-   Or: update their `SKILL.md` files to reference the new AI SDK patterns
-   Pragmatic choice: leave them as-is. They're instructions for the LLM, not executable code. The LLM will adapt.

## Verification

1.  Start the app → verify all 18 skills are discovered and listed in `/api/skills` 
2.  Check gating: if `ffmpeg` is not installed and a skill requires it, verify it shows as disabled
3.  Create an agent with `skills: ["web-search", "LLM"]` → verify only those skill instructions appear in the system prompt
4.  Create an agent with `skills: []` → verify all enabled skills are included
5.  Verify the Skills tab in the dashboard shows the correct list
6.  Add a new skill directory `skills/test-skill/SKILL.md` → verify it's picked up (after cache refresh)
7.  Check total prompt size doesn't explode with all 18 skills (verify caps work)
