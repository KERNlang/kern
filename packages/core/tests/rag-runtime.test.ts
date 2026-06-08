import {
  createInMemoryRetriever,
  InMemoryRagCorpus,
  MAX_IN_MEMORY_RAG_TOP_K,
  retrieveFromInMemoryCorpus,
  tokenizeForRetrieval,
} from '../src/index.js';

describe('RAG in-memory runtime retrieval', () => {
  test('ranks exact lexical matches first', () => {
    const corpus = new InMemoryRagCorpus([
      { id: 'b', text: 'refund policy', source: 'docs/refunds.md' },
      { id: 'a', text: 'shipping policy', source: 'docs/shipping.md' },
    ]);

    const result = retrieveFromInMemoryCorpus(corpus, 'refund policy');

    expect(result.query).toBe('refund policy');
    expect(result.chunks[0]).toEqual(
      expect.objectContaining({
        id: 'b',
        score: 1,
        source: 'docs/refunds.md',
        citation: { uri: 'docs/refunds.md' },
      }),
    );
  });

  test('limits results by topK', () => {
    const corpus = new InMemoryRagCorpus(
      Array.from({ length: 10 }, (_, index) => ({
        id: `chunk-${index}`,
        text: `refund policy ${index}`,
        source: `docs/${index}.md`,
      })),
    );

    expect(retrieveFromInMemoryCorpus(corpus, 'refund policy', { topK: 3 }).chunks).toHaveLength(3);
  });

  test('filters results by minScore', () => {
    const corpus = new InMemoryRagCorpus([
      { id: 'weak', text: 'refund unrelated unrelated unrelated', source: 'docs/weak.md' },
      { id: 'none', text: 'shipping delivery', source: 'docs/none.md' },
    ]);

    expect(retrieveFromInMemoryCorpus(corpus, 'refund policy', { minScore: 0.5 }).chunks).toEqual([]);
  });

  test('orders results by descending score', () => {
    const corpus = new InMemoryRagCorpus([
      { id: 'partial', text: 'refund shipping', source: 'docs/partial.md' },
      { id: 'exact', text: 'refund policy', source: 'docs/exact.md' },
      { id: 'weak', text: 'refund shipping returns', source: 'docs/weak.md' },
    ]);

    const scores = retrieveFromInMemoryCorpus(corpus, 'refund policy').chunks.map((chunk) => chunk.score);

    expect(scores.length).toBeGreaterThan(1);
    for (let index = 0; index < scores.length - 1; index += 1) {
      expect(scores[index]).toBeGreaterThanOrEqual(scores[index + 1]);
    }
  });

  test('breaks score ties by chunk id deterministically', () => {
    const corpus = new InMemoryRagCorpus([
      { id: 'b', text: 'refund', source: 'docs/b.md' },
      { id: 'a', text: 'refund', source: 'docs/a.md' },
    ]);
    const retrieve = createInMemoryRetriever(corpus);

    expect(retrieve('refund').chunks.map((chunk) => chunk.id)).toEqual(['a', 'b']);
    expect(retrieve('refund').chunks.map((chunk) => chunk.id)).toEqual(['a', 'b']);
  });

  test('returns empty results for empty corpus and empty queries', () => {
    const empty = new InMemoryRagCorpus();
    expect(retrieveFromInMemoryCorpus(empty, 'refund').chunks).toEqual([]);

    const corpus = new InMemoryRagCorpus([{ id: 'refunds', text: 'refund policy', source: 'docs/refunds.md' }]);
    expect(retrieveFromInMemoryCorpus(corpus, '   ').chunks).toEqual([]);
  });

  test('preserves citation and metadata provenance', () => {
    const corpus = new InMemoryRagCorpus([
      {
        id: 'refunds',
        text: 'refund policy',
        source: 'docs/refunds.md',
        citation: { uri: 'file:///docs/refunds.md', locator: 'L10-L20' },
        metadata: { section: 'policy' },
      },
    ]);

    expect(retrieveFromInMemoryCorpus(corpus, 'refund policy').chunks[0]).toEqual(
      expect.objectContaining({
        id: 'refunds',
        citation: { uri: 'file:///docs/refunds.md', locator: 'L10-L20' },
        metadata: { section: 'policy' },
      }),
    );
  });

  test('returns defensive copies from corpus reads', () => {
    const circularMetadata: Record<string, unknown> = { section: 'policy', nested: { owner: 'support' } };
    circularMetadata.self = circularMetadata;
    const corpus = new InMemoryRagCorpus([
      {
        id: 'refunds',
        text: 'refund policy',
        source: 'docs/refunds.md',
        citation: { uri: 'docs/refunds.md' },
        metadata: circularMetadata,
      },
    ]);

    const snapshot = corpus.get('refunds');
    if (!snapshot) throw new Error('missing fixture chunk');
    (snapshot.metadata as Record<string, unknown>).section = 'mutated';
    ((snapshot.metadata as Record<string, unknown>).nested as Record<string, unknown>).owner = 'mutated';
    (snapshot.citation as Record<string, unknown>).uri = 'mutated';

    expect(corpus.retrieve('refund policy').chunks[0]).toEqual(
      expect.objectContaining({
        citation: { uri: 'docs/refunds.md' },
        metadata: expect.objectContaining({ section: 'policy', nested: { owner: 'support' } }),
      }),
    );
  });

  test('upserts chunks by id without changing retrieval determinism', () => {
    const corpus = new InMemoryRagCorpus([{ id: 'refunds', text: 'old refund policy', source: 'docs/old.md' }]);

    corpus.add({ id: 'refunds', text: 'updated return policy', source: 'docs/new.md' });

    expect(corpus.size).toBe(1);
    expect(corpus.retrieve('updated return policy').chunks[0]).toEqual(
      expect.objectContaining({ id: 'refunds', source: 'docs/new.md' }),
    );
  });

  test('validates retrieval options and chunk identity inputs', () => {
    const corpus = new InMemoryRagCorpus([{ id: 'refunds', text: 'refund policy', source: 'docs/refunds.md' }]);

    expect(() => retrieveFromInMemoryCorpus(corpus, 'refund', { topK: 0 })).toThrow('topK');
    expect(() => retrieveFromInMemoryCorpus(corpus, 'refund', { topK: MAX_IN_MEMORY_RAG_TOP_K + 1 })).toThrow('topK');
    expect(() => retrieveFromInMemoryCorpus(corpus, 'refund', { minScore: 1.1 })).toThrow('minScore');
    expect(() => retrieveFromInMemoryCorpus(corpus, 1 as unknown as string)).toThrow('query');
    expect(() => corpus.add({ id: ' ', text: 'bad', source: 'docs/bad.md' })).toThrow('chunk id');
    expect(() => corpus.add({ id: 'bad', text: ' ', source: 'docs/bad.md' })).toThrow('text');
    expect(() => corpus.add({ id: 'bad', text: 'bad', source: ' ' })).toThrow('source');
    expect(() =>
      corpus.add({ id: 1, text: 'bad', source: 'docs/bad.md' } as unknown as Parameters<InMemoryRagCorpus['add']>[0]),
    ).toThrow('chunk id');
  });

  test('tokenizes Unicode text for non-English retrieval', () => {
    const corpus = new InMemoryRagCorpus([
      { id: 'resume', text: 'résumé policy', source: 'docs/resume.md' },
      { id: 'jp', text: '日本語 ガイド', source: 'docs/jp.md' },
    ]);

    expect([...tokenizeForRetrieval('résumé 日本語')]).toEqual(['résumé', '日本語']);
    expect(retrieveFromInMemoryCorpus(corpus, 'résumé').chunks[0]?.id).toBe('resume');
    expect(retrieveFromInMemoryCorpus(corpus, '日本語').chunks[0]?.id).toBe('jp');
  });
});
