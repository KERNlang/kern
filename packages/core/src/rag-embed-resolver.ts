import {
  type AsyncEmbedder,
  asAsyncEmbedder,
  DeterministicHashEmbedder,
  type Embedder,
  LocalSemanticEmbedder,
  OpenAIEmbeddingAdapter,
  type OpenAIEmbeddingAdapterOptions,
} from './rag-embedding.js';
import type { RagSemanticEmbedFact, RagSemanticFacts, RagSemanticPipelineFact } from './semantic-validator.js';

export const RAG_EMBED_MODEL_LOCAL_HASH = 'local-hash-v1';
export const RAG_EMBED_MODEL_LOCAL_SEMANTIC = 'local-semantic-v1';
export const RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL = 'openai:text-embedding-3-small';
export const RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE = 'openai:text-embedding-3-large';

export const RAG_SUPPORTED_EMBED_MODELS = [
  RAG_EMBED_MODEL_LOCAL_HASH,
  RAG_EMBED_MODEL_LOCAL_SEMANTIC,
  RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL,
  RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE,
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
  | typeof RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE;

export interface RagProviderEmbeddingOptions {
  readonly openai?: Omit<OpenAIEmbeddingAdapterOptions, 'model' | 'dims'>;
}

export function isSupportedRagEmbedModel(model: string): model is RagSupportedEmbedModel {
  return (RAG_SUPPORTED_EMBED_MODELS as readonly string[]).includes(model);
}

export function canonicalRagEmbedModel(model: string | undefined): RagCanonicalEmbedModel {
  if (model === undefined || model.trim() === '') return RAG_EMBED_MODEL_LOCAL_SEMANTIC;
  if (model === 'text-embedding-3-small') return RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL;
  if (model === 'text-embedding-3-large') return RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE;
  if (
    model === RAG_EMBED_MODEL_LOCAL_HASH ||
    model === RAG_EMBED_MODEL_LOCAL_SEMANTIC ||
    model === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL ||
    model === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE
  ) {
    return model;
  }
  throw new Error(`Unsupported RAG embed model '${model}'.`);
}

export function defaultDimsForRagEmbedModel(model: string): number {
  const canonical = canonicalRagEmbedModel(model);
  switch (canonical) {
    case RAG_EMBED_MODEL_LOCAL_HASH:
      return 256;
    case RAG_EMBED_MODEL_LOCAL_SEMANTIC:
      return 64;
    case RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL:
      return 1536;
    case RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE:
      return 3072;
    default:
      return assertNever(canonical);
  }
}

export function ragEmbedModelAllowsCustomDims(model: string): boolean {
  const canonical = canonicalRagEmbedModel(model);
  return (
    canonical === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL ||
    canonical === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE
  );
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
  if (model === RAG_EMBED_MODEL_LOCAL_HASH) return new DeterministicHashEmbedder({ dims });
  if (model === RAG_EMBED_MODEL_LOCAL_SEMANTIC) return new LocalSemanticEmbedder();
  throw new Error(`RAG embed model '${model}' requires async provider execution.`);
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
  if (model === RAG_EMBED_MODEL_LOCAL_HASH) return asAsyncEmbedder(new DeterministicHashEmbedder({ dims }));
  if (model === RAG_EMBED_MODEL_LOCAL_SEMANTIC) return asAsyncEmbedder(new LocalSemanticEmbedder());
  if (
    model === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL ||
    model === RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_LARGE
  ) {
    const openai = options.providers?.openai;
    if (!openai?.apiKey?.trim()) throw new Error(`RAG embed model '${model}' requires OpenAI provider options.`);
    return new OpenAIEmbeddingAdapter({
      ...openai,
      apiKey: openai.apiKey,
      model: model.replace(/^openai:/u, ''),
      dims,
    });
  }
  return assertNever(model);
}

export function embedFactForPipeline(
  facts: RagSemanticFacts,
  pipeline: RagSemanticPipelineFact,
): RagSemanticEmbedFact | undefined {
  const retriever = facts.retrievers.find((entry) => entry.name === pipeline.retrieverName);
  if (!retriever?.embedName) return undefined;
  return facts.corpora.flatMap((corpus) => corpus.embeds).find((embed) => embed.name === retriever.embedName);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled RAG embed model '${String(value)}'.`);
}
