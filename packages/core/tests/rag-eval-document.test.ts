/**
 * P1.2 end-to-end: a parsed `.kern` RAG document's `ragEval` runs against a real
 * cosine retriever (not the lexical reference corpus) and yields pass/fail.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateRagEvalDocument,
  evaluateRagEvalDocumentFromDeclaredSources,
  type RagChunkInput,
} from '../src/index.js';

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
    expect(report.embedderId).toBe('local-semantic-v1');
    expect(report.corpusSource.mode).toBe('explicit-corpus-json');
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

embed name=DocsEmbedding corpus=Docs model=text-embedding-3-small dims=1536 metric=cosine
embed name=OtherEmbedding corpus=Other model=text-embedding-3-small dims=1536 metric=cosine

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

embed name=UnusedEmbedding corpus=Unused model=text-embedding-3-small dims=1536 metric=cosine
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
