/**
 * P1.2 end-to-end: a parsed `.kern` RAG document's `ragEval` runs against a real
 * cosine retriever (not the lexical reference corpus) and yields pass/fail.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateRagEvalDocument,
  evaluateRagEvalDocumentAsync,
  evaluateRagEvalDocumentFromDeclaredSources,
  evaluateRagEvalDocumentFromDeclaredSourcesAsync,
  type RagChunkInput,
} from '../src/index.js';

const DOC = `corpus name=Docs title="Support docs"
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown
  chunking source=manuals strategy=semantic maxTokens=600 overlap=80 unit=tokens

embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine

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

const INDEXED_DOC = `corpus name=Docs title="Support docs"
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown
  chunking name=DocsChunks source=manuals strategy=semantic maxTokens=600 overlap=80 unit=tokens

embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine
vectorStore name=DocsMemory kind=local-persistent dims=64 metric=cosine path="./index"
ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=DocsChunks
retriever name=DocsSearch corpus=Docs embed=DocsEmbedding mode=hybrid topK=4 minScore=0.1

rag name=AnswerDocs retriever=DocsSearch citations=true
  grounding name=StrictGrounding requireCitations=true policy=strict maxContext=6000
  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund refunds policy window" topK=1
      ragAssert kind=sourceGlob value="docs/refunds*" required=true
      ragAssert kind=citesRequired
`;

describe('evaluateRagEvalDocument (P1.2 end-to-end)', () => {
  test('runs a parsed ragEval against real cosine retrieval and passes', () => {
    const report = evaluateRagEvalDocument(DOC, CORPUS);
    expect(report.embedderId).toBe('local-semantic-v1');
    expect(report.corpusSource.mode).toBe('explicit-corpus-json');
    expect(report.evals).toHaveLength(1);
    expect(report.evals[0].ragName).toBe('AnswerDocs');
    expect(report.evals[0].evalName).toBe('Faithfulness');
    expect(report.passed).toBe(true);
    expect(report.evals[0].result.passedCaseCount).toBe(1);
  });

  test('sync eval fails closed when a retriever declares a provider embed model', () => {
    const providerDoc = DOC.replace(
      'model=local-semantic-v1 dims=64',
      'model="openai:text-embedding-3-small" dims=1536',
    );
    expect(() => evaluateRagEvalDocument(providerDoc, CORPUS)).toThrow(/requires async provider execution/u);
  });

  test('async eval honors OpenAI embed declarations through injected fetch', async () => {
    const providerDoc = DOC.replace(
      'model=local-semantic-v1 dims=64',
      'model="openai:text-embedding-3-small" dims=1536',
    );
    const fetchCalls: string[] = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] };
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
      fetchCalls.push(...inputs);
      return new Response(JSON.stringify({ data: inputs.map((input) => ({ embedding: openAiVector(input) })) }), {
        status: 200,
      });
    };

    const report = await evaluateRagEvalDocumentAsync(providerDoc, CORPUS, {
      providers: { openai: { apiKey: 'test-key', fetch: fakeFetch } },
    });

    expect(report.passed).toBe(true);
    expect(report.embedderId).toBe('openai:text-embedding-3-small:dims=1536');
    expect(report.embedderIds).toEqual(['openai:text-embedding-3-small:dims=1536']);
    expect(fetchCalls).toEqual(expect.arrayContaining(CORPUS.map((chunk) => chunk.text)));
  });

  test('async eval reuses a provider-backed index across pipelines that share a retriever', async () => {
    const providerDoc = `${DOC.replace(
      'model=local-semantic-v1 dims=64',
      'model="openai:text-embedding-3-small" dims=1536',
    )}
rag name=AuditDocs retriever=DocsSearch citations=false
  ragEval name=AuditFaithfulness metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund refunds policy window" topK=1
      ragAssert kind=scoreGte threshold=0.5 required=true
      ragAssert kind=sourceGlob value="docs/refunds*" required=true
`;
    const fetchCalls: string[] = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] };
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
      fetchCalls.push(...inputs);
      return new Response(JSON.stringify({ data: inputs.map((input) => ({ embedding: openAiVector(input) })) }), {
        status: 200,
      });
    };

    const report = await evaluateRagEvalDocumentAsync(providerDoc, CORPUS, {
      providers: { openai: { apiKey: 'test-key', fetch: fakeFetch } },
    });

    expect(report.passed).toBe(true);
    expect(report.evals).toHaveLength(2);
    for (const chunk of CORPUS) {
      expect(fetchCalls.filter((input) => input === chunk.text)).toHaveLength(1);
    }
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

  test('sync eval does not resolve provider retrievers when no ragEval is declared', () => {
    const providerDoc = `corpus name=Docs title="Support docs"
embed name=DocsEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=1536 metric=cosine
retriever name=DocsSearch corpus=Docs embed=DocsEmbedding mode=hybrid topK=4 minScore=0.72
rag name=AnswerDocs retriever=DocsSearch citations=false
`;

    const report = evaluateRagEvalDocument(providerDoc, CORPUS);

    expect(report.evals).toHaveLength(0);
    expect(report.passed).toBe(false);
  });

  test('a valid spec reports no diagnostics', () => {
    expect(evaluateRagEvalDocument(DOC, CORPUS).diagnostics).toEqual([]);
  });

  test('fails closed on a semantically invalid RAG spec (unresolved refs)', () => {
    const badDoc = `retriever name=DocsSearch corpus=Missing embed=MissingEmbed mode=hybrid topK=4 minScore=0.5
rag name=AnswerDocs retriever=DocsSearch citations=true
  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract
    ragCase name=c query="refund refunds policy window" topK=1
      ragAssert kind=citesRequired
`;
    const report = evaluateRagEvalDocument(badDoc, CORPUS);
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(report.evals).toHaveLength(0);
    expect(report.passed).toBe(false);
  });

  test('does not consume explicit corpus iterables when the spec is invalid', () => {
    const badDoc = 'retriever name=DocsSearch corpus=Missing\nrag name=AnswerDocs retriever=DocsSearch\n';
    const throwingCorpus: Iterable<RagChunkInput> = {
      [Symbol.iterator](): Iterator<RagChunkInput> {
        throw new Error('corpus should not be consumed');
      },
    };
    const report = evaluateRagEvalDocument(badDoc, throwingCorpus);
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(report.corpusSource).toEqual({ mode: 'explicit-corpus-json', chunkCount: 0, corpusSha256: '' });
  });

  test('ingests declared local sources when no explicit corpus is supplied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-doc-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, DOC);

      const report = evaluateRagEvalDocumentFromDeclaredSources(DOC, { sourcePath });

      expect(report.passed).toBe(true);
      expect(report.corpusSource.mode).toBe('declared-local-sources');
      expect(report.corpusSource.fileCount).toBe(2);
      expect(report.corpusSource.chunkCount).toBe(2);
      expect(report.corpusSource.chunkIdVersion).toBe('kern-rag-chunk-v1');
      expect(report.corpusSource.chunkerVersion).toBe('semantic-boundary-v1');
      expect(report.corpusSource.chunkerVersions).toEqual(['semantic-boundary-v1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source eval uses local-persistent ragIndex snapshots across repeated runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-eval-index-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, INDEXED_DOC);

      const first = evaluateRagEvalDocumentFromDeclaredSources(INDEXED_DOC, { sourcePath });
      const snapshot = readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8');
      const second = evaluateRagEvalDocumentFromDeclaredSources(INDEXED_DOC, { sourcePath });

      expect(first.passed).toBe(true);
      expect(first.indexes).toEqual([
        expect.objectContaining({
          indexName: 'DocsIndex',
          storeKind: 'local-persistent',
          status: 'indexed',
          snapshotPath: 'index/DocsIndex.json',
        }),
      ]);
      expect(second.passed).toBe(true);
      expect(second.indexes).toEqual([
        expect.objectContaining({
          indexName: 'DocsIndex',
          storeKind: 'local-persistent',
          status: 'reused',
          snapshotPath: 'index/DocsIndex.json',
        }),
      ]);
      expect(readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8')).toBe(snapshot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source eval reports bad retrieval assertions against ragIndex snapshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-eval-index-bad-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      const badDoc = INDEXED_DOC.replace('value="docs/refunds*"', 'value="docs/shipping*"');
      writeFileSync(sourcePath, badDoc);

      const report = evaluateRagEvalDocumentFromDeclaredSources(badDoc, { sourcePath });

      expect(report.passed).toBe(false);
      expect(report.indexes).toEqual([
        expect.objectContaining({
          indexName: 'DocsIndex',
          storeKind: 'local-persistent',
          status: 'indexed',
          snapshotPath: 'index/DocsIndex.json',
        }),
      ]);
      expect(report.evals[0].result.metrics.hitRate).toBe(0);
      expect(report.evals[0].result.cases[0].assertions).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'sourceGlob', passed: false })]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source eval can explicitly target one compatible ragIndex', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-eval-target-index-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      const doc = INDEXED_DOC.replace(
        'vectorStore name=DocsMemory kind=local-persistent dims=64 metric=cosine path="./index"',
        [
          'vectorStore name=DocsMemory kind=local-persistent dims=64 metric=cosine path="./index"',
          'vectorStore name=AltMemory kind=local-persistent dims=64 metric=cosine path="./alt-index"',
        ].join('\n'),
      ).replace(
        'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=DocsChunks',
        [
          'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=DocsChunks',
          'ragIndex name=AltIndex corpus=Docs store=AltMemory embed=DocsEmbedding chunking=DocsChunks',
        ].join('\n'),
      );
      writeFileSync(sourcePath, doc);

      const auto = evaluateRagEvalDocumentFromDeclaredSources(doc, { sourcePath });
      const targeted = evaluateRagEvalDocumentFromDeclaredSources(doc, {
        sourcePath,
        target: { indexName: 'AltIndex' },
      });
      const paired = evaluateRagEvalDocumentFromDeclaredSources(doc, {
        sourcePath,
        target: { retrieverName: 'DocsSearch', indexName: 'AltIndex' },
      });

      expect(auto.passed).toBe(true);
      expect(auto.indexes).toEqual([]);
      expect(auto.target).toEqual(
        expect.objectContaining({
          mode: 'declared-sources',
          indexNames: [],
        }),
      );
      expect(targeted.passed).toBe(true);
      expect(targeted.indexes).toEqual([
        expect.objectContaining({
          indexName: 'AltIndex',
          storeKind: 'local-persistent',
          status: 'indexed',
          snapshotPath: 'alt-index/AltIndex.json',
        }),
      ]);
      expect(targeted.target).toEqual(
        expect.objectContaining({
          requested: { indexName: 'AltIndex' },
          mode: 'explicit-index',
          retrieverNames: ['DocsSearch'],
          indexNames: ['AltIndex'],
        }),
      );
      expect(targeted.evals[0].target).toEqual({
        retrieverName: 'DocsSearch',
        indexName: 'AltIndex',
        mode: 'explicit-index',
      });
      expect(paired.passed).toBe(true);
      expect(paired.target).toEqual(
        expect.objectContaining({
          requested: { retrieverName: 'DocsSearch', indexName: 'AltIndex' },
          mode: 'explicit-pair',
          retrieverNames: ['DocsSearch'],
          indexNames: ['AltIndex'],
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source async eval can explicitly target one compatible ragIndex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-eval-target-index-async-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, INDEXED_DOC);

      const report = await evaluateRagEvalDocumentFromDeclaredSourcesAsync(INDEXED_DOC, {
        sourcePath,
        target: { retrieverName: 'DocsSearch', indexName: 'DocsIndex' },
      });

      expect(report.passed).toBe(true);
      expect(report.target).toEqual(
        expect.objectContaining({
          requested: { retrieverName: 'DocsSearch', indexName: 'DocsIndex' },
          mode: 'explicit-pair',
          retrieverNames: ['DocsSearch'],
          indexNames: ['DocsIndex'],
        }),
      );
      expect(report.evals[0].target).toEqual({
        retrieverName: 'DocsSearch',
        indexName: 'DocsIndex',
        mode: 'explicit-index',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source eval can explicitly target evals for one retriever', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-eval-target-retriever-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      const doc = `${INDEXED_DOC}
retriever name=ShippingSearch corpus=Docs embed=DocsEmbedding mode=hybrid topK=4 minScore=0.1
rag name=ShippingDocs retriever=ShippingSearch citations=false
  ragEval name=ShippingOnly metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund refunds policy window" topK=1
      ragAssert kind=sourceGlob value="docs/refunds*" required=true
`;
      writeFileSync(sourcePath, doc);

      const report = evaluateRagEvalDocumentFromDeclaredSources(doc, {
        sourcePath,
        target: { retrieverName: 'ShippingSearch' },
      });

      expect(report.passed).toBe(true);
      expect(report.evals).toHaveLength(1);
      expect(report.evals[0].ragName).toBe('ShippingDocs');
      expect(report.target).toEqual(
        expect.objectContaining({
          requested: { retrieverName: 'ShippingSearch' },
          mode: 'explicit-retriever',
          retrieverNames: ['ShippingSearch'],
          indexNames: ['DocsIndex'],
        }),
      );
      expect(report.evals[0].target).toEqual({
        retrieverName: 'ShippingSearch',
        indexName: 'DocsIndex',
        mode: 'auto-compatible-index',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source eval fails closed for unknown and incompatible explicit targets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-eval-target-error-'));
    try {
      mkdirSync(join(dir, 'docs'));
      mkdirSync(join(dir, 'other'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'other/refunds.md'), 'Other refund policy text.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      const doc = `${INDEXED_DOC}
corpus name=Other title="Other docs"
  source name=other kind=local uri="./other/**/*.md" media=markdown
  chunking name=OtherChunks source=other strategy=semantic maxTokens=600 overlap=80 unit=tokens
