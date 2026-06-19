import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(result.stdout).toContain('AnswerDocs/FindDocs index=DocsIndex');
    expect(result.stdout).toContain('refunds');
    expect(result.stdout).toContain('refund policy money back within thirty days');
  });

  test('runs runtime ragRetrieve declarations with named query params', () => {
    const result = run(['rag', 'retrieve', 'retrieve.kern', '--param', 'question=refund policy money back'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('kern rag retrieve retrieve.kern');
    expect(result.stdout).toContain('AnswerDocs/FindDocs index=DocsIndex');
    expect(result.stdout).toContain('refunds');
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

  test('provider-backed runtime ragRetrieve specs fail closed in the local-only CLI path', () => {
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
    expect(result.stderr).toContain(
      "RAG embed model 'openai:text-embedding-3-small' requires async provider execution",
    );
  });

  test('rejects unknown retrieve flags before consuming their values as files', () => {
    const result = run(['rag', 'retrieve', '--openai-api-key', 'sk-test', 'retrieve.kern', '--query', 'refund'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown flag for retrieve: --openai-api-key');
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
    expect(result.stdout).toContain('✓ memory');
    expect(result.stdout).toContain('✓ local-persistent');
  });

  test('emits JSON for RAG adapter conformance checks', () => {
    const result = run(['rag', 'conformance', '--adapter', 'memory', '--json'], dir);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly passed: boolean;
      readonly reports: readonly [
        { readonly manifest: { readonly name: string }; readonly summary: { readonly failed: number } },
      ];
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.reports[0].manifest.name).toBe('memory');
    expect(parsed.reports[0].summary.failed).toBe(0);
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
