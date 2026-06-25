import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');

const DOC = `corpus name=Docs
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown
  chunking source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens

retriever name=DocsSearch corpus=Docs
rag name=AnswerDocs retriever=DocsSearch citations=true
  grounding name=StrictGrounding requireCitations=true policy=strict maxContext=6000
  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund policy money back" topK=1
      ragAssert kind=sourceGlob value="docs/refunds*" required=true
      ragAssert kind=citesRequired
`;

const RETRIEVE_DOC = `corpus name=Docs
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

const FIXED_RETRIEVE_DOC = RETRIEVE_DOC.replace(
  'ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
  'ragRetrieve name=FindDocs index=DocsIndex query="refund policy money back" topK=1 output="RetrievedChunk[]"',
);

const DYNAMIC_RETRIEVE_DOC = RETRIEVE_DOC.replace(
  'ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=1 output="RetrievedChunk[]"',
  'ragRetrieve name=FindDocs index=DocsIndex query={{ "refund policy money back" }} topK=1 output="RetrievedChunk[]"',
);

const LOCAL_PERSISTENT_RETRIEVE_DOC = RETRIEVE_DOC.replace(
  'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
  'vectorStore name=DocsMemory kind=local-persistent dims=64 metric=cosine path="./index"',
);

const LOCAL_PERSISTENT_EVAL_DOC = `corpus name=Docs
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown
  chunking name=DocsChunks source=manuals strategy=semantic maxTokens=80 overlap=0 unit=tokens

embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine
vectorStore name=DocsMemory kind=local-persistent dims=64 metric=cosine path="./index"
ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=DocsChunks
retriever name=DocsSearch corpus=Docs embed=DocsEmbedding
rag name=AnswerDocs retriever=DocsSearch citations=true
  grounding name=StrictGrounding requireCitations=true policy=strict maxContext=6000
  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund policy money back" topK=1
      ragAssert kind=sourceGlob value="docs/refunds*" required=true
      ragAssert kind=citesRequired
