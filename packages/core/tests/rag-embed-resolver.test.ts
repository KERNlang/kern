import {
  RAG_EMBED_MODEL_FAKE_DETERMINISTIC,
  RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL,
  RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION,
  RAG_EMBEDDING_PROVIDER_MANIFESTS,
  RagEmbeddingProviderAuthError,
  type RagEmbeddingProviderAdapter,
  RagEmbeddingProviderConfigurationError,
  RagEmbeddingProviderDimensionMismatchError,
  RagEmbeddingProviderRegistry,
  canonicalRagEmbedModel,
  defaultDimsForRagEmbedModel,
  ragEmbedderIdentityForModel,
  resolveAsyncRagEmbedderForModel,
  resolveSyncRagEmbedderForModel,
} from '../src/index.js';

describe('RAG embedding provider registry', () => {
  test('exposes provider manifests with aliases and capability metadata', () => {
    expect(RAG_EMBEDDING_MANIFEST_PROVIDER_IDS()).toEqual(['fake', 'local', 'openai']);
    const openai = RAG_EMBEDDING_PROVIDER_MANIFESTS.find((manifest) => manifest.providerId === 'openai');
    expect(openai?.version).toBe(RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION);
    expect(openai?.models[0]).toEqual(
      expect.objectContaining({
        id: RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL,
        aliases: ['text-embedding-3-small'],
        defaultDimensions: 1536,
        customDimensions: true,
        batching: true,
      }),
    );
  });

  test('canonicalizes aliases through the registry manifest', () => {
    expect(canonicalRagEmbedModel('text-embedding-3-small')).toBe(
      RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL,
    );
    expect(defaultDimsForRagEmbedModel(RAG_EMBED_MODEL_FAKE_DETERMINISTIC)).toBe(64);
  });

  test('rejects duplicate model references during provider registration', () => {
    const registry = new RagEmbeddingProviderRegistry([]);
    const duplicateProvider: RagEmbeddingProviderAdapter = {
      manifest: {
        version: RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION,
        providerId: 'duplicate',
        kind: 'embedding',
        models: [
          {
            id: RAG_EMBED_MODEL_FAKE_DETERMINISTIC,
            aliases: [RAG_EMBED_MODEL_FAKE_DETERMINISTIC],
            defaultDimensions: 3,
            customDimensions: true,
            maxDimensions: 3,
            batching: true,
            maxBatchSize: 4,
          },
        ],
      },
      createAsyncEmbedder: (model, dims) => resolveAsyncRagEmbedderForModel(model.id, dims),
    };

    expect(() => registry.register(duplicateProvider)).toThrow(RagEmbeddingProviderConfigurationError);
  });

  test('rejects duplicate provider ids during provider registration', () => {
    const registry = new RagEmbeddingProviderRegistry();
    const duplicateProviderId: RagEmbeddingProviderAdapter = {
      manifest: {
        version: RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION,
        providerId: 'fake',
        kind: 'embedding',
        models: [
          {
            id: RAG_EMBED_MODEL_FAKE_DETERMINISTIC,
            aliases: [],
            defaultDimensions: 3,
            customDimensions: true,
            maxDimensions: 3,
            batching: true,
            maxBatchSize: 4,
          },
        ],
      },
      createAsyncEmbedder: (model, dims) => resolveAsyncRagEmbedderForModel(model.id, dims),
    };

    expect(() => registry.register(duplicateProviderId)).toThrow(RagEmbeddingProviderConfigurationError);
  });

  test('rejects duplicate model references across providers', () => {
    const registry = new RagEmbeddingProviderRegistry();
    const shadowingProvider: RagEmbeddingProviderAdapter = {
      manifest: {
        version: RAG_EMBEDDING_PROVIDER_MANIFEST_VERSION,
        providerId: 'shadow',
        kind: 'embedding',
        models: [
          {
            id: RAG_EMBED_MODEL_FAKE_DETERMINISTIC,
            aliases: [],
            defaultDimensions: 3,
            customDimensions: true,
            maxDimensions: 3,
            batching: true,
            maxBatchSize: 4,
          },
        ],
      },
      createAsyncEmbedder: (model, dims) => resolveAsyncRagEmbedderForModel(model.id, dims),
    };

    expect(() => registry.register(shadowingProvider)).toThrow(RagEmbeddingProviderConfigurationError);
  });

  test('validates provider dimensions before constructing an embedder', () => {
    const registry = new RagEmbeddingProviderRegistry();
    expect(() => registry.validateCapabilities(RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL, 1537)).toThrow(
      RagEmbeddingProviderDimensionMismatchError,
    );
    expect(() => registry.validateCapabilities('local-hash-v1', 128)).toThrow(
      RagEmbeddingProviderDimensionMismatchError,
    );
    expect(() => registry.validateCapabilities(RAG_EMBED_MODEL_FAKE_DETERMINISTIC, 3, 0)).toThrow(
      RagEmbeddingProviderConfigurationError,
    );
  });

  test('normalizes missing OpenAI credentials as provider auth errors', () => {
    expect(() => resolveAsyncRagEmbedderForModel(RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL, 1536)).toThrow(
      RagEmbeddingProviderAuthError,
    );
  });

  test('computes provider-scoped OpenAI identities without requiring credentials', () => {
    const first = ragEmbedderIdentityForModel(RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL, 1536);
    const second = ragEmbedderIdentityForModel(RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL, 1536, {
      providers: { openai: { endpoint: 'https://proxy.example/v1/embeddings' } },
    });

    expect(first.id).toMatch(/^openai:text-embedding-3-small:dims=1536:provider=[a-f0-9]{12}$/u);
    expect(second.id).toMatch(/^openai:text-embedding-3-small:dims=1536:provider=[a-f0-9]{12}$/u);
    expect(first.id).not.toBe(second.id);
  });

  test('resolved OpenAI embedders use the same provider-scoped identity as identity probes', () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), { status: 200 });
    const options = { providers: { openai: { apiKey: 'test-key', fetch: fakeFetch } } };
    const identity = ragEmbedderIdentityForModel(RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL, 3, options);
    const embedder = resolveAsyncRagEmbedderForModel(RAG_EMBED_MODEL_OPENAI_TEXT_EMBEDDING_3_SMALL, 3, options);

    expect(embedder.id).toBe(identity.id);
  });
});

