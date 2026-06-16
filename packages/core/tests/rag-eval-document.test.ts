/**
 * P1.2 end-to-end: a parsed `.kern` RAG document's `ragEval` runs against a real
 * cosine retriever (not the lexical reference corpus) and yields pass/fail.
 */

import { evaluateRagEvalDocument, type RagChunkInput } from '../src/index.js';

const DOC = `corpus name=Docs title="Support docs"
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown
  chunking source=manuals strategy=semantic maxTokens=600 overlap=80 unit=tokens

embed name=DocsEmbedding corpus=Docs model=text-embedding-3-small dims=1536 metric=cosine

retriever name=DocsSearch corpus=Docs embed=DocsEmbedding mode=hybrid topK=4 minScore=0.72

rag name=AnswerDocs retriever=DocsSearch prompt="./answer.md" citations=true
  grounding name=StrictGrounding requireCitations=true policy=strict maxContext=6000
  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund refunds policy window" topK=1
      ragAssert kind=scoreGte threshold=0.5 required=true
      ragAssert kind=sourceGlob value="docs/refunds*" required=true
      ragAssert kind=citesRequired
`;

const CORPUS: RagChunkInput[] = [
  { id: 'refunds', text: 'refund refunds policy window thirty days money back', source: 'docs/refunds.md' },
  { id: 'shipping', text: 'shipping delivery courier tracking parcel', source: 'docs/shipping.md' },
];

describe('evaluateRagEvalDocument (P1.2 end-to-end)', () => {
  test('runs a parsed ragEval against real cosine retrieval and passes', () => {
    const report = evaluateRagEvalDocument(DOC, CORPUS);
    expect(report.embedderId).toBe('local-hash-v1');
    expect(report.evals).toHaveLength(1);
    expect(report.evals[0].ragName).toBe('AnswerDocs');
    expect(report.evals[0].evalName).toBe('Faithfulness');
    expect(report.passed).toBe(true);
    expect(report.evals[0].result.passedCaseCount).toBe(1);
  });

  test('reports failure when the corpus cannot satisfy the assertions', () => {
    const offTopic: RagChunkInput[] = [
      { id: 'weather', text: 'sunshine clouds rain forecast temperature', source: 'docs/weather.md' },
    ];
    const report = evaluateRagEvalDocument(DOC, offTopic);
    expect(report.passed).toBe(false);
  });

  test('a document with no ragEval is not vacuously passing', () => {
    const report = evaluateRagEvalDocument('corpus name=Docs title="x"\n', CORPUS);
    expect(report.evals).toHaveLength(0);
    expect(report.passed).toBe(false);
  });
});
