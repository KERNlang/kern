import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type AsyncEmbedder,
  type Embedder,
  parseRetrievedChunkCitationProvenance,
  retrieveRagDocument,
  retrieveRagDocumentAsync,
} from '../src/index.js';
import { createAsyncLocalRagRetrieveCapability, createLocalRagCapability } from '../src/rag-retrieve-runner.js';

const DOC = `corpus name=Docs
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown
  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens

embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine
vectorStore name=DocsMemory kind=memory dims=64 metric=cosine
ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding
retriever name=DocsSearch corpus=Docs embed=DocsEmbedding
rag name=AnswerDocs retriever=DocsSearch citations=true
  grounding requireCitations=true
  ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"
`;

const FIXED_QUERY_DOC = DOC.replace(
  'ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
  'ragRetrieve name=FindDocs index=DocsIndex query="refund policy money back" topK=1 output="RetrievedChunk[]"',
);

const DYNAMIC_QUERY_DOC = DOC.replace(
  'ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
  'ragRetrieve name=FindDocs index=DocsIndex query={{ "refund policy money back" }} topK=1 output="RetrievedChunk[]"',
);

const TEMPLATE_QUERY_DOC = DOC.replace(
  'ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
  'ragRetrieve name=FindDocs index=DocsIndex queryTemplate="{{topic:string}} policy {{year:number}}" topK=1 output="RetrievedChunk[]"',
);

const PROTOTYPE_QUERY_PARAM_DOC = DOC.replace('queryParam=question', 'queryParam=toString');

const PROFILE_DOC = DOC.replace(
  'rag name=AnswerDocs retriever=DocsSearch citations=true',
  [
    'retrievalProfile name=SupportDefault queryParam=question topK=2 minScore=0.1 output="RetrievedChunk[]"',
    'rag name=AnswerDocs retriever=DocsSearch citations=true',
  ].join('\n'),
).replace(
  '  ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
  '  ragRetrieve name=FindDocs index=DocsIndex profile=SupportDefault',
);

const PROFILE_OVERRIDE_DOC = PROFILE_DOC.replace(
  'ragRetrieve name=FindDocs index=DocsIndex profile=SupportDefault',
  'ragRetrieve name=FindDocs index=DocsIndex profile=SupportDefault query="refund policy money back" topK=1 minScore=0',
);

const PROFILE_TEMPLATE_DOC = PROFILE_DOC.replace(
  'retrievalProfile name=SupportDefault queryParam=question topK=2 minScore=0.1 output="RetrievedChunk[]"',
  'retrievalProfile name=SupportDefault queryTemplate="{{topic:string}} policy {{year:number}}" topK=2 minScore=0 output="RetrievedChunk[]"',
);

const PROFILE_FILTER_DOC = PROFILE_DOC.replace(
  'retrievalProfile name=SupportDefault queryParam=question topK=2 minScore=0.1 output="RetrievedChunk[]"',
  'retrievalProfile name=SupportDefault queryParam=question topK=2 minScore=0 filterPath="docs/shipping.md" output="RetrievedChunk[]"',
);

const PROFILE_FILTER_OVERRIDE_DOC = PROFILE_FILTER_DOC.replace(
  'ragRetrieve name=FindDocs index=DocsIndex profile=SupportDefault',
  'ragRetrieve name=FindDocs index=DocsIndex profile=SupportDefault filterPath="docs/refunds.md"',
);

const INDEX_CHUNKING_DOC = DOC.replace(
  'chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
  'chunking name=Large source=manuals strategy=window maxTokens=2 overlap=0 unit=tokens',
).replace(
  'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding',
  'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=Large',
);

const INDEX_CHUNKING_SOURCE_MISMATCH_DOC = INDEX_CHUNKING_DOC.replace(
  'source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
  [
    'source name=manuals kind=local uri="./docs/refunds.md" media=markdown',
    '  source name=shipping kind=local uri="./docs/shipping.md" media=markdown',
  ].join('\n  '),
);

const ASYNC_PROVIDER_MEMORY_DOC = DOC.replace(
  'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
  'embed name=DocsEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=3 metric=cosine',
).replace(
  'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
  'vectorStore name=DocsMemory kind=memory dims=3 metric=cosine',
);

const FAKE_PROVIDER_MEMORY_DOC = ASYNC_PROVIDER_MEMORY_DOC.replace(
  'model="openai:text-embedding-3-small"',
  'model="fake:deterministic"',
);

const ASYNC_PROVIDER_LOCAL_PERSISTENT_DOC = ASYNC_PROVIDER_MEMORY_DOC.replace(
  'vectorStore name=DocsMemory kind=memory dims=3 metric=cosine',
  'vectorStore name=DocsMemory kind=local-persistent dims=3 metric=cosine path="./index"',
);

const LOCAL_PERSISTENT_STORE_DOC = DOC.replace(
  'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
  'vectorStore name=DocsMemory kind=local-persistent dims=64 metric=cosine path="./index"',
);

const LOCAL_PERSISTENT_ESCAPE_DOC = LOCAL_PERSISTENT_STORE_DOC.replace('path="./index"', 'path="../outside"');

