import { createHash } from 'node:crypto';

import {
  type AsyncEmbedder,
  asAsyncEmbedder,
  DeterministicHashEmbedder,
  type Embedder,
  fnv1a32,
  LocalSemanticEmbedder,
  OpenAIEmbeddingAdapter,
  type OpenAIEmbeddingAdapterOptions,
} from './rag-embedding.js';
import {
  RagEmbeddingProviderAuthError,
  RagEmbeddingProviderConfigurationError,
  RagEmbeddingProviderDimensionMismatchError,
  RagEmbeddingProviderModelNotFoundError,
} from './rag-provider-errors.js';
import type { RagSemanticEmbedFact, RagSemanticFacts, RagSemanticPipelineFact } from './semantic-validator.js';

export const RAG_EMBED_MODEL_LOCAL_HASH = 'local-hash-v1';
export const RAG_EMBED_MODEL_LOCAL_SEMANTIC = 'local-semantic-v1';
export const RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL = 'openai:text-embedding-3-small';
export const RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE = 'openai:text-embedding-3-large';
export const RAG_EMBED_MODEL_FAKE_DETERMINISTIC = 'fake:deterministic';

export const RAG_SUPPORTED_EMBED_MODELS = [
  RAG_EMBED_MODEL_LOCAL_HASH,
  RAG_EMBED_MODEL_LOCAL_SEMANTIC,
  RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL,
  RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE,
  RAG_EMBED_MODEL_FAKE_DETERMINISTIC,
  // Back-compat alias for existing P1 examples. It resolves to OpenAI and
  // therefore requires the async provider path to execute.
  'text-embedding-3-small',
  'text-embedding-3-large',
] as const;

export type RagSupportedEmbedModel = (typeof RAG_SUPPORTED_EMBED_MODELS)[number];
export type RagCanonicalEmbedModel =
  | typeof RAG_EMBED_MODEL_LOCAL_HASH
  | typeof RAG_EMBED_MODEL_LOCAL_SEMANTIC
  | typeof RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL
  | typeof RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE
  | typeof RAG_EMBED_MODEL_FAKE_DETERMINISTIC;

export const RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION = 'kern-rag-embedding-provider-v1';

export interface RagEmbeddingProviderModelManifest {
  readonly id: RagCanonicalEmbedModel;
  readonly aliases: readonly string[];
  readonly defaultDimensions: number;
  readonly customDimensions: boolean;
  readonly maxDimensions: number;
  readonly batching: boolean;
  readonly maxBatchSize: number;
}

export interface RagEmbeddingProviderManifest {
  readonly version: typeof RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION;
  readonly providerId: string;
  readonly kind: 'embedding';
  readonly models: readonly RagEmbeddingProviderModelManifest[];
}

export interface RagProviderFakeEmbeddingOptions {
  readonly seed?: string;
}

export interface RagProviderEmbeddingOptions {
  readonly openai?: Omit<OpenAIEmbeddingAdapterOptions, 'model' | 'dims'>;
  readonly fake?: RagProviderFakeEmbeddingOptions;
}

export interface RagEmbeddingProviderAdapter {
  readonly manifest: RagEmbeddingProviderManifest;
  createAsyncEmbedder(
    model: RagEmbeddingProviderModelManifest,
    dims: number,
    options: RagProviderEmbeddingOptions,
  ): AsyncEmbedder;
  createSyncEmbedder?(model: RagEmbeddingProviderModelManifest, dims: number): Embedder;
  embedderIdentity?(
    model: RagEmbeddingProviderModelManifest,
    dims: number,
    options: RagProviderEmbeddingOptions,
  ): Pick<Embedder, 'id' | 'dims'>;
}

export class RagEmbeddingProviderRegistry {
  private readonly providers = new Map<string, RagEmbeddingProviderAdapter>();