embed name=OtherEmbedding corpus=Other model=local-semantic-v1 dims=64 metric=cosine
vectorStore name=OtherMemory kind=local-persistent dims=64 metric=cosine path="./other-index"
ragIndex name=OtherIndex corpus=Other store=OtherMemory embed=OtherEmbedding chunking=OtherChunks
`;
      writeFileSync(sourcePath, doc);

      expect(() =>
        evaluateRagEvalDocumentFromDeclaredSources(doc, {
          sourcePath,
          target: { retrieverName: 'MissingSearch' },
        }),
      ).toThrow(/ragRetriever 'MissingSearch' was not declared/u);
      expect(() =>
        evaluateRagEvalDocumentFromDeclaredSources(doc, {
          sourcePath,
          target: { retrieverName: 'DocsSearch', indexName: 'OtherIndex' },
        }),
      ).toThrow(/ragIndex 'OtherIndex' is incompatible with retriever 'DocsSearch'/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source eval ignores unrelated runtime ragRetrieve declarations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-eval-existing-retrieve-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      const doc = `${INDEXED_DOC}
ragRetrieve name=NeedsRuntimeQuery index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"
`;
      writeFileSync(sourcePath, doc);

      const report = evaluateRagEvalDocumentFromDeclaredSources(doc, { sourcePath });

      expect(report.passed).toBe(true);
      expect(report.indexes).toEqual([
        expect.objectContaining({
          indexName: 'DocsIndex',
          storeKind: 'local-persistent',
          status: 'indexed',
        }),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source async eval ignores unrelated runtime ragRetrieve declarations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-eval-existing-retrieve-async-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      const doc = `${INDEXED_DOC}
