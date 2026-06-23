import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { retrieveRagDocument } from '../src/index.js';

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

const INDEX_CHUNKING_DOC = DOC.replace(
  'chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
  'chunking name=Large source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens',
).replace(
  'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding',
  'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=Large',
);

describe('retrieveRagDocument', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-rag-retrieve-'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'spec.kern'), DOC);
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy money back within thirty days\n');
    writeFileSync(join(dir, 'docs/shipping.md'), 'shipping delivery courier tracking parcel\n');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

  test('fails closed for dynamic fixed-query expressions in the synchronous runner', () => {
    expect(() => retrieveRagDocument(DYNAMIC_QUERY_DOC, { sourcePath: join(dir, 'spec.kern') })).toThrow(
      /uses dynamic query=<expr>/u,
    );
  });

  test('fails closed instead of ignoring index-level chunking overrides', () => {
    expect(() =>
      retrieveRagDocument(INDEX_CHUNKING_DOC, {
        sourcePath: join(dir, 'spec.kern'),
        query: 'refund policy money back',
      }),
    ).toThrow(/index 'DocsIndex' with chunking='Large'/u);
  });
});
