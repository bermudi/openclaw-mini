import { z } from 'zod';

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4.1': 1047576,
  'gpt-4.1-mini': 1047576,
  'gpt-4.1-nano': 1047576,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  'claude-3-7-sonnet-latest': 200000,
  'claude-3-5-sonnet-latest': 200000,
  'claude-3-5-haiku-latest': 200000,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONTEXT_WINDOW_SIZE = 128000;
const POE_MODELS_URL = 'https://api.poe.com/v1/models';

const RawPoeModelSchema = z.object({
  id: z.string().min(1),
  architecture: z.object({
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()).optional(),
  }).passthrough().optional(),
  supported_features: z.array(z.string()).optional(),
  reasoning: z.unknown().optional(),
  context_window: z.object({
    context_length: z.number().int().positive().optional(),
  }).passthrough().optional(),
}).passthrough();

const RawPoeModelsResponseSchema = z.object({
  data: z.array(RawPoeModelSchema),
}).passthrough();

export type ModelCapability = 'vision' | 'reasoning' | 'web-search' | 'tools';

export interface ModelFilters {
  capabilities?: ModelCapability[];
}

export interface CatalogModel {
  id: string;
  contextWindowSize?: number;
  inputModalities: string[];
  outputModalities: string[];
  supportedFeatures: string[];
  reasoning: unknown;
}

export interface ModelCatalogData {
  models: CatalogModel[];
  fetchedAt: number;
}

export interface ModelCatalogOptions {
  ttlMs?: number;
  fetchImpl?: typeof fetch;
}

function normalizeEntries(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  return values.map(value => value.trim().toLowerCase()).filter(value => value.length > 0);
}

function extractVersionScore(modelId: string): number {
  const matches = Array.from(modelId.toLowerCase().matchAll(/(\d+(?:\.\d+)?)/g));

  if (matches.length === 0) {
    return 0;
  }

  const versionText = matches[matches.length - 1]?.[1] ?? '0';
  const version = Number.parseFloat(versionText);
  return Number.isFinite(version) ? version : 0;
}

function compareModelsByRecency(left: CatalogModel, right: CatalogModel): number {
  const versionDelta = extractVersionScore(right.id) - extractVersionScore(left.id);
  if (versionDelta !== 0) {
    return versionDelta;
  }

  return right.id.localeCompare(left.id);
}

function modelSupportsCapability(model: CatalogModel, capability: ModelCapability): boolean {
  switch (capability) {
    case 'vision':
      return model.inputModalities.includes('image');
    case 'reasoning':
      return model.supportedFeatures.includes('extended_thinking') || model.reasoning != null;
    case 'web-search':
      return model.supportedFeatures.includes('web_search');
    case 'tools':
      return model.supportedFeatures.includes('tools');
  }
}

function mapCatalogModel(rawModel: z.infer<typeof RawPoeModelSchema>): CatalogModel {
  return {
    id: rawModel.id,
    contextWindowSize: rawModel.context_window?.context_length,
    inputModalities: normalizeEntries(rawModel.architecture?.input_modalities),
    outputModalities: normalizeEntries(rawModel.architecture?.output_modalities),
    supportedFeatures: normalizeEntries(rawModel.supported_features),
    reasoning: rawModel.reasoning,
  };
}

export class ModelCatalog {
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;
  private cache?: ModelCatalogData;
  private cacheExpiresAt = 0;
  private inflightRefresh?: Promise<ModelCatalogData>;

  constructor(options: ModelCatalogOptions = {}) {
    this.ttlMs = options.ttlMs ?? ONE_DAY_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private hasFreshCache(): boolean {
    return !!this.cache && Date.now() < this.cacheExpiresAt;
  }

  private setCache(data: ModelCatalogData): ModelCatalogData {
    this.cache = data;
    this.cacheExpiresAt = data.fetchedAt + this.ttlMs;
    return data;
  }

  async fetch(): Promise<ModelCatalogData> {
    const response = await this.fetchImpl(POE_MODELS_URL, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Poe model catalog: HTTP ${response.status}`);
    }

    const json = await response.json();
    const payload = RawPoeModelsResponseSchema.parse(json);

    return {
      models: payload.data.map(mapCatalogModel),
      fetchedAt: Date.now(),
    };
  }

  async refresh(force: boolean = false): Promise<ModelCatalogData> {
    if (!force && this.hasFreshCache() && this.cache) {
      return this.cache;
    }

    if (force) {
      this.cache = undefined;
      this.cacheExpiresAt = 0;
    }

    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }

    const staleCache = this.cache;

    this.inflightRefresh = this.fetch()
      .then(data => this.setCache(data))
      .catch((error: unknown) => {
        if (staleCache) {
          return staleCache;
        }

        throw error;
      })
      .finally(() => {
        this.inflightRefresh = undefined;
      });

    return this.inflightRefresh;
  }

  getModels(filters?: ModelFilters): CatalogModel[] {
    const models = [...(this.cache?.models ?? [])];
    const capabilities = filters?.capabilities ?? [];

    if (capabilities.length === 0) {
      return models.sort(compareModelsByRecency);
    }

    return models
      .filter(model => capabilities.every(capability => modelSupportsCapability(model, capability)))
      .sort(compareModelsByRecency);
  }

  getContextWindowSize(modelId: string): number {
    const catalogValue = this.cache?.models.find(model => model.id === modelId)?.contextWindowSize;

    if (catalogValue && catalogValue > 0) {
      return catalogValue;
    }

    return MODEL_CONTEXT_WINDOWS[modelId] ?? DEFAULT_CONTEXT_WINDOW_SIZE;
  }
}

export const modelCatalog = new ModelCatalog();

const KNOWN_VISION_MODELS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-7-sonnet-latest',
]);

export function supportsVision(modelId: string): boolean {
  const model = modelCatalog.getModels().find(m => m.id === modelId);
  if (model) {
    return modelSupportsCapability(model, 'vision');
  }
  return KNOWN_VISION_MODELS.has(modelId);
}
