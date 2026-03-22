import { z } from 'zod';
import { resolveModelConfig } from '@/lib/services/model-provider';
import { getRuntimeConfig } from '@/lib/config/runtime';

export const SUB_AGENT_OVERRIDE_FIELDS = [
  'model',
  'provider',
  'credentialRef',
  'systemPrompt',
  'maxIterations',
  'allowedSkills',
  'allowedTools',
  'maxToolInvocations',
] as const;

export type SubAgentOverrideField = typeof SUB_AGENT_OVERRIDE_FIELDS[number];

export interface SubAgentOverrides {
  model?: string;
  provider?: string;
  credentialRef?: string;
  systemPrompt?: string;
  maxIterations?: number;
  allowedSkills?: string[];
  allowedTools?: string[];
  maxToolInvocations?: number;
}

export interface SubAgentBaseConfig {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  agentSkills?: string[];
  defaultSystemPrompt: string;
  defaultToolNames?: string[];
  defaultMaxIterations?: number;
  defaultMaxToolInvocations?: number;
}

export interface ResolvedSubAgentConfig {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  credentialRef?: string;
  systemPrompt: string;
  maxIterations: number;
  allowedSkills?: string[];
  allowedTools?: string[];
  maxToolInvocations?: number;
  overrideFieldsApplied: SubAgentOverrideField[];
}

export interface SubAgentOverrideSchemaOptions {
  knownSkillNames: string[];
  knownToolNames: string[];
  knownProviderNames: string[];
}


function normalizeNames(values?: string[]): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const normalized = values
    .map(value => value.trim())
    .filter(value => value.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function buildKnownNameSet(values: string[]): Set<string> {
  return new Set(values.map(value => value.toLowerCase()));
}

export function createSubAgentOverridesSchema(
  options: SubAgentOverrideSchemaOptions,
): z.ZodType<SubAgentOverrides> {
  const knownSkillNames = buildKnownNameSet(options.knownSkillNames);
  const knownToolNames = buildKnownNameSet(options.knownToolNames);
  const knownProviders = buildKnownNameSet(options.knownProviderNames);

  return z.object({
    model: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1).optional(),
    credentialRef: z.string().trim().min(1).optional(),
    systemPrompt: z.string().trim().min(1).optional(),
    maxIterations: z.number().int().positive().optional(),
    allowedSkills: z.array(z.string().trim().min(1)).min(1).optional(),
    allowedTools: z.array(z.string().trim().min(1)).min(1).optional(),
    maxToolInvocations: z.number().int().positive().optional(),
  }).superRefine((value, context) => {
    const hasAnyField = SUB_AGENT_OVERRIDE_FIELDS.some(field => value[field] !== undefined);

    if (!hasAnyField) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one override field is required',
        path: [],
      });
    }

    if (value.provider && !knownProviders.has(value.provider.toLowerCase())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unsupported provider '${value.provider}'`,
        path: ['provider'],
      });
    }

    for (const [index, skillName] of (value.allowedSkills ?? []).entries()) {
      if (!knownSkillNames.has(skillName.toLowerCase())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown skill '${skillName}'`,
          path: ['allowedSkills', index],
        });
      }
    }

    for (const [index, toolName] of (value.allowedTools ?? []).entries()) {
      if (!knownToolNames.has(toolName.toLowerCase())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown tool '${toolName}'`,
          path: ['allowedTools', index],
        });
      }
    }
  }).transform(value => ({
    ...value,
    provider: value.provider,
    allowedSkills: normalizeNames(value.allowedSkills),
    allowedTools: normalizeNames(value.allowedTools),
  }));
}

export function formatSubAgentOverrideIssues(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    if (!issue.path || issue.path.length === 0) {
      return issue.message;
    }

    return `${issue.path.join('.')}: ${issue.message}`;
  });
}

export function getOverrideFieldsApplied(overrides?: SubAgentOverrides): SubAgentOverrideField[] {
  if (!overrides) {
    return [];
  }

  return SUB_AGENT_OVERRIDE_FIELDS.filter(field => overrides[field] !== undefined);
}

export function resolveSubAgentConfig(input: {
  baseConfig: SubAgentBaseConfig;
  overrides?: SubAgentOverrides;
}): ResolvedSubAgentConfig {
  const { baseConfig, overrides } = input;
  const provider = overrides?.provider ?? baseConfig.provider;
  const providerChanged = provider !== baseConfig.provider;
  const resolvedModelConfig = resolveModelConfig({
    provider,
    model: overrides?.model ?? baseConfig.model,
    credentialRef: overrides?.credentialRef,
    baseURL: providerChanged ? undefined : baseConfig.baseURL,
    apiKey: providerChanged || overrides?.credentialRef ? undefined : baseConfig.apiKey,
  });

  const resolved: ResolvedSubAgentConfig = {
    provider: resolvedModelConfig.provider,
    model: resolvedModelConfig.model,
    baseURL: resolvedModelConfig.baseURL,
    apiKey: resolvedModelConfig.apiKey,
    credentialRef: resolvedModelConfig.credentialRef,
    systemPrompt: baseConfig.defaultSystemPrompt,
    maxIterations: baseConfig.defaultMaxIterations ?? getRuntimeConfig().safety.maxIterations,
    allowedSkills: normalizeNames(baseConfig.agentSkills),
    allowedTools: normalizeNames(baseConfig.defaultToolNames),
    maxToolInvocations: baseConfig.defaultMaxToolInvocations,
    overrideFieldsApplied: getOverrideFieldsApplied(overrides),
  };

  if (!overrides) {
    return resolved;
  }

  if (overrides.systemPrompt) {
    resolved.systemPrompt = overrides.systemPrompt;
  }

  if (overrides.maxIterations) {
    resolved.maxIterations = overrides.maxIterations;
  }

  if (overrides.allowedSkills) {
    resolved.allowedSkills = overrides.allowedSkills;
  }

  if (overrides.allowedTools) {
    resolved.allowedTools = overrides.allowedTools;
  }

  if (overrides.maxToolInvocations) {
    resolved.maxToolInvocations = overrides.maxToolInvocations;
  }

  return resolved;
}
