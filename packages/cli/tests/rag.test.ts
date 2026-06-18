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

function run(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('kern rag eval', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-rag-cli-'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy money back within thirty days\n');
    writeFileSync(join(dir, 'docs/shipping.md'), 'shipping delivery courier tracking parcel\n');
    writeFileSync(join(dir, 'mydocs.kern'), DOC);
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
});
