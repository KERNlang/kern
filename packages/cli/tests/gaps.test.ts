import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runGaps } from '../src/commands/gaps.js';

describe('kern gaps command', () => {
  let tmpDir: string;
  let stdoutChunks: string[];
  let origWrite: (chunk: string) => boolean;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-gaps-test-'));
    stdoutChunks = [];
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = origWrite as typeof process.stdout.write;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function out(): string {
    return stdoutChunks.join('');
  }

  test('reports "No gaps found" on an empty tree', async () => {
    await runGaps([`--root=${tmpDir}`]);
    expect(out()).toContain('scanned 0 files');
    expect(out()).toContain('No gaps found.');
  });

  test('finds KERN-GAP comments across .ts, .kern, and .tsx files', async () => {
    writeFileSync(join(tmpDir, 'a.ts'), '// KERN-GAP: async state initializers not supported\nfoo();\n');
    writeFileSync(
      join(tmpDir, 'b.kern'),
      'screen name=T\n  // KERN-GAP: nested screens cant share state\n  text value=hi\n',
    );
    writeFileSync(join(tmpDir, 'c.tsx'), 'const x = 1; // unrelated\n// KERN-GAP: tsx too\n');

    await runGaps([`--root=${tmpDir}`]);
    const text = out();

    expect(text).toContain('scanned 3 files');
    expect(text).toContain('KERN-GAP comments (3)');
    expect(text).toContain('async state initializers not supported');
    expect(text).toContain('nested screens cant share state');
    expect(text).toContain('tsx too');
  });

  test('skips node_modules, dist, .git, and other tool dirs', async () => {
    mkdirSync(join(tmpDir, 'node_modules'));
    mkdirSync(join(tmpDir, 'dist'));
    mkdirSync(join(tmpDir, '.git'));
    writeFileSync(join(tmpDir, 'node_modules', 'fake.ts'), '// KERN-GAP: should not be found\n');
    writeFileSync(join(tmpDir, 'dist', 'fake.ts'), '// KERN-GAP: should not be found\n');
    writeFileSync(join(tmpDir, '.git', 'fake.ts'), '// KERN-GAP: should not be found\n');
    writeFileSync(join(tmpDir, 'real.ts'), '// KERN-GAP: real one\n');

    await runGaps([`--root=${tmpDir}`]);
    const text = out();

    expect(text).toContain('scanned 1 files');
    expect(text).toContain('real one');
    expect(text).not.toContain('should not be found');
  });

  test('--json emits structured output and suppresses human output', async () => {
    writeFileSync(join(tmpDir, 'a.ts'), '// KERN-GAP: one\n// KERN-GAP: two\n');

    await runGaps([`--root=${tmpDir}`, '--json']);
    const text = out();

    // Should be parseable JSON
    const parsed = JSON.parse(text);
    expect(parsed.scannedFiles).toBe(1);
    expect(parsed.sourceGaps).toHaveLength(2);
    expect(parsed.sourceGaps[0].message).toBe('one');
    expect(parsed.sourceGaps[1].message).toBe('two');
    expect(parsed.coverageGaps).toEqual([]);
    // Should NOT contain the human-readable header
    expect(text).not.toContain('kern gaps — scanned');
  });

  test('reads compiler coverage gaps from .kern-gaps/ JSON', async () => {
    const gapDir = join(tmpDir, '.kern-gaps');
    mkdirSync(gapDir);
    writeFileSync(
      join(gapDir, 'some_file.kern.json'),
      JSON.stringify([
        {
          file: 'examples/foo.kern',
          line: 12,
          nodeType: 'handler',
          handlerLength: 180,
          timestamp: '2026-04-14T10:00:00.000Z',
        },
      ]),
    );

    await runGaps([`--root=${tmpDir}`]);
    const text = out();

    expect(text).toContain('Compiler coverage gaps (1)');
    expect(text).toContain('handler: 1');
  });

  test('--verbose expands the coverage gap list', async () => {
    const gapDir = join(tmpDir, '.kern-gaps');
    mkdirSync(gapDir);
    writeFileSync(
      join(gapDir, 'a.json'),
      JSON.stringify([
        {
          file: 'examples/foo.kern',
          line: 12,
          nodeType: 'handler',
          handlerLength: 180,
          timestamp: '2026-04-14T10:00:00.000Z',
        },
      ]),
    );

    await runGaps([`--root=${tmpDir}`, '--verbose']);
    const text = out();

    expect(text).toContain('Detail:');
    expect(text).toContain('examples/foo.kern:12');
    expect(text).toContain('[handler] handler 180ch');
    expect(text).not.toContain('(run with --verbose for per-file detail)');
  });

  test('clones and scans a remote repo via --git', async () => {
    const repoDir = join(tmpDir, 'repo');
    mkdirSync(repoDir);
    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'kern@example.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'KERN Test'], { cwd: repoDir });
    writeFileSync(join(repoDir, 'remote.ts'), '// KERN-GAP: remote gap\n');
    execFileSync('git', ['add', 'remote.ts'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

    await runGaps([`--git=${repoDir}`]);
    const text = out();

    expect(text).toContain('scanned 1 files');
    expect(text).toContain('remote gap');
  });

  test('checks out --ref for remote gap scans', async () => {
    const repoDir = join(tmpDir, 'repo-ref');
    mkdirSync(repoDir);
    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'kern@example.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'KERN Test'], { cwd: repoDir });

    const file = join(repoDir, 'history.ts');
    writeFileSync(file, '// KERN-GAP: old gap\n');
    execFileSync('git', ['add', 'history.ts'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'first'], { cwd: repoDir });
    execFileSync('git', ['tag', 'v1'], { cwd: repoDir });

    writeFileSync(file, '// KERN-GAP: new gap\n');
    execFileSync('git', ['add', 'history.ts'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'second'], { cwd: repoDir });

    await runGaps([`--git=${repoDir}`, '--ref=v1']);
    const text = out();

    expect(text).toContain('old gap');
    expect(text).not.toContain('new gap');
  });
});
