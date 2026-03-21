// Migration: flat memory keys → path-based keys
// Renames: preferences → system/preferences, history → system/history, context → agent/context
// Also initializes git repos for each agent directory with an initial commit.
// Idempotent: safe to run multiple times.

import { db } from '../src/lib/db';
import { MemoryGit } from '../src/lib/services/memory-git';
import * as fs from 'fs';
import * as path from 'path';

const MEMORY_DIR = path.join(process.cwd(), 'data', 'memories');

const KEY_MAP: Record<string, string> = {
  preferences: 'system/preferences',
  history: 'system/history',
  context: 'agent/context',
};

async function migrateMemoryKeys() {
  console.log('Starting memory key migration...');

  const memories = await db.memory.findMany({
    orderBy: [{ agentId: 'asc' }, { key: 'asc' }],
  });

  let renamedCount = 0;
  let skippedCount = 0;
  const processedAgents = new Set<string>();

  for (const memory of memories) {
    processedAgents.add(memory.agentId);

    if (memory.key.includes('/')) {
      skippedCount += 1;
      continue;
    }

    const newKey = KEY_MAP[memory.key];
    if (!newKey) {
      console.log(`  [SKIP] Unknown flat key "${memory.key}" for agent ${memory.agentId} — leaving unchanged`);
      skippedCount += 1;
      continue;
    }

    const existingTarget = await db.memory.findUnique({
      where: { agentId_key: { agentId: memory.agentId, key: newKey } },
    });

    if (existingTarget) {
      console.log(`  [SKIP] Target key "${newKey}" already exists for agent ${memory.agentId}`);
      skippedCount += 1;
      continue;
    }

    await db.memory.update({
      where: { id: memory.id },
      data: { key: newKey },
    });

    const agentDir = path.join(MEMORY_DIR, memory.agentId);
    const oldFilePath = path.join(agentDir, `${memory.key}.md`);
    const newFilePath = path.join(agentDir, `${newKey}.md`);

    if (fs.existsSync(oldFilePath)) {
      const newFileDir = path.dirname(newFilePath);
      if (!fs.existsSync(newFileDir)) {
        fs.mkdirSync(newFileDir, { recursive: true });
      }
      fs.renameSync(oldFilePath, newFilePath);
      console.log(`  [RENAME] ${memory.agentId}: ${memory.key}.md → ${newKey}.md`);
    }

    renamedCount += 1;
  }

  console.log(`\nKey migration complete: ${renamedCount} renamed, ${skippedCount} skipped`);

  if (!MemoryGit.isAvailable()) {
    console.log('\n[WARN] git not available — skipping git repo initialization');
    return { renamedCount, skippedCount, gitInitCount: 0 };
  }

  console.log('\nInitializing git repos for agent memory directories...');
  let gitInitCount = 0;

  for (const agentId of processedAgents) {
    const agentDir = path.join(MEMORY_DIR, agentId);
    if (!fs.existsSync(agentDir)) continue;

    const git = new MemoryGit(agentDir);
    await git.init();

    const files = collectMarkdownFiles(agentDir);
    if (files.length === 0) continue;

    const gitDir = path.join(agentDir, '.git');
    const hasCommits = await checkHasCommits(agentDir);

    if (hasCommits) {
      console.log(`  [SKIP] Agent ${agentId} git repo already has commits`);
      continue;
    }

    for (const file of files) {
      const rel = path.relative(agentDir, file);
      await git.add(rel);
    }
    await git.commit(`Initial commit: migrate memory files for ${agentId}`);
    gitInitCount += 1;
    console.log(`  [GIT] Initialized repo for agent ${agentId} (${files.length} files)`);
  }

  console.log(`\nGit initialization complete: ${gitInitCount} repos initialized`);
  return { renamedCount, skippedCount, gitInitCount };
}

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

async function checkHasCommits(repoDir: string): Promise<boolean> {
  const proc = Bun.spawnSync(['git', 'log', '--oneline', '-1'], {
    cwd: repoDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return proc.exitCode === 0 && proc.stdout.toString().trim().length > 0;
}

const result = await migrateMemoryKeys();
console.log('\nResult:', JSON.stringify(result, null, 2));
await db.$disconnect();