  constructor(providers: readonly RagEmbeddingProviderAdapter[] = defaultRagEmbeddingProviders()) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: RagEmbeddingProviderAdapter): void {
    if (this.providers.has(provider.manifest.providerId)) {
      throw new RagEmbeddingProviderConfigurationError(
        provider.manifest.providerId,
        `RAG embedding provider '${provider.manifest.providerId}' is already registered.`,
      );
    }
    if (provider.manifest.version !== RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION) {
      throw new RagEmbeddingProviderConfigurationError(
        provider.manifest.providerId,
        `RAG embedding provider '${provider.manifest.providerId}' manifest version '${provider.manifest.version}' is not supported.`,
      );
    }
    const seen = new Set<string>();
    for (const model of provider.manifest.models) {
      for (const ref of [model.id, ...model.aliases]) {
        if (seen.has(ref)) {
          throw new RagEmbeddingProviderConfigurationError(
            provider.manifest.providerId,
            `RAG embedding provider '${provider.manifest.providerId}' declares duplicate model reference '${ref}'.`,
          );
        }
        seen.add(ref);
      }
      if (!Number.isInteger(model.defaultDimensions) || model.defaultDimensions <= 0) {
        throw new RagEmbeddingProviderConfigurationError(
          provider.manifest.providerId,
          `RAG embedding provider '${provider.manifest.providerId}' model '${model.id}' defaultDimensions must be positive.`,
        );
      }
      if (!Number.isInteger(model.maxDimensions) || model.maxDimensions < model.defaultDimensions) {
        throw new RagEmbeddingProviderConfigurationError(
          provider.manifest.providerId,
          `RAG embedding provider '${provider.manifest.providerId}' model '${model.id}' maxDimensions is invalid.`,
        );
      }
      if (!Number.isInteger(model.maxBatchSize) || model.maxBatchSize <= 0) {
        throw new RagEmbeddingProviderConfigurationError(
          provider.manifest.providerId,
          `RAG embedding provider '${provider.manifest.providerId}' model '${model.id}' maxBatchSize must be positive.`,
        );
      }
    }
    for (const existing of this.providers.values()) {
      const existingRefs = new Set(existing.manifest.models.flatMap((model) => [model.id, ...model.aliases]));
      for (const model of provider.manifest.models) {
        for (const ref of [model.id, ...model.aliases]) {
          if (existingRefs.has(ref)) {
            throw new RagEmbeddingProviderConfigurationError(
              provider.manifest.providerId,
              `RAG embedding provider '${provider.manifest.providerId}' model reference '${ref}' conflicts with provider '${existing.manifest.providerId}'.`,
            );
          }
        }
      }
    }
    this.providers.set(provider.manifest.providerId, provider);
  }

  manifests(): readonly RagEmbeddingProviderManifest[] {
    return Array.from(this.providers.values(), (provider) => provider.manifest);
  }

  resolve(modelRef: string): { readonly provider: RagEmbeddingProviderAdapter; readonly model: RagEmbeddingProviderModelManifest } {
    for (const provider of this.providers.values()) {
      const model = provider.manifest.models.find((entry) => entry.id === modelRef || entry.aliases.includes(modelRef));
      if (model) return { provider, model };
    }
    const providerId = modelRef.includes(':') ? modelRef.slice(0, modelRef.indexOf(':')) : 'unknown';
    throw new RagEmbeddingProviderModelNotFoundError(providerId, modelRef);
  }

  canonicalModel(modelRef: string | undefined): RagCanonicalEmbedModel {
    const requested = modelRef === undefined || modelRef.trim() === '' ? RAG_EMBED_MODEL_LOCAL_SEMANTIC : modelRef;
    return this.resolve(requested).model.id;
  }

  validateCapabilities(modelRef: string, dims: number, batchSize = 1): RagEmbeddingProviderModelManifest {
    const { provider, model } = this.resolve(modelRef);
    if (!Number.isInteger(dims) || dims <= 0) {
      throw new RagEmbeddingProviderDimensionMismatchError(
        provider.manifest.providerId,
        `RAG embed model '${model.id}' dims must be a positive integer.`,
        model.defaultDimensions,
        dims,
      );
    }
    if (!model.customDimensions && dims !== model.defaultDimensions) {
      throw new RagEmbeddingProviderDimensionMismatchError(
        provider.manifest.providerId,
        `RAG embed model '${model.id}' requires ${model.defaultDimensions} dimensions, got ${dims}.`,
        model.defaultDimensions,
        dims,
      );
    }
    if (dims > model.maxDimensions) {
      throw new RagEmbeddingProviderDimensionMismatchError(
        provider.manifest.providerId,
        `RAG embed model '${model.id}' supports at most ${model.maxDimensions} dimensions, got ${dims}.`,
        model.maxDimensions,
        dims,
      );
    }
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new RagEmbeddingProviderConfigurationError(
        provider.manifest.providerId,
        `RAG embed model '${model.id}' batchSize must be a positive integer.`,
      );
    }
    if (batchSize > model.maxBatchSize) {
      throw new RagEmbeddingProviderConfigurationError(
        provider.manifest.providerId,
        `RAG embed model '${model.id}' supports batches up to ${model.maxBatchSize}, got ${batchSize}.`,
      );
    }
    return model;
  }

  createSyncEmbedder(modelRef: string, dims: number): Embedder {
    const { provider, model } = this.resolve(modelRef);
    this.validateCapabilities(model.id, dims);
    if (!provider.createSyncEmbedder) {
      throw new RagEmbeddingProviderConfigurationError(
        provider.manifest.providerId,
        `RAG embed model '${model.id}' requires async provider execution.`,
      );
    }
    return provider.createSyncEmbedder(model, dims);
  }

  createAsyncEmbedder(modelRef: string, dims: number, options: RagProviderEmbeddingOptions = {}): AsyncEmbedder {
    const { provider, model } = this.resolve(modelRef);
    this.validateCapabilities(model.id, dims);
    return provider.createAsyncEmbedder(model, dims, options);
  }

  embedderIdentity(
    modelRef: string,
    dims: number,
    options: RagProviderEmbeddingOptions = {},
  ): Pick<Embedder, 'id' | 'dims'> {
    const { provider, model } = this.resolve(modelRef);
    this.validateCapabilities(model.id, dims);
    return provider.embedderIdentity?.(model, dims, options) ?? {
      id: `${provider.manifest.providerId}:${model.id}:dims=${dims}`,
      dims,
    };
  }
}

