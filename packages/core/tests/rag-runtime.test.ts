import type { RagSemanticEvalFact } from '../src/index.js';
import {
  createInMemoryRetriever,
  evaluateRagEvalContract,
  hashRetrievedChunkText,
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
    expect([...tokenizeForRetrieval('résumé')]).toEqual(['résumé']);
    expect(retrieveFromInMemoryCorpus(corpus, 'résumé').chunks[0]?.id).toBe('resume');
    expect(retrieveFromInMemoryCorpus(corpus, 'résumé').chunks[0]?.id).toBe('resume');
    expect(retrieveFromInMemoryCorpus(corpus, '日本語').chunks[0]?.id).toBe('jp');
  });
});

describe('RAG eval runtime contracts', () => {
  test('evaluates passing RAG eval cases against retrieved chunks', () => {
    const corpus = new InMemoryRagCorpus([
      {
        id: 'refunds',
        text: 'refund policy',
        source: 'docs/refunds.md',
        citation: { uri: 'docs/refunds.md', locator: 'L1-L2' },
        metadata: { section: 'policy' },
      },
      {
        id: 'policy',
        text: 'policy details',
        source: 'docs/policies.md',
        citation: { uri: 'docs/policies.md' },
      },
    ]);
    const refundHash = hashRetrievedChunkText('refund policy');
    expect(refundHash).toMatch(/^[a-f0-9]{32}$/);
    const evalFact: RagSemanticEvalFact = {
      name: 'Faithfulness',
      ragName: 'AnswerDocs',
      mode: 'contract',
      cases: [
        {
          name: 'refunds',
          ragName: 'AnswerDocs',
          evalName: 'Faithfulness',
          query: 'refund policy',
          tags: ['smoke'],
          expected: { topK: 1, minScore: 0.25, sources: ['docs/refunds.md'] },
          asserts: [
            assertFact('scoreGte', 0.25),
            assertFact('sourceGlob', 'docs/*.md'),
            assertFact('contains', 'refund'),
            assertFact('uniqueSourcesGte', 1),
            assertFact('chunkCountEq', 1),
            assertFact('citesRequired', true),
            assertFact('factId', 'AnswerDocs:Faithfulness:refunds'),
            assertFact('chunkHash', refundHash),
            assertFact('latencyLte', 1),
          ],
        },
      ],
    };
    let now = 10;

    const result = evaluateRagEvalContract(evalFact, createInMemoryRetriever(corpus), {
      now: () => now++,
    });

    expect(result.passed).toBe(true);
    expect(result.caseCount).toBe(1);
    expect(result.passedAssertionCount).toBe(result.assertionCount);
    expect(result.cases[0]?.retrieveOptions).toEqual({ topK: 1, minScore: 0.25 });
    expect(result.cases[0]?.assertions.map((assertion) => assertion.code)).toEqual(
      new Array(result.cases[0]?.assertions.length).fill('PASS'),
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  test('reports failing RAG eval contracts and retriever errors as structured diagnostics', () => {
    const corpus = new InMemoryRagCorpus([
      { id: 'shipping', text: 'shipping details', source: 'docs/shipping.md', citation: { uri: 'docs/shipping.md' } },
    ]);
    const evalFact: RagSemanticEvalFact = {
      name: 'Faithfulness',
      ragName: 'AnswerDocs',
      mode: 'contract',
      cases: [
        {
          name: 'refunds',
          query: 'refund policy',
          tags: [],
          expected: { chunkCount: 1, sources: ['docs/refunds.md'] },
          asserts: [
            assertFact('scoreGte', 0.5),
            assertFact('sourceEq', 'docs/refunds.md'),
            assertFact('scoreLte', 0.1),
            { ...assertFact('contains', ''), value: '' },
            { ...assertFact('unknownKind', 'x'), kind: 'unknownKind' },
          ],
        },
      ],
    };

    const result = evaluateRagEvalContract(evalFact, createInMemoryRetriever(corpus));
    const errorResult = evaluateRagEvalContract(evalFact, () => {
      throw new Error('offline');
    });

    expect(result.passed).toBe(false);
    expect(result.cases[0]?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'expected.chunkCount', passed: false, code: 'ASSERTION_FAIL' }),
        expect.objectContaining({ kind: 'expected.sources', passed: false, code: 'ASSERTION_FAIL' }),
        expect.objectContaining({ kind: 'contains', required: false, passed: false, code: 'INVALID_ASSERTION' }),
        expect.objectContaining({ kind: 'unknownKind', required: false, passed: false, code: 'UNSUPPORTED_ASSERTION' }),
      ]),
    );
    expect(errorResult.cases[0]?.assertions).toEqual([
      expect.objectContaining({ kind: 'retriever', passed: false, code: 'RETRIEVER_ERROR' }),
    ]);
    const missingChunksResult = evaluateRagEvalContract(
      evalFact,
      () =>
        ({
          query: 'refund policy',
        }) as unknown as ReturnType<ReturnType<typeof createInMemoryRetriever>>,
    );
    const malformedChunkResult = evaluateRagEvalContract(
      evalFact,
      () =>
        ({
          query: 'refund policy',
          chunks: [{ id: 'bad' }],
        }) as unknown as ReturnType<ReturnType<typeof createInMemoryRetriever>>,
    );
    const invalidScoreAndCitationResult = evaluateRagEvalContract(
      evalFact,
      () =>
        ({
          query: 'refund policy',
          chunks: [{ id: 'bad', text: 'bad', score: Number.NaN, source: 'docs/bad.md', citation: { uri: 1 } }],
        }) as unknown as ReturnType<ReturnType<typeof createInMemoryRetriever>>,
    );

    for (const invalidResult of [missingChunksResult, malformedChunkResult, invalidScoreAndCitationResult]) {
      expect(invalidResult).toEqual(expect.objectContaining({ passed: false }));
      expect(invalidResult.cases[0]?.assertions).toEqual([
        expect.objectContaining({ kind: 'retriever', passed: false, code: 'RETRIEVER_ERROR' }),
      ]);
    }
  });

  test('handles empty and assertion-less eval facts without crashing', () => {
    const corpus = new InMemoryRagCorpus([{ id: 'refunds', text: 'refund policy', source: 'docs/refunds.md' }]);

    expect(evaluateRagEvalContract({ name: 'Empty', cases: [] }, createInMemoryRetriever(corpus))).toEqual(
      expect.objectContaining({ passed: false, caseCount: 0 }),
    );
    expect(
      evaluateRagEvalContract(
        {
          name: 'NoAsserts',
          cases: [
            {
              name: 'refunds',
              query: 'refund policy',
              tags: [],
              expected: {},
            } as unknown as NonNullable<RagSemanticEvalFact['cases']>[number],
          ],
        },
        createInMemoryRetriever(corpus),
      ),
    ).toEqual(expect.objectContaining({ passed: true, caseCount: 1 }));
  });

  test('treats non-required assertion failures as advisory diagnostics', () => {
    const corpus = new InMemoryRagCorpus([
      { id: 'refunds', text: 'refund policy', source: 'docs/refunds.md', citation: { uri: 'docs/refunds.md' } },
    ]);
    const optionalFailure = evaluateRagEvalContract(
      {
        name: 'Advisory',
        ragName: 'AnswerDocs',
        cases: [
          {
            name: 'refunds',
            query: 'refund policy',
            tags: [],
            expected: { chunkCount: 1 },
            asserts: [assertFact('sourceEq', 'docs/missing.md')],
          },
        ],
      },
      createInMemoryRetriever(corpus),
    );
    const requiredFailure = evaluateRagEvalContract(
      {
        name: 'Required',
        ragName: 'AnswerDocs',
        cases: [
          {
            name: 'refunds',
            query: 'refund policy',
            tags: [],
            expected: { chunkCount: 1 },
            asserts: [{ ...assertFact('sourceEq', 'docs/missing.md'), required: true }],
          },
        ],
      },
      createInMemoryRetriever(corpus),
    );

    expect(optionalFailure).toEqual(expect.objectContaining({ passed: true, passedCaseCount: 1 }));
    expect(optionalFailure.cases[0]?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'sourceEq', required: false, passed: false, code: 'ASSERTION_FAIL' }),
      ]),
    );
    expect(requiredFailure).toEqual(expect.objectContaining({ passed: false, passedCaseCount: 0 }));
    expect(requiredFailure.cases[0]?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'sourceEq', required: true, passed: false, code: 'ASSERTION_FAIL' }),
      ]),
    );
  });
});

function assertFact(kind: string, value: string | number | boolean) {
  return {
    kind,
    target: ragAssertTarget(kind),
    op: ragAssertOp(kind),
    value,
    required: false,
  };
}

function ragAssertTarget(kind: string) {
  if (kind === 'uniqueSourcesGte' || kind === 'chunkCountEq') return 'retrieved-chunks' as const;
  if (kind === 'latencyLte') return 'latency' as const;
  if (kind === 'citesRequired') return 'grounding' as const;
  return 'retrieved-chunk' as const;
}

function ragAssertOp(kind: string) {
  switch (kind) {
    case 'scoreGte':
    case 'uniqueSourcesGte':
      return 'gte' as const;
    case 'scoreLte':
    case 'latencyLte':
      return 'lte' as const;
    case 'contains':
      return 'contains' as const;
    case 'sourceGlob':
      return 'glob' as const;
    case 'citesRequired':
      return 'present' as const;
    default:
      return 'eq' as const;
  }
}