ragRetrieve name=NeedsRuntimeQuery index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"
`;
      writeFileSync(sourcePath, doc);

      const report = await evaluateRagEvalDocumentFromDeclaredSourcesAsync(doc, { sourcePath });

      expect(report.passed).toBe(true);
      expect(report.indexes).toEqual([
        expect.objectContaining({
          indexName: 'DocsIndex',
          storeKind: 'local-persistent',
          status: 'indexed',
        }),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source evals only retrieve chunks from the pipeline retriever corpus', () => {
    const doc = `corpus name=Docs title="Support docs"
  source name=docs kind=local uri="./docs/**/*.md" media=markdown
  chunking source=docs strategy=semantic maxTokens=600 overlap=80 unit=tokens

corpus name=Other title="Other docs"
  source name=other kind=local uri="./other/**/*.md" media=markdown
  chunking source=other strategy=semantic maxTokens=600 overlap=80 unit=tokens

embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine
embed name=OtherEmbedding corpus=Other model=local-semantic-v1 dims=64 metric=cosine

retriever name=DocsSearch corpus=Docs embed=DocsEmbedding mode=hybrid topK=4 minScore=0.1

rag name=AnswerDocs retriever=DocsSearch
  ragEval name=Isolation metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund refunds policy window" topK=1
      ragAssert kind=sourceGlob value="other/*" required=true
