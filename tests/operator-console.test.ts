/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import {
  createOperatorAgentFromCommaList,
  createOperatorTrigger,
  loadOperatorSnapshot,
  saveOperatorWorkspaceDocument,
  sendOperatorMessage,
} from '../src/lib/operator-console';
import { memoryService } from '../src/lib/services/memory-service';

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'operator-console.test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';

  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push', '--accept-data-loss'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, NO_ENV_FILE: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare operator console test DB: ${dbPush.stderr.toString()}`);
  }

  const { recreateDbClientForTests } = await import('../src/lib/db');
  await recreateDbClientForTests();
});

beforeEach(async () => {
  const workspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-operator-console-'));
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;

  const { db } = await import('../src/lib/db');
  await db.task.deleteMany();
  await db.trigger.deleteMany();
  await db.session.deleteMany();
  await db.memory.deleteMany();
  await db.agent.deleteMany();
});

afterAll(async () => {
  delete process.env.OPENCLAW_WORKSPACE_DIR;

  const { db } = await import('../src/lib/db');
  await db.$disconnect();
  fs.rmSync(TEST_DB_PATH, { force: true });
});

describe('operator console boundary reset', () => {
  test('createOperatorAgent initializes core memory and queues operator messages without API auth', async () => {
    const agent = await createOperatorAgentFromCommaList({
      name: 'Console Agent',
      description: 'Runs through the same-origin console',
      skills: 'triage, summarize',
    });

    const preferences = await memoryService.getMemory(agent.id, 'system/preferences');
    expect(preferences?.value).toContain('Console Agent');

    const result = await sendOperatorMessage({
      agentId: agent.id,
      content: 'Check the overnight queue.',
      channel: 'webchat',
    });

    expect(result.taskId).toBeDefined();
    expect(result.sessionId).toBeDefined();
  });

  test('loadOperatorSnapshot reads agent, trigger, session, task, and workspace state from services', async () => {
    const agent = await createOperatorAgentFromCommaList({
      name: 'Snapshot Agent',
      skills: 'ops',
    });

    await sendOperatorMessage({
      agentId: agent.id,
      content: 'Generate a status report.',
      channel: 'webchat',
    });

    await createOperatorTrigger({
      agentId: agent.id,
      name: 'Quarter Hour',
      type: 'heartbeat',
      schedule: '15',
    });

    await saveOperatorWorkspaceDocument('OPERATIONS.md', '# Operations\n\nSame-origin console notes\n');

    const snapshot = await loadOperatorSnapshot('OPERATIONS.md');

    expect(snapshot.agents).toEqual([
      expect.objectContaining({ name: 'Snapshot Agent' }),
    ]);
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({ agentId: agent.id, type: 'message' }),
    ]);
    expect(snapshot.sessions).toEqual([
      expect.objectContaining({ agentId: agent.id, agentName: 'Snapshot Agent', messageCount: 0 }),
    ]);
    expect(snapshot.triggers).toEqual([
      expect.objectContaining({ agentId: agent.id, name: 'Quarter Hour', type: 'heartbeat' }),
    ]);
    expect(snapshot.selectedWorkspaceFile).toEqual(
      expect.objectContaining({ name: 'OPERATIONS.md', content: expect.stringContaining('Same-origin console notes') }),
    );
  });
});
