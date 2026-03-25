/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  cleanupRuntimeConfigFixture,
  createRuntimeConfigFixture,
  writeRuntimeConfig,
  type RuntimeConfigFixture,
} from './runtime-config-fixture';
import { clearSkillCache, loadAllSkills } from '../src/lib/services/skill-service';
import { getTool } from '../src/lib/tools';

const REPO_ROOT = process.cwd();
const BUILT_IN_SKILLS_DIR = path.join(REPO_ROOT, 'skills');

let runtimeConfigFixture: RuntimeConfigFixture | null = null;
let workspaceDir = '';
let originalConfigPath: string | undefined;
let originalSkillsDir: string | undefined;

function writeManagedSkill(name: string, frontmatter: string, body: string): void {
  const dir = path.join(workspaceDir, 'data', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`, 'utf-8');
}

function buildWriteSkillsCommand(skills: Array<{ name: string; content: string }>): string {
  const program = [
    'const fs = require("fs");',
    'const path = require("path");',
    `const skills = ${JSON.stringify(skills)};`,
    'for (const skill of skills) {',
    '  const dir = path.join(process.cwd(), skill.name);',
    '  fs.mkdirSync(dir, { recursive: true });',
    '  fs.writeFileSync(path.join(dir, "SKILL.md"), skill.content, "utf-8");',
    '}',
  ].join(' ');

  return `bun -e ${JSON.stringify(program)}`;
}

function buildRewriteSkillCommand(content: string): string {
  const program = [
    'const fs = require("fs");',
    `fs.writeFileSync("SKILL.md", ${JSON.stringify(content)}, "utf-8");`,
  ].join(' ');

  return `bun -e ${JSON.stringify(program)}`;
}

async function resetProviderRegistry(): Promise<void> {
  const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
}

beforeAll(async () => {
  originalConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  originalSkillsDir = process.env.OPENCLAW_SKILLS_DIR;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-runtime-skill-management-');
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;
  process.env.OPENCLAW_SKILLS_DIR = BUILT_IN_SKILLS_DIR;
  await resetProviderRegistry();
});

beforeEach(async () => {
  workspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-runtime-skills-workspace-'));
  process.chdir(workspaceDir);
  process.env.OPENCLAW_SKILLS_DIR = BUILT_IN_SKILLS_DIR;
  if (!runtimeConfigFixture) {
    throw new Error('Runtime config fixture was not initialized');
  }
  writeRuntimeConfig(runtimeConfigFixture.configPath);
  clearSkillCache();
  await resetProviderRegistry();
});

afterEach(async () => {
  const { processSupervisor } = await import('../src/lib/services/process-supervisor');
  const { resetExecRuntimeStateForTests } = await import('../src/lib/services/exec-runtime');
  processSupervisor.resetForTests();
  resetExecRuntimeStateForTests();
  clearSkillCache();
  await resetProviderRegistry();
  process.chdir(REPO_ROOT);

  if (workspaceDir && fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }

  workspaceDir = '';
});

afterAll(async () => {
  clearSkillCache();
  await resetProviderRegistry();

  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }

  if (originalConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = originalConfigPath;
  }

  if (originalSkillsDir === undefined) {
    delete process.env.OPENCLAW_SKILLS_DIR;
  } else {
    process.env.OPENCLAW_SKILLS_DIR = originalSkillsDir;
  }
});

describe('runtime skill management', () => {
  test('read_skill_file reads built-in and managed skills and enforces scope', async () => {
    writeManagedSkill(
      'runtime-helper',
      'name: runtime-helper\ndescription: Runtime helper\ntools:\n  - get_datetime',
      'Managed helper instructions.',
    );

    const readSkillFileTool = getTool('read_skill_file');
    if (!readSkillFileTool?.execute) {
      throw new Error('read_skill_file tool is not registered');
    }

    const builtInResult = await readSkillFileTool.execute(
      { source: 'built-in', skillName: 'planner' },
      { toolCallId: 'read-built-in', messages: [] },
    ) as { success: boolean; data?: { content?: string; filePath?: string } };
    expect(builtInResult.success).toBe(true);
    expect(builtInResult.data?.filePath).toBe(path.join(BUILT_IN_SKILLS_DIR, 'planner', 'SKILL.md'));
    expect(builtInResult.data?.content).toContain('You are the planner.');

    const managedResult = await readSkillFileTool.execute(
      { source: 'managed', skillName: 'runtime-helper' },
      { toolCallId: 'read-managed', messages: [] },
    ) as { success: boolean; data?: { content?: string; filePath?: string } };
    expect(managedResult.success).toBe(true);
    expect(managedResult.data?.filePath).toBe(path.join(workspaceDir, 'data', 'skills', 'runtime-helper', 'SKILL.md'));
    expect(managedResult.data?.content).toContain('Managed helper instructions.');

    const invalidSource = await readSkillFileTool.execute(
      { source: 'other', skillName: 'planner' },
      { toolCallId: 'read-invalid-source', messages: [] },
    ) as { success: boolean; error?: string };
    expect(invalidSource.success).toBe(false);
    expect(invalidSource.error).toContain('Invalid skill source');

    const missingSkill = await readSkillFileTool.execute(
      { source: 'managed', skillName: 'missing-skill' },
      { toolCallId: 'read-missing-skill', messages: [] },
    ) as { success: boolean; error?: string };
    expect(missingSkill.success).toBe(false);
    expect(missingSkill.error).toContain('Skill file not found');

    const traversalAttempt = await readSkillFileTool.execute(
      { source: 'managed', skillName: '../planner' },
      { toolCallId: 'read-traversal', messages: [] },
    ) as { success: boolean; error?: string };
    expect(traversalAttempt.success).toBe(false);
    expect(traversalAttempt.error).toContain('allowed skill directories');
  });

  test('read_skill_file trims user input while still rejecting invalid names', async () => {
    writeManagedSkill(
      'trimmed-helper',
      'name: trimmed-helper\ndescription: Trimmed helper',
      'Trimmed helper instructions.',
    );

    const readSkillFileTool = getTool('read_skill_file');
    if (!readSkillFileTool?.execute) {
      throw new Error('read_skill_file tool is not registered');
    }

    const builtInTrimmed = await readSkillFileTool.execute(
      { source: '  BUILT-IN  ', skillName: ' planner ' },
      { toolCallId: 'read-trimmed-built-in', messages: [] },
    ) as { success: boolean; data?: { content?: string } };
    expect(builtInTrimmed.success).toBe(true);
    expect(builtInTrimmed.data?.content).toContain('You are the planner.');

    const managedTrimmed = await readSkillFileTool.execute(
      { source: '  managed  ', skillName: ' trimmed-helper ' },
      { toolCallId: 'read-trimmed-managed', messages: [] },
    ) as { success: boolean; data?: { content?: string; filePath?: string } };
    expect(managedTrimmed.success).toBe(true);
    expect(managedTrimmed.data?.filePath).toBe(path.join(workspaceDir, 'data', 'skills', 'trimmed-helper', 'SKILL.md'));
    expect(managedTrimmed.data?.content).toContain('Trimmed helper instructions.');

    const emptyName = await readSkillFileTool.execute(
      { source: 'managed', skillName: '   ' },
      { toolCallId: 'read-empty-name', messages: [] },
    ) as { success: boolean; error?: string };
    expect(emptyName.success).toBe(false);
    expect(emptyName.error).toContain('Invalid skill name');
  });

  test('loadAllSkills recovers cleanly after the managed skills directory is removed', async () => {
    writeManagedSkill(
      'ephemeral-helper',
      'name: ephemeral-helper\ndescription: Ephemeral helper',
      'Ephemeral helper instructions.',
    );

    let skills = await loadAllSkills();
    expect(skills.some(skill => skill.name === 'ephemeral-helper')).toBe(true);

    fs.rmSync(path.join(workspaceDir, 'data', 'skills'), { recursive: true, force: true });
    clearSkillCache();

    skills = await loadAllSkills();
    expect(skills.some(skill => skill.name === 'ephemeral-helper')).toBe(false);
    expect(skills.some(skill => skill.source === 'built-in')).toBe(true);
  });

  test('exec_command can create managed skills under approved mounts and built-ins still win collisions', async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture was not initialized');
    }

    writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        exec: {
          enabled: true,
          defaultTier: 'host',
          maxTier: 'host',
          allowlist: ['bun'],
          mounts: [
            {
              alias: 'skills',
              hostPath: path.join(workspaceDir, 'data', 'skills'),
              permissions: 'read-write',
              createIfMissing: true,
            },
          ],
        },
      },
    });
    await resetProviderRegistry();
    clearSkillCache();

    const execTool = getTool('exec_command');
    if (!execTool?.execute) {
      throw new Error('exec_command tool is not registered');
    }

    const runtimeHelperContent = [
      '---',
      'name: runtime-helper',
      'description: Runtime helper',
      'tools:',
      '  - get_datetime',
      '---',
      '',
      'First draft managed instructions.',
      '',
    ].join('\n');
    const collidingPlannerContent = [
      '---',
      'name: planner',
      'description: Managed planner override attempt',
      '---',
      '',
      'This managed planner should be rejected.',
      '',
    ].join('\n');

    const createResult = await execTool.execute(
      {
        agentId: 'runtime-skill-manager-agent',
        tier: 'host',
        commandMode: 'shell',
        cwd: 'mount:skills',
        command: buildWriteSkillsCommand([
          { name: 'runtime-helper', content: runtimeHelperContent },
          { name: 'planner', content: collidingPlannerContent },
        ]),
      },
      { toolCallId: 'create-managed-skills', messages: [] },
    ) as { success: boolean; error?: string };

    expect(createResult.success).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, 'data', 'skills', 'runtime-helper', 'SKILL.md'))).toBe(true);

    clearSkillCache();
    const skills = await loadAllSkills();

    const runtimeHelper = skills.find(skill => skill.name === 'runtime-helper');
    expect(runtimeHelper).toMatchObject({
      source: 'managed',
      description: 'Runtime helper',
      instructions: 'First draft managed instructions.',
    });

    const planners = skills.filter(skill => skill.name.toLowerCase() === 'planner');
    expect(planners).toHaveLength(1);
    expect(planners[0]?.source).toBe('built-in');
    expect(planners[0]?.instructions).toContain('You are the planner.');
  });

  test('skill-manager guidance supports safe inspect and refine loops for managed skills', async () => {
    if (!runtimeConfigFixture) {
      throw new Error('Runtime config fixture was not initialized');
    }

    writeRuntimeConfig(runtimeConfigFixture.configPath, {
      runtime: {
        exec: {
          enabled: true,
          defaultTier: 'host',
          maxTier: 'host',
          allowlist: ['bun'],
          mounts: [
            {
              alias: 'skills',
              hostPath: path.join(workspaceDir, 'data', 'skills'),
              permissions: 'read-write',
              createIfMissing: true,
            },
          ],
        },
      },
    });
    await resetProviderRegistry();
    clearSkillCache();

    const skills = await loadAllSkills();
    const skillManager = skills.find(skill => skill.name === 'skill-manager');
    expect(skillManager).toMatchObject({
      source: 'built-in',
      tools: ['read_skill_file', 'exec_command', 'write_note'],
    });
    expect(skillManager?.instructions).toContain('draft -> test -> evaluate -> refine');
    expect(skillManager?.instructions).toContain('Only create or edit files under `data/skills/<name>/`.');
    expect(skillManager?.instructions).toContain('Never modify built-in skills under `skills/`.');

    const execTool = getTool('exec_command');
    const readSkillFileTool = getTool('read_skill_file');
    if (!execTool?.execute || !readSkillFileTool?.execute) {
      throw new Error('Expected runtime skill management tools are not registered');
    }

    const draftContent = [
      '---',
      'name: refiner',
      'description: Refiner test skill',
      '---',
      '',
      'Draft instructions.',
      '',
    ].join('\n');
    const refinedContent = [
      '---',
      'name: refiner',
      'description: Refiner test skill',
      'tools:',
      '  - get_datetime',
      '---',
      '',
      'Refined instructions after evaluation.',
      '',
    ].join('\n');

    const createResult = await execTool.execute(
      {
        agentId: 'runtime-skill-manager-agent',
        tier: 'host',
        commandMode: 'shell',
        cwd: 'mount:skills',
        command: buildWriteSkillsCommand([{ name: 'refiner', content: draftContent }]),
      },
      { toolCallId: 'create-refiner', messages: [] },
    ) as { success: boolean; error?: string };
    expect(createResult.success).toBe(true);

    const firstRead = await readSkillFileTool.execute(
      { source: 'managed', skillName: 'refiner' },
      { toolCallId: 'read-refiner-draft', messages: [] },
    ) as { success: boolean; data?: { content?: string } };
    expect(firstRead.success).toBe(true);
    expect(firstRead.data?.content).toContain('Draft instructions.');

    const refineResult = await execTool.execute(
      {
        agentId: 'runtime-skill-manager-agent',
        tier: 'host',
        commandMode: 'shell',
        cwd: 'mount:skills/refiner',
        command: buildRewriteSkillCommand(refinedContent),
      },
      { toolCallId: 'refine-refiner', messages: [] },
    ) as { success: boolean; error?: string };
    expect(refineResult.success).toBe(true);

    const secondRead = await readSkillFileTool.execute(
      { source: 'managed', skillName: 'refiner' },
      { toolCallId: 'read-refiner-refined', messages: [] },
    ) as { success: boolean; data?: { content?: string } };
    expect(secondRead.success).toBe(true);
    expect(secondRead.data?.content).toContain('Refined instructions after evaluation.');
    expect(secondRead.data?.content).toContain('tools:');
    expect(secondRead.data?.content).not.toContain('Draft instructions.');
  });
});