export function defaultRagEmbeddingProviderRegistry(): RagEmbeddingProviderRegistry {
  return new RagEmbeddingProviderRegistry();
}

export const RAG_EMBEDDING_PROVIDER_MANIFESTS: readonly RagEmbeddingProviderManifest[] =
  defaultRagEmbeddingProviderRegistry().manifests();

export function isSupportedRagEmbedModel(model: string): model is RagSupportedEmbedModel {
  try {
    defaultRagEmbeddingProviderRegistry().canonicalModel(model);
    return true;
  } catch (error) {
    if (!(error instanceof RagEmbeddingProviderModelNotFoundError)) throw error;
    return false;
  }
}

export function canonicalRagEmbedModel(model: string | undefined): RagCanonicalEmbedModel {
  return defaultRagEmbeddingProviderRegistry().canonicalModel(model);
}

export function defaultDimsForRagEmbedModel(model: string): number {
  return defaultRagEmbeddingProviderRegistry().resolve(canonicalRagEmbedModel(model)).model.defaultDimensions;
}

export function ragEmbedModelAllowsCustomDims(model: string): boolean {
  return defaultRagEmbeddingProviderRegistry().resolve(canonicalRagEmbedModel(model)).model.customDimensions;
}

export function resolveSyncRagEmbedderForModel(model: string, dims: number): Embedder {
  return defaultRagEmbeddingProviderRegistry().createSyncEmbedder(model, dims);
}

export function resolveAsyncRagEmbedderForModel(
  model: string,
  dims: number,
  options: { readonly providers?: RagProviderEmbeddingOptions } = {},
): AsyncEmbedder {
  return defaultRagEmbeddingProviderRegistry().createAsyncEmbedder(model, dims, options.providers);
}

