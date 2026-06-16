import {
  createEmbeddingRetriever,
  DEFAULT_HASH_EMBEDDER_ID,
  DeterministicHashEmbedder,
  EmbeddingRagIndex,
  embeddingCosine,
  fnv1a32,
  type RagChunkInput,
} from '../src/index.js';

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
});
