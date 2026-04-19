import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { __test__, MIGRATIONS, runMigrate } from '../src/commands/migrate.js';

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

  test('wraps strings, expressions, and object/array literals in value={{ ... }}', () => {
    const source = [
      'const name=NAME type=string',
      '  handler <<<',
      '    "AudioFacets"',
      '  >>>',
      'const name=EXPR type=number',
      '  handler <<<',
      '    40 + 2',
      '  >>>',
      'const name=INIT type=any',
      '  handler <<<',
      '    { current: null }',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteLiteralConsts(source);

    expect(result.hits).toHaveLength(3);
    expect(result.output).toContain('const name=NAME type=string value={{ "AudioFacets" }}');
    expect(result.output).toContain('const name=EXPR type=number value={{ 40 + 2 }}');
    expect(result.output).toContain('const name=INIT type=any value={{ { current: null } }}');
    expect(result.output).not.toContain('handler <<<');
  });

  test('leaves consts that already have value= unchanged', () => {
    const source = ['const name=READY type=boolean value=true', '  handler <<<', '    false', '  >>>'].join('\n');

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

  test('rejects identifiers, expressions, template literals, objects as bare literals', () => {
    // These must not take the bare `value=` path (whitespace breaks the KERN
    // prop tokeniser); they go through the `value={{ ... }}` expression path.
    const cases = ['Math.PI', 'a + b', '`hello ${x}`', '{ foo: 1 }', '[1, 2]', 'foo()', 'new Date()'];
    for (const c of cases) {
      expect(__test__.isInlineSafeLiteral(c)).toBe(false);
    }
  });

  test('rejects strings as bare literals but accepts them as expressions', () => {
    // Bare form `value="foo"` is broken by the parser's quote-stripping;
    // wrapping in `{{ ... }}` is safe because the expr block preserves raw
    // content between `{{` and `}}` verbatim.
    for (const c of ['"hello"', "'world'", '"AFREC\\x01"']) {
      expect(__test__.isInlineSafeLiteral(c)).toBe(false);
      expect(__test__.isInlineSafeExpression(c)).toBe(true);
    }
  });

  test('rejects expressions that contain the `}}` closing delimiter', () => {
    // `}}` inside a body would close the expr block prematurely.
    expect(__test__.isInlineSafeExpression('obj}}x')).toBe(false);
    expect(__test__.isInlineSafeExpression('')).toBe(false);
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

  test('rewrites single-line fn handler bodies to expr blocks', () => {
    const source = [
      'fn name=getAnswer returns=number export=false',
      '  handler <<<',
      '    return 42;',
      '  >>>',
      'fn name=log returns=void',
      '  handler <<<',
      '    console.log("hi");',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteFnExpr(source);

    expect(result.hits).toHaveLength(2);
    expect(result.output).toContain('fn name=getAnswer returns=number export=false expr={{ return 42; }}');
    expect(result.output).toContain('fn name=log returns=void expr={{ console.log("hi"); }}');
    expect(result.output).not.toContain('handler <<<');
  });

  test('fn-expr skips existing expr or handler attributes and unsafe bodies', () => {
    const source = [
      'fn name=existing returns=void expr={{ return; }}',
      '  handler <<<',
      '    return;',
      '  >>>',
      'fn name=inline returns=void handler=run',
      '  handler <<<',
      '    return;',
      '  >>>',
      'fn name=unsafe returns=void',
      '  handler <<<',
      '    return obj}}x;',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteFnExpr(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('fn-expr skips multi-line handler bodies and sibling handlers', () => {
    const source = [
      'fn name=multi returns=void',
      '  handler <<<',
      '    if (ready) {',
      '      return;',
      '    }',
      '  >>>',
      'module name=Foo',
      '  fn name=nested returns=void',
      '  handler <<<',
      '    return;',
      '  >>>',
    ].join('\n');

    const result = __test__.rewriteFnExpr(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('fn-expr --write applies migration in place', () => {
    const kernFile = join(tmpDir, 'functions.kern');
    writeFileSync(
      kernFile,
      ['fn name=getAnswer returns=number', '  handler <<<', '    return 42;', '  >>>'].join('\n'),
    );

    runMigrate(['migrate', 'fn-expr', tmpDir, '--write']);

    expect(out()).toContain('kern migrate fn-expr');
    expect(out()).toContain('applied: 1 hits across 1 files');
    expect(readFileSync(kernFile, 'utf-8')).toContain('fn name=getAnswer returns=number expr={{ return 42; }}');
  });

  describe('registry + list subcommand', () => {
    test('MIGRATIONS exposes every migration with name/category/summary', () => {
      const keys = Object.keys(MIGRATIONS);
      // Phase 3 + later additions — pin the core entries but don't break when
      // new migrations land (class-body, etc.). Each entry must be complete.
      expect(keys).toEqual(expect.arrayContaining(['fn-expr', 'literal-const']));
      for (const key of keys) {
        const def = MIGRATIONS[key];
        expect(def.name).toBe(key);
        expect(def.category).toBe('migratable');
        expect(typeof def.summary).toBe('string');
        expect(def.summary.length).toBeGreaterThan(0);
        expect(typeof def.rewrite).toBe('function');
      }
    });

    test('kern migrate list prints each migration tagged with its category', () => {
      runMigrate(['migrate', 'list']);
      const text = out();
      expect(text).toContain('literal-const');
      expect(text).toContain('fn-expr');
      expect(text).toContain('[migratable]');
    });

    test('kern migrate list --json emits the registry as structured data', () => {
      runMigrate(['migrate', 'list', '--json']);
      const parsed = JSON.parse(out());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(2);
      const names = parsed.map((e: { name: string }) => e.name);
      expect(names).toEqual(expect.arrayContaining(['fn-expr', 'literal-const']));
      for (const entry of parsed) {
        expect(entry.category).toBe('migratable');
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.summary).toBe('string');
      }
    });

    test('JSON migration reports now carry category for cross-reference with `kern gaps`', () => {
      const kernFile = join(tmpDir, 'constants.kern');
      writeFileSync(kernFile, ['const name=C type=number', '  handler <<<', '    42', '  >>>'].join('\n'));

      runMigrate(['migrate', 'literal-const', tmpDir, '--json']);
      const parsed = JSON.parse(out());

      expect(parsed.migration).toBe('literal-const');
      expect(parsed.category).toBe('migratable');
      expect(parsed.mode).toBe('dry-run');
      expect(parsed.totalHits).toBe(1);
    });
  });
});
