// OpenClaw Agent Runtime - Skill Loaders
// Discover-stage helpers for finding SKILL.md files and parsing them into
// unvalidated skill records. Validation (gating + override schema checks)
// happens later in the skill-service pipeline.

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { getPathsConfig } from '@/lib/config/runtime';

export type SkillSource = 'built-in' | 'managed';

export const SKILL_PRECEDENCE_BUILTIN = 10;
export const SKILL_PRECEDENCE_MANAGED = 20;

export interface SkillRequirements {
  binaries?: string[];
  env?: string[];
  platform?: string[];
}

export interface UnvalidatedSkill {
  name: string;
  description: string;
  tools?: string[];
  rawOverrides?: unknown;
  requires?: SkillRequirements;
  instructions: string;
  source: SkillSource;
  sourcePath: string;
  precedence: number;
}

export interface SkillLoader {
  name: string;
  source: SkillSource;
  precedence: number;
  load(): Promise<UnvalidatedSkill[]>;
}

interface ParsedSkillFile {
  name: string;
  description: string;
  tools?: string[];
  rawOverrides?: unknown;
  requires?: SkillRequirements;
  instructions: string;
}

interface FilesystemSkillLoaderOptions {
  name: string;
  dirPath: string;
  source: SkillSource;
  precedence: number;
  logMissingDirectory?: boolean;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return filtered.length > 0 ? filtered : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parseSkillRequirements(value: unknown): SkillRequirements | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const requirements: SkillRequirements = {
    binaries: normalizeStringArray(value.binaries),
    env: normalizeStringArray(value.env),
    platform: normalizeStringArray(value.platform),
  };

  if (!requirements.binaries && !requirements.env && !requirements.platform) {
    return undefined;
  }

  return requirements;
}

export function getBuiltInSkillsDir(): string {
  return getPathsConfig().skillsDir;
}

export function getManagedSkillsDir(): string {
  return path.join(process.cwd(), 'data', 'skills');
}

export async function parseSkillFile(skillPath: string): Promise<ParsedSkillFile | null> {
  const raw = await fs.promises.readFile(skillPath, 'utf-8');
  const parsed = matter(raw);

  const data = parsed.data as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';

  if (!name || !description) {
    console.warn(`Skipping skill at ${skillPath} (missing name or description)`);
    return null;
  }

  return {
    name,
    description,
    tools: normalizeStringArray(data.tools),
    rawOverrides: data.overrides,
    requires: parseSkillRequirements(data.requires),
    instructions: parsed.content.trim(),
  };
}

export function createFilesystemSkillLoader(options: FilesystemSkillLoaderOptions): SkillLoader {
  const { name, dirPath, source, precedence, logMissingDirectory = false } = options;

  return {
    name,
    source,
    precedence,
    async load(): Promise<UnvalidatedSkill[]> {
      if (!fs.existsSync(dirPath)) {
        if (logMissingDirectory) {
          console.info(`Skills directory not found at ${dirPath}. No skills loaded.`);
        }
        return [];
      }

      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const directories = entries
        .filter(entry => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));

      const skills: UnvalidatedSkill[] = [];

      for (const entry of directories) {
        const skillPath = path.join(dirPath, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) {
          continue;
        }

        try {
          const parsed = await parseSkillFile(skillPath);
          if (!parsed) {
            continue;
          }

          skills.push({
            ...parsed,
            source,
            sourcePath: skillPath,
            precedence,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Failed to load skill at ${skillPath}: ${message}`);
        }
      }

      return skills;
    },
  };
}

export function createBuiltInSkillLoader(): SkillLoader {
  return createFilesystemSkillLoader({
    name: 'built-in-filesystem',
    dirPath: getBuiltInSkillsDir(),
    source: 'built-in',
    precedence: SKILL_PRECEDENCE_BUILTIN,
    logMissingDirectory: true,
  });
}

export function createManagedSkillLoader(): SkillLoader {
  return createFilesystemSkillLoader({
    name: 'managed-filesystem',
    dirPath: getManagedSkillsDir(),
    source: 'managed',
    precedence: SKILL_PRECEDENCE_MANAGED,
  });
}
