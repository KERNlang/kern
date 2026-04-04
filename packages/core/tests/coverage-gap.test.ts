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