const LOCAL_PERSISTENT_SYMLINK_DOC = LOCAL_PERSISTENT_STORE_DOC.replace('path="./index"', 'path="./index-link"');

const LOCAL_PERSISTENT_NESTED_SYMLINK_DOC = LOCAL_PERSISTENT_STORE_DOC.replace(
  'path="./index"',
  'path="./a/index-link/subdir"',
);

const LOCAL_PERSISTENT_METADATA_DRIFT_DOC = LOCAL_PERSISTENT_STORE_DOC.replace(
  'uri="./docs/**/*.md"',
  'uri="docs/**/*.md"',
);

const LOCAL_PERSISTENT_SHARED_NAMESPACE_DOC = LOCAL_PERSISTENT_STORE_DOC.replace(
  'path="./index"',
  'path="./index" namespace=shared',
).replace(
  '  ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
  `  ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"
ragIndex name=DocsIndexMirror corpus=Docs store=DocsMemory embed=DocsEmbedding
  ragRetrieve name=FindDocsAgain index=DocsIndexMirror queryParam=question topK=1 output="RetrievedChunk[]"`,
);

const MULTI_INDEX_DOC = `corpus name=Docs
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown

corpus name=Faq
  source name=faq kind=local uri="./faq/**/*.md" media=markdown

embed name=DocsEmbedding corpus=Docs model="fake:deterministic" dims=3 metric=cosine
embed name=FaqEmbedding corpus=Faq model="fake:deterministic" dims=3 metric=cosine
vectorStore name=DocsMemory kind=memory dims=3 metric=cosine
vectorStore name=FaqMemory kind=memory dims=3 metric=cosine
ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding
ragIndex name=FaqIndex corpus=Faq store=FaqMemory embed=FaqEmbedding
ragRetrieve name=FindAll indexes="DocsIndex,FaqIndex" queryParam=question topK=2 output="RetrievedChunk[]"
`;

const OVERLAPPING_MULTI_INDEX_DOC = `corpus name=Docs
  source name=manuals kind=local uri="./docs/refunds.md" media=markdown

embed name=DocsEmbedding corpus=Docs model="fake:deterministic" dims=3 metric=cosine
vectorStore name=DocsMemory kind=memory dims=3 metric=cosine
ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding
ragIndex name=DocsIndexMirror corpus=Docs store=DocsMemory embed=DocsEmbedding
ragRetrieve name=FindDocs indexes="DocsIndex,DocsIndexMirror" queryParam=question topK=2 output="RetrievedChunk[]"
`;

function fakeProviderVector(text: string): Float64Array {
  const lower = text.toLowerCase();
  if (lower.includes('refund') || lower.includes('money')) return new Float64Array([1, 0, 0]);
  if (lower.includes('shipping') || lower.includes('delivery')) return new Float64Array([0, 1, 0]);
  return new Float64Array([0, 0, 1]);
}

const fakeAsyncEmbedder: AsyncEmbedder = {
  id: 'provider:fake-rag-test:dims=3',
  dims: 3,
  async embed(text: string): Promise<Float64Array> {
    return fakeProviderVector(text);
  },
  async embedMany(texts: readonly string[]): Promise<readonly Float64Array[]> {
    return texts.map(fakeProviderVector);
  },
};

const fakeMultiIndexEmbedder: Embedder = {
  id: 'local:fake-multi-index:dims=3',
  dims: 3,
  embed(text: string): Float64Array {
    const lower = text.toLowerCase();
    return new Float64Array([
      lower.includes('refund') || lower.includes('money') ? 1 : 0,
      lower.includes('password') || lower.includes('login') ? 1 : 0,
      lower.includes('shipping') || lower.includes('delivery') ? 1 : 0,
    ]);
  },
};