export function ragEmbedderIdentityForModel(
  model: string,
  dims: number,
  options: { readonly providers?: RagProviderEmbeddingOptions } = {},
): Pick<Embedder, 'id' | 'dims'> {
  return defaultRagEmbeddingProviderRegistry().embedderIdentity(model, dims, options.providers);
}

export function resolveSyncRagEmbedderForPipeline(
  facts: RagSemanticFacts,
  pipeline: RagSemanticPipelineFact,
  options: { readonly embedder?: Embedder } = {},
): Embedder {
  if (options.embedder) return options.embedder;
  const embed = embedFactForPipeline(facts, pipeline);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  return resolveSyncRagEmbedderForModel(model, dims);
}

export function resolveAsyncRagEmbedderForPipeline(
  facts: RagSemanticFacts,
  pipeline: RagSemanticPipelineFact,
  options: { readonly embedder?: AsyncEmbedder; readonly providers?: RagProviderEmbeddingOptions } = {},
): AsyncEmbedder {
  if (options.embedder) return options.embedder;
  const embed = embedFactForPipeline(facts, pipeline);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  return resolveAsyncRagEmbedderForModel(model, dims, options);
}

export function embedFactForPipeline(
  facts: RagSemanticFacts,
  pipeline: RagSemanticPipelineFact,
): RagSemanticEmbedFact | undefined {
  const retriever = facts.retrievers.find((entry) => entry.name === pipeline.retrieverName);
  if (!retriever?.embedName) return undefined;
  return facts.corpora.flatMap((corpus) => corpus.embeds).find((embed) => embed.name === retriever.embedName);
}

function defaultRagEmbeddingProviders(): readonly RagEmbeddingProviderAdapter[] {
  return [localEmbeddingProvider(), openAiEmbeddingProvider(), fakeEmbeddingProvider()];
}

function localEmbeddingProvider(): RagEmbeddingProviderAdapter {
  return {
    manifest: {
      version: RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION,
      providerId: 'local',
      kind: 'embedding',
      models: [
        {
          id: RAG_EMBED_MODEL_LOCAL_HASH,
          aliases: [],
          defaultDimensions: 256,
          customDimensions: false,
          maxDimensions: 256,
          batching: true,
          maxBatchSize: Number.MAX_SAFE_INTEGER,
        },
        {
          id: RAG_EMBED_MODEL_LOCAL_SEMANTIC,
          aliases: [],
          defaultDimensions: 64,
          customDimensions: false,
          maxDimensions: 64,
          batching: true,
          maxBatchSize: Number.MAX_SAFE_INTEGER,
        },
      ],
    },
    createSyncEmbedder: (model, dims) =>
      model.id === RAG_EMBED_MODEL_LOCAL_HASH ? new DeterministicHashEmbedder({ dims }) : new LocalSemanticEmbedder(),
    createAsyncEmbedder: (model, dims) =>
      asAsyncEmbedder(
        model.id === RAG_EMBED_MODEL_LOCAL_HASH ? new DeterministicHashEmbedder({ dims }) : new LocalSemanticEmbedder(),
      ),
    embedderIdentity: (model, dims) => ({
      id:
        model.id === RAG_EMBED_MODEL_LOCAL_HASH
          ? new DeterministicHashEmbedder({ dims }).id
          : new LocalSemanticEmbedder().id,
      dims,
    }),
  };
}