`;
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-isolated-'));
    try {
      mkdirSync(join(dir, 'docs'));
      mkdirSync(join(dir, 'other'));
      writeFileSync(join(dir, 'docs/general.md'), 'General support homepage and account overview.\n');
      writeFileSync(join(dir, 'other/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, doc);

      const report = evaluateRagEvalDocumentFromDeclaredSources(doc, { sourcePath });

      expect(report.passed).toBe(false);
      expect(report.corpusSource.mode).toBe('declared-local-sources');
      expect(report.corpusSource.fileCount).toBe(1);
      expect(report.corpusSource.files?.map((file) => file.slice(dir.length + 1))).toEqual(['docs/general.md']);
      const sourceGlob = report.evals[0].result.cases[0].assertions.find(
        (assertion) => assertion.kind === 'sourceGlob',
      );
      expect(sourceGlob?.expected).toBe('other/*');
      expect(sourceGlob?.passed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source eval ignores unused broken corpus declarations', () => {
    const doc = `${DOC}

corpus name=Unused title="Unused"
  source name=missing kind=local uri="./missing/**/*.md" media=markdown
  chunking source=missing strategy=semantic maxTokens=600 overlap=80 unit=tokens

embed name=UnusedEmbedding corpus=Unused model=local-semantic-v1 dims=64 metric=cosine
`;
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-unused-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, doc);

      const report = evaluateRagEvalDocumentFromDeclaredSources(doc, { sourcePath });

      expect(report.passed).toBe(true);
      expect(report.corpusSource.mode).toBe('declared-local-sources');
      expect(report.corpusSource.patterns).toEqual(['./docs/**/*.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source report does not collapse mixed chunker provenance into one version', () => {
    const doc = `corpus name=Docs title="Support docs"
  source name=semanticDocs kind=local uri="./semantic/**/*.md" media=markdown
  chunking source=semanticDocs strategy=semantic maxTokens=600 overlap=80 unit=tokens
  source name=windowDocs kind=local uri="./window/**/*.md" media=markdown
  chunking source=windowDocs strategy=window maxTokens=600 overlap=80 unit=tokens

