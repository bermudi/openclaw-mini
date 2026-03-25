/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test';
import path from 'path';
import {
  cleanupRuntimeConfigFixture,
  createRuntimeConfigFixture,
  type RuntimeConfigFixture,
} from './runtime-config-fixture';
import { browserService, resetBrowserServiceForTests } from '../src/lib/services/browser-service';
import { clearSkillCache, loadAllSkills } from '../src/lib/services/skill-service';
import { registerOptionalTools, unregisterTool } from '../src/lib/tools';

const BUILT_IN_SKILLS_DIR = path.join(process.cwd(), 'skills');

let runtimeConfigFixture: RuntimeConfigFixture | null = null;
let originalSkillsDir: string | undefined;
let originalConfigPath: string | undefined;

beforeAll(async () => {
  originalSkillsDir = process.env.OPENCLAW_SKILLS_DIR;
  originalConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-built-in-skills-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_SKILLS_DIR = BUILT_IN_SKILLS_DIR;

  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
});

beforeEach(async () => {
  process.env.OPENCLAW_SKILLS_DIR = BUILT_IN_SKILLS_DIR;
  unregisterTool('browser_action');
  resetBrowserServiceForTests();
  clearSkillCache();

  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
});

afterAll(async () => {
  unregisterTool('browser_action');
  resetBrowserServiceForTests();
  clearSkillCache();

  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();

  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }

  if (originalSkillsDir === undefined) {
    delete process.env.OPENCLAW_SKILLS_DIR;
  } else {
    process.env.OPENCLAW_SKILLS_DIR = originalSkillsDir;
  }

  if (originalConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = originalConfigPath;
  }
});

test('repository built-in skills load with expected metadata and substantive instructions', async () => {
  const availabilitySpy = spyOn(browserService, 'checkAvailability').mockResolvedValue(true);

  try {
    await registerOptionalTools();
    clearSkillCache();

    const skills = await loadAllSkills();
    const builtIns = skills
      .filter(skill => skill.source === 'built-in')
      .sort((a, b) => a.name.localeCompare(b.name));

    expect(builtIns.map(skill => skill.name)).toEqual([
      'browser',
      'coder',
      'planner',
      'researcher',
      'skill-manager',
      'vision-analyst',
    ]);

    const byName = new Map(builtIns.map(skill => [skill.name, skill]));

    expect(byName.get('browser')).toMatchObject({
      enabled: true,
      tools: ['browser_action'],
      source: 'built-in',
      overrides: {
        model: 'gpt-4.1-mini',
        maxIterations: 6,
        maxToolInvocations: 8,
      },
    });

    expect(byName.get('coder')).toMatchObject({
      enabled: true,
      tools: ['exec_command', 'send_file_to_chat', 'write_note', 'read_file'],
      source: 'built-in',
      overrides: {
        model: 'gpt-4.1',
        maxIterations: 10,
        maxToolInvocations: 12,
      },
    });

    expect(byName.get('planner')).toMatchObject({
      enabled: true,
      tools: ['spawn_subagent', 'get_datetime', 'write_note'],
      source: 'built-in',
      overrides: {
        model: 'gpt-4.1',
        maxIterations: 8,
        maxToolInvocations: 6,
        allowedSkills: ['researcher', 'vision-analyst', 'coder', 'browser'],
      },
    });

    expect(byName.get('researcher')).toMatchObject({
      enabled: true,
      tools: ['web_search', 'web_fetch', 'write_note'],
      source: 'built-in',
      overrides: {
        model: 'gpt-4.1-mini',
        maxIterations: 6,
        maxToolInvocations: 8,
      },
    });

    expect(byName.get('skill-manager')).toMatchObject({
      enabled: true,
      tools: ['read_skill_file', 'exec_command', 'write_note'],
      source: 'built-in',
      overrides: {
        model: 'gpt-4.1',
        maxIterations: 10,
        maxToolInvocations: 12,
      },
    });

    expect(byName.get('vision-analyst')).toMatchObject({
      enabled: true,
      tools: ['write_note'],
      source: 'built-in',
      overrides: {
        model: 'gpt-4.1',
        maxIterations: 4,
        maxToolInvocations: 4,
      },
    });

    for (const skill of builtIns) {
      expect(skill.instructions.trim().length).toBeGreaterThan(500);
      expect(skill.instructions).not.toContain('placeholder');
      expect(Boolean(skill.overrides && 'systemPrompt' in skill.overrides)).toBe(false);
    }
  } finally {
    availabilitySpy.mockRestore();
  }
});
