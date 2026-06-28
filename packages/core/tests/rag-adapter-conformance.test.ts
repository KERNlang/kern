import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type AsyncRagVectorStoreAdapter,
  builtinRagVectorStoreManifest,
  createInMemoryRagVectorStoreForConformance,
  defineRagVectorStoreAdapterContract,
  InMemoryPgVectorRagStore,
  RAG_VECTOR_STORE_CONFORMANCE_PROFILE,
  type RagChunkInput,
  type RagVectorStoreConformanceContext,
  type RagVectorStoreSnapshot,
  type RagVectorStoreUpsert,
  type RetrieveOptions,
  type RetrieveResult,
  runRagVectorStoreConformance,
  runRagVectorStoreConformanceAsync,
  validateRagVectorStoreAdapterManifest,
} from '../src/index.js';
import { LocalPersistentRagVectorStoreAdapter } from '../src/rag-embedding-node.js';

describe('RAG vector store adapter conformance', () => {
  test('exports a stable vector store conformance profile for adapter authors', () => {
    expect(RAG_VECTOR_STORE_CONFORMANCE_PROFILE.version).toBe('kern-rag-vector-store-conformance-v2');
    expect(RAG_VECTOR_STORE_CONFORMANCE_PROFILE.requiredCapabilities).toContain('search');
    expect(RAG_VECTOR_STORE_CONFORMANCE_PROFILE.requiredManifestFields).toContain('transport');
    expect(RAG_VECTOR_STORE_CONFORMANCE_PROFILE.requiredManifestFields).toContain('capabilities.maxDimensions');
    expect(RAG_VECTOR_STORE_CONFORMANCE_PROFILE.supportedMetrics).toContain('cosine');
    expect(RAG_VECTOR_STORE_CONFORMANCE_PROFILE.cases).toContain('durable-round-trip');
    expect(RAG_VECTOR_STORE_CONFORMANCE_PROFILE.cases).toContain('batch-upsert-is-honored');
    expect(RAG_VECTOR_STORE_CONFORMANCE_PROFILE.cases).toContain('namespace-isolation');
  });

  test('validates and defines adapter author contracts', () => {
    const manifest = builtinRagVectorStoreManifest('memory');
    expect(manifest).toBeDefined();

    const validation = validateRagVectorStoreAdapterManifest(manifest!);
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
    expect(manifest!.transport).toBe('in-process');
    expect(manifest!.capabilities).toEqual(
      expect.objectContaining({
        upsertMany: true,
        namespaces: false,
        filters: [],
        maxDimensions: manifest!.maxDimensions,
      }),
    );

    const contract = defineRagVectorStoreAdapterContract({
      manifest: manifest!,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(contract.manifest.name).toBe('memory');
  });

  test('adapter author contract helper rejects invalid manifests', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      version: '',
    };

    const validation = validateRagVectorStoreAdapterManifest(manifest);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('version'))).toBe(true);
    expect(() =>
      defineRagVectorStoreAdapterContract({
        manifest,
        createStore: createInMemoryRagVectorStoreForConformance,
      }),
    ).toThrow(/invalid RAG vector store adapter manifest/u);
  });

  test('adapter author contract helper rejects ambiguous factory variants', () => {
    const manifest = builtinRagVectorStoreManifest('memory')!;

    expect(() =>
      defineRagVectorStoreAdapterContract({
        manifest,
        createStore: createInMemoryRagVectorStoreForConformance,
        createStoreAsync: async (context) => createAsyncMemoryStore(context),
      } as never),
    ).toThrow(/exactly one of createStore or createStoreAsync/u);
  });

  test('manifest validation reports malformed plain JavaScript inputs', () => {
    const missingManifest = validateRagVectorStoreAdapterManifest(undefined);
    expect(missingManifest.valid).toBe(false);
    expect(missingManifest.errors).toContain('manifest must be an object.');

    const malformedManifest = validateRagVectorStoreAdapterManifest({
      name: 'bad',
      kind: 'vectorStore',
      adapterKind: 'memory',
      version: '1.0.0',
      maxDimensions: 64,
    });
    expect(malformedManifest.valid).toBe(false);
    expect(malformedManifest.errors).toContain('manifest metrics must include only supported metrics: cosine.');
    expect(malformedManifest.errors).toContain("manifest persistence must be 'ephemeral' or 'durable'.");
    expect(malformedManifest.errors).toContain("manifest transport must be 'in-process' or 'external'.");
    expect(malformedManifest.errors).toContain('manifest capabilities must be an object.');

    const invalidMetric = validateRagVectorStoreAdapterManifest({
      ...builtinRagVectorStoreManifest('memory')!,
      metrics: ['cosine', 'invalid'],
    });
    expect(invalidMetric.valid).toBe(false);
    expect(invalidMetric.errors).toContain('manifest metrics must include only supported metrics: cosine.');

    const invalidCapabilities = validateRagVectorStoreAdapterManifest({
      ...builtinRagVectorStoreManifest('memory')!,
      capabilities: {
        ...builtinRagVectorStoreManifest('memory')!.capabilities,
        filters: ['unsupported'],
        maxDimensions: 128,
      },
    });
    expect(invalidCapabilities.valid).toBe(false);
    expect(invalidCapabilities.errors).toContain(
      "manifest capability filter 'unsupported' is not supported by this conformance profile.",
    );
    expect(invalidCapabilities.errors).toContain(
      "manifest capability 'maxDimensions' must match manifest maxDimensions.",
    );
  });

  test('conformance profile case names match emitted report cases', () => {
    const manifest = builtinRagVectorStoreManifest('memory');
    expect(manifest).toBeDefined();

    const report = runRagVectorStoreConformance({
      manifest: manifest!,
      createStore: createInMemoryRagVectorStoreForConformance,
      runId: 'profile-case-list',
    });

    expect(report.cases.map((entry) => entry.name).sort()).toEqual(
      [...RAG_VECTOR_STORE_CONFORMANCE_PROFILE.cases].sort(),
    );
  });

  test('built-in memory adapter passes deterministic conformance with durable case skipped', () => {
    const manifest = builtinRagVectorStoreManifest('memory');
    expect(manifest).toBeDefined();

    const report = runRagVectorStoreConformance({
      manifest: manifest!,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(true);
    expect(report.adapterMode).toBe('sync');
    expect(report.summary.failed).toBe(0);
    expect(report.cases.some((entry) => entry.name === 'durable-round-trip' && entry.status === 'skipped')).toBe(true);
    expect(report.cases.some((entry) => entry.name === 'namespace-isolation' && entry.status === 'skipped')).toBe(true);
  });

  test('async vector store adapter contracts pass the same conformance profile', async () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      transport: 'external' as const,
    };

    const report = await runRagVectorStoreConformanceAsync({
      manifest,
      createStoreAsync: async (context) => createAsyncMemoryStore(context),
    });

    expect(report.passed).toBe(true);
    expect(report.adapterMode).toBe('async');
    expect(report.cases.map((entry) => entry.name).sort()).toEqual(
      [...RAG_VECTOR_STORE_CONFORMANCE_PROFILE.cases].sort(),
    );
  });

  test('built-in local persistent adapter passes durable conformance', () => {
    const manifest = builtinRagVectorStoreManifest('local-persistent');
    expect(manifest).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-conformance-'));
    try {
      const report = runRagVectorStoreConformance({
        manifest: manifest!,
        createStore: (context) =>
          new LocalPersistentRagVectorStoreAdapter({
            directory: dir,
            fileName: `${context.namespace}.json`,
            fingerprint: context.fingerprint,
            dims: context.dims,
          }),
      });

      expect(report.passed).toBe(true);
      expect(report.cases.some((entry) => entry.name === 'durable-round-trip' && entry.status === 'passed')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('namespace capability requires same-namespace handles to share backing data', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('local-persistent')!,
      capabilities: {
        ...builtinRagVectorStoreManifest('local-persistent')!.capabilities,
        namespaces: true,
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-conformance-'));
    try {
      const report = runRagVectorStoreConformance({
        manifest,
        createStore: (context) =>
          new LocalPersistentRagVectorStoreAdapter({
            directory: dir,
            fileName: `${context.namespace}.json`,
            fingerprint: context.fingerprint,
            dims: context.dims,
          }),
      });

      expect(report.passed).toBe(true);
      expect(report.cases.some((entry) => entry.name === 'namespace-isolation' && entry.status === 'passed')).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('namespace capability rejects adapters that only create fresh isolated instances', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      capabilities: {
        ...builtinRagVectorStoreManifest('memory')!.capabilities,
        namespaces: true,
      },
    };

    const report = runRagVectorStoreConformance({
      manifest,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(false);
    expect(
      report.cases.some(
        (entry) =>
          entry.name === 'namespace-isolation' &&
          entry.status === 'failed' &&
          entry.message === 'expected same namespace handle to read indexed chunk.',
      ),
    ).toBe(true);
  });

  test('repeated local persistent conformance runs isolate backing files by default', () => {
    const manifest = builtinRagVectorStoreManifest('local-persistent');
    expect(manifest).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-conformance-'));
    try {
      const createStore = (context: RagVectorStoreConformanceContext) =>
        new LocalPersistentRagVectorStoreAdapter({
          directory: dir,
          fileName: `${context.namespace}.json`,
          fingerprint: context.fingerprint,
          dims: context.dims,
        });

      const first = runRagVectorStoreConformance({ manifest: manifest!, createStore });
      const second = runRagVectorStoreConformance({ manifest: manifest!, createStore });

      expect(first.passed).toBe(true);
      expect(second.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('local persistent adapter recovers stale locks from dead processes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-stale-lock-'));
    try {
      const context: RagVectorStoreConformanceContext = {
        namespace: 'stale-lock',
        fingerprint: 'test-fingerprint',
        dims: 3,
      };
      writeFileSync(
        join(dir, 'vectors.json.lock'),
        JSON.stringify({
          version: 'kern-rag-vector-store-lock-v1',
          pid: 99999999,
          filePath: join(dir, 'vectors.json'),
        }),
      );

      const store = new LocalPersistentRagVectorStoreAdapter({
        directory: dir,
        fingerprint: context.fingerprint,
        dims: context.dims,
      });
      try {
        expect(store.kind).toBe('local-persistent');
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('local persistent adapter recovers malformed stale locks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-malformed-lock-'));
    try {
      writeFileSync(join(dir, 'vectors.json.lock'), '{');

      const store = new LocalPersistentRagVectorStoreAdapter({
        directory: dir,
        fingerprint: 'test-fingerprint',
        dims: 3,
      });
      try {
        expect(store.kind).toBe('local-persistent');
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('manifest shape failures are reported instead of thrown', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      metrics: [],
    };

    const report = runRagVectorStoreConformance({
      manifest,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(false);
    expect(report.cases.some((entry) => entry.name === 'manifest-shape' && entry.status === 'failed')).toBe(true);
  });

  test('manifest adapter mismatches are reported instead of thrown', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      adapterKind: 'local-persistent' as const,
    };

    const report = runRagVectorStoreConformance({
      manifest,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(false);
    expect(report.cases.some((entry) => entry.name === 'manifest-matches-adapter' && entry.status === 'failed')).toBe(
      true,
    );
  });

  test('manifest persistence mismatches are reported instead of thrown', () => {
    const manifest = {
      ...builtinRagVectorStoreManifest('memory')!,
      persistence: 'durable' as const,
    };

    const report = runRagVectorStoreConformance({
      manifest,
      createStore: createInMemoryRagVectorStoreForConformance,
    });

    expect(report.passed).toBe(false);
    expect(
      report.cases.some((entry) => entry.name === 'persistence-matches-adapter' && entry.status === 'failed'),
    ).toBe(true);
  });
});

function createAsyncMemoryStore(context: RagVectorStoreConformanceContext): AsyncRagVectorStoreAdapter {
  const store = new InMemoryPgVectorRagStore(context.fingerprint, context.dims);
  return {
    get kind() {
      return store.kind;
    },
    get fingerprint() {
      return store.fingerprint;
    },
    get dims() {
      return store.dims;
    },
    get metric() {
      return store.metric;
    },
    async upsert(chunk: RagChunkInput, vector: Float64Array, fingerprint?: string): Promise<void> {
      store.upsert(chunk, vector, fingerprint);
    },
    async upsertMany(entries: Iterable<RagVectorStoreUpsert>): Promise<void> {
      store.upsertMany(entries);
    },
    async search(
      query: string,
      queryVector: Float64Array,
      options?: RetrieveOptions,
      fingerprint?: string,
    ): Promise<RetrieveResult> {
      return store.search(query, queryVector, options, fingerprint);
    },
    async snapshot(): Promise<RagVectorStoreSnapshot> {
      return store.snapshot();
    },
    async clear(): Promise<void> {
      store.clear();
    },
    close(): void {
      store.close();
    },
  };
}