retriever name=DocsSearch corpus=Docs mode=hybrid topK=4 minScore=0.1

rag name=AnswerDocs retriever=DocsSearch
  ragEval name=Mixed metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund refunds policy window" topK=1
      ragAssert kind=sourceGlob value="semantic/*" required=true
`;
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-mixed-chunker-'));
    try {
      mkdirSync(join(dir, 'semantic'));
      mkdirSync(join(dir, 'window'));
      writeFileSync(join(dir, 'semantic/refunds.md'), '# Refunds\nrefund refunds policy window thirty days.\n');
      writeFileSync(join(dir, 'window/shipping.md'), 'shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, doc);

      const report = evaluateRagEvalDocumentFromDeclaredSources(doc, { sourcePath });

      expect(report.corpusSource.chunkerVersion).toBeUndefined();
      expect(report.corpusSource.chunkerVersions).toEqual(['semantic-boundary-v1', 'token-window-v1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('declared-source async eval honors provider embed declarations', async () => {
    const doc = DOC.replace('model=local-semantic-v1 dims=64', 'model="openai:text-embedding-3-small" dims=1536');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-doc-openai-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(join(dir, 'docs/refunds.md'), 'Refund policy: refunds return money within thirty days.\n');
      writeFileSync(join(dir, 'docs/shipping.md'), 'Shipping delivery courier tracking parcel.\n');
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, doc);
      const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] };
        const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
        return new Response(JSON.stringify({ data: inputs.map((input) => ({ embedding: openAiVector(input) })) }), {
          status: 200,
        });
      };

      const report = await evaluateRagEvalDocumentFromDeclaredSourcesAsync(doc, {
        sourcePath,
        providers: { openai: { apiKey: 'test-key', fetch: fakeFetch } },
      });

      expect(report.passed).toBe(true);
      expect(report.embedderId).toBe('openai:text-embedding-3-small:dims=1536');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails declared-source ingestion when a glob matches nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-empty-'));
    try {
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, DOC);
      expect(() => evaluateRagEvalDocumentFromDeclaredSources(DOC, { sourcePath })).toThrow(/matched no files/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails declared-source ingestion when a source would ingest the spec file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-self-'));
    try {
      const selfDoc = DOC.replace('./docs/**/*.md', './mydocs.kern');
      const sourcePath = join(dir, 'mydocs.kern');
      writeFileSync(sourcePath, selfDoc);
      expect(() => evaluateRagEvalDocumentFromDeclaredSources(selfDoc, { sourcePath })).toThrow(
        /declaring \.kern file/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function openAiVector(input: string): number[] {
  return Array.from({ length: 1536 }, (_, index) => {
    if (index === 0 && input.toLowerCase().includes('refund')) return 1;
    if (index === 1 && input.toLowerCase().includes('shipping')) return 1;
    return 0;
  });
}
