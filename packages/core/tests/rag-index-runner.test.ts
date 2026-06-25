import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AsyncEmbedder, indexRagDocumentAsync } from '../src/index.js';

const DOC = `corpus name=Docs
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown
  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens

embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine
vectorStore name=DocsStore kind=local-persistent dims=64 metric=cosine path="./index"
ragIndex name=DocsIndex corpus=Docs store=DocsStore embed=DocsEmbedding
`;

const PROVIDER_DOC = DOC.replace(
  'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
  'embed name=DocsEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=3 metric=cosine',
).replace(
  'vectorStore name=DocsStore kind=local-persistent dims=64 metric=cosine',
  'vectorStore name=DocsStore kind=local-persistent dims=3 metric=cosine',
);

const SHARED_NAMESPACE_DOC = DOC.replace('path="./index"', 'path="./index" namespace=shared').replace(
  'ragIndex name=DocsIndex corpus=Docs store=DocsStore embed=DocsEmbedding',
  [
    'ragIndex name=DocsIndex corpus=Docs store=DocsStore embed=DocsEmbedding',
    'ragIndex name=DocsIndexMirror corpus=Docs store=DocsStore embed=DocsEmbedding',
  ].join('\n'),
);

describe('indexRagDocumentAsync', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-rag-index-'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'spec.kern'), DOC);
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy money back within thirty days\n');
    writeFileSync(join(dir, 'docs/shipping.md'), 'shipping delivery courier tracking parcel\n');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('indexes local-persistent snapshots and reuses fresh manifests', async () => {
    const first = await indexRagDocumentAsync(DOC, { sourcePath: join(dir, 'spec.kern') });

    expect(first.indexes[0]).toEqual(
      expect.objectContaining({
        indexName: 'DocsIndex',
        status: 'missing',
        action: 'indexed',
        snapshotPath: 'index/DocsIndex.json',
        manifestPath: 'index/DocsIndex.manifest.json',
      }),
    );
    const snapshot = readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8');
    const manifest = JSON.parse(readFileSync(join(dir, 'index', 'DocsIndex.manifest.json'), 'utf-8')) as {
      readonly provenance?: { readonly corpus?: { readonly files?: readonly { readonly path: string }[] } };
    };
    expect(manifest.provenance?.corpus?.files?.map((file) => file.path)).toEqual([
      'docs/refunds.md',
      'docs/shipping.md',
    ]);

    const second = await indexRagDocumentAsync(DOC, { sourcePath: join(dir, 'spec.kern') });

    expect(second.indexes[0]).toEqual(expect.objectContaining({ status: 'fresh', action: 'reused' }));
    expect(readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8')).toBe(snapshot);
  });

  test('status mode reports stale snapshots without rebuilding', async () => {
    await indexRagDocumentAsync(DOC, { sourcePath: join(dir, 'spec.kern') });
    const snapshotPath = join(dir, 'index', 'DocsIndex.json');
    const snapshot = readFileSync(snapshotPath, 'utf-8');
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy now requires receipt approval\n');

    const status = await indexRagDocumentAsync(DOC, { sourcePath: join(dir, 'spec.kern'), statusOnly: true });

    expect(status.indexes[0]).toEqual(expect.objectContaining({ status: 'stale', action: 'inspected' }));
    expect(readFileSync(snapshotPath, 'utf-8')).toBe(snapshot);
  });

  test('rejects shared local-persistent namespaces with incompatible fingerprints', async () => {
    await expect(indexRagDocumentAsync(SHARED_NAMESPACE_DOC, { sourcePath: join(dir, 'spec.kern') })).rejects.toThrow(
      /multiple incompatible fingerprints/u,
    );
  });

  test('inspects and reuses fresh provider-backed snapshots without provider credentials', async () => {
    const missing = await indexRagDocumentAsync(PROVIDER_DOC, {
      sourcePath: join(dir, 'spec.kern'),
      statusOnly: true,
    });
    const providerId = missing.indexes[0]?.provenance?.embed.id;
    expect(providerId).toContain('openai:text-embedding-3-small:dims=3:provider=');

    const fakeProvider: AsyncEmbedder = {
      id: providerId ?? 'missing-provider-id',
      dims: 3,
      async embed(text: string): Promise<Float64Array> {
        return fakeProviderVector(text);
      },
      async embedMany(texts: readonly string[]): Promise<readonly Float64Array[]> {
        return texts.map(fakeProviderVector);
      },
    };
    await indexRagDocumentAsync(PROVIDER_DOC, { sourcePath: join(dir, 'spec.kern'), embedder: fakeProvider });

    const status = await indexRagDocumentAsync(PROVIDER_DOC, { sourcePath: join(dir, 'spec.kern'), statusOnly: true });
    expect(status.indexes[0]).toEqual(expect.objectContaining({ status: 'fresh', action: 'inspected' }));

    const reused = await indexRagDocumentAsync(PROVIDER_DOC, { sourcePath: join(dir, 'spec.kern') });
    expect(reused.indexes[0]).toEqual(expect.objectContaining({ status: 'fresh', action: 'reused' }));

    await expect(
      indexRagDocumentAsync(PROVIDER_DOC, { sourcePath: join(dir, 'spec.kern'), forceRebuild: true }),
    ).rejects.toThrow(/requires OpenAI provider options/u);
  });
});

function fakeProviderVector(text: string): Float64Array {
  const lower = text.toLowerCase();
  if (lower.includes('refund') || lower.includes('money')) return new Float64Array([1, 0, 0]);
  if (lower.includes('shipping') || lower.includes('delivery')) return new Float64Array([0, 1, 0]);
  return new Float64Array([0, 0, 1]);
}
