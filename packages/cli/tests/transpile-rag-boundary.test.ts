import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');

describe('kern transpile RAG boundary diagnostics', () => {
  let dir: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`transpile RAG boundary test requires a built CLI at ${CLI}`);
    }
    dir = mkdtempSync(join(tmpdir(), 'kern-transpile-rag-boundary-'));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('prints runner-only RAG consumed diagnostics for emitted targets', () => {
    const file = join(dir, 'rag-boundary.kern');
    writeFileSync(
      file,
      [
        'server name=Api',
        '  route method=GET path="/health" response=Health',
        'interface name=Health',
        '  field name=ok type=boolean',
        'corpus name=Docs',
        '  source name=manuals kind=local uri="./docs/**/*.md"',
        'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
        'ragIndex name=DocsIndex corpus=Docs store=DocsMemory',
        'ragRetrieve name=FindDocs index=DocsIndex queryParam=question output="RetrievedChunk[]"',
      ].join('\n'),
    );

    const result = spawnSync(process.execPath, [CLI, file, '--target=express'], { encoding: 'utf-8', timeout: 20000 });
    if (result.error) throw result.error;

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Diagnostics: ');
    expect(result.stdout).toContain('consumed');
    expect(result.stdout).toContain('RAG runner-only boundary in express');
  });
});
