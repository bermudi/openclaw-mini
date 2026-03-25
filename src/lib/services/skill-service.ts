// OpenClaw Agent Runtime - Skill Service
// Skill loading is an explicit pipeline:
//   Discover -> Merge -> Validate -> Cache
// Discover finds raw skill definitions from each source, merge resolves
// case-insensitive name collisions using precedence, validate applies gating
// and override-schema checks, and cache stores only validated results.
//
// Public provenance is intentionally stable: `source` reports only
// `'built-in' | 'managed'`. Internal diagnostics retain `sourcePath` so merge
// and validation warnings can still point to the exact SKILL.md file.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type SkillLoader,
  type SkillRequirements,
  type SkillSource,
  type UnvalidatedSkill,
  SKILL_PRECEDENCE_BUILTIN,
  SKILL_PRECEDENCE_MANAGED,
  createBuiltInSkillLoader,
  createManagedSkillLoader,
} from './skill-loaders';
import {
  type SubAgentOverrides,
  createSubAgentOverridesSchema,
  formatSubAgentOverrideIssues,
} from '@/lib/subagent-config';
import { ensureProviderRegistryInitialized, providerRegistry } from '@/lib/services/provider-registry';

const DEFAULT_CACHE_TTL_MS = 60_000;
const execFileAsync = promisify(execFile);
const binaryAvailabilityCache = new Map<string, boolean>();

export const SKILL_CACHE_TTL_MS = DEFAULT_CACHE_TTL_MS;
export {
  SKILL_PRECEDENCE_BUILTIN,
  SKILL_PRECEDENCE_MANAGED,
};
export type {
  SkillLoader,
  SkillRequirements,
  SkillSource,
  UnvalidatedSkill,
};

export interface SkillMetadata {
  name: string;
  description: string;
  tools?: string[];
  overrides?: SubAgentOverrides;
  overrideErrors?: string[];
  requires?: SkillRequirements;
  enabled: boolean;
  gatingReason?: string;
  source: SkillSource;
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
  source: SkillSource;
}

interface SkillCache {
  loadedAt: number;
  skills: Map<string, LoadedSkill>;
}

const cache: SkillCache = {
  loadedAt: 0,
  skills: new Map(),
};

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

async function isBinaryAvailable(binary: string): Promise<boolean> {
  const cached = binaryAvailabilityCache.get(binary);
  if (cached !== undefined) {
    return cached;
  }

  const command = process.platform === 'win32' ? 'where' : 'which';

  try {
    await execFileAsync(command, [binary], { windowsHide: true });
    binaryAvailabilityCache.set(binary, true);
    return true;
  } catch {
    binaryAvailabilityCache.set(binary, false);
    return false;
  }
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

async function discoverSkills(loaders: SkillLoader[]): Promise<UnvalidatedSkill[]> {
  const discovered: UnvalidatedSkill[] = [];

  for (const loader of loaders) {
    try {
      const skills = await loader.load();
      discovered.push(...skills);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to discover skills from loader '${loader.name}': ${message}`);
    }
  }

  return discovered;
}

function mergeSkills(skills: UnvalidatedSkill[]): UnvalidatedSkill[] {
  const merged = new Map<string, UnvalidatedSkill>();

  for (const skill of skills) {
    const logicalName = skill.name.toLowerCase();
    const existing = merged.get(logicalName);

    if (!existing) {
      merged.set(logicalName, skill);
      continue;
    }

    if (skill.precedence < existing.precedence) {
      console.warn(
        `Replacing ${existing.source} skill '${existing.name}' from ${existing.sourcePath} with ` +
          `${skill.source} skill '${skill.name}' from ${skill.sourcePath} due to higher precedence.`,
      );
      merged.set(logicalName, skill);
      continue;
    }

    if (skill.precedence > existing.precedence) {
      console.warn(
        `Rejected ${skill.source} skill '${skill.name}' from ${skill.sourcePath} because it collides with ` +
          `${existing.source} skill '${existing.name}' from ${existing.sourcePath}.`,
      );
      continue;
    }

    console.warn(
      `Rejected duplicate ${skill.source} skill '${skill.name}' from ${skill.sourcePath}; ` +
        `existing ${existing.source} skill '${existing.name}' from ${existing.sourcePath} already owns that name.`,
    );
  }

  return Array.from(merged.values());
}

async function validateSkills(skills: UnvalidatedSkill[]): Promise<Map<string, LoadedSkill>> {
  const validatedSkills = new Map<string, LoadedSkill>();

  const { getAvailableToolNames } = await import('@/lib/tools');
  ensureProviderRegistryInitialized();
  const overrideSchema = createSubAgentOverridesSchema({
    knownSkillNames: skills.map(skill => skill.name),
    knownToolNames: getAvailableToolNames(),
    knownProviderNames: providerRegistry.list().map(provider => provider.id),
  });

  for (const skill of skills) {
    const gatingReason = await resolveGatingReason(skill.requires);
    let enabled = !gatingReason;
    let mergedGatingReason = gatingReason;
    let overrides: SubAgentOverrides | undefined;
    let overrideErrors: string[] | undefined;

    if (skill.rawOverrides !== undefined) {
      const overrideResult = overrideSchema.safeParse(skill.rawOverrides);
      if (!overrideResult.success) {
        overrideErrors = formatSubAgentOverrideIssues(overrideResult.error.issues);
        enabled = false;
        mergedGatingReason = mergeGatingReason(
          mergedGatingReason,
          `invalid overrides: ${overrideErrors.join('; ')}`,
        );
        console.warn(
          `Invalid overrides for skill '${skill.name}' at ${skill.sourcePath}: ${overrideErrors.join('; ')}`,
        );
      } else {
        overrides = overrideResult.data;
      }
    }

    validatedSkills.set(skill.name, {
      name: skill.name,
      description: skill.description,
      tools: skill.tools,
      overrides,
      overrideErrors,
      requires: skill.requires,
      enabled,
      gatingReason: mergedGatingReason,
      source: skill.source,
      instructions: skill.instructions,
    });
  }

  return validatedSkills;
}

function getDefaultLoaders(): SkillLoader[] {
  return [
    // Lower precedence values win. Built-ins remain protected from managed
    // overrides, while managed skills still contribute unique names.
    createBuiltInSkillLoader(),
    createManagedSkillLoader(),
  ];
}

export async function loadAllSkills(): Promise<LoadedSkill[]> {
  if (shouldUseCache()) {
    return Array.from(cache.skills.values());
  }

  const discoveredSkills = await discoverSkills(getDefaultLoaders());
  const mergedSkills = mergeSkills(discoveredSkills);
  const validatedSkills = await validateSkills(mergedSkills);

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
  binaryAvailabilityCache.clear();
}
