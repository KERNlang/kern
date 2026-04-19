import { classifyHandlerGap, isInlineSafeExpression, isInlineSafeLiteral } from '../src/migrate-literals.js';

describe('isInlineSafeLiteral', () => {
  it.each([
    '42',
    '-17',
    '3.14',
    '0xFF',
    '0b1010',
    '0o77',
    '1e3',
    '1_000_000',
    'true',
    'false',
    'null',
    'undefined',
  ])('accepts %s', (input) => {
    expect(isInlineSafeLiteral(input)).toBe(true);
  });

  it.each(['"hello"', 'foo', '60 * 60', '{}', '[]', '', '   '])('rejects %s', (input) => {
    expect(isInlineSafeLiteral(input)).toBe(false);
  });
});

describe('isInlineSafeExpression', () => {
  it('accepts arbitrary non-empty body without `}}`', () => {
    expect(isInlineSafeExpression('60 * 60 * 1000')).toBe(true);
    expect(isInlineSafeExpression('"hello"')).toBe(true);
    expect(isInlineSafeExpression('{ a: 1 }')).toBe(true);
  });

  it('rejects empty or `}}`-containing bodies', () => {
    expect(isInlineSafeExpression('')).toBe(false);
    expect(isInlineSafeExpression('  ')).toBe(false);
    expect(isInlineSafeExpression('x }} y')).toBe(false);
  });
});

describe('classifyHandlerGap', () => {
  it('tags a const+literal as migratable via literal-const', () => {
    expect(classifyHandlerGap('const', '42')).toEqual({ category: 'migratable', migration: 'literal-const' });
    expect(classifyHandlerGap('const', 'true')).toEqual({ category: 'migratable', migration: 'literal-const' });
  });

  it('tags a const+expression as migratable via literal-const (value={{ expr }} form)', () => {
    expect(classifyHandlerGap('const', '60 * 60 * 1000')).toEqual({
      category: 'migratable',
      migration: 'literal-const',
    });
  });

  it('tags an fn+single-line as migratable via fn-expr', () => {
    expect(classifyHandlerGap('fn', 'return users.filter(u => u.active);')).toEqual({
      category: 'migratable',
      migration: 'fn-expr',
    });
  });

  it('does not flag route/screen handlers as migratable (no rewriter exists)', () => {
    expect(classifyHandlerGap('route', 'return [];').category).toBe('detected');
    expect(classifyHandlerGap('screen', 'return null;').category).toBe('detected');
  });

  it('never flags multi-line handlers as migratable — both rewriters reject them', () => {
    const body = 'const x = 1;\nreturn x * 2;';
    expect(classifyHandlerGap('const', body).category).toBe('detected');
    expect(classifyHandlerGap('fn', body).category).toBe('detected');
  });

  it('never flags a body containing `}}` as migratable (would break expr-block)', () => {
    expect(classifyHandlerGap('const', 'x }} y').category).toBe('detected');
    expect(classifyHandlerGap('fn', 'x }} y').category).toBe('detected');
  });

  it('returns detected when parent is unknown', () => {
    expect(classifyHandlerGap(undefined, '42').category).toBe('detected');
  });
});
