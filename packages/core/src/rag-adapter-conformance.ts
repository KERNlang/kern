import {
  DeterministicHashEmbedder,
  type Embedder,
  embedderFingerprint,
  InMemoryPgVectorRagStore,
  type AsyncRagVectorStoreAdapter,
  type RagVectorStoreAdapter,
  type RagVectorStoreKind,
  type RagVectorStoreMetric,
} from './rag-embedding.js';
import type { RagChunkInput } from './rag-runtime.js';

export type RagAdapterPersistence = 'ephemeral' | 'durable';
export type RagVectorStoreAdapterTransport = 'in-process' | 'external';
export type RagVectorStoreFilterCapability = string;
export type RagVectorStoreConformanceStatus = 'passed' | 'failed' | 'skipped';
export type RagVectorStoreConformanceProfileVersion = 'kern-rag-vector-store-conformance-v2';

export interface RagVectorStoreAdapterCapabilities {
  readonly upsert: boolean;
  readonly upsertMany: boolean;
  readonly search: boolean;
  readonly snapshot: boolean;
  readonly clear: boolean;
  readonly namespaces: boolean;
  readonly filters: readonly RagVectorStoreFilterCapability[];
  readonly maxDimensions: number;
}

export interface RagVectorStoreAdapterManifest {
  readonly name: string;
  readonly kind: 'vectorStore';
  readonly adapterKind: RagVectorStoreKind;
  readonly version: string;
  readonly transport: RagVectorStoreAdapterTransport;
  readonly metrics: readonly RagVectorStoreMetric[];
  readonly maxDimensions: number;
  readonly persistence: RagAdapterPersistence;
  readonly capabilities: RagVectorStoreAdapterCapabilities;
}

export interface RagVectorStoreManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

interface RagVectorStoreAdapterContractBase {
  readonly manifest: RagVectorStoreAdapterManifest;
}

export type RagVectorStoreAdapterContract =
  | (RagVectorStoreAdapterContractBase & {
      readonly createStore: (context: RagVectorStoreConformanceContext) => RagVectorStoreAdapter;
      readonly createStoreAsync?: never;
    })
  | (RagVectorStoreAdapterContractBase & {
      readonly createStore?: never;
      readonly createStoreAsync: (context: RagVectorStoreConformanceContext) => Promise<AsyncRagVectorStoreAdapter>;
    });

interface RagVectorStoreConformanceOptionsBase {
  readonly manifest: RagVectorStoreAdapterManifest;
  readonly embedder?: Embedder;
  /** Optional namespace seed for programmatic callers that need reproducible backing file names. */
  readonly runId?: string;
}

export interface RagVectorStoreConformanceOptions extends RagVectorStoreConformanceOptionsBase {
  readonly createStore: (context: RagVectorStoreConformanceContext) => RagVectorStoreAdapter;
}

export interface RagVectorStoreAsyncConformanceOptions extends RagVectorStoreConformanceOptionsBase {
  readonly createStoreAsync: (context: RagVectorStoreConformanceContext) => Promise<AsyncRagVectorStoreAdapter>;
}

export interface RagVectorStoreConformanceProfile {
  readonly version: RagVectorStoreConformanceProfileVersion;
  readonly kind: 'vectorStore';
  readonly requiredCapabilities: readonly (keyof RagVectorStoreAdapterCapabilities)[];
  readonly requiredManifestFields: readonly string[];
  readonly supportedAdapterKinds: readonly RagVectorStoreKind[];
  readonly supportedMetrics: readonly RagVectorStoreMetric[];
  readonly cases: readonly string[];
}

export interface RagVectorStoreConformanceCaseResult {
  readonly name: string;
  readonly status: RagVectorStoreConformanceStatus;
  readonly message?: string;
}

