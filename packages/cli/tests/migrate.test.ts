import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { __test__, runMigrate } from '../src/commands/migrate.js';

describe('kern migrate command', () => {
  let tmpDir: string;
  let stdoutChunks: string[];
  let origWrite: typeof process.stdout.write;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-migrate-test-'));
    stdoutChunks = [];
    origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function out(): string {
    return stdoutChunks.join('');
  }

  test('rewrites single-line primitive non-string literal const handlers', () => {
    const source = [
      'const name=COUNT type=number export=false',
      '  handler <<<',
      '    42',
      '  >>>',
      'const name=READY type=boolean',
      '  handler <<<',
      '    true',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteLiteralConsts(source);

    expect(result.hits).toHaveLength(2);
    expect(result.output).toContain('const name=COUNT type=number export=false value=42');
    expect(result.output).toContain('const name=READY type=boolean value=true');
    expect(result.output).not.toContain('handler <<<');
  });

  test('leaves strings, expressions, and existing value attributes unchanged', () => {
    const source = [
      'const name=NAME type=string',
      '  handler <<<',
      '    "AudioFacets"',
      '  >>>',
      'const name=EXPR type=number',
      '  handler <<<',
      '    40 + 2',
      '  >>>',
      'const name=READY type=boolean value=true',
      '  handler <<<',
      '    false',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteLiteralConsts(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('dry-run reports candidates without modifying files', () => {
    const kernFile = join(tmpDir, 'constants.kern');
    const source = ['const name=ANSWER type=number', '  handler <<<', '    42', '  >>>'].join('\n');
    writeFileSync(kernFile, source);

    runMigrate(['migrate', 'literal-const', tmpDir]);

    expect(out()).toContain('scanned 1 .kern files');
    expect(out()).toContain('would apply: 1 hits across 1 files');
    expect(readFileSync(kernFile, 'utf-8')).toBe(source);
  });

  test('--write applies migration in place', () => {
    const kernFile = join(tmpDir, 'constants.kern');
    writeFileSync(kernFile, ['const name=ANSWER type=number', '  handler <<<', '    42', '  >>>'].join('\n'));

    runMigrate(['migrate', 'literal-const', tmpDir, '--write']);

    expect(out()).toContain('applied: 1 hits across 1 files');
    expect(readFileSync(kernFile, 'utf-8')).toContain('const name=ANSWER type=number value=42');
  });
});
