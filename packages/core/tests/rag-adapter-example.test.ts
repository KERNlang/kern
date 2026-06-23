import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CORE_DIST_INDEX = resolve(ROOT, 'packages/core/dist/index.js');

type ExampleAdapterStore = {
  upsert(chunk: unknown, vector: Float64Array, fingerprint?: string): void;
  upsertMany(
    entries: Iterable<{
      readonly chunk: unknown;
      readonly vector: Float64Array;
      readonly fingerprint?: string;
    }>,
  ): void;
  search(
    query: unknown,
    queryVector: Float64Array,
    options?: { readonly topK?: number; readonly minScore?: number } | null,
    fingerprint?: string,
  ): { readonly chunks: readonly { readonly id: string; readonly score: number }[] };
  snapshot(): {
    readonly version: string;
    readonly fingerprint: string;
    readonly dims: number;
    readonly metric: string;
    readonly entries: readonly {
      readonly chunk: { readonly id: string };
      readonly vector: readonly number[];
      readonly fingerprint: string;
    }[];
  };
  clear(): void;
  close(): void;
};

type ExampleAdapterModule = {
  readonly exampleRagVectorStoreContract: {
    readonly createStore: (context: {
      readonly fingerprint: string;
      readonly dims: number;
      readonly namespace: string;
    }) => ExampleAdapterStore;
  };
};

describe('RAG vector store adapter example', () => {
  test('plain JavaScript example adapter passes public conformance', () => {
    assertCoreDistBuilt();
    const result = spawnSync(process.execPath, ['examples/rag-vector-store-adapter/adapter.mjs'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 10_000,
    });

    assertExampleProcessSucceeded(result);
    const parsed = parseExampleJson(result.stdout, result.stderr);
    const total = parsed.summary.passed + parsed.summary.failed + parsed.summary.skipped;
    expect(total).toBeGreaterThan(0);
    expect(parsed.profile).toBe('kern-rag-vector-store-conformance-v1');
    expect(parsed.adapter).toBe('example-external-memory');
    expect(parsed.passed).toBe(true);
    expect(parsed.summary.failed).toBe(0);
  });

  test('plain JavaScript example adapter fails closed on malformed inputs', async () => {
    const store = await createExampleStore();

    try {
      expect(() => store.upsert({ id: '', text: '', source: '' }, new Float64Array([1, 0]))).toThrow(/chunk id/u);
      expect(() =>
        store.upsert({ id: 'bad-vector', text: 'bad vector', source: 'test' }, null as unknown as Float64Array),
      ).toThrow(/Float64Array/u);
      expect(() => store.search(123, new Float64Array([1, 0]))).toThrow(/query must be a string/u);
      expect(() => store.search('query', null as unknown as Float64Array)).toThrow(/Float64Array/u);
      expect(() => store.search('query', new Float64Array([1, 0]), null)).toThrow(/options/u);
      expect(() => store.search('query', new Float64Array([1, 0]), undefined, 'other:fingerprint')).toThrow(
        /fingerprint mismatch/u,
      );
      expect(() => store.search('query', new Float64Array([1, 0]), { topK: Number.MAX_SAFE_INTEGER })).toThrow(/topK/u);
      expect(() => store.search('query', new Float64Array([1, 0]), { minScore: 2 })).toThrow(/minScore/u);
      expect(() =>
        store.upsert(
          { id: 'wrong-fingerprint', text: 'wrong fingerprint', source: 'test' },
          new Float64Array([1, 0]),
          'other:fingerprint',
        ),
      ).toThrow(/fingerprint mismatch/u);
      expect(() =>
        store.upsertMany([
          {
            chunk: { id: 'wrong-fingerprint-many', text: 'wrong fingerprint', source: 'test' },
            vector: new Float64Array([1, 0]),
            fingerprint: 'other:fingerprint',
          },
        ]),
      ).toThrow(/fingerprint mismatch/u);
      expect(() => store.upsertMany(null as unknown as [])).toThrow(/entries must be iterable/u);
      expect(() =>
        store.upsertMany([null as unknown as { readonly chunk: unknown; readonly vector: Float64Array }]),
      ).toThrow(/entry must be an object/u);
    } finally {
      store.close();
    }
  });

  test('plain JavaScript example adapter keeps retrieval defaults aligned with core', async () => {
    const store = await createExampleStore();

    try {
      store.upsertMany([
        ...Array.from({ length: 6 }, (_, index) => ({
          chunk: { id: `positive-${index}`, text: `positive ${index}`, source: 'test' },
          vector: new Float64Array([1, 0]),
        })),
        {
          chunk: { id: 'zero-score', text: 'zero score', source: 'test' },
          vector: new Float64Array([0, 0]),
        },
      ]);

      const result = store.search('query', new Float64Array([1, 0]));
      expect(result.chunks).toHaveLength(5);
      expect(result.chunks.every((chunk) => chunk.score > 0)).toBe(true);
      expect(result.chunks.map((chunk) => chunk.id)).not.toContain('zero-score');
    } finally {
      store.close();
    }
  });

  test('plain JavaScript example adapter snapshots and clears deterministically', async () => {
    const store = await createExampleStore();

    try {
      store.upsert({ id: 'snapshot', text: 'snapshot chunk', source: 'test' }, new Float64Array([1, 0]));

      expect(store.search('query', new Float64Array([1, 0]), { topK: 1 }).chunks).toHaveLength(1);
      expect(store.snapshot()).toMatchObject({
        version: 'kern-rag-vector-store-v1',
        fingerprint: 'example:fingerprint',
        dims: 2,
        metric: 'cosine',
        entries: [
          {
            chunk: { id: 'snapshot' },
            vector: [1, 0],
            fingerprint: 'example:fingerprint',
          },
        ],
      });

      store.clear();
      expect(store.search('query', new Float64Array([1, 0]), { topK: 1 }).chunks).toEqual([]);
      // Adapter close is intentionally idempotent so callers can safely clean up in finally blocks.
      store.close();
      store.close();
    } finally {
      store.close();
    }
  });
});

async function createExampleStore(): Promise<ExampleAdapterStore> {
  assertCoreDistBuilt();
  const module = (await import(
    pathToFileURL(resolve(ROOT, 'examples/rag-vector-store-adapter/adapter.mjs')).href
  )) as ExampleAdapterModule;
  return module.exampleRagVectorStoreContract.createStore({
    fingerprint: 'example:fingerprint',
    dims: 2,
    namespace: 'test',
  });
}

function assertCoreDistBuilt(): void {
  if (!existsSync(CORE_DIST_INDEX)) {
    throw new Error(
      'RAG adapter example tests require packages/core/dist/index.js. Run `pnpm --filter @kernlang/core build` first.',
    );
  }
}

function assertExampleProcessSucceeded(result: ReturnType<typeof spawnSync>): void {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `example adapter process failed with status ${result.status ?? '<null>'}\nstdout:\n${result.stdout}\nstderr:\n${
        result.stderr
      }`,
    );
  }
}

function parseExampleJson(
  stdout: string,
  stderr: string,
): {
  readonly profile: string;
  readonly adapter: string;
  readonly passed: boolean;
  readonly summary: { readonly passed: number; readonly failed: number; readonly skipped: number };
} {
  try {
    return JSON.parse(stdout) as {
      readonly profile: string;
      readonly adapter: string;
      readonly passed: boolean;
      readonly summary: { readonly passed: number; readonly failed: number; readonly skipped: number };
    };
  } catch (error) {
    throw new Error(`failed to parse example adapter JSON output\nstdout:\n${stdout}\nstderr:\n${stderr}`, {
      cause: error,
    });
  }
}
