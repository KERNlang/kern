import { collectCoverageGaps } from '../src/coverage-gap.js';
import { parse } from '../src/parser.js';

describe('Coverage Gap Emitter', () => {
  it('collects handler escapes as coverage gaps', () => {
    const source = [
      'route GET /api/users',
      '  handler <<<',
      '    const users = await db.query("SELECT * FROM users");',
      '    return users;',
      '  >>>',
    ].join('\n');

    const ast = parse(source);
    const gaps = collectCoverageGaps(ast, 'kern/api/users.kern');

    expect(gaps.length).toBe(1);
    expect(gaps[0].nodeType).toBe('handler');
    expect(gaps[0].file).toBe('kern/api/users.kern');
    expect(gaps[0].handlerLength).toBeGreaterThan(0);
    expect(gaps[0].timestamp).toBeDefined();
    // Multi-line route handler has no rewriter — stays `detected`.
    expect(gaps[0].category).toBe('detected');
    expect(gaps[0].migration).toBeUndefined();
    expect(gaps[0].parentType).toBe('route');
  });

  it('tags a const+literal handler as migratable with a migration hint', () => {
    const source = ['const name=TIMEOUT type=number', '  handler <<<', '    5000', '  >>>'].join('\n');
    const ast = parse(source);
    const gaps = collectCoverageGaps(ast, 'timeout.kern');

    expect(gaps).toHaveLength(1);
    expect(gaps[0].category).toBe('migratable');
    expect(gaps[0].migration).toBe('literal-const');
    expect(gaps[0].parentType).toBe('const');
  });

  it('tags an fn+single-line handler as migratable via fn-expr', () => {
    const source = ['fn name=toUpper', '  handler <<<', '    return s.toUpperCase();', '  >>>'].join('\n');
    const ast = parse(source);
    const gaps = collectCoverageGaps(ast, 'fn.kern');

    expect(gaps).toHaveLength(1);
    expect(gaps[0].category).toBe('migratable');
    expect(gaps[0].migration).toBe('fn-expr');
    expect(gaps[0].parentType).toBe('fn');
  });

  it('collects multiple handlers', () => {
    const source = [
      'route GET /api/users',
      '  handler <<<return [];>>>',
      'route POST /api/users',
      '  handler <<<return {};>>>',
    ].join('\n');

    const ast = parse(source);
    const gaps = collectCoverageGaps(ast, 'test.kern');

    expect(gaps.length).toBe(2);
  });

  it('returns empty for handler-free AST', () => {
    const source = ['screen name="Home"', '  text value="Hello"', '  button label="Click"'].join('\n');

    const ast = parse(source);
    const gaps = collectCoverageGaps(ast, 'test.kern');

    expect(gaps).toEqual([]);
  });

  it('ignores empty handlers', () => {
    const source = 'handler <<<>>>';
    const ast = parse(source);
    const gaps = collectCoverageGaps(ast, 'test.kern');
    expect(gaps).toEqual([]);
  });
});
