/**
 * P1.0 discriminating-oracle gate.
 *
 * Proves the RAG eval fixtures are *discriminating*: the real cosine retriever
 * passes every case, and each deliberately-broken "mutant" retriever fails at
 * least one case. A fixture that a wrong retriever can still pass is a
 * non-discriminating oracle (the atan2(0,1) trap) — this test exists so that
 * never ships silently.
 */

import {
  createEmbeddingRetriever,
  createInMemoryRetriever,
  DeterministicHashEmbedder,
  EmbeddingRagIndex,
  evaluateRagEvalContract,
  InMemoryRagCorpus,
  type RagChunkInput,
  type RagContractRetriever,
  type RagSemanticEvalAssertFact,
  type RagSemanticEvalCaseFact,
  type RagSemanticEvalFact,
  tokenizeForRetrieval,
} from '../src/index.js';

const MAX_TOP_K = 1000;

// A corpus engineered so cosine, Jaccard, tie-break, top-k and score-magnitude
// each diverge somewhere — that divergence is what makes the cases discriminating.
const CORPUS: RagChunkInput[] = [
  { id: 'refund-exact', text: 'refund refunds policy window', source: 'docs/refunds.md' },
  { id: 'refund-super', text: 'refund refunds policy window plus extra alpha beta', source: 'docs/refunds.md' },
  { id: 'shipping', text: 'shipping delivery courier tracking parcel', source: 'docs/shipping.md' },
  { id: 'super-only', text: 'gamma delta epsilon zeta eta theta iota kappa', source: 'docs/super.md' },
  { id: 'aaa-keep', text: 'unicorn rainbow sparkle', source: 'docs/keep.md' },
  { id: 'zzz-drop', text: 'unicorn rainbow sparkle', source: 'docs/drop.md' },
];

function assertTarget(kind: string): RagSemanticEvalAssertFact['target'] {
  if (kind === 'uniqueSourcesGte' || kind === 'chunkCountEq') return 'retrieved-chunks';
  if (kind === 'latencyLte') return 'latency';
  if (kind === 'citesRequired') return 'grounding';
  return 'retrieved-chunk';
}

function assertOp(kind: string): RagSemanticEvalAssertFact['op'] {
  switch (kind) {
    case 'scoreGte':
    case 'uniqueSourcesGte':
      return 'gte';
    case 'scoreLte':
    case 'latencyLte':
      return 'lte';
    case 'contains':
      return 'contains';
    case 'sourceGlob':
      return 'glob';
    case 'citesRequired':
      return 'present';
    default:
      return 'eq';
  }
}

function assertFact(kind: string, value?: string | number): RagSemanticEvalAssertFact {
  return {
    kind,
    target: assertTarget(kind),
    op: assertOp(kind),
    ...(value !== undefined ? { value } : {}),
    required: true,
  };
}

function caseFact(
  name: string,
  query: string,
  expected: RagSemanticEvalCaseFact['expected'],
  asserts: RagSemanticEvalAssertFact[],
): RagSemanticEvalCaseFact {
  return { name, query, tags: [], expected, asserts };
}

const CASES: Record<string, RagSemanticEvalCaseFact> = {
  count: caseFact('count', 'refund refunds policy window', { topK: 1 }, [assertFact('chunkCountEq', 1)]),
  scoreFloor: caseFact('score-floor', 'refund refunds policy window', { topK: 1 }, [assertFact('scoreGte', 0.9)]),
  cosineMargin: caseFact('cosine-margin', 'gamma delta epsilon zeta', { topK: 1 }, [assertFact('scoreGte', 0.6)]),
  tieBreak: caseFact('tie-break', 'unicorn rainbow sparkle', { topK: 1 }, [assertFact('sourceEq', 'docs/keep.md')]),
};

function evalFact(cases: RagSemanticEvalCaseFact[]): RagSemanticEvalFact {
  return { name: 'RagOracle', ragName: 'AnswerDocs', metric: 'faithfulness', mode: 'contract', cases };
}

const realIndex = new EmbeddingRagIndex(CORPUS, { embedder: new DeterministicHashEmbedder() });
const realRetriever = createEmbeddingRetriever(realIndex);

// ── Mutant retrievers — each violates exactly one correctness property ──
const offByOneTopK: RagContractRetriever = (query, options = {}) =>
  realIndex.retrieve(query, { ...options, topK: (options.topK ?? 5) + 1 });

const signFlip: RagContractRetriever = (query, options = {}) => {
  const all = realIndex.retrieve(query, { ...options, topK: MAX_TOP_K });
  const chunks = all.chunks
    .map((chunk) => ({ ...chunk, score: 1 - chunk.score }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, options.topK ?? 5);
  return { query: all.query, chunks };
};

const wrongTieBreak: RagContractRetriever = (query, options = {}) => {
  const all = realIndex.retrieve(query, { ...options, topK: MAX_TOP_K });
  const chunks = [...all.chunks]
    .sort((a, b) => b.score - a.score || b.id.localeCompare(a.id)) // id DESCENDING — wrong tie-break
    .slice(0, options.topK ?? 5);
  return { query: all.query, chunks };
};

const jaccardImposter: RagContractRetriever = createInMemoryRetriever(new InMemoryRagCorpus(CORPUS));

const wrongL2: RagContractRetriever = (query, options = {}) => {
  // Skip L2 normalisation: rank by raw token-overlap "dot product". Scores escape [0,1].
  const queryTokens = tokenizeForRetrieval(query);
  const chunks = CORPUS.map((chunk) => {
    const chunkTokens = tokenizeForRetrieval(chunk.text);
    let dot = 0;
    for (const token of queryTokens) if (chunkTokens.has(token)) dot += 1;
    return { chunk, score: dot };
  })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, options.topK ?? 5)
    .map(({ chunk, score }) => ({
      id: chunk.id,
      text: chunk.text,
      score,
      source: chunk.source,
      citation: chunk.citation ?? { uri: chunk.source },
    }));
  return { query, chunks };
};

const MUTANTS: Record<string, RagContractRetriever> = {
  offByOneTopK,
  signFlip,
  wrongTieBreak,
  jaccardImposter,
  wrongL2,
};

describe('RAG eval discriminating-oracle gate (P1.0)', () => {
  const fullFact = evalFact(Object.values(CASES));

  test('the real cosine retriever passes every case', () => {
    const result = evaluateRagEvalContract(fullFact, realRetriever);
    expect(result.passed).toBe(true);
    expect(result.passedCaseCount).toBe(result.caseCount);
  });

  test.each(Object.keys(MUTANTS))('mutant "%s" fails the oracle (is caught)', (name) => {
    const result = evaluateRagEvalContract(fullFact, MUTANTS[name]);
    expect(result.passed).toBe(false);
  });

  // Targeted discrimination: each case kills a specific mutant while the real retriever passes it.
  const discrimination: Array<[keyof typeof CASES, string]> = [
    ['count', 'offByOneTopK'],
    ['scoreFloor', 'signFlip'],
    ['scoreFloor', 'wrongL2'],
    ['cosineMargin', 'jaccardImposter'],
    ['tieBreak', 'wrongTieBreak'],
  ];

  test.each(discrimination)('case "%s" passes real but kills mutant "%s"', (caseKey, mutantName) => {
    const single = evalFact([CASES[caseKey]]);
    expect(evaluateRagEvalContract(single, realRetriever).passed).toBe(true);
    expect(evaluateRagEvalContract(single, MUTANTS[mutantName]).passed).toBe(false);
  });
});