function openAiEmbeddingProvider(): RagEmbeddingProviderAdapter {
  return {
    manifest: {
      version: RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION,
      providerId: 'openai',
      kind: 'embedding',
      models: [
        {
          id: RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL,
          aliases: ['text-embedding-3-small'],
          defaultDimensions: 1536,
          customDimensions: true,
          maxDimensions: 1536,
          batching: true,
          maxBatchSize: 2048,
        },
        {
          id: RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE,
          aliases: ['text-embedding-3-large'],
          defaultDimensions: 3072,
          customDimensions: true,
          maxDimensions: 3072,
          batching: true,
          maxBatchSize: 2048,
        },
      ],
    },
    createAsyncEmbedder: (model, dims, options) => {
      const openai = options.openai;
      if (!openai?.apiKey?.trim()) {
        throw new RagEmbeddingProviderAuthError('openai', `RAG embed model '${model.id}' requires OpenAI provider options.`);
      }
      const adapter = new OpenAIEmbeddingAdapter({
        ...openai,
        apiKey: openai.apiKey,
        model: model.id.replace(/^openai:/u, ''),
        dims,
      });
      return {
        id: `${adapter.id}:provider=${openAIProviderScope(openai)}`,
        dims,
        embed: (text) => adapter.embed(text),
        embedMany: (texts) => adapter.embedMany(texts),
      };
    },
    embedderIdentity: (model, dims, options) => ({
      id: `${openAiBaseId(model.id, dims)}:provider=${openAIProviderScope(options.openai)}`,
      dims,
    }),
  };
}

function fakeEmbeddingProvider(): RagEmbeddingProviderAdapter {
  return {
    manifest: {
      version: RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION,
      providerId: 'fake',
      kind: 'embedding',
      models: [
        {
          id: RAG_EMBED_MODEL_FAKE_DETERMINISTIC,
          aliases: [],
          defaultDimensions: 64,
          customDimensions: true,
          maxDimensions: 4096,
          batching: true,
          maxBatchSize: Number.MAX_SAFE_INTEGER,
        },
      ],
    },
    createSyncEmbedder: (_model, dims) => new SyncDeterministicFakeRagEmbedder(dims),
    createAsyncEmbedder: (_model, dims, options) => new DeterministicFakeRagEmbedder(dims, options.fake?.seed),
    embedderIdentity: (_model, dims, options) => ({
      id: deterministicFakeRagEmbedderId(dims, options.fake?.seed),
      dims,
    }),
  };
}

class DeterministicFakeRagEmbedder implements AsyncEmbedder {
  readonly id: string;
  readonly dims: number;
  private readonly seed: string;

  constructor(dims: number, seed = 'kern-rag-fake-v1') {
    this.dims = dims;
    this.seed = seed;
    this.id = deterministicFakeRagEmbedderId(dims, seed);
  }

  async embed(text: string): Promise<Float64Array> {
    return deterministicFakeRagVector(text, this.dims, this.seed);
  }

  async embedMany(texts: readonly string[]): Promise<readonly Float64Array[]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

class SyncDeterministicFakeRagEmbedder implements Embedder {
  readonly id: string;
  readonly dims: number;
  private readonly seed: string;

  constructor(dims: number, seed = 'kern-rag-fake-v1') {
    this.dims = dims;
    this.seed = seed;
    this.id = deterministicFakeRagEmbedderId(dims, seed);
  }

  embed(text: string): Float64Array {
    return deterministicFakeRagVector(text, this.dims, this.seed);
  }
}

function deterministicFakeRagVector(text: string, dims: number, seed: string): Float64Array {
  const vector = new Float64Array(dims);
  for (let i = 0; i < dims; i += 1) {
    vector[i] = (fnv1a32(`${seed}\0${text}\0${i}`) / 0xffffffff) * 2 - 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
  return vector;
}

function deterministicFakeRagEmbedderId(dims: number, seed = 'kern-rag-fake-v1'): string {
  const seedSuffix = seed === 'kern-rag-fake-v1' ? '' : `:seed=${fnv1a32(seed).toString(16)}`;
  return `fake:deterministic:dims=${dims}${seedSuffix}`;
}

function openAiBaseId(model: string, dims: number): string {
  return `openai:${model.replace(/^openai:/u, '')}:dims=${dims}`;
}

function openAIProviderScope(openai: RagProviderEmbeddingOptions['openai'] | undefined): string {
  return stableHash(
    stableJson({
      endpoint: openai?.endpoint ?? 'https://api.openai.com/v1/embeddings',
      fetch: openai?.fetch ? 'custom-fetch' : 'global-fetch',
    }),
  ).slice(0, 12);
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}
