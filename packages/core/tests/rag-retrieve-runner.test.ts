import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AsyncEmbedder, retrieveRagDocument, retrieveRagDocumentAsync } from '../src/index.js';

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

describe('retrieveRagDocument', () => {
  let dir: string;
  let outsideDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-rag-retrieve-'));
    outsideDir = undefined;
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'spec.kern'), DOC);
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy money back within thirty days\n');
    writeFileSync(join(dir, 'docs/shipping.md'), 'shipping delivery courier tracking parcel\n');
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
