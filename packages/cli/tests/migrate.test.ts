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

  test('accepts numeric edge cases: negatives, hex, scientific, underscore separators', () => {
    const cases = ['-1', '0xFF', '0b101', '0o17', '1e10', '3.14', '5_000', '-2.5e-3'];
    for (const c of cases) {
      expect(__test__.isInlineSafeLiteral(c)).toBe(true);
    }
  });

  test('accepts booleans, null, undefined', () => {
    for (const c of ['true', 'false', 'null', 'undefined']) {
      expect(__test__.isInlineSafeLiteral(c)).toBe(true);
    }
  });

  test('rejects identifiers, expressions, template literals, objects', () => {
    const cases = ['Math.PI', 'a + b', '`hello ${x}`', '{ foo: 1 }', '[1, 2]', 'foo()', 'new Date()'];
    for (const c of cases) {
      expect(__test__.isInlineSafeLiteral(c)).toBe(false);
    }
  });

  test('rejects strings to avoid latent codegen bug', () => {
    // Strings are excluded because KERN parser strips quotes from `quoted`
    // tokens, causing `value="foo"` to round-trip as unquoted TS.
    for (const c of ['"hello"', "'world'", '"AFREC\\x01"']) {
      expect(__test__.isInlineSafeLiteral(c)).toBe(false);
    }
  });

  test('skips multi-line handler bodies', () => {
    const source = [
      'const name=FOO type=object',
      '  handler <<<',
      '    {',
      '      nested: true,',
      '    }',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteLiteralConsts(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('does not swallow a sibling handler of an indented const', () => {
    // A const nested under a parent node followed by a sibling `handler`
    // block at the SAME indent. The old matcher required any whitespace in
    // front of `handler`, which meant siblings were mistakenly consumed.
    const source = [
      'module name=Foo',
      '  const name=COUNT type=number',
      '  handler <<<',
      '    runModule();',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteLiteralConsts(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('skips const headers with inline # or // comments', () => {
    // KERN strips `#` and `//` inline comments; appending `value=...` after
    // one would put the value inside the stripped comment, silently losing
    // the handler's value.
    const source = [
      'const name=A type=number # retries',
      '  handler <<<',
      '    42',
      '  >>>',
      'const name=B type=number // note',
      '  handler <<<',
      '    7',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteLiteralConsts(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('leaves unrelated const declarations and fn handlers alone', () => {
    const source = ['const name=NO_TYPE', 'fn name=doStuff returns=void', '  handler <<<', '    return;', '  >>>'].join(
      '\n',
    );

    const result = __test__.rewriteLiteralConsts(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });
});
