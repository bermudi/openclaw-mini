// OpenClaw Agent Runtime - Skill Service
// Load SKILL.md files and provide skill metadata

import fs from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import matter from 'gray-matter';
import {
  type SubAgentOverrides,
  createSubAgentOverridesSchema,
  formatSubAgentOverrideIssues,
} from '@/lib/subagent-config';
import { initializeProviderRegistry, providerRegistry } from '@/lib/services/provider-registry';

const SKILLS_DIR = path.join(process.cwd(), 'skills');
const DEFAULT_CACHE_TTL_MS = 60_000;
const execFileAsync = promisify(execFile);
const binaryCache = new Map<string, boolean>();

export const SKILL_CACHE_TTL_MS = DEFAULT_CACHE_TTL_MS;

export interface SkillRequirements {
  binaries?: string[];
  env?: string[];
  platform?: string[];
}

export interface SkillMetadata {
  name: string;
  description: string;
  tools?: string[];
  overrides?: SubAgentOverrides;
  overrideErrors?: string[];
  requires?: SkillRequirements;
  enabled: boolean;
  gatingReason?: string;
  source: string;
}

export interface LoadedSkill extends SkillMetadata {
  instructions: string;
}

export interface SkillLookupResult {
  skill?: LoadedSkill;
  error?: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  enabled: boolean;
  gatingReason?: string;
  source: string;
}

interface SkillCache {
  loadedAt: number;
  skills: Map<string, LoadedSkill>;
}

interface UnvalidatedLoadedSkill extends LoadedSkill {
  rawOverrides?: unknown;
}

const cache: SkillCache = {
  loadedAt: 0,
  skills: new Map(),
};

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return filtered.length > 0 ? filtered : undefined;
}

async function resolveGatingReason(requires?: SkillRequirements): Promise<string | undefined> {
  if (!requires) return undefined;

  if (requires.binaries) {
    for (const binary of requires.binaries) {
      if (!await isBinaryAvailable(binary)) {
        return `missing binary: ${binary}`;
      }
    }
  }

  if (requires.env) {
    for (const envKey of requires.env) {
      if (!process.env[envKey]) {
        return `missing env: ${envKey}`;
      }
    }
  }

  if (requires.platform && requires.platform.length > 0) {
    if (!requires.platform.includes(process.platform)) {
      return `unsupported platform: ${process.platform} (requires: ${requires.platform.join(', ')})`;
    }
  }

  return undefined;
}

async function isBinaryAvailable(binary: string): Promise<boolean> {
  const cached = binaryCache.get(binary);
  if (cached !== undefined) {
    return cached;
  }

  const command = process.platform === 'win32' ? 'where' : 'which';

  try {
    await execFileAsync(command, [binary], { windowsHide: true });
    binaryCache.set(binary, true);
    return true;
  } catch {
    binaryCache.set(binary, false);
    return false;
  }
}

function shouldUseCache(): boolean {
  if (!cache.loadedAt) return false;
  return Date.now() - cache.loadedAt < DEFAULT_CACHE_TTL_MS;
}

function saveCache(skills: Map<string, LoadedSkill>): void {
  cache.skills = skills;
  cache.loadedAt = Date.now();
}

function mergeGatingReason(existing: string | undefined, next: string): string {
  if (!existing) {
    return next;
  }

  return `${existing}; ${next}`;
}

async function readSkillFile(skillPath: string): Promise<UnvalidatedLoadedSkill | null> {
  const raw = await fs.promises.readFile(skillPath, 'utf-8');
  const parsed = matter(raw);

  const data = parsed.data as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';

  if (!name || !description) {
    console.warn(`Skipping skill at ${skillPath} (missing name or description)`);
    return null;
  }

  const requires: SkillRequirements | undefined = data.requires != null && typeof data.requires === 'object'
    ? {
        binaries: normalizeStringArray((data.requires as SkillRequirements).binaries),
        env: normalizeStringArray((data.requires as SkillRequirements).env),
        platform: normalizeStringArray((data.requires as SkillRequirements).platform),
      }
    : undefined;

  const tools = normalizeStringArray(data.tools);
  const gatingReason = await resolveGatingReason(requires);

  return {
    name,
    description,
    tools,
    rawOverrides: data.overrides,
    requires,
    enabled: !gatingReason,
    gatingReason,
    source: skillPath,
    instructions: parsed.content.trim(),
  };
}