`;

function run(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('kern rag', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-rag-cli-'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy money back within thirty days\n');
    writeFileSync(join(dir, 'docs/shipping.md'), 'shipping delivery courier tracking parcel\n');
    writeFileSync(join(dir, 'mydocs.kern'), DOC);
    writeFileSync(join(dir, 'retrieve.kern'), RETRIEVE_DOC);
    writeFileSync(join(dir, 'persistent-retrieve.kern'), LOCAL_PERSISTENT_RETRIEVE_DOC);
    writeFileSync(join(dir, 'persistent-eval.kern'), LOCAL_PERSISTENT_EVAL_DOC);
    writeFileSync(join(dir, 'fixed-retrieve.kern'), FIXED_RETRIEVE_DOC);
    writeFileSync(join(dir, 'dynamic-retrieve.kern'), DYNAMIC_RETRIEVE_DOC);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('runs without --corpus using declared local sources', () => {
    const result = run(['rag', 'eval', 'mydocs.kern'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mode=declared-local-sources');
    expect(result.stdout).toContain('embedder=local-semantic-v1');
    expect(result.stdout).toContain('PASS');
  });

  test('preserves explicit --corpus mode', () => {
    const corpus = [
      { id: 'refunds', text: 'refund policy money back within thirty days', source: 'docs/refunds.md' },
      { id: 'shipping', text: 'shipping delivery courier tracking parcel', source: 'docs/shipping.md' },
    ];
    writeFileSync(join(dir, 'chunks.json'), JSON.stringify(corpus));

    const result = run(['rag', 'eval', 'mydocs.kern', '--corpus', 'chunks.json'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mode=explicit-corpus-json');
    expect(result.stdout).toContain('PASS');
  });

  test('emits CI-friendly JSON eval reports with retrieval metrics', () => {
    const result = run(['rag', 'eval', 'mydocs.kern', '--json'], dir);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly corpusSource: { readonly mode: string };
      readonly evals: readonly [
        {
          readonly ragName: string;
          readonly evalName: string;
          readonly result: {
            readonly metrics: {
              readonly hitRate: number;
              readonly citationCoverage: number;
              readonly minRelevance: number | null;
              readonly grounding: { readonly passed: boolean; readonly passRate: number };
            };
          };
        },
      ];
    };
    expect(report.passed).toBe(true);
    expect(report.corpusSource.mode).toBe('declared-local-sources');
    expect(report.evals[0]).toEqual(expect.objectContaining({ ragName: 'AnswerDocs', evalName: 'Faithfulness' }));
    expect(typeof report.evals[0].result.metrics.minRelevance).toBe('number');
    expect(report.evals[0].result.metrics).toEqual(
      expect.objectContaining({
        hitRate: 1,
        citationCoverage: 1,
        grounding: expect.objectContaining({ passed: true, passRate: 1 }),
      }),
    );
  });

  test('keeps the rag-starter eval fixture runnable for CI', () => {
    const fixture = join(dir, 'rag-starter');
    cpSync(join(ROOT, 'examples/rag-starter'), fixture, { recursive: true });
    rmSync(join(fixture, 'index'), { recursive: true, force: true });

    const result = run(['rag', 'eval', 'eval-ci.kern', '--json'], fixture);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly corpusSource: { readonly chunkCount: number };
      readonly indexes: readonly [{ readonly storeKind: string; readonly status: string; readonly snapshotPath: string }];
      readonly evals: readonly [{ readonly result: { readonly passed: boolean } }];
    };
    expect(report.passed).toBe(true);
    expect(report.corpusSource.chunkCount).toBe(2);
    expect(report.indexes[0]).toEqual(
      expect.objectContaining({ storeKind: 'local-persistent', status: 'indexed', snapshotPath: 'index/DocsIndex.json' }),
    );
    expect(report.evals[0].result.passed).toBe(true);
  });

  test('emits runtime index lifecycle in JSON eval reports', () => {
    const first = run(['rag', 'eval', 'persistent-eval.kern', '--json'], dir);
    const snapshot = readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8');
    const second = run(['rag', 'eval', 'persistent-eval.kern', '--json'], dir);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const firstReport = JSON.parse(first.stdout) as {
      readonly passed: boolean;
      readonly indexes: readonly [
        { readonly indexName: string; readonly status: string; readonly snapshotPath: string },
      ];
    };
    const secondReport = JSON.parse(second.stdout) as {
      readonly passed: boolean;
      readonly indexes: readonly [
        { readonly indexName: string; readonly status: string; readonly snapshotPath: string },
      ];
    };
    expect(firstReport.passed).toBe(true);
    expect(firstReport.indexes[0]).toEqual(
      expect.objectContaining({ indexName: 'DocsIndex', status: 'indexed', snapshotPath: 'index/DocsIndex.json' }),
    );
    expect(secondReport.passed).toBe(true);
    expect(secondReport.indexes[0]).toEqual(
      expect.objectContaining({ indexName: 'DocsIndex', status: 'reused', snapshotPath: 'index/DocsIndex.json' }),
    );
    expect(readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8')).toBe(snapshot);
  });

  test('emits explicit eval target provenance in JSON reports', () => {
    const result = run(['rag', 'eval', 'persistent-eval.kern', '--rag-index', 'DocsIndex', '--json'], dir);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly target: {
        readonly requested: { readonly indexName: string };
        readonly mode: string;
        readonly retrieverNames: readonly string[];
        readonly indexNames: readonly string[];
      };
      readonly evals: readonly [
        {
          readonly target: {
            readonly retrieverName: string;
            readonly indexName: string;
            readonly mode: string;
          };
        },
      ];
    };
    expect(report.passed).toBe(true);
    expect(report.target).toEqual(
      expect.objectContaining({
        requested: { indexName: 'DocsIndex' },
        mode: 'explicit-index',
        retrieverNames: ['DocsSearch'],
        indexNames: ['DocsIndex'],
      }),
    );
    expect(report.evals[0].target).toEqual({
      retrieverName: 'DocsSearch',
      indexName: 'DocsIndex',
      mode: 'explicit-index',
    });
  });

  test('supports explicit eval retriever and retriever/index pair targets', () => {
    const retriever = run(['rag', 'eval', 'persistent-eval.kern', '--rag-retriever', 'DocsSearch', '--json'], dir);
    const pair = run(
      ['rag', 'eval', 'persistent-eval.kern', '--rag-retriever', 'DocsSearch', '--rag-index', 'DocsIndex', '--json'],
      dir,
    );

    expect(retriever.status).toBe(0);
    expect(pair.status).toBe(0);
    const retrieverReport = JSON.parse(retriever.stdout) as {
      readonly target: { readonly mode: string; readonly retrieverNames: readonly string[] };
    };
    const pairReport = JSON.parse(pair.stdout) as {
      readonly target: {
        readonly requested: { readonly retrieverName: string; readonly indexName: string };
        readonly mode: string;
        readonly retrieverNames: readonly string[];
        readonly indexNames: readonly string[];
      };
    };
    expect(retrieverReport.target).toEqual(
      expect.objectContaining({
        mode: 'explicit-retriever',
        retrieverNames: ['DocsSearch'],
      }),
    );
    expect(pairReport.target).toEqual(
      expect.objectContaining({
        requested: { retrieverName: 'DocsSearch', indexName: 'DocsIndex' },
        mode: 'explicit-pair',
        retrieverNames: ['DocsSearch'],
        indexNames: ['DocsIndex'],
      }),
    );
  });

  test('rejects eval target flags with explicit corpus mode', () => {
    const corpus = [
      { id: 'refunds', text: 'refund policy money back within thirty days', source: 'docs/refunds.md' },
      { id: 'shipping', text: 'shipping delivery courier tracking parcel', source: 'docs/shipping.md' },
    ];
    writeFileSync(join(dir, 'chunks.json'), JSON.stringify(corpus));

    const result = run(['rag', 'eval', 'persistent-eval.kern', '--corpus', 'chunks.json', '--rag-index', 'DocsIndex'], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--corpus cannot be combined with --rag-retriever or --rag-index');
  });

  test('rejects eval target flags without values', () => {
    const missingRetriever = run(['rag', 'eval', 'persistent-eval.kern', '--rag-retriever'], dir);
    const missingIndex = run(['rag', 'eval', 'persistent-eval.kern', '--rag-index'], dir);

    expect(missingRetriever.status).toBe(1);
    expect(missingRetriever.stderr).toContain('missing value for --rag-retriever');
    expect(missingIndex.status).toBe(1);
    expect(missingIndex.stderr).toContain('missing value for --rag-index');
  });

  test('rejects --corpus without a value', () => {
    const result = run(['rag', 'eval', 'mydocs.kern', '--corpus'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing value for --corpus');
  });

  test('provider-backed specs use the async provider path in the CLI', () => {
    const providerDoc = DOC.replace(
      'retriever name=DocsSearch corpus=Docs',
      [
        'embed name=DocsEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=1536 metric=cosine',
        'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'provider.kern'), providerDoc);

    const result = run(['rag', 'eval', 'provider.kern'], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RAG embed model 'openai:text-embedding-3-small' requires OpenAI provider options");
    expect(result.stderr).not.toContain('requires async provider execution');
  });

  test('rejects --openai-api-key without a value', () => {
    const result = run(['rag', 'eval', 'mydocs.kern', '--openai-api-key'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing value for --openai-api-key');
  });

  test('rejects unknown eval flags before reading files', () => {
    const result = run(['rag', 'eval', '--openai-api-kee', 'sk-test', 'mydocs.kern'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown flag for eval: --openai-api-kee');
  });

  test('rejects extra eval positional arguments', () => {
    const result = run(['rag', 'eval', 'mydocs.kern', 'extra.kern'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected argument for eval: extra.kern');
  });

  test('reports empty declared source globs with the pattern', () => {
    rmSync(join(dir, 'docs'), { recursive: true, force: true });
    const result = run(['rag', 'eval', 'mydocs.kern'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('./docs/**/*.md');
    expect(result.stderr).toContain('matched no files');
  });

  test('runs runtime ragRetrieve declarations from declared local sources', () => {
    const result = run(['rag', 'retrieve', 'retrieve.kern', '--query', 'refund policy money back'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('kern rag retrieve retrieve.kern');
    expect(result.stdout).toContain('DocsIndex store=DocsMemory kind=memory status=indexed');
    expect(result.stdout).toContain('AnswerDocs/FindDocs index=DocsIndex');
    expect(result.stdout).toContain('refunds');
    expect(result.stdout).toContain('refund policy money back within thirty days');
  });

  test('emits CI-friendly JSON retrieve reports for in-memory indexes', () => {
    const result = run(['rag', 'retrieve', 'retrieve.kern', '--query', 'refund policy money back', '--json'], dir);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      readonly diagnostics: readonly unknown[];
      readonly ingestion: {
        readonly corpusSha256: string;
        readonly chunks: readonly unknown[];
        readonly sources: readonly unknown[];
      };
      readonly indexes: readonly [{ readonly indexName: string; readonly storeKind: string; readonly status: string }];
      readonly retrievals: readonly [
        {
          readonly name: string;
          readonly ragName: string;
          readonly indexName: string;
          readonly query: string;
          readonly result: { readonly chunks: readonly [{ readonly id: string; readonly source: string }] };
        },
      ];
    };
    expect(report.diagnostics).toEqual([]);
    expect(typeof report.ingestion.corpusSha256).toBe('string');
    expect(Array.isArray(report.ingestion.chunks)).toBe(true);
    expect(Array.isArray(report.ingestion.sources)).toBe(true);
    expect(report.ingestion.chunks).toHaveLength(2);
    expect(report.indexes[0]).toEqual(
      expect.objectContaining({ indexName: 'DocsIndex', storeKind: 'memory', status: 'indexed' }),
    );
    expect(report.retrievals[0]).toEqual(
      expect.objectContaining({
        name: 'FindDocs',
        ragName: 'AnswerDocs',
        indexName: 'DocsIndex',
        query: 'refund policy money back',
      }),
    );
    expect(report.retrievals[0].result.chunks[0]).toEqual(
      expect.objectContaining({ source: 'docs/refunds.md' }),
    );
  });

  test('runs runtime ragRetrieve declarations with named query params', () => {
    const result = run(['rag', 'retrieve', 'retrieve.kern', '--param', 'question=refund policy money back'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('kern rag retrieve retrieve.kern');
    expect(result.stdout).toContain('AnswerDocs/FindDocs index=DocsIndex');
    expect(result.stdout).toContain('refunds');
  });

  test('runs local-persistent runtime ragRetrieve declarations across repeated CLI invocations', () => {
    const first = run(['rag', 'retrieve', 'persistent-retrieve.kern', '--query', 'refund policy money back'], dir);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('refunds');
    expect(first.stdout).toContain('DocsIndex store=DocsMemory kind=local-persistent status=indexed');

    const snapshot = readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8');
    const second = run(['rag', 'retrieve', 'persistent-retrieve.kern', '--query', 'refund policy money back'], dir);

    expect(second.status).toBe(0);
    expect(second.stdout).toContain('refunds');
    expect(second.stdout).toContain('DocsIndex store=DocsMemory kind=local-persistent status=reused');
    expect(readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8')).toBe(snapshot);
  });

  test('emits JSON retrieve reports with local-persistent reuse state', () => {
    const first = run(
      ['rag', 'retrieve', 'persistent-retrieve.kern', '--query', 'refund policy money back', '--json'],
      dir,
    );
    const snapshot = readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8');
    const second = run(
      ['rag', 'retrieve', 'persistent-retrieve.kern', '--query', 'refund policy money back', '--json'],
      dir,
    );

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const firstReport = JSON.parse(first.stdout) as {
      readonly indexes: readonly [{ readonly storeKind: string; readonly status: string; readonly snapshotPath: string }];
    };
    const secondReport = JSON.parse(second.stdout) as {
      readonly indexes: readonly [{ readonly storeKind: string; readonly status: string; readonly snapshotPath: string }];
    };
    expect(firstReport.indexes[0]).toEqual(
      expect.objectContaining({ storeKind: 'local-persistent', status: 'indexed', snapshotPath: 'index/DocsIndex.json' }),
    );
    expect(secondReport.indexes[0]).toEqual(
      expect.objectContaining({ storeKind: 'local-persistent', status: 'reused', snapshotPath: 'index/DocsIndex.json' }),
    );
    expect(readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8')).toBe(snapshot);
  });

  test('exits non-zero with JSON retrieve diagnostics for invalid specs', () => {
    writeFileSync(
      join(dir, 'invalid-retrieve.kern'),
      RETRIEVE_DOC.replace('queryParam=question topK=1 output=', 'queryParam=question topK=0 output='),
    );

    const result = run(['rag', 'retrieve', 'invalid-retrieve.kern', '--query', 'refund policy', '--json'], dir);

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as {
      readonly diagnostics: readonly [{ readonly rule: string; readonly message: string }];
      readonly retrievals: readonly unknown[];
    };
    expect(report.retrievals).toEqual([]);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('topK') }),
      ]),
    );
  });

  test('indexes local-persistent ragIndex snapshots and reports status as JSON', () => {
    const first = run(['rag', 'index', 'persistent-retrieve.kern'], dir);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('DocsIndex store=DocsMemory kind=local-persistent status=missing action=indexed');
    expect(first.stdout).toContain('snapshot=index/DocsIndex.json');
    expect(first.stdout).toContain('manifest=index/DocsIndex.manifest.json');

    const snapshot = readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8');
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy now requires receipt approval\n');

    const status = run(['rag', 'index', 'persistent-retrieve.kern', '--status', '--json'], dir);
    expect(status.status).toBe(0);
    const parsed = JSON.parse(status.stdout) as {
      readonly indexes: readonly [{ readonly status: string; readonly action: string }];
    };
    expect(parsed.indexes[0]).toEqual(expect.objectContaining({ status: 'stale', action: 'inspected' }));
    expect(readFileSync(join(dir, 'index', 'DocsIndex.json'), 'utf-8')).toBe(snapshot);
  });

  test('runs fixed literal runtime ragRetrieve declarations without CLI query input', () => {
    const result = run(['rag', 'retrieve', 'fixed-retrieve.kern'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AnswerDocs/FindDocs index=DocsIndex query="refund policy money back"');
    expect(result.stdout).toContain('refunds');
  });

  test('rejects dynamic fixed runtime ragRetrieve expressions', () => {
    const result = run(['rag', 'retrieve', 'dynamic-retrieve.kern'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('uses dynamic query=<expr>');
  });

  test('emits JSON retrieve errors for runtime retrieval failures', () => {
    const result = run(['rag', 'retrieve', 'dynamic-retrieve.kern', '--json'], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as {
      readonly diagnostics: readonly [{ readonly rule: string; readonly message: string }];
      readonly indexes: readonly unknown[];
      readonly retrievals: readonly unknown[];
    };
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ rule: 'rag-retrieve-error', message: expect.stringContaining('uses dynamic query=<expr>') }),
    ]);
    expect(report.indexes).toEqual([]);
    expect(report.retrievals).toEqual([]);
  });

  test('emits JSON retrieve diagnostics for argument validation failures', () => {
    const result = run(['rag', 'retrieve', 'retrieve.kern', '--json', '--param'], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as {
      readonly diagnostics: readonly [{ readonly rule: string; readonly message: string }];
      readonly indexes: readonly unknown[];
      readonly retrievals: readonly unknown[];
    };
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ rule: 'rag-retrieve-error', message: expect.stringContaining('missing value for --param') }),
    ]);
    expect(report.indexes).toEqual([]);
    expect(report.retrievals).toEqual([]);
  });

  test('rejects retrieve without a query source', () => {
    const result = run(['rag', 'retrieve', 'retrieve.kern'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires queryParam 'question'");
  });

  test('rejects malformed retrieve query params', () => {
    const result = run(['rag', 'retrieve', 'retrieve.kern', '--param', 'question'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing value for --param (expected name=value)');
  });

  test('rejects empty retrieve query param names and values', () => {
    const emptyName = run(['rag', 'retrieve', 'retrieve.kern', '--param', '=refund'], dir);
    expect(emptyName.status).toBe(1);
    expect(emptyName.stderr).toContain('missing value for --param (expected name=value)');

    const emptyValue = run(['rag', 'retrieve', 'retrieve.kern', '--param', 'question='], dir);
    expect(emptyValue.status).toBe(1);
    expect(emptyValue.stderr).toContain('missing value for --param');
  });

  test('provider-backed runtime ragRetrieve specs require provider options in the CLI path', () => {
    const providerDoc = RETRIEVE_DOC.replace(
      'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
      'embed name=DocsEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=1536 metric=cosine',
    ).replace(
      'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
      'vectorStore name=DocsMemory kind=memory dims=1536 metric=cosine',
    );
    writeFileSync(join(dir, 'provider-retrieve.kern'), providerDoc);

    const result = run(['rag', 'retrieve', 'provider-retrieve.kern', '--query', 'refund policy'], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RAG embed model 'openai:text-embedding-3-small' requires OpenAI provider options");
  });

  test('rejects unknown retrieve flags before consuming their values as files', () => {
    const result = run(['rag', 'retrieve', '--openai-api-kee', 'sk-test', 'retrieve.kern', '--query', 'refund'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown flag for retrieve: --openai-api-kee');
  });

  test('rejects retrieve --openai-api-key without a value', () => {
    const result = run(['rag', 'retrieve', 'retrieve.kern', '--openai-api-key'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing value for --openai-api-key');
  });

  test('rejects extra retrieve positional arguments', () => {
    const result = run(
      ['rag', 'retrieve', 'retrieve.kern', 'extra.kern', '--param', 'question=refund policy money back'],
      dir,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected argument for retrieve: extra.kern');
  });

  test('reports empty declared source globs for retrieve', () => {
    rmSync(join(dir, 'docs'), { recursive: true, force: true });
    const result = run(['rag', 'retrieve', 'retrieve.kern', '--query', 'refund policy'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('./docs/**/*.md');
    expect(result.stderr).toContain('matched no files');
  });

  test('runs built-in RAG adapter conformance checks', () => {
    const result = run(['rag', 'conformance'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('kern rag conformance');
    expect(result.stdout).toContain('✓ memory mode=sync');
    expect(result.stdout).toContain('✓ local-persistent');
    expect(result.stdout).toContain('transport=in-process batchUpsert=true namespaces=false filters=none');
  });

  test('emits JSON for RAG adapter conformance checks', () => {
    const result = run(['rag', 'conformance', '--adapter', 'memory', '--json'], dir);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly reports: readonly [
        {
          readonly adapterMode: string;
          readonly manifest: {
            readonly name: string;
            readonly transport: string;
            readonly capabilities: { readonly upsertMany: boolean; readonly namespaces: boolean };
          };
          readonly summary: { readonly failed: number };
        },
      ];
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.reports[0].adapterMode).toBe('sync');
    expect(parsed.reports[0].manifest.name).toBe('memory');
    expect(parsed.reports[0].manifest.transport).toBe('in-process');
    expect(parsed.reports[0].manifest.capabilities.upsertMany).toBe(true);
    expect(parsed.reports[0].manifest.capabilities.namespaces).toBe(false);
    expect(parsed.reports[0].summary.failed).toBe(0);
  });

  test('lists RAG adapter conformance contracts', () => {
    const result = run(['rag', 'conformance', '--list'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('kern rag conformance kern-rag-vector-store-conformance-v2');
    expect(result.stdout).toContain('required operations:');
    expect(result.stdout).toContain('required manifest fields:');
    expect(result.stdout).toContain('memory kind=memory');
    expect(result.stdout).toContain('local-persistent kind=local-persistent');
    expect(result.stdout).toContain('transport=in-process batchUpsert=true namespaces=false filters=none');
  });

  test('emits JSON for RAG adapter conformance contract listing', () => {
    const result = run(['rag', 'conformance', '--list', '--json'], dir);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly profile: { readonly version: string; readonly cases: readonly string[] };
      readonly adapters: readonly {
        readonly name: string;
        readonly transport: string;
        readonly capabilities: { readonly upsertMany: boolean; readonly filters: readonly string[] };
      }[];
    };
    expect(parsed.profile).toBeDefined();
    expect(parsed.profile.version).toBe('kern-rag-vector-store-conformance-v2');
    expect(parsed.profile.cases).toContain('durable-round-trip');
    expect(parsed.profile.cases).toContain('namespace-isolation');
    expect(parsed.adapters[0].name).toBe('memory');
    expect(parsed.adapters[0].transport).toBe('in-process');
    expect(parsed.adapters[0].capabilities.upsertMany).toBe(true);
    expect(parsed.adapters[0].capabilities.filters).toEqual([]);
  });

  test('rejects RAG conformance list combined with adapter filter', () => {
    const result = run(['rag', 'conformance', '--list', '--adapter', 'memory'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--list cannot be combined with --adapter');
  });

  test('rejects unknown RAG conformance adapters', () => {
    const result = run(['rag', 'conformance', '--adapter', 'pinecone'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown RAG adapter 'pinecone'");
  });

  test('rejects RAG conformance adapter flag without a value', () => {
    const result = run(['rag', 'conformance', '--adapter'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing value for --adapter');
  });

  test('rejects unexpected RAG conformance positional arguments', () => {
    const result = run(['rag', 'conformance', 'memory'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected argument for conformance: memory');
  });
});