describe('deterministic fake RAG embedding provider', () => {
  test('embeds deterministically across instances and batches', async () => {
    const first = resolveAsyncRagEmbedderForModel(RAG_EMBED_MODEL_FAKE_DETERMINISTIC, 3, {
      providers: { fake: { seed: 'stable' } },
    });
    const second = resolveAsyncRagEmbedderForModel(RAG_EMBED_MODEL_FAKE_DETERMINISTIC, 3, {
      providers: { fake: { seed: 'stable' } },
    });

    const one = await first.embed('refund policy');
    const again = await second.embed('refund policy');
    const [batched] = await first.embedMany?.(['refund policy']) ?? [];

    expect(Array.from(one)).toEqual(Array.from(again));
    expect(Array.from(one)).toEqual(Array.from(batched ?? []));
    expect(one).toHaveLength(3);
  });

  test('supports synchronous fake provider embeddings for local tests', () => {
    const embedder = resolveSyncRagEmbedderForModel(RAG_EMBED_MODEL_FAKE_DETERMINISTIC, 3);

    expect(embedder.id).toBe('fake:deterministic:dims=3');
    expect(Array.from(embedder.embed('refund policy'))).toEqual(Array.from(embedder.embed('refund policy')));
  });

  test('uses fake provider seed in the stable embedder identity', async () => {
    const first = resolveAsyncRagEmbedderForModel(RAG_EMBED_MODEL_FAKE_DETERMINISTIC, 3, {
      providers: { fake: { seed: 'one' } },
    });
    const second = resolveAsyncRagEmbedderForModel(RAG_EMBED_MODEL_FAKE_DETERMINISTIC, 3, {
      providers: { fake: { seed: 'two' } },
    });

    expect(first.id).toContain('fake:deterministic:dims=3:seed=');
    expect(second.id).toContain('fake:deterministic:dims=3:seed=');
    expect(first.id).not.toBe(second.id);
    expect(Array.from(await first.embed('refund policy'))).not.toEqual(Array.from(await second.embed('refund policy')));
  });
});

function RAG_EMBEDDING_MANIFEST_PROVIDER_IDS(): string[] {
  return RAG_EMBEDDING_PROVIDER_MANIFESTS.map((manifest) => manifest.providerId).sort();
}
