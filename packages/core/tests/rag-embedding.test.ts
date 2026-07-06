import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type AsyncEmbedder,
  AsyncEmbeddingRagIndex,
  asAsyncEmbedder,
  createEmbeddingRetriever,
  DEFAULT_HASH_EMBEDDER_ID,
  DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID,
  DeterministicHashEmbedder,
  EmbeddingRagIndex,
  embedderFingerprint,
  embeddingCosine,
  fnv1a32,
  InMemoryPgVectorRagStore,
  LocalSemanticEmbedder,
  OpenAIEmbeddingAdapter,
  type OpenAIEmbeddingAdapterOptions,
  type RagChunkInput,
  RagEmbeddingProviderUnavailableError,
  type RagVectorStoreAdapter,
} from '../src/index.js';
import { LocalPersistentRagVectorStoreAdapter } from '../src/rag-embedding-node.js';

const CORPUS: RagChunkInput[] = [
  { id: 'refunds', text: 'refund refunds policy window thirty days money back', source: 'docs/refunds.md' },
  { id: 'shipping', text: 'shipping delivery courier tracking parcel transit', source: 'docs/shipping.md' },
  { id: 'returns', text: 'return exchange store credit receipt policy window', source: 'docs/returns.md' },
];

describe('DeterministicHashEmbedder', () => {
  const embedder = new DeterministicHashEmbedder();

  test('exposes a stable id and dims', () => {
    expect(embedder.id).toBe(DEFAULT_HASH_EMBEDDER_ID);
    expect(embedder.dims).toBe(256);
  });

  test('fnv1a32 is deterministic and unsigned 32-bit', () => {
    const a = fnv1a32('refund');
    const b = fnv1a32('refund');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    expect(fnv1a32('refund')).not.toBe(fnv1a32('shipping'));
  });

  test('same text embeds byte-identically', () => {
    expect(Array.from(embedder.embed('refund policy window'))).toEqual(
      Array.from(embedder.embed('refund policy window')),
    );
  });

  test('non-empty text is L2-normalised (unit length)', () => {
    const v = embedder.embed('refund refunds policy');
    const norm = Math.sqrt(Array.from(v).reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  test('empty / token-free text embeds to the zero vector', () => {
    expect(Array.from(embedder.embed('   ')).every((x) => x === 0)).toBe(true);
  });

  test('cosine of identical text is exactly 1; disjoint tokens score lower', () => {
    const a = embedder.embed('refund refunds policy window');
    const exact = embedder.embed('refund refunds policy window');
    const disjoint = embedder.embed('shipping delivery courier tracking parcel');
    expect(embeddingCosine(a, exact)).toBe(1);
    expect(embeddingCosine(a, disjoint)).toBeLessThan(embeddingCosine(a, exact));
  });

  test('scores are rounded to <= 6 decimals (stable fixed-point)', () => {
    const q = embedder.embed('refund refunds policy window thirty days money back');
    const c = embedder.embed(CORPUS[2].text);
    const score = embeddingCosine(q, c);
    expect(score).toBe(Math.round(score * 1_000_000) / 1_000_000);
    expect(Object.is(score, -0)).toBe(false);
  });
});

describe('LocalSemanticEmbedder', () => {
  const embedder = new LocalSemanticEmbedder();

  test('exposes a stable semantic id and dims', () => {
    expect(embedder.id).toBe(DEFAULT_LOCAL_SEMANTIC_EMBEDDER_ID);
    expect(embedder.dims).toBe(64);
  });

  test('same text embeds deterministically', () => {
    expect(Array.from(embedder.embed('the car drove fast'))).toEqual(Array.from(embedder.embed('the car drove fast')));
  });

  test('semantic aliases rank above unrelated text', () => {
    const query = embedder.embed('the car drove fast');
    const related = embedder.embed('the automobile moved quickly');
    const unrelated = embedder.embed('the weather forecast changed');
    expect(embeddingCosine(query, related)).toBeGreaterThan(embeddingCosine(query, unrelated));
  });
});

describe('OpenAIEmbeddingAdapter', () => {
  test('posts embeddings requests through injected fetch and validates dimensions', async () => {
    const calls: unknown[] = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), { status: 200 });
    };
    const embedder = new OpenAIEmbeddingAdapter({
      model: 'text-embedding-3-small',
      dims: 3,
      apiKey: 'test-key',
      fetch: fakeFetch,
    });

    expect(Array.from(await embedder.embed('refund policy'))).toEqual([1, 0, 0]);
    expect(calls).toEqual([{ model: 'text-embedding-3-small', input: 'refund policy', dimensions: 3 }]);
  });

  test('fails closed when constructed without an API key', () => {
    expect(() => new OpenAIEmbeddingAdapter({ model: 'text-embedding-3-small', dims: 3 })).toThrow(
      /requires an apiKey/u,
    );
  });

  test('accepts non-enumerable API key options', async () => {
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(init?.headers).toEqual(
        expect.objectContaining({
          authorization: 'Bearer test-key',
        }),
      );
      return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), { status: 200 });
    };
    const options = { model: 'text-embedding-3-small', dims: 3, fetch: fakeFetch } as OpenAIEmbeddingAdapterOptions;
    Object.defineProperty(options, 'apiKey', {
      value: 'test-key',
      enumerable: false,
    });

    expect(JSON.stringify(options)).not.toContain('test-key');
    const embedder = new OpenAIEmbeddingAdapter(options);
    await expect(embedder.embed('refund policy')).resolves.toEqual(new Float64Array([1, 0, 0]));
  });

  test('wraps provider transport errors with KERN context', async () => {
    const embedder = new OpenAIEmbeddingAdapter({
      model: 'text-embedding-3-small',
      dims: 3,
      apiKey: 'test-key',
      fetch: async (): Promise<Response> => {
        throw new Error('socket closed');
      },
    });

    await expect(embedder.embed('refund policy')).rejects.toThrow(
      /KERN OpenAI embedder request failed: socket closed/u,
    );
  });

  test('fails closed on provider dimension mismatch', async () => {
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), { status: 200 });
    const embedder = new OpenAIEmbeddingAdapter({
      model: 'text-embedding-3-small',
      dims: 3,
      apiKey: 'test-key',
      fetch: fakeFetch,
    });

    await expect(embedder.embed('refund policy')).rejects.toThrow(/returned 2 dimensions/u);
  });

  test('normalizes malformed provider JSON responses', async () => {
    const embedder = new OpenAIEmbeddingAdapter({
      model: 'text-embedding-3-small',
      dims: 3,
      apiKey: 'test-key',
      fetch: async (): Promise<Response> => new Response('not-json', { status: 200 }),
    });

    await expect(embedder.embed('refund policy')).rejects.toThrow(RagEmbeddingProviderUnavailableError);
  });

  test('normalizes malformed provider embedding payloads', async () => {
    const embedder = new OpenAIEmbeddingAdapter({
      model: 'text-embedding-3-small',
      dims: 3,
      apiKey: 'test-key',
      fetch: async (): Promise<Response> =>
        new Response(JSON.stringify({ data: [{ embedding: ['bad'] }] }), { status: 200 }),
    });

    await expect(embedder.embed('refund policy')).rejects.toThrow(RagEmbeddingProviderUnavailableError);
  });
});

