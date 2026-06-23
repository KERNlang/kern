import {
  DeterministicHashEmbedder,
  type Embedder,
  embedderFingerprint,
  InMemoryPgVectorRagStore,
  type RagVectorStoreAdapter,
  type RagVectorStoreKind,
  type RagVectorStoreMetric,
} from './rag-embedding.js';
import type { RagChunkInput } from './rag-runtime.js';

export type RagAdapterPersistence = 'ephemeral' | 'durable';
export type RagVectorStoreConformanceStatus = 'passed' | 'failed' | 'skipped';
export type RagVectorStoreConformanceProfileVersion = 'kern-rag-vector-store-conformance-v1';

export interface RagVectorStoreAdapterCapabilities {
  readonly upsert: boolean;
  readonly upsertMany: boolean;
  readonly search: boolean;
  readonly snapshot: boolean;
  readonly clear: boolean;
}

export interface RagVectorStoreAdapterManifest {
  readonly name: string;
  readonly kind: 'vectorStore';
  readonly adapterKind: RagVectorStoreKind;
  readonly version: string;
  readonly metrics: readonly RagVectorStoreMetric[];
  readonly maxDimensions: number;
  readonly persistence: RagAdapterPersistence;
  readonly capabilities: RagVectorStoreAdapterCapabilities;
}

export interface RagVectorStoreManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface RagVectorStoreAdapterContract {
  readonly manifest: RagVectorStoreAdapterManifest;
  readonly createStore: (context: RagVectorStoreConformanceContext) => RagVectorStoreAdapter;
}

export interface RagVectorStoreConformanceProfile {
  readonly version: RagVectorStoreConformanceProfileVersion;
  readonly kind: 'vectorStore';
  readonly requiredCapabilities: readonly (keyof RagVectorStoreAdapterCapabilities)[];
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

export interface RagVectorStoreConformanceOptions {
  readonly manifest: RagVectorStoreAdapterManifest;
  readonly createStore: (context: RagVectorStoreConformanceContext) => RagVectorStoreAdapter;
  readonly embedder?: Embedder;
  /** Optional namespace seed for programmatic callers that need reproducible backing file names. */
  readonly runId?: string;
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
const RAG_VECTOR_STORE_CONFORMANCE_CASE_NAMES: readonly string[] = [
  'manifest-shape',
  'manifest-matches-adapter',
  'persistence-matches-adapter',
  'empty-search-returns-empty-list',
  'upsert-search-ranks-related-chunk',
  'topk-is-respected',
  'dimension-mismatch-fails-closed',
  'fingerprint-mismatch-fails-closed',
  'snapshot-is-deterministic-and-sorted',
  'clear-removes-indexed-vectors',
  'durable-round-trip',
];

export const RAG_VECTOR_STORE_CONFORMANCE_PROFILE: RagVectorStoreConformanceProfile = {
  version: 'kern-rag-vector-store-conformance-v1',
  kind: 'vectorStore',
  requiredCapabilities: REQUIRED_RAG_VECTOR_STORE_CAPABILITIES,
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
    metrics: ['cosine'],
    maxDimensions: 4096,
    persistence: 'ephemeral',
    capabilities: {
      upsert: true,
      upsertMany: true,
      search: true,
      snapshot: true,
      clear: true,
    },
  },
  {
    name: 'local-persistent',
    kind: 'vectorStore',
    adapterKind: 'local-persistent',
    version: '1.0.0',
    metrics: ['cosine'],
    maxDimensions: 4096,
    persistence: 'durable',
    capabilities: {
      upsert: true,
      upsertMany: true,
      search: true,
      snapshot: true,
      clear: true,
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
  if (typeof contract.createStore !== 'function') {
    throw new Error('RAG vector store adapter contract createStore must be a function.');
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
  const embedder = options.embedder ?? new DeterministicHashEmbedder({ dims: 64 });
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
  if (!Number.isInteger(candidate.maxDimensions) || (candidate.maxDimensions ?? 0) <= 0) {
    errors.push('manifest maxDimensions must be a positive integer.');
  }
  if (!candidate.capabilities || typeof candidate.capabilities !== 'object') {
    errors.push('manifest capabilities must be an object.');
    return;
  }
  for (const capability of REQUIRED_RAG_VECTOR_STORE_CAPABILITIES) {
    if (candidate.capabilities[capability] !== true) errors.push(`manifest capability '${capability}' must be true.`);
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