describe('retrieveRagDocument', () => {
  let dir: string;
  let outsideDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-rag-retrieve-'));
    outsideDir = undefined;
    mkdirSync(join(dir, 'docs'));
    mkdirSync(join(dir, 'faq'));
    writeFileSync(join(dir, 'spec.kern'), DOC);
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy money back within thirty days\n');
    writeFileSync(join(dir, 'docs/shipping.md'), 'shipping delivery courier tracking parcel\n');
    writeFileSync(join(dir, 'faq/passwords.md'), 'password login security reset recovery\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (outsideDir) rmSync(outsideDir, { recursive: true, force: true });
  });

  test('executes runtime retrieval contracts over declared local sources', () => {
    const report = retrieveRagDocument(DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals).toHaveLength(1);
    expect(report.retrievals[0]).toEqual(
      expect.objectContaining({
        name: 'FindDocs',
        indexName: 'DocsIndex',
        query: 'refund policy money back',
      }),
    );
    expect(report.retrievals[0]?.result.chunks[0]).toEqual(
      expect.objectContaining({
        source: 'docs/refunds.md',
        text: expect.stringContaining('refund policy money back'),
      }),
    );
  });

  test('creates a local rag.retrieve capability over declared local sources', () => {
    const capability = createLocalRagCapability(DOC, { sourcePath: join(dir, 'spec.kern') });

    const result = (
      capability as { retrieve: (call: { namespace: string; operation: string; input: unknown }) => unknown }
    ).retrieve({
      namespace: 'rag',
      operation: 'retrieve',
      input: { question: 'refund policy money back', retrieval: 'FindDocs' },
    });

    expect(Array.isArray(result)).toBe(true);
    const [chunk] = result as Array<Record<string, unknown>>;
    expect(typeof chunk.id).toBe('string');
    expect(String(chunk.text)).toContain('refund policy money back');
    expect(typeof chunk.score).toBe('number');
    expect(chunk.source).toBe('docs/refunds.md');
    expect(chunk.citationUri).toBe('docs/refunds.md');
    expect(typeof chunk.citationLocator).toBe('string');
  });

  test('PROVENANCE NORMALIZATION: rag.retrieve and rag.retrieveAsync emit byte-identical chunk provenance for the same query', async () => {
    const syncCapability = createLocalRagCapability(DOC, { sourcePath: join(dir, 'spec.kern') }) as {
      retrieve: (call: { namespace: string; operation: string; input: unknown }) => unknown;
    };
    const asyncCapability = createAsyncLocalRagRetrieveCapability(DOC, { sourcePath: join(dir, 'spec.kern') });

    const syncResult = syncCapability.retrieve({
      namespace: 'rag',
      operation: 'retrieve',
      input: { question: 'refund policy money back', retrieval: 'FindDocs' },
    });
    const asyncResult = await asyncCapability.retrieveAsync({
      input: { question: 'refund policy money back', retrieval: 'FindDocs' },
    });

    expect(Array.isArray(syncResult)).toBe(true);
    expect(asyncResult).toEqual(syncResult);
    const [chunk] = syncResult as Array<Record<string, unknown>>;
    // The one normalized wire shape: exactly these six fields, citation
    // provenance as `string | null` — never `undefined` — on both paths.
    expect(Object.keys(chunk).sort()).toEqual(['citationLocator', 'citationUri', 'id', 'score', 'source', 'text']);
  });

  test('creates local prompt context from rag.retrieve capability chunks', () => {
    const capability = createLocalRagCapability(DOC, { sourcePath: join(dir, 'spec.kern') }) as {
      promptContext: (call: { namespace: string; operation: string; input: unknown }) => unknown;
      retrieve: (call: { namespace: string; operation: string; input: unknown }) => unknown;
    };

    const chunks = capability.retrieve({
      namespace: 'rag',
      operation: 'retrieve',
      input: { question: 'refund policy money back', retrieval: 'FindDocs' },
    });
    const context = capability.promptContext({
      namespace: 'rag',
      operation: 'promptContext',
      input: { chunks, maxChars: 6000 },
    });

    expect(context).toEqual(
      expect.objectContaining({
        includedCount: 1,
        omittedCount: 0,
        truncated: false,
        maxChars: 6000,
        text: expect.stringContaining('refund policy money back within thirty days'),
      }),
    );
    expect((context as Record<string, unknown>).text).toContain('[1] id=');
    expect((context as Record<string, unknown>).text).toContain('source="docs/refunds.md"');
    expect((context as Record<string, unknown>).chunks).toEqual([
      expect.objectContaining({
        index: 0,
        source: 'docs/refunds.md',
        renderedText: 'refund policy money back within thirty days',
      }),
    ]);
  });

  test('checks a grounded answer over local rag.retrieve capability chunks', () => {
    const capability = createLocalRagCapability(DOC, { sourcePath: join(dir, 'spec.kern') }) as {
      checkAnswer: (call: { namespace: string; operation: string; input: unknown }) => unknown;
      retrieve: (call: { namespace: string; operation: string; input: unknown }) => unknown;
    };
    const chunks = capability.retrieve({
      namespace: 'rag',
      operation: 'retrieve',
      input: { question: 'refund policy money back', retrieval: 'FindDocs' },
    });

    const result = capability.checkAnswer({
      namespace: 'rag',
      operation: 'checkAnswer',
      input: {
        query: 'refund policy money back',
        answer: 'refund policy money back',
        chunks,
        groundingSpans: [{ start: 0, end: 24, chunkIndexes: [0], required: true }],
        requireCitations: true,
        minCitedChunks: 1,
        minGroundingCoverage: 1,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        passed: true,
        status: 'grounded',
        groundingCoverage: 1,
        sources: ['docs/refunds.md'],
      }),
    );
    expect((result as { citedChunkIds?: unknown }).citedChunkIds).toEqual(
      expect.arrayContaining([(chunks as Array<Record<string, unknown>>)[0]?.id]),
    );
  });

  test('infers local rag.checkAnswer grounding spans from inline citation markers', () => {
    const capability = createLocalRagCapability(DOC, { sourcePath: join(dir, 'spec.kern') }) as {
      checkAnswer: (call: { namespace: string; operation: string; input: unknown }) => unknown;
      retrieve: (call: { namespace: string; operation: string; input: unknown }) => unknown;
    };
    const chunks = capability.retrieve({
      namespace: 'rag',
      operation: 'retrieve',
      input: { question: 'refund policy money back', retrieval: 'FindDocs' },
    });

    const result = capability.checkAnswer({
      namespace: 'rag',
      operation: 'checkAnswer',
      input: {
        query: 'refund policy money back',
        answer: 'refund policy money back [1]',
        chunks,
        requireCitations: true,
        minCitedChunks: 1,
        minGroundingCoverage: 0.85,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        passed: true,
        status: 'grounded',
        sources: ['docs/refunds.md'],
      }),
    );
    expect((result as { groundingCoverage?: number }).groundingCoverage).toBeGreaterThan(0.85);

    const adjacent = capability.checkAnswer({
      namespace: 'rag',
      operation: 'checkAnswer',
      input: {
        query: 'refund policy money back',
        answer: 'refund policy money back [1] [1]',
        chunks,
        requireCitations: true,
        minCitedChunks: 1,
        minGroundingCoverage: 0.75,
      },
    });

    expect(adjacent).toEqual(expect.objectContaining({ passed: true, status: 'grounded' }));

    const punctuatedAdjacent = capability.checkAnswer({
      namespace: 'rag',
      operation: 'checkAnswer',
      input: {
        query: 'refund policy money back',
        answer: 'refund policy money back [1], [1]',
        chunks,
        requireCitations: true,
        minCitedChunks: 1,
        minGroundingCoverage: 0.75,
      },
    });

    expect(punctuatedAdjacent).toEqual(expect.objectContaining({ passed: true, status: 'grounded' }));

    const coverageOnly = capability.checkAnswer({
      namespace: 'rag',
      operation: 'checkAnswer',
      input: {
        query: 'refund policy money back',
        answer: 'refund policy money back [1]',
        chunks,
        minGroundingCoverage: 0.85,
      },
    });

    expect(coverageOnly).toEqual(expect.objectContaining({ passed: true, status: 'grounded' }));

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: '[1] refund policy money back',
          chunks,
          requireCitations: true,
        },
      }),
    ).toThrow(/must follow non-empty answer text/u);

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: 'refund policy money back [99]',
          chunks,
          requireCitations: true,
        },
      }),
    ).toThrow(/between 1 and 1/u);

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: 'refund policy money back',
          chunks,
          requireCitations: true,
          minCitedChunks: 1,
        },
      }),
    ).toThrow(/CITATION_REQUIRED|CITED_CHUNKS_BELOW_MINIMUM/u);

    const explicit = capability.checkAnswer({
      namespace: 'rag',
      operation: 'checkAnswer',
      input: {
        query: 'refund policy money back',
        answer: 'refund policy money back [99]',
        chunks,
        groundingSpans: [{ start: 0, end: 24, chunkIndexes: [0], required: true }],
        requireCitations: true,
        minCitedChunks: 1,
        minGroundingCoverage: 0.8,
      },
    });

    expect(explicit).toEqual(expect.objectContaining({ passed: true, status: 'grounded' }));
  });

  test('local rag.checkAnswer fails closed for ungrounded answers and invalid chunk indexes', () => {
    const capability = createLocalRagCapability(DOC, { sourcePath: join(dir, 'spec.kern') }) as {
      checkAnswer: (call: { namespace: string; operation: string; input: unknown }) => unknown;
      retrieve: (call: { namespace: string; operation: string; input: unknown }) => unknown;
    };
    const chunks = capability.retrieve({
      namespace: 'rag',
      operation: 'retrieve',
      input: { question: 'refund policy money back', retrieval: 'FindDocs' },
    });

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: 'refund policy money back',
          chunks,
          groundingSpans: [{ start: 0, end: 7, chunkIndexes: [0], required: true }],
          minGroundingCoverage: 1,
        },
      }),
    ).toThrow(/GROUNDING_BELOW_THRESHOLD/u);

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: 'unsupported refund timing detail',
          chunks,
          groundingSpans: [{ start: 0, end: 32, chunkIndexes: [0], required: true }],
        },
      }),
    ).toThrow(/SPAN_TEXT_UNSUPPORTED/u);

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: 'fabricated supporting answer',
          chunks: [
            {
              id: 'fake',
              text: 'fabricated supporting answer',
              score: 1,
              source: 'docs/fake.md',
              citationUri: 'docs/fake.md',
              citationLocator: null,
            },
          ],
          groundingSpans: [{ start: 0, end: 28, chunkIndexes: [0], required: true }],
        },
      }),
    ).toThrow(/previously returned by rag\.retrieve/u);

    const tamperedScoreChunks = (chunks as Array<Record<string, unknown>>).map((chunk) => ({ ...chunk, score: 0.01 }));
    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: 'refund policy money back',
          chunks: tamperedScoreChunks,
          groundingSpans: [{ start: 0, end: 24, chunkIndexes: [0], required: true }],
        },
      }),
    ).toThrow(/previously returned by rag\.retrieve/u);

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'shipping courier tracking',
          answer: 'refund policy money back',
          chunks,
          groundingSpans: [{ start: 0, end: 24, chunkIndexes: [0], required: true }],
        },
      }),
    ).toThrow(/same query/u);

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: '',
          chunks,
          groundingSpans: [],
        },
      }),
    ).toThrow(/ANSWER_EMPTY/u);

    expect(() =>
      capability.checkAnswer({
        namespace: 'rag',
        operation: 'checkAnswer',
        input: {
          query: 'refund policy money back',
          answer: 'refund policy money back',
          chunks,
          groundingSpans: [{ start: 0, end: 24, chunkIndexes: [100], required: true }],
        },
      }),
    ).toThrow(/in-bounds chunk index/u);
  });

  test('local rag.retrieve gives explicit nested queryParams precedence over top-level input fields', () => {
    const capability = createLocalRagCapability(DOC, { sourcePath: join(dir, 'spec.kern') });

    const result = (
      capability as { retrieve: (call: { namespace: string; operation: string; input: unknown }) => unknown }
    ).retrieve({
      namespace: 'rag',
      operation: 'retrieve',
      input: {
        question: 'shipping courier tracking',
        queryParams: { question: 'refund policy money back' },
        retrieval: 'FindDocs',
      },
    });

    const [chunk] = result as Array<Record<string, unknown>>;
    expect(chunk.source).toBe('docs/refunds.md');
  });

  test('local rag.retrieve validates setup and input shapes before retrieval', () => {
    expect(() => createLocalRagCapability(DOC, { sourcePath: '  ' })).toThrow(/sourcePath/u);

    const capability = createLocalRagCapability(DOC, { sourcePath: join(dir, 'spec.kern') });
    expect(() =>
      (
        capability as { retrieve: (call: { namespace: string; operation: string; input: unknown }) => unknown }
      ).retrieve({
        namespace: 'rag',
        operation: 'retrieve',
        input: { queryParams: 'refund policy money back' },
      }),
    ).toThrow(/queryParams/u);

    expect(() =>
      (
        capability as { promptContext: (call: { namespace: string; operation: string; input: unknown }) => unknown }
      ).promptContext({
        namespace: 'rag',
        operation: 'promptContext',
        input: { chunks: [{ id: 'chunk', text: '', score: 1, source: 'docs/refunds.md' }] },
      }),
    ).toThrow(/text must be a non-empty/u);
  });

  test('merges one ragRetrieve across multiple target indexes', () => {
    const report = retrieveRagDocument(MULTI_INDEX_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      queryParams: { question: 'refund password' },
      embedder: fakeMultiIndexEmbedder,
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.indexes.map((index) => index.indexName).sort()).toEqual(['DocsIndex', 'FaqIndex']);
    expect(report.retrievals).toHaveLength(1);
    expect(report.retrievals[0]).toEqual(
      expect.objectContaining({
        name: 'FindAll',
        indexName: 'DocsIndex',
        indexNames: ['DocsIndex', 'FaqIndex'],
        query: 'refund password',
        retrieveOptions: { topK: 2 },
      }),
    );
    expect(report.retrievals[0]?.result.chunks.map((chunk) => chunk.source).sort()).toEqual([
      'docs/refunds.md',
      'faq/passwords.md',
    ]);
    expect(report.ingestion?.chunks.map((chunk) => chunk.metadata?.corpusName).sort()).toEqual(['Docs', 'Docs', 'Faq']);
  });

  test('deduplicates chunks returned by overlapping multi-index targets', () => {
    const report = retrieveRagDocument(OVERLAPPING_MULTI_INDEX_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      queryParams: { question: 'refund money' },
      embedder: fakeMultiIndexEmbedder,
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.indexes.map((index) => index.indexName).sort()).toEqual(['DocsIndex', 'DocsIndexMirror']);
    expect(report.retrievals[0]?.result.chunks).toHaveLength(1);
    expect(report.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
  });

  test('fails closed when a runtime query parameter is not supplied', () => {
    expect(() => retrieveRagDocument(DOC, { sourcePath: join(dir, 'spec.kern') })).toThrow(
      /requires queryParam 'question'/u,
    );
  });

  test('validates runtime query parameters before ingesting declared sources', () => {
    rmSync(join(dir, 'docs'), { recursive: true, force: true });

    expect(() => retrieveRagDocument(DOC, { sourcePath: join(dir, 'spec.kern') })).toThrow(
      /requires queryParam 'question'/u,
    );
  });

  test('does not resolve queryParam from inherited object properties', () => {
    const queryParams = Object.create({ toString: 'refund policy money back' }) as Record<string, string>;

    expect(() =>
      retrieveRagDocument(PROTOTYPE_QUERY_PARAM_DOC, { sourcePath: join(dir, 'spec.kern'), queryParams }),
    ).toThrow(/requires queryParam 'toString'/u);
  });

  test('falls back to global query when a named queryParam value is undefined', () => {
    const report = retrieveRagDocument(DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
      queryParams: { question: undefined },
    });

    expect(report.retrievals[0]).toEqual(
      expect.objectContaining({
        query: 'refund policy money back',
      }),
    );
  });

  test('executes fixed literal runtime retrieval queries without caller input', () => {
    const report = retrieveRagDocument(FIXED_QUERY_DOC, { sourcePath: join(dir, 'spec.kern') });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals[0]).toEqual(
      expect.objectContaining({
        query: 'refund policy money back',
      }),
    );
    expect(report.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
  });

  test('renders typed runtime query templates from named params', () => {
    const report = retrieveRagDocument(TEMPLATE_QUERY_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      templateParams: { topic: 'refund', year: 2026 },
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals[0]).toEqual(expect.objectContaining({ query: 'refund policy 2026' }));
    expect(report.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
  });

  test('validates runtime query template params before ingesting declared sources', () => {
    rmSync(join(dir, 'docs'), { recursive: true, force: true });

    expect(() =>
      retrieveRagDocument(TEMPLATE_QUERY_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        templateParams: { topic: 'refund', year: 'twenty' },
      }),
    ).toThrow(/param 'year' must be a finite number/u);
  });

  test('inherits runtime retrieval options from a named retrieval profile', () => {
    const report = retrieveRagDocument(PROFILE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals[0]).toEqual(
      expect.objectContaining({
        query: 'refund policy money back',
        retrieveOptions: { topK: 2, minScore: 0.1 },
      }),
    );
    expect(report.retrievals[0]?.result.chunks.length).toBeLessThanOrEqual(2);
  });

  test('inherits runtime query templates from a named retrieval profile', () => {
    const report = retrieveRagDocument(PROFILE_TEMPLATE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      templateParams: { topic: 'refund', year: 2026 },
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals[0]).toEqual(
      expect.objectContaining({
        query: 'refund policy 2026',
        retrieveOptions: { topK: 2, minScore: 0 },
      }),
    );
  });

  test('lets partial templateParams fall back to queryParams by name', () => {
    const report = retrieveRagDocument(TEMPLATE_QUERY_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      queryParams: { topic: 'refund', year: '2026' },
      templateParams: { topic: 'refund' },
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals[0]).toEqual(expect.objectContaining({ query: 'refund policy 2026' }));
  });

  test('lets ragRetrieve override named retrieval profile defaults', () => {
    const report = retrieveRagDocument(PROFILE_OVERRIDE_DOC, { sourcePath: join(dir, 'spec.kern') });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals[0]).toEqual(
      expect.objectContaining({
        query: 'refund policy money back',
        retrieveOptions: { topK: 1, minScore: 0 },
      }),
    );
    expect(report.retrievals[0]?.result.chunks).toHaveLength(1);
  });

  test('applies named retrieval profile metadata filters before ranking', () => {
    const report = retrieveRagDocument(PROFILE_FILTER_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund shipping delivery',
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals[0]?.retrieveOptions).toEqual({
      topK: 2,
      minScore: 0,
      metadataFilter: { relativePath: 'docs/shipping.md' },
    });
    expect(report.retrievals[0]?.result.chunks).toHaveLength(1);
    expect(report.retrievals[0]?.result.chunks[0]).toEqual(
      expect.objectContaining({
        source: 'docs/shipping.md',
        metadata: expect.objectContaining({ relativePath: 'docs/shipping.md' }),
      }),
    );
  });

  test('lets ragRetrieve override named retrieval profile metadata filters', () => {
    const report = retrieveRagDocument(PROFILE_FILTER_OVERRIDE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.retrievals[0]?.retrieveOptions).toEqual({
      topK: 2,
      minScore: 0,
      metadataFilter: { relativePath: 'docs/refunds.md' },
    });
    expect(report.retrievals[0]?.result.chunks).toHaveLength(1);
    expect(report.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
  });

  test('fails closed for dynamic fixed-query expressions in the synchronous runner', () => {
    expect(() => retrieveRagDocument(DYNAMIC_QUERY_DOC, { sourcePath: join(dir, 'spec.kern') })).toThrow(
      /uses dynamic query=<expr>/u,
    );
  });

  test('executes index-level chunking overrides during retrieval', () => {
    const report = retrieveRagDocument(INDEX_CHUNKING_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.indexes[0]).toEqual(
      expect.objectContaining({
        indexName: 'DocsIndex',
        chunkingName: 'Large',
        status: 'indexed',
      }),
    );
    expect(report.ingestion?.chunks.length).toBeGreaterThan(2);
    expect(report.ingestion?.chunks.every((chunk) => chunk.metadata?.chunkingName === 'Large')).toBe(true);
    expect(report.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
  });

  test('fails closed when index-level chunking does not apply to a corpus source', () => {
    expect(() =>
      retrieveRagDocument(INDEX_CHUNKING_SOURCE_MISMATCH_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        query: 'refund policy money back',
      }),
    ).toThrow(/chunking 'Large' does not apply to source 'shipping'/u);
  });

  test('executes local-persistent vector stores and reuses matching snapshots', () => {
    const first = retrieveRagDocument(LOCAL_PERSISTENT_STORE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });

    expect(first.diagnostics).toEqual([]);
    expect(first.indexes[0]?.status).toBe('indexed');
    expect(first.indexes[0]?.snapshotPath).toBe('index/DocsIndex.json');
    expect(first.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
    const snapshotPath = join(dir, 'index', 'DocsIndex.json');
    const firstSnapshot = readFileSync(snapshotPath, 'utf-8');
    const parsed = JSON.parse(firstSnapshot) as {
      readonly fingerprint?: unknown;
      readonly entries?: readonly { readonly chunk?: { readonly source?: string } }[];
    };
    expect(typeof parsed.fingerprint).toBe('string');
    expect(parsed.entries?.some((entry) => entry.chunk?.source === 'docs/refunds.md')).toBe(true);

    const second = retrieveRagDocument(LOCAL_PERSISTENT_STORE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });

    expect(second.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
    expect(second.indexes[0]?.status).toBe('reused');
    expect(readFileSync(snapshotPath, 'utf-8')).toBe(firstSnapshot);
  });

  test('rejects local-persistent paths outside the declaring document directory', () => {
    expect(() =>
      retrieveRagDocument(LOCAL_PERSISTENT_ESCAPE_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        query: 'refund policy money back',
      }),
    ).toThrow(/path must stay inside/u);
  });

  test('rejects local-persistent symlinks outside the declaring document directory', () => {
    outsideDir = mkdtempSync(join(tmpdir(), 'kern-rag-retrieve-outside-'));
    symlinkSync(outsideDir, join(dir, 'index-link'), 'dir');

    expect(() =>
      retrieveRagDocument(LOCAL_PERSISTENT_SYMLINK_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        query: 'refund policy money back',
      }),
    ).toThrow(/path must stay inside/u);
  });

  test('rejects local-persistent nested symlinks outside the declaring document directory', () => {
    outsideDir = mkdtempSync(join(tmpdir(), 'kern-rag-retrieve-outside-'));
    mkdirSync(join(dir, 'a'));
    symlinkSync(outsideDir, join(dir, 'a/index-link'), 'dir');

    expect(() =>
      retrieveRagDocument(LOCAL_PERSISTENT_NESTED_SYMLINK_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        query: 'refund policy money back',
      }),
    ).toThrow(/path must stay inside/u);
  });

  test('rejects local-persistent broken symlink path components', () => {
    mkdirSync(join(dir, 'a'));
    symlinkSync(join(tmpdir(), 'kern-rag-missing-outside-target'), join(dir, 'a/index-link'), 'dir');

    expect(() =>
      retrieveRagDocument(LOCAL_PERSISTENT_NESTED_SYMLINK_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        query: 'refund policy money back',
      }),
    ).toThrow(/path must stay inside/u);
  });

  test('rejects incompatible fingerprints sharing the same local-persistent file', () => {
    expect(() =>
      retrieveRagDocument(LOCAL_PERSISTENT_SHARED_NAMESPACE_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        query: 'refund policy money back',
      }),
    ).toThrow(/multiple incompatible fingerprints/u);
  });

  test('rebuilds local-persistent vector stores when source content changes', () => {
    retrieveRagDocument(LOCAL_PERSISTENT_STORE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });
    const snapshotPath = join(dir, 'index', 'DocsIndex.json');
    const before = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as { readonly fingerprint: string };

    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy now requires receipt approval\n');
    const report = retrieveRagDocument(LOCAL_PERSISTENT_STORE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy receipt',
    });
    const after = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as { readonly fingerprint: string };

    expect(report.retrievals[0]?.result.chunks[0]?.text).toContain('receipt approval');
    expect(report.indexes[0]?.status).toBe('rebuilt');
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  test('rebuilds local-persistent vector stores when chunk metadata changes', () => {
    retrieveRagDocument(LOCAL_PERSISTENT_STORE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });
    const snapshotPath = join(dir, 'index', 'DocsIndex.json');
    const before = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as { readonly fingerprint: string };

    const report = retrieveRagDocument(LOCAL_PERSISTENT_METADATA_DRIFT_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });
    const after = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as {
      readonly entries: readonly { readonly chunk: { readonly metadata?: { readonly sourceUri?: string } } }[];
      readonly fingerprint: string;
    };

    expect(report.retrievals[0]?.result.chunks[0]?.metadata?.sourceUri).toBe('docs/**/*.md');
    expect(report.indexes[0]?.status).toBe('rebuilt');
    expect(after.entries[0]?.chunk.metadata?.sourceUri).toBe('docs/**/*.md');
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  test('rebuilds local-persistent vector stores when stored chunks drift from the fingerprint', () => {
    retrieveRagDocument(LOCAL_PERSISTENT_STORE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });
    const snapshotPath = join(dir, 'index', 'DocsIndex.json');
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as {
      entries: { chunk: { text: string } }[];
    };
    snapshot.entries[0].chunk.text = 'stale tampered text';
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

    const report = retrieveRagDocument(LOCAL_PERSISTENT_STORE_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
    });
    const after = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as {
      readonly entries: readonly { readonly chunk: { readonly text: string } }[];
    };

    expect(report.retrievals[0]?.result.chunks[0]?.text).toContain('refund policy money back');
    expect(report.indexes[0]?.status).toBe('rebuilt');
    expect(after.entries.some((entry) => entry.chunk.text === 'stale tampered text')).toBe(false);
  });

  test('async provider-backed memory retrieval executes runtime ragRetrieve declarations', async () => {
    const report = await retrieveRagDocumentAsync(ASYNC_PROVIDER_MEMORY_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
      embedder: fakeAsyncEmbedder,
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.indexes[0]).toEqual(
      expect.objectContaining({
        indexName: 'DocsIndex',
        storeKind: 'memory',
        status: 'indexed',
      }),
    );
    expect(report.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
  });

  test('async retrieval resolves a declared deterministic fake provider without OpenAI options', async () => {
    const report = await retrieveRagDocumentAsync(FAKE_PROVIDER_MEMORY_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
      providers: { fake: { seed: 'runtime-test' } },
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.indexes[0]).toEqual(
      expect.objectContaining({
        indexName: 'DocsIndex',
        storeKind: 'memory',
        status: 'indexed',
      }),
    );
    expect(report.retrievals[0]?.result.chunks).toHaveLength(1);
  });

  test('async provider-backed local-persistent retrieval reuses matching snapshots', async () => {
    const first = await retrieveRagDocumentAsync(ASYNC_PROVIDER_LOCAL_PERSISTENT_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
      embedder: fakeAsyncEmbedder,
    });
    const snapshotPath = join(dir, 'index', 'DocsIndex.json');
    const firstSnapshot = readFileSync(snapshotPath, 'utf-8');

    const second = await retrieveRagDocumentAsync(ASYNC_PROVIDER_LOCAL_PERSISTENT_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      query: 'refund policy money back',
      embedder: fakeAsyncEmbedder,
    });

    expect(first.indexes[0]?.status).toBe('indexed');
    expect(second.indexes[0]?.status).toBe('reused');
    expect(second.retrievals[0]?.result.chunks[0]?.source).toBe('docs/refunds.md');
    expect(readFileSync(snapshotPath, 'utf-8')).toBe(firstSnapshot);
  });

  test('async provider-backed retrieval wraps provider failures with KERN context', async () => {
    const failingEmbedder: AsyncEmbedder = {
      id: 'provider:fake-broken',
      dims: 3,
      async embed(): Promise<Float64Array> {
        throw new Error('socket closed for sk-test-secret');
      },
    };

    await expect(
      retrieveRagDocumentAsync(ASYNC_PROVIDER_MEMORY_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        query: 'refund policy money back',
        embedder: failingEmbedder,
      }),
    ).rejects.toThrow(/KERN RAG provider-backed retrieval failed for index 'DocsIndex'.*socket closed for sk-\*\*\*/u);
  });
});