describe('InMemoryPgVectorRagStore', () => {
  test('rejects query vectors from a different embedding fingerprint', () => {
    const embedder = new DeterministicHashEmbedder();
    const fingerprint = embedderFingerprint(embedder, 'cosine');
    const store = new InMemoryPgVectorRagStore(fingerprint, embedder.dims);
    store.upsertMany([{ chunk: CORPUS[0], vector: embedder.embed(CORPUS[0].text) }]);

    expect(() =>
      store.search('refund policy', embedder.embed('refund policy'), {}, 'openai:model:1536:cosine'),
    ).toThrow(/fingerprint mismatch/u);
  });

  test('async local adapter retrieves through the pgvector-like store', async () => {
    const embedder = asAsyncEmbedder(new LocalSemanticEmbedder());
    const fingerprint = embedderFingerprint(embedder, 'cosine');
    const store = new InMemoryPgVectorRagStore(fingerprint, embedder.dims);
    for (const chunk of CORPUS) store.upsert(chunk, await embedder.embed(chunk.text), fingerprint);

    const query = 'refund refunds policy window thirty days money back';
    const result = store.search(query, await embedder.embed(query), { topK: 1 });

    expect(result.chunks[0].id).toBe('refunds');
  });

  test('exposes deterministic adapter snapshots and clear semantics', () => {
    const embedder = new DeterministicHashEmbedder();
    const fingerprint = embedderFingerprint(embedder, 'cosine');
    const store = new InMemoryPgVectorRagStore(fingerprint, embedder.dims);
    store.upsert(CORPUS[0], embedder.embed(CORPUS[0].text));

    expect(store.snapshot()).toEqual(
      expect.objectContaining({
        version: 'kern-rag-vector-store-v1',
        fingerprint,
        dims: embedder.dims,
        metric: 'cosine',
        entries: [
          expect.objectContaining({
            chunk: CORPUS[0],
            fingerprint,
          }),
        ],
      }),
    );

    expect(store.snapshot().entries.map((entry) => entry.chunk.id)).toEqual(['refunds']);
    store.clear();
    expect(store.search('refund policy', embedder.embed('refund policy')).chunks).toEqual([]);
  });

  test('adapter snapshots are sorted by chunk id', () => {
    const embedder = new DeterministicHashEmbedder();
    const fingerprint = embedderFingerprint(embedder, 'cosine');
    const store = new InMemoryPgVectorRagStore(fingerprint, embedder.dims);
    store.upsertMany(
      [CORPUS[1], CORPUS[0]].map((chunk) => ({
        chunk,
        vector: embedder.embed(chunk.text),
      })),
    );

    expect(store.snapshot().entries.map((entry) => entry.chunk.id)).toEqual(['refunds', 'shipping']);
  });

  test('local persistent adapter reloads vector entries from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-vector-store-'));
    try {
      const embedder = new LocalSemanticEmbedder();
      const fingerprint = embedderFingerprint(embedder, 'cosine');
      const first = new LocalPersistentRagVectorStoreAdapter({
        directory: dir,
        fingerprint,
        dims: embedder.dims,
      });
      first.upsertMany(
        CORPUS.slice(0, 2).map((chunk) => ({
          chunk,
          vector: embedder.embed(chunk.text),
        })),
      );
      first.close();

      const reloaded = new LocalPersistentRagVectorStoreAdapter({
        directory: dir,
        fingerprint,
        dims: embedder.dims,
      });
      try {
        const result = reloaded.search('refund refunds policy', embedder.embed('refund refunds policy'), { topK: 2 });

        expect(result.chunks[0]).toEqual(expect.objectContaining({ id: 'refunds', source: 'docs/refunds.md' }));
        expect(reloaded.snapshot().entries).toHaveLength(2);
      } finally {
        reloaded.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('local persistent adapter rejects a second live writer for the same file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-vector-store-'));
    try {
      const embedder = new DeterministicHashEmbedder();
      const options = {
        directory: dir,
        fingerprint: embedderFingerprint(embedder, 'cosine'),
        dims: embedder.dims,
      };
      const first: RagVectorStoreAdapter = new LocalPersistentRagVectorStoreAdapter(options);
      try {
        expect(() => new LocalPersistentRagVectorStoreAdapter(options)).toThrow(/already open for writing/u);
      } finally {
        first.close();
      }
      const reopened = new LocalPersistentRagVectorStoreAdapter(options);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('local persistent adapter fails closed on incompatible snapshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-vector-store-'));
    try {
      const embedder = new DeterministicHashEmbedder();
      writeFileSync(
        join(dir, 'vectors.json'),
        JSON.stringify({
          version: 'kern-rag-vector-store-v1',
          fingerprint: 'other',
          dims: embedder.dims,
          metric: 'cosine',
          entries: [],
        }),
        'utf-8',
      );

      expect(
        () =>
          new LocalPersistentRagVectorStoreAdapter({
            directory: dir,
            fingerprint: embedderFingerprint(embedder, 'cosine'),
            dims: embedder.dims,
          }),
      ).toThrow(/fingerprint mismatch/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('local persistent adapter recovers a complete temp snapshot on open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-vector-store-'));
    try {
      const embedder = new DeterministicHashEmbedder();
      const fingerprint = embedderFingerprint(embedder, 'cosine');
      writeFileSync(
        join(dir, 'vectors.json.tmp'),
        JSON.stringify({
          version: 'kern-rag-vector-store-v1',
          fingerprint,
          dims: embedder.dims,
          metric: 'cosine',
          entries: [
            {
              chunk: CORPUS[0],
              vector: Array.from(embedder.embed(CORPUS[0].text)),
              fingerprint,
            },
          ],
        }),
        'utf-8',
      );

      const store = new LocalPersistentRagVectorStoreAdapter({ directory: dir, fingerprint, dims: embedder.dims });
      try {
        expect(store.snapshot().entries.map((entry) => entry.chunk.id)).toEqual(['refunds']);
        expect(existsSync(join(dir, 'vectors.json'))).toBe(true);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('local persistent adapter rejects malformed snapshot entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-vector-store-'));
    try {
      const embedder = new DeterministicHashEmbedder();
      const fingerprint = embedderFingerprint(embedder, 'cosine');
      writeFileSync(
        join(dir, 'vectors.json'),
        JSON.stringify({
          version: 'kern-rag-vector-store-v1',
          fingerprint,
          dims: embedder.dims,
          metric: 'cosine',
          entries: [null],
        }),
        'utf-8',
      );

      expect(
        () =>
          new LocalPersistentRagVectorStoreAdapter({
            directory: dir,
            fingerprint,
            dims: embedder.dims,
          }),
      ).toThrow(/entry must be an object/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('local persistent adapter constrains custom snapshot file names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-vector-store-'));
    try {
      const embedder = new DeterministicHashEmbedder();
      expect(
        () =>
          new LocalPersistentRagVectorStoreAdapter({
            directory: dir,
            fileName: '../vectors.json',
            fingerprint: embedderFingerprint(embedder, 'cosine'),
            dims: embedder.dims,
          }),
      ).toThrow(/plain file name/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('local persistent adapter validates file name before creating its directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'kern-rag-vector-store-'));
    const dir = join(parent, 'not-created');
    try {
      const embedder = new DeterministicHashEmbedder();
      expect(
        () =>
          new LocalPersistentRagVectorStoreAdapter({
            directory: dir,
            fileName: '../vectors.json',
            fingerprint: embedderFingerprint(embedder, 'cosine'),
            dims: embedder.dims,
          }),
      ).toThrow(/plain file name/u);
      expect(existsSync(dir)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test('async index deduplicates concurrent query embeddings', async () => {
    let embedCalls = 0;
    const embedder: AsyncEmbedder = {
      id: 'async-test',
      dims: 2,
      async embed(text: string): Promise<Float64Array> {
        embedCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        return text.includes('refund') ? new Float64Array([1, 0]) : new Float64Array([0, 1]);
      },
    };
    const index = await AsyncEmbeddingRagIndex.create(CORPUS, { embedder });
    embedCalls = 0;

    await Promise.all([index.retrieve('refund policy'), index.retrieve('refund policy')]);

    expect(embedCalls).toBe(1);
  });
});

describe('EmbeddingRagIndex', () => {
  const index = new EmbeddingRagIndex(CORPUS);

  test('ranks the exact lexical match first with score 1 and defaults citation to source', () => {
    const result = index.retrieve('refund refunds policy window thirty days money back');
    expect(result.query).toBe('refund refunds policy window thirty days money back');
    expect(result.chunks[0]).toEqual(
      expect.objectContaining({
        id: 'refunds',
        score: 1,
        source: 'docs/refunds.md',
        citation: { uri: 'docs/refunds.md' },
      }),
    );
  });

  test('respects topK', () => {
    expect(index.retrieve('policy window', { topK: 1 }).chunks).toHaveLength(1);
  });

  test('filters by minScore', () => {
    const result = index.retrieve('refund refunds policy window thirty days money back', { minScore: 0.99 });
    expect(result.chunks.every((c) => c.score >= 0.99)).toBe(true);
    expect(result.chunks).toHaveLength(1);
  });

  test('drops chunks with no token overlap (score 0)', () => {
    const result = index.retrieve('refund policy');
    expect(result.chunks.some((c) => c.id === 'shipping')).toBe(false);
  });

  test('empty query yields no chunks', () => {
    expect(index.retrieve('   ').chunks).toEqual([]);
  });

  test('breaks score ties by id ascending (stable, deterministic)', () => {
    const tied = new EmbeddingRagIndex([
      { id: 'zzz', text: 'unicorn rainbow sparkle', source: 'docs/z.md' },
      { id: 'aaa', text: 'unicorn rainbow sparkle', source: 'docs/a.md' },
    ]);
    const ids = tied.retrieve('unicorn rainbow sparkle').chunks.map((c) => c.id);
    expect(ids).toEqual(['aaa', 'zzz']);
  });

  test('rejects malformed top-k', () => {
    expect(() => index.retrieve('refund', { topK: 0 })).toThrow();
    expect(() => index.retrieve('refund', { minScore: 2 })).toThrow();
  });

  test('createEmbeddingRetriever matches index.retrieve and records embedder id', () => {
    const retriever = createEmbeddingRetriever(index);
    expect(retriever('refund policy window')).toEqual(index.retrieve('refund policy window'));
    expect(index.embedderId).toBe(DEFAULT_HASH_EMBEDDER_ID);
  });

  test('retrieval is reproducible across rebuilds (same corpus -> identical result)', () => {
    const a = new EmbeddingRagIndex(CORPUS).retrieve('refund refunds policy window', { topK: 3 });
    const b = new EmbeddingRagIndex(CORPUS).retrieve('refund refunds policy window', { topK: 3 });
    expect(a).toEqual(b);
  });

  test('upserts duplicate chunk ids (last-write-wins, no duplicate-id crash)', () => {
    const idx = new EmbeddingRagIndex([
      { id: 'dup', text: 'first refund policy window', source: 'docs/a.md' },
      { id: 'dup', text: 'second shipping courier parcel', source: 'docs/b.md' },
    ]);
    expect(idx.size).toBe(1);
    const result = idx.retrieve('shipping courier parcel');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].source).toBe('docs/b.md');
  });

  test('defensively copies chunks so caller mutation does not leak into retrieval', () => {
    const metadata = { tag: 'v1' };
    const chunk: RagChunkInput = { id: 'm', text: 'refund policy window', source: 'docs/m.md', metadata };
    const idx = new EmbeddingRagIndex([chunk]);
    metadata.tag = 'MUTATED';
    const result = idx.retrieve('refund policy window');
    expect((result.chunks[0].metadata as { tag: string }).tag).toBe('v1');
  });
});