export interface RagVectorStoreConformanceReport {
  readonly manifest: RagVectorStoreAdapterManifest;
  readonly adapterMode: 'sync' | 'async';
  readonly passed: boolean;
  readonly cases: readonly RagVectorStoreConformanceCaseResult[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
}

export interface RagVectorStoreConformanceContext {
  readonly fingerprint: string;
  readonly dims: number;
  readonly namespace: string;
}

const CONFORMANCE_CORPUS: readonly RagChunkInput[] = [
  { id: 'refunds', text: 'refund refunds policy window thirty days money back', source: 'docs/refunds.md' },
  { id: 'shipping', text: 'shipping delivery courier tracking parcel transit', source: 'docs/shipping.md' },
  { id: 'returns', text: 'return exchange store credit receipt policy window', source: 'docs/returns.md' },
];
const CONFORMANCE_CORPUS_IDS = new Set(CONFORMANCE_CORPUS.map((chunk) => chunk.id));
const CONFORMANT_RAG_VECTOR_STORE_KINDS: readonly RagVectorStoreKind[] = ['memory', 'local-persistent'];
const REQUIRED_RAG_VECTOR_STORE_CAPABILITIES: readonly (keyof RagVectorStoreAdapterCapabilities)[] = [
  'upsert',
  'upsertMany',
  'search',
  'snapshot',
  'clear',
];
const REQUIRED_RAG_VECTOR_STORE_MANIFEST_FIELDS: readonly string[] = [
  'transport',
  'capabilities.namespaces',
  'capabilities.filters',
  'capabilities.maxDimensions',
];
const DEFAULT_RAG_VECTOR_STORE_CONFORMANCE_DIMS = 64;
const SUPPORTED_RAG_VECTOR_STORE_FILTERS: readonly RagVectorStoreFilterCapability[] = [];
const RAG_VECTOR_STORE_CONFORMANCE_CASE_NAMES: readonly string[] = [
  'manifest-shape',
  'manifest-matches-adapter',
  'capability-flags-are-consistent',
  'persistence-matches-adapter',
  'empty-search-returns-empty-list',
  'upsert-search-ranks-related-chunk',
  'batch-upsert-is-honored',
  'topk-is-respected',
  'dimension-mismatch-fails-closed',
  'fingerprint-mismatch-fails-closed',
  'snapshot-is-deterministic-and-sorted',
  'clear-removes-indexed-vectors',
  'namespace-isolation',
  'durable-round-trip',
];

export const RAG_VECTOR_STORE_CONFORMANCE_PROFILE: RagVectorStoreConformanceProfile = {
  version: 'kern-rag-vector-store-conformance-v2',
  kind: 'vectorStore',
  requiredCapabilities: REQUIRED_RAG_VECTOR_STORE_CAPABILITIES,
  requiredManifestFields: REQUIRED_RAG_VECTOR_STORE_MANIFEST_FIELDS,
  supportedAdapterKinds: CONFORMANT_RAG_VECTOR_STORE_KINDS,
  supportedMetrics: ['cosine'],
  cases: RAG_VECTOR_STORE_CONFORMANCE_CASE_NAMES,
};

export const BUILTIN_RAG_VECTOR_STORE_MANIFESTS: readonly RagVectorStoreAdapterManifest[] = [
  {
    name: 'memory',
    kind: 'vectorStore',
    adapterKind: 'memory',
    version: '1.0.0',
    transport: 'in-process',
    metrics: ['cosine'],
    maxDimensions: 4096,
    persistence: 'ephemeral',
    capabilities: {
      upsert: true,
      upsertMany: true,
      search: true,
      snapshot: true,
      clear: true,
      namespaces: false,
      filters: [],
      maxDimensions: 4096,
    },
  },
  {
    name: 'local-persistent',
    kind: 'vectorStore',
    adapterKind: 'local-persistent',
    version: '1.0.0',
    transport: 'in-process',
    metrics: ['cosine'],
    maxDimensions: 4096,
    persistence: 'durable',
    capabilities: {
      upsert: true,
      upsertMany: true,
      search: true,
      snapshot: true,
      clear: true,
      namespaces: false,
      filters: [],
      maxDimensions: 4096,
    },
  },
] as const;

let conformanceRunSequence = 0;

export function builtinRagVectorStoreManifest(name: string): RagVectorStoreAdapterManifest | undefined {
  return BUILTIN_RAG_VECTOR_STORE_MANIFESTS.find((manifest) => manifest.name === name);
}

export function createInMemoryRagVectorStoreForConformance(
  context: RagVectorStoreConformanceContext,
): RagVectorStoreAdapter {
  return new InMemoryPgVectorRagStore(context.fingerprint, context.dims);
}

export function validateRagVectorStoreAdapterManifest(manifest: unknown): RagVectorStoreManifestValidationResult {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object') {
    errors.push('manifest must be an object.');
  } else {
    collectManifestErrors(manifest, errors);
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function defineRagVectorStoreAdapterContract(
  contract: RagVectorStoreAdapterContract,
): RagVectorStoreAdapterContract {
  const hasSyncFactory = typeof contract.createStore === 'function';
  const hasAsyncFactory = typeof contract.createStoreAsync === 'function';
  if (hasSyncFactory === hasAsyncFactory) {
    throw new Error('RAG vector store adapter contract must provide exactly one of createStore or createStoreAsync.');
  }
  const validation = validateRagVectorStoreAdapterManifest(contract.manifest);
  if (!validation.valid) {
    throw new Error(`invalid RAG vector store adapter manifest: ${validation.errors.join('; ')}`);
  }
  return contract;
}

export function runRagVectorStoreConformance(
  options: RagVectorStoreConformanceOptions,
): RagVectorStoreConformanceReport {
  const embedder = options.embedder ?? new DeterministicHashEmbedder({ dims: DEFAULT_RAG_VECTOR_STORE_CONFORMANCE_DIMS });
  const context = {
    fingerprint: embedderFingerprint(embedder, 'cosine'),
    dims: embedder.dims,
  };
  const runNamespace = safeConformanceNamespace(options.runId ?? defaultConformanceRunNamespace());
  const contextFor = (name: string): RagVectorStoreConformanceContext => ({
    ...context,
    namespace: `${runNamespace}-${safeConformanceNamespace(name)}`,
  });
  const cases: RagVectorStoreConformanceCaseResult[] = [];

  runCase(cases, 'manifest-shape', () => assertManifest(options.manifest));
  runCase(cases, 'manifest-matches-adapter', () => {
    if (options.manifest.maxDimensions < context.dims) {
      throw new Error(`manifest maxDimensions ${options.manifest.maxDimensions} is below tested dims ${context.dims}.`);
    }
    usingStore(options.createStore(contextFor('manifest-matches-adapter')), (store) => {
      if (store.kind !== options.manifest.adapterKind) {
        throw new Error(
          `manifest adapterKind '${options.manifest.adapterKind}' does not match store kind '${store.kind}'.`,
        );
      }
      if (store.metric !== 'cosine') throw new Error(`expected cosine metric, got '${store.metric}'.`);
      if (store.dims !== context.dims) throw new Error(`expected store dims ${context.dims}, got ${store.dims}.`);
      if (store.fingerprint !== context.fingerprint)
        throw new Error('store fingerprint does not match conformance context.');
    });
  });
  runCase(cases, 'capability-flags-are-consistent', () => assertCapabilityFlags(options.manifest, context.dims));
  runCase(cases, 'persistence-matches-adapter', () => {
    const observed = observeStorePersistence(options, contextFor('persistence-matches-adapter'), embedder);
    if (observed !== options.manifest.persistence) {
      throw new Error(`manifest persistence '${options.manifest.persistence}' does not match observed '${observed}'.`);
    }
  });
  runCase(cases, 'empty-search-returns-empty-list', () => {
    usingStore(options.createStore(contextFor('empty-search-returns-empty-list')), (store) => {
      const result = store.search('refund policy', embedder.embed('refund policy'), { topK: 3 });
      if (result.chunks.length !== 0) throw new Error(`expected 0 chunks, got ${result.chunks.length}.`);
    });
  });
  runCase(cases, 'upsert-search-ranks-related-chunk', () => {
    usingStore(options.createStore(contextFor('upsert-search-ranks-related-chunk')), (store) => {
      store.upsertMany(
        CONFORMANCE_CORPUS.map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      const result = store.search('refund policy money back', embedder.embed('refund policy money back'), { topK: 1 });
      if (result.chunks[0]?.id !== 'refunds') {
        throw new Error(`expected top chunk 'refunds', got '${result.chunks[0]?.id ?? '<none>'}'.`);
      }
    });
  });
  runCase(cases, 'batch-upsert-is-honored', () => {
    usingStore(options.createStore(contextFor('batch-upsert-is-honored')), (store) => {
      store.upsertMany(
        CONFORMANCE_CORPUS.slice(0, 2).map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      const result = store.search('refund policy shipping', embedder.embed('refund policy shipping'), { topK: 2 });
      if (result.chunks.length !== 2) throw new Error(`expected batch upsert to index 2 chunks, got ${result.chunks.length}.`);
    });
  });
  runCase(cases, 'topk-is-respected', () => {
    usingStore(options.createStore(contextFor('topk-is-respected')), (store) => {
      store.upsertMany(
        CONFORMANCE_CORPUS.map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      const result = store.search('policy return refund shipping', embedder.embed('policy return refund shipping'), {
        topK: 2,
      });
      if (result.chunks.length !== 2) throw new Error(`expected exactly 2 chunks, got ${result.chunks.length}.`);
      const unexpected = result.chunks.find((chunk) => !CONFORMANCE_CORPUS_IDS.has(chunk.id));
      if (unexpected) throw new Error(`returned unknown chunk '${unexpected.id}'.`);
    });
  });
  runCase(cases, 'dimension-mismatch-fails-closed', () => {
    usingStore(options.createStore(contextFor('dimension-mismatch-fails-closed')), (store) => {
      expectThrow(() => store.upsert(CONFORMANCE_CORPUS[0], new Float64Array(context.dims + 1)), /dimensions/u);
    });
  });
  runCase(cases, 'fingerprint-mismatch-fails-closed', () => {
    usingStore(options.createStore(contextFor('fingerprint-mismatch-fails-closed')), (store) => {
      const mismatchedFingerprint = `${context.fingerprint}:mismatch`;
      expectThrow(
        () => store.search('refund policy', embedder.embed('refund policy'), {}, mismatchedFingerprint),
        /fingerprint mismatch/u,
      );
    });
  });
  runCase(cases, 'snapshot-is-deterministic-and-sorted', () => {
    usingStore(options.createStore(contextFor('snapshot-is-deterministic-and-sorted')), (store) => {
      store.upsertMany(
        [CONFORMANCE_CORPUS[1], CONFORMANCE_CORPUS[0]].map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      const ids = store.snapshot().entries.map((entry) => entry.chunk.id);
      if (ids.join(',') !== 'refunds,shipping') throw new Error(`snapshot order was ${ids.join(',')}.`);
    });
  });
  runCase(cases, 'clear-removes-indexed-vectors', () => {
    usingStore(options.createStore(contextFor('clear-removes-indexed-vectors')), (store) => {
      store.upsert(CONFORMANCE_CORPUS[0], embedder.embed(CONFORMANCE_CORPUS[0].text));
      store.clear();
      const result = store.search('refund policy', embedder.embed('refund policy'));
      if (result.chunks.length !== 0)
        throw new Error(`expected clear() to remove chunks, got ${result.chunks.length}.`);
    });
  });
  if (options.manifest.capabilities.namespaces) {
    runCase(cases, 'namespace-isolation', () => {
      const left = contextFor('namespace-isolation-left');
      const right = { ...left, namespace: `${left.namespace}-other` };
      usingStore(options.createStore(left), (store) => {
        store.upsert(CONFORMANCE_CORPUS[0], embedder.embed(CONFORMANCE_CORPUS[0].text));
        const result = store.search('refund policy', embedder.embed('refund policy'), { topK: 1 });
        if (result.chunks[0]?.id !== 'refunds') throw new Error('expected source namespace to retain indexed chunk.');
      });
      usingStore(options.createStore(left), (sameNamespace) => {
        const sameResult = sameNamespace.search('refund policy', embedder.embed('refund policy'), { topK: 1 });
        if (sameResult.chunks[0]?.id !== 'refunds') {
          throw new Error('expected same namespace handle to read indexed chunk.');
        }
      });
      usingStore(options.createStore(right), (other) => {
        const otherResult = other.search('refund policy', embedder.embed('refund policy'), { topK: 1 });
        if (otherResult.chunks.length !== 0) throw new Error('expected namespace-isolated store to be empty.');
      });
    });
  } else {
    cases.push({ name: 'namespace-isolation', status: 'skipped', message: 'adapter does not claim namespaces' });
  }
  if (options.manifest.persistence === 'durable') {
    runCase(cases, 'durable-round-trip', () => {
      const durableContext = contextFor('durable-round-trip');
      usingStore(options.createStore(durableContext), (first) => {
        first.upsertMany(
          CONFORMANCE_CORPUS.slice(0, 2).map((chunk) => ({
            chunk,
            vector: embedder.embed(chunk.text),
          })),
        );
      });
      usingStore(options.createStore(durableContext), (reopened) => {
        const result = reopened.search('refund policy shipping', embedder.embed('refund policy shipping'), { topK: 2 });
        const ids = new Set(result.chunks.map((chunk) => chunk.id));
        if (!ids.has('refunds') || !ids.has('shipping')) {
          throw new Error(`expected durable store to reload 'refunds' and 'shipping', got '${[...ids].join(',')}'.`);
        }
      });
    });
  } else {
    cases.push({ name: 'durable-round-trip', status: 'skipped', message: 'adapter persistence is ephemeral' });
  }

  const summary = conformanceSummary(cases);
  return {
    manifest: options.manifest,
    adapterMode: 'sync',
    passed: summary.failed === 0,
    cases,
    summary,
  };
}

export async function runRagVectorStoreConformanceAsync(
  options: RagVectorStoreAsyncConformanceOptions,
): Promise<RagVectorStoreConformanceReport> {
  const embedder = options.embedder ?? new DeterministicHashEmbedder({ dims: DEFAULT_RAG_VECTOR_STORE_CONFORMANCE_DIMS });
  const context = {
    fingerprint: embedderFingerprint(embedder, 'cosine'),
    dims: embedder.dims,
  };
  const runNamespace = safeConformanceNamespace(options.runId ?? defaultConformanceRunNamespace());
  const contextFor = (name: string): RagVectorStoreConformanceContext => ({
    ...context,
    namespace: `${runNamespace}-${safeConformanceNamespace(name)}`,
  });
  const cases: RagVectorStoreConformanceCaseResult[] = [];
  const createStore = options.createStoreAsync;

  await runCaseAsync(cases, 'manifest-shape', async () => assertManifest(options.manifest));
  await runCaseAsync(cases, 'manifest-matches-adapter', async () => {
    if (options.manifest.maxDimensions < context.dims) {
      throw new Error(`manifest maxDimensions ${options.manifest.maxDimensions} is below tested dims ${context.dims}.`);
    }
    await usingStoreAsync(await createStore(contextFor('manifest-matches-adapter')), async (store) => {
      if (store.kind !== options.manifest.adapterKind) {
        throw new Error(
          `manifest adapterKind '${options.manifest.adapterKind}' does not match store kind '${store.kind}'.`,
        );
      }
      if (store.metric !== 'cosine') throw new Error(`expected cosine metric, got '${store.metric}'.`);
      if (store.dims !== context.dims) throw new Error(`expected store dims ${context.dims}, got ${store.dims}.`);
      if (store.fingerprint !== context.fingerprint)
        throw new Error('store fingerprint does not match conformance context.');
    });
  });
  await runCaseAsync(cases, 'capability-flags-are-consistent', async () =>
    assertCapabilityFlags(options.manifest, context.dims),
  );
  await runCaseAsync(cases, 'persistence-matches-adapter', async () => {
    const observed = await observeStorePersistenceAsync(options, contextFor('persistence-matches-adapter'), embedder);
    if (observed !== options.manifest.persistence) {
      throw new Error(`manifest persistence '${options.manifest.persistence}' does not match observed '${observed}'.`);
    }
  });
  await runCaseAsync(cases, 'empty-search-returns-empty-list', async () => {
    await usingStoreAsync(await createStore(contextFor('empty-search-returns-empty-list')), async (store) => {
      const result = await store.search('refund policy', embedder.embed('refund policy'), { topK: 3 });
      if (result.chunks.length !== 0) throw new Error(`expected 0 chunks, got ${result.chunks.length}.`);
    });
  });
  await runCaseAsync(cases, 'upsert-search-ranks-related-chunk', async () => {
    await usingStoreAsync(await createStore(contextFor('upsert-search-ranks-related-chunk')), async (store) => {
      await store.upsertMany(
        CONFORMANCE_CORPUS.map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      const result = await store.search('refund policy money back', embedder.embed('refund policy money back'), {
        topK: 1,
      });
      if (result.chunks[0]?.id !== 'refunds') {
        throw new Error(`expected top chunk 'refunds', got '${result.chunks[0]?.id ?? '<none>'}'.`);
      }
    });
  });
  await runCaseAsync(cases, 'batch-upsert-is-honored', async () => {
    await usingStoreAsync(await createStore(contextFor('batch-upsert-is-honored')), async (store) => {
      await store.upsertMany(
        CONFORMANCE_CORPUS.slice(0, 2).map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      const result = await store.search('refund policy shipping', embedder.embed('refund policy shipping'), { topK: 2 });
      if (result.chunks.length !== 2) throw new Error(`expected batch upsert to index 2 chunks, got ${result.chunks.length}.`);
    });
  });
  await runCaseAsync(cases, 'topk-is-respected', async () => {
    await usingStoreAsync(await createStore(contextFor('topk-is-respected')), async (store) => {
      await store.upsertMany(
        CONFORMANCE_CORPUS.map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      const result = await store.search('policy return refund shipping', embedder.embed('policy return refund shipping'), {
        topK: 2,
      });
      if (result.chunks.length !== 2) throw new Error(`expected exactly 2 chunks, got ${result.chunks.length}.`);
      const unexpected = result.chunks.find((chunk) => !CONFORMANCE_CORPUS_IDS.has(chunk.id));
      if (unexpected) throw new Error(`returned unknown chunk '${unexpected.id}'.`);
    });
  });
  await runCaseAsync(cases, 'dimension-mismatch-fails-closed', async () => {
    await usingStoreAsync(await createStore(contextFor('dimension-mismatch-fails-closed')), async (store) => {
      await expectThrowAsync(() => store.upsert(CONFORMANCE_CORPUS[0], new Float64Array(context.dims + 1)), /dimensions/u);
    });
  });
  await runCaseAsync(cases, 'fingerprint-mismatch-fails-closed', async () => {
    await usingStoreAsync(await createStore(contextFor('fingerprint-mismatch-fails-closed')), async (store) => {
      const mismatchedFingerprint = `${context.fingerprint}:mismatch`;
      await expectThrowAsync(
        () => store.search('refund policy', embedder.embed('refund policy'), {}, mismatchedFingerprint),
        /fingerprint mismatch/u,
      );
    });
  });
  await runCaseAsync(cases, 'snapshot-is-deterministic-and-sorted', async () => {
    await usingStoreAsync(await createStore(contextFor('snapshot-is-deterministic-and-sorted')), async (store) => {
      await store.upsertMany(
        [CONFORMANCE_CORPUS[1], CONFORMANCE_CORPUS[0]].map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      const ids = (await store.snapshot()).entries.map((entry) => entry.chunk.id);
      if (ids.join(',') !== 'refunds,shipping') throw new Error(`snapshot order was ${ids.join(',')}.`);
    });
  });
  await runCaseAsync(cases, 'clear-removes-indexed-vectors', async () => {
    await usingStoreAsync(await createStore(contextFor('clear-removes-indexed-vectors')), async (store) => {
      await store.upsert(CONFORMANCE_CORPUS[0], embedder.embed(CONFORMANCE_CORPUS[0].text));
      await store.clear();
      const result = await store.search('refund policy', embedder.embed('refund policy'));
      if (result.chunks.length !== 0)
        throw new Error(`expected clear() to remove chunks, got ${result.chunks.length}.`);
    });
  });
  if (options.manifest.capabilities.namespaces) {
    await runCaseAsync(cases, 'namespace-isolation', async () => {
      const left = contextFor('namespace-isolation-left');
      const right = { ...left, namespace: `${left.namespace}-other` };
      await usingStoreAsync(await createStore(left), async (store) => {
        await store.upsert(CONFORMANCE_CORPUS[0], embedder.embed(CONFORMANCE_CORPUS[0].text));
        const result = await store.search('refund policy', embedder.embed('refund policy'), { topK: 1 });
        if (result.chunks[0]?.id !== 'refunds') throw new Error('expected source namespace to retain indexed chunk.');
      });
      await usingStoreAsync(await createStore(left), async (sameNamespace) => {
        const sameResult = await sameNamespace.search('refund policy', embedder.embed('refund policy'), { topK: 1 });
        if (sameResult.chunks[0]?.id !== 'refunds') {
          throw new Error('expected same namespace handle to read indexed chunk.');
        }
      });
      await usingStoreAsync(await createStore(right), async (other) => {
        const otherResult = await other.search('refund policy', embedder.embed('refund policy'), { topK: 1 });
        if (otherResult.chunks.length !== 0) throw new Error('expected namespace-isolated store to be empty.');
      });
    });
  } else {
    cases.push({ name: 'namespace-isolation', status: 'skipped', message: 'adapter does not claim namespaces' });
  }
  if (options.manifest.persistence === 'durable') {
    await runCaseAsync(cases, 'durable-round-trip', async () => {
      const durableContext = contextFor('durable-round-trip');
      await usingStoreAsync(await createStore(durableContext), async (first) => {
        await first.upsertMany(
          CONFORMANCE_CORPUS.slice(0, 2).map((chunk) => ({
            chunk,
            vector: embedder.embed(chunk.text),
          })),
        );
      });
      await usingStoreAsync(await createStore(durableContext), async (reopened) => {
        const result = await reopened.search('refund policy shipping', embedder.embed('refund policy shipping'), {
          topK: 2,
        });
        const ids = new Set(result.chunks.map((chunk) => chunk.id));
        if (!ids.has('refunds') || !ids.has('shipping')) {
          throw new Error(`expected durable store to reload 'refunds' and 'shipping', got '${[...ids].join(',')}'.`);
        }
      });
    });
  } else {
    cases.push({ name: 'durable-round-trip', status: 'skipped', message: 'adapter persistence is ephemeral' });
  }

  const summary = conformanceSummary(cases);
  return {
    manifest: options.manifest,
    adapterMode: 'async',
    passed: summary.failed === 0,
    cases,
    summary,
  };
}

function assertManifest(manifest: RagVectorStoreAdapterManifest): void {
  const validation = validateRagVectorStoreAdapterManifest(manifest);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
}

function collectManifestErrors(manifest: object, errors: string[]): void {
  const candidate = manifest as Partial<RagVectorStoreAdapterManifest>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) errors.push('manifest name must be non-empty.');
  if (typeof candidate.version !== 'string' || !candidate.version.trim()) {
    errors.push('manifest version must be non-empty.');
  }
  if (candidate.kind !== 'vectorStore') errors.push('manifest kind must be vectorStore.');
  if (candidate.transport !== 'in-process' && candidate.transport !== 'external') {
    errors.push("manifest transport must be 'in-process' or 'external'.");
  }
  if (
    !RAG_VECTOR_STORE_CONFORMANCE_PROFILE.supportedAdapterKinds.includes(candidate.adapterKind as RagVectorStoreKind)
  ) {
    errors.push(
      `manifest adapterKind '${String(candidate.adapterKind)}' is not supported by this conformance profile.`,
    );
  }
  if (candidate.persistence !== 'ephemeral' && candidate.persistence !== 'durable') {
    errors.push("manifest persistence must be 'ephemeral' or 'durable'.");
  }
  if (
    !Array.isArray(candidate.metrics) ||
    !candidate.metrics.some((metric) => RAG_VECTOR_STORE_CONFORMANCE_PROFILE.supportedMetrics.includes(metric)) ||
    !candidate.metrics.every((metric) => RAG_VECTOR_STORE_CONFORMANCE_PROFILE.supportedMetrics.includes(metric))
  ) {
    errors.push(
      `manifest metrics must include only supported metrics: ${RAG_VECTOR_STORE_CONFORMANCE_PROFILE.supportedMetrics.join(', ')}.`,
    );
  }
  if (
    !Number.isInteger(candidate.maxDimensions) ||
    (candidate.maxDimensions ?? 0) <= 0
  ) {
    errors.push('manifest maxDimensions must be a positive integer.');
  }
  if (!candidate.capabilities || typeof candidate.capabilities !== 'object') {
    errors.push('manifest capabilities must be an object.');
    return;
  }
  for (const capability of REQUIRED_RAG_VECTOR_STORE_CAPABILITIES) {
    if (candidate.capabilities[capability] !== true) errors.push(`manifest capability '${capability}' must be true.`);
  }
  if (typeof candidate.capabilities.namespaces !== 'boolean') {
    errors.push("manifest capability 'namespaces' must be a boolean.");
  }
  if (!Array.isArray(candidate.capabilities.filters)) {
    errors.push("manifest capability 'filters' must be an array.");
  } else {
    for (const filter of candidate.capabilities.filters) {
      if (!SUPPORTED_RAG_VECTOR_STORE_FILTERS.includes(filter as RagVectorStoreFilterCapability)) {
        errors.push(`manifest capability filter '${String(filter)}' is not supported by this conformance profile.`);
      }
    }
  }
  const capabilityMaxDimensions = candidate.capabilities.maxDimensions;
  if (!Number.isInteger(capabilityMaxDimensions) || (capabilityMaxDimensions ?? 0) <= 0) {
    errors.push("manifest capability 'maxDimensions' must be a positive integer.");
  }
  if (
    Number.isInteger(capabilityMaxDimensions) &&
    Number.isInteger(candidate.maxDimensions) &&
    capabilityMaxDimensions !== candidate.maxDimensions
  ) {
    errors.push("manifest capability 'maxDimensions' must match manifest maxDimensions.");
  }
}

function assertCapabilityFlags(manifest: RagVectorStoreAdapterManifest, testedDims: number): void {
  if (manifest.capabilities.maxDimensions !== manifest.maxDimensions) {
    throw new Error("manifest capability 'maxDimensions' must match manifest maxDimensions.");
  }
  if (manifest.capabilities.maxDimensions < testedDims) {
    throw new Error(
      `manifest capability maxDimensions ${manifest.capabilities.maxDimensions} is below tested dims ${testedDims}.`,
    );
  }
  if (manifest.capabilities.filters.length > 0 && !manifest.capabilities.search) {
    throw new Error('manifest cannot claim filter support without search support.');
  }
}

function runCase(cases: RagVectorStoreConformanceCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    cases.push({ name, status: 'passed' });
  } catch (error) {
    cases.push({ name, status: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}

async function runCaseAsync(
  cases: RagVectorStoreConformanceCaseResult[],
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    cases.push({ name, status: 'passed' });
  } catch (error) {
    cases.push({ name, status: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}

function usingStore(store: RagVectorStoreAdapter, fn: (store: RagVectorStoreAdapter) => void): void {
  let failure: unknown;
  try {
    fn(store);
  } catch (error) {
    failure = error;
  }
  try {
    store.close();
  } catch (error) {
    // Preserve the body failure as the conformance signal; close errors are secondary cleanup noise.
    if (failure === undefined) throw error;
  }
  if (failure !== undefined) throw failure;
}

async function usingStoreAsync(
  store: AsyncRagVectorStoreAdapter,
  fn: (store: AsyncRagVectorStoreAdapter) => Promise<void>,
): Promise<void> {
  let failure: unknown;
  try {
    await fn(store);
  } catch (error) {
    failure = error;
  }
  try {
    await store.close();
  } catch (error) {
    if (failure === undefined) throw error;
  }
  if (failure !== undefined) throw failure;
}

function observeStorePersistence(
  options: RagVectorStoreConformanceOptions,
  context: RagVectorStoreConformanceContext,
  embedder: Embedder,
): RagAdapterPersistence {
  usingStore(options.createStore(context), (store) => {
    store.upsert(CONFORMANCE_CORPUS[0], embedder.embed(CONFORMANCE_CORPUS[0].text));
  });
  let persisted = false;
  usingStore(options.createStore(context), (reopened) => {
    const result = reopened.search('refund policy', embedder.embed('refund policy'), { topK: 1 });
    persisted = result.chunks[0]?.id === CONFORMANCE_CORPUS[0].id;
  });
  return persisted ? 'durable' : 'ephemeral';
}

async function observeStorePersistenceAsync(
  options: Pick<RagVectorStoreAsyncConformanceOptions, 'createStoreAsync'>,
  context: RagVectorStoreConformanceContext,
  embedder: Embedder,
): Promise<RagAdapterPersistence> {
  if (!options.createStoreAsync) throw new Error('RAG vector store async conformance requires createStoreAsync.');
  await usingStoreAsync(await options.createStoreAsync(context), async (store) => {
    await store.upsert(CONFORMANCE_CORPUS[0], embedder.embed(CONFORMANCE_CORPUS[0].text));
  });
  let persisted = false;
  await usingStoreAsync(await options.createStoreAsync(context), async (reopened) => {
    const result = await reopened.search('refund policy', embedder.embed('refund policy'), { topK: 1 });
    persisted = result.chunks[0]?.id === CONFORMANCE_CORPUS[0].id;
  });
  return persisted ? 'durable' : 'ephemeral';
}

function defaultConformanceRunNamespace(): string {
  conformanceRunSequence += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `run-${Date.now().toString(36)}-${conformanceRunSequence.toString(36)}-${random}`;
}

function expectThrow(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(`expected error matching ${pattern}, got '${message}'.`);
    return;
  }
  throw new Error(`expected error matching ${pattern}, but no error was thrown.`);
}

async function expectThrowAsync(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(`expected error matching ${pattern}, got '${message}'.`);
    return;
  }
  throw new Error(`expected error matching ${pattern}, but no error was thrown.`);
}

function safeConformanceNamespace(name: string): string {
  return name.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'case';
}

function conformanceSummary(
  cases: readonly RagVectorStoreConformanceCaseResult[],
): RagVectorStoreConformanceReport['summary'] {
  return {
    passed: cases.filter((entry) => entry.status === 'passed').length,
    failed: cases.filter((entry) => entry.status === 'failed').length,
    skipped: cases.filter((entry) => entry.status === 'skipped').length,
  };
}