describe('PROVENANCE NORMALIZATION: parseRetrievedChunkCitationProvenance (shared by promptContext/checkAnswer/answer)', () => {
  test('accepts the flat citationUri/citationLocator wire shape rag.retrieve/rag.retrieveAsync emit', () => {
    expect(
      parseRetrievedChunkCitationProvenance({ citationUri: 'docs/refunds.md', citationLocator: 'p1' }, 'chunks[0]'),
    ).toEqual({ uri: 'docs/refunds.md', locator: 'p1' });
  });

  test('accepts the nested citation record form for chunks authored directly in .kern source', () => {
    expect(
      parseRetrievedChunkCitationProvenance({ citation: { uri: 'docs/refunds.md', locator: 'p1' } }, 'chunks[0]'),
    ).toEqual({ uri: 'docs/refunds.md', locator: 'p1' });
  });

  test('treats null citation fields as absent, never as a literal "null" string', () => {
    expect(
      parseRetrievedChunkCitationProvenance({ citationUri: 'docs/refunds.md', citationLocator: null }, 'chunks[0]'),
    ).toEqual({ uri: 'docs/refunds.md' });
    expect(parseRetrievedChunkCitationProvenance({}, 'chunks[0]')).toEqual({});
  });

  test('accepts both forms together when they agree', () => {
    expect(
      parseRetrievedChunkCitationProvenance(
        { citation: { uri: 'docs/refunds.md' }, citationUri: 'docs/refunds.md' },
        'chunks[0]',
      ),
    ).toEqual({ uri: 'docs/refunds.md' });
  });

  test('fails closed when the nested and flat forms disagree, rather than silently preferring one', () => {
    expect(() =>
      parseRetrievedChunkCitationProvenance(
        { citation: { uri: 'docs/refunds.md' }, citationUri: 'docs/other.md' },
        'chunks[0]',
      ),
    ).toThrow(
      'chunks[0] declares both citation.uri and citationUri with disagreeing values; provide exactly one citation provenance encoding.',
    );
    expect(() =>
      parseRetrievedChunkCitationProvenance(
        { citation: { uri: 'docs/refunds.md', locator: 'p1' }, citationLocator: 'p2' },
        'chunks[0]',
      ),
    ).toThrow(
      'chunks[0] declares both citation.locator and citationLocator with disagreeing values; provide exactly one citation provenance encoding.',
    );
  });

  test('rejects a non-record citation field', () => {
    expect(() => parseRetrievedChunkCitationProvenance({ citation: 'docs/refunds.md' as never }, 'chunks[0]')).toThrow(
      'chunks[0].citation must be a record.',
    );
  });
});
