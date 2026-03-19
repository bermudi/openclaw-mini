/// <reference types="bun-types" />

import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  initializeWorkspace,
  loadBootstrapContext,
  loadHeartbeatContext,
} from '../src/lib/services/workspace-service';

const createdDirs = new Set<string>();

function createWorkspaceDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-workspace-service-'));
  createdDirs.add(dir);
  return dir;
}

function writeWorkspaceFile(workspaceDir: string, fileName: string, content: string): void {
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, fileName), content, 'utf-8');
}

afterEach(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  createdDirs.clear();
});

test('loadBootstrapContext uses the defined file order when all files are present', () => {
  const workspaceDir = createWorkspaceDir();

  writeWorkspaceFile(workspaceDir, 'IDENTITY.md', 'Identity block');
  writeWorkspaceFile(workspaceDir, 'SOUL.md', 'Soul block');
  writeWorkspaceFile(workspaceDir, 'USER.md', 'User block');
  writeWorkspaceFile(workspaceDir, 'AGENTS.md', 'Agent block');
  writeWorkspaceFile(workspaceDir, 'TOOLS.md', 'Tools block');
  writeWorkspaceFile(workspaceDir, 'MEMORY.md', 'Memory block');

  const prompt = loadBootstrapContext({ workspaceDir });

  expect(prompt).toContain('## Identity\nIdentity block');
  expect(prompt.indexOf('## Identity')).toBeLessThan(prompt.indexOf('## Persona & Tone'));
  expect(prompt.indexOf('## Persona & Tone')).toBeLessThan(prompt.indexOf('## User Profile'));
  expect(prompt.indexOf('## User Profile')).toBeLessThan(prompt.indexOf('## Operating Instructions'));
  expect(prompt.indexOf('## Operating Instructions')).toBeLessThan(prompt.indexOf('## Tool Notes'));
  expect(prompt.indexOf('## Tool Notes')).toBeLessThan(prompt.indexOf('## Long-Term Memory'));
});

test('loadBootstrapContext skips missing and empty files', () => {
  const workspaceDir = createWorkspaceDir();

  writeWorkspaceFile(workspaceDir, 'SOUL.md', 'Speak plainly.');
  writeWorkspaceFile(workspaceDir, 'TOOLS.md', '   \n\n  ');
  writeWorkspaceFile(workspaceDir, 'AGENTS.md', 'Follow the plan.');

  const prompt = loadBootstrapContext({ workspaceDir });

  expect(prompt).toContain('## Persona & Tone\nSpeak plainly.');
  expect(prompt).toContain('## Operating Instructions\nFollow the plan.');
  expect(prompt).not.toContain('## Identity');
  expect(prompt).not.toContain('## Tool Notes');
});

test('loadBootstrapContext truncates a file that exceeds the per-file cap', () => {
  const workspaceDir = createWorkspaceDir();
  const oversizedContent = 'A'.repeat(80);

  writeWorkspaceFile(workspaceDir, 'AGENTS.md', oversizedContent);

  const prompt = loadBootstrapContext({
    workspaceDir,
    perFileCharCap: 40,
    totalCharCap: 1_000,
  });

  expect(prompt).toContain('## Operating Instructions');
  expect(prompt).toContain('[... truncated]');
  expect(prompt).not.toContain(oversizedContent);
});

test('loadBootstrapContext stops loading additional files when the total cap is reached', () => {
  const workspaceDir = createWorkspaceDir();

  writeWorkspaceFile(workspaceDir, 'IDENTITY.md', 'Identity block');
  writeWorkspaceFile(workspaceDir, 'SOUL.md', 'Soul block');
  writeWorkspaceFile(workspaceDir, 'USER.md', 'User block');

  const prompt = loadBootstrapContext({
    workspaceDir,
    perFileCharCap: 1_000,
    totalCharCap: 70,
  });

  expect(prompt).toContain('## Identity');
  expect(prompt).toContain('## Persona & Tone');
  expect(prompt).not.toContain('## User Profile');
});

test('loadHeartbeatContext reads HEARTBEAT.md separately from the standard bootstrap sequence', () => {
  const workspaceDir = createWorkspaceDir();

  writeWorkspaceFile(workspaceDir, 'HEARTBEAT.md', 'Check inbox and review cron runs.');

  const heartbeatPrompt = loadHeartbeatContext({ workspaceDir, perFileCharCap: 1_000, totalCharCap: 1_000 });
  const bootstrapPrompt = loadBootstrapContext({ workspaceDir, perFileCharCap: 1_000, totalCharCap: 1_000 });

  expect(heartbeatPrompt).toContain('## Heartbeat Checklist');
  expect(heartbeatPrompt).toContain('Check inbox and review cron runs.');
  expect(bootstrapPrompt).not.toContain('Heartbeat Checklist');
});

test('initializeWorkspace creates default files when the workspace directory is missing', () => {
  const workspaceDir = path.join(createWorkspaceDir(), 'nested-workspace');

  const result = initializeWorkspace({ workspaceDir });

  expect(result.created).toBe(true);
  expect(result.filesCreated.sort()).toEqual([
    'AGENTS.md',
    'IDENTITY.md',
    'SOUL.md',
    'TOOLS.md',
    'USER.md',
  ]);
  expect(fs.existsSync(path.join(workspaceDir, 'IDENTITY.md'))).toBe(true);
});

test('initializeWorkspace creates defaults when the workspace directory exists but is empty', () => {
  const workspaceDir = createWorkspaceDir();

  const result = initializeWorkspace({ workspaceDir });

  expect(result.created).toBe(true);
  expect(fs.existsSync(path.join(workspaceDir, 'SOUL.md'))).toBe(true);
  expect(fs.existsSync(path.join(workspaceDir, 'TOOLS.md'))).toBe(true);
});

test('initializeWorkspace does not overwrite existing files', () => {
  const workspaceDir = createWorkspaceDir();

  writeWorkspaceFile(workspaceDir, 'SOUL.md', 'Existing custom persona');

  const result = initializeWorkspace({ workspaceDir });
  const soulContent = fs.readFileSync(path.join(workspaceDir, 'SOUL.md'), 'utf-8');

  expect(result.created).toBe(false);
  expect(result.filesCreated).toEqual([]);
  expect(soulContent).toBe('Existing custom persona');
});