export async function loadAllSkills(): Promise<LoadedSkill[]> {
  if (shouldUseCache()) {
    return Array.from(cache.skills.values());
  }

  const skills = new Map<string, UnvalidatedLoadedSkill>();

  if (!fs.existsSync(SKILLS_DIR)) {
    console.info(`Skills directory not found at ${SKILLS_DIR}. No skills loaded.`);
    saveCache(skills);
    return [];
  }

  const entries = await fs.promises.readdir(SKILLS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      continue;
    }

    try {
      const skill = await readSkillFile(skillPath);
      if (skill) {
        if (skills.has(skill.name)) {
          const existing = skills.get(skill.name);
          console.warn(
            `Duplicate skill name '${skill.name}' from ${skillPath}. Existing source: ${existing?.source ?? 'unknown'}`,
          );
        } else {
          skills.set(skill.name, skill);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load skill at ${skillPath}: ${message}`);
    }
  }

  const { getAvailableToolNames } = await import('@/lib/tools');
  initializeProviderRegistry();
  const overrideSchema = createSubAgentOverridesSchema({
    knownSkillNames: Array.from(skills.values()).map(skill => skill.name),
    knownToolNames: getAvailableToolNames(),
    knownProviderNames: providerRegistry.list().map(provider => provider.id),
  });

  for (const skill of skills.values()) {
    if (skill.rawOverrides === undefined) {
      continue;
    }

    const overrideResult = overrideSchema.safeParse(skill.rawOverrides);
    if (!overrideResult.success) {
      const overrideErrors = formatSubAgentOverrideIssues(overrideResult.error.issues);
      skill.overrideErrors = overrideErrors;
      skill.enabled = false;
      skill.gatingReason = mergeGatingReason(
        skill.gatingReason,
        `invalid overrides: ${overrideErrors.join('; ')}`,
      );
      console.warn(
        `Invalid overrides for skill '${skill.name}' at ${skill.source}: ${overrideErrors.join('; ')}`,
      );
      continue;
    }

    skill.overrides = overrideResult.data;
  }

  const validatedSkills = new Map<string, LoadedSkill>();
  for (const [name, skill] of skills.entries()) {
    const { rawOverrides: _rawOverrides, ...validatedSkill } = skill;
    validatedSkills.set(name, validatedSkill);
  }

  saveCache(validatedSkills);
  return Array.from(validatedSkills.values());
}

export async function getSkillSummaries(agentSkillNames: string[]): Promise<SkillSummary[]> {
  const skills = await loadAllSkills();
  const allowed = agentSkillNames.map((skill) => skill.toLowerCase());

  return skills
    .filter((skill) => {
      if (!skill.enabled) return false;
      if (allowed.length === 0) return true;
      return allowed.includes(skill.name.toLowerCase());
    })
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      enabled: skill.enabled,
      gatingReason: skill.gatingReason,
      source: skill.source,
    }));
}

export async function getSkillForSubAgent(skillName: string): Promise<SkillLookupResult> {
  const skills = await loadAllSkills();
  const matched = skills.find((skill) => skill.name.toLowerCase() === skillName.toLowerCase());

  if (!matched) {
    return { error: `Skill '${skillName}' not found` };
  }

  if (!matched.enabled) {
    return {
      error: `Skill '${matched.name}' is disabled${matched.gatingReason ? `: ${matched.gatingReason}` : ''}`,
    };
  }

  return { skill: matched };
}

export function clearSkillCache(): void {
  cache.skills = new Map();
  cache.loadedAt = 0;
}
