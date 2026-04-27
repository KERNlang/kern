import { parseDocumentWithDiagnostics, tokenizeLine } from '../src/parser.js';

describe('Extended numeric literals', () => {
  test('plain integer (regression)', () => {
    const toks = tokenizeLine('width=42').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '42', pos: 6 }]);
  });

  test('float with leading int', () => {
    const toks = tokenizeLine('size=3.14').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '3.14', pos: 5 }]);
  });

  test('float with leading dot', () => {
    const toks = tokenizeLine('opacity=.5').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '.5', pos: 8 }]);
  });

  test('numeric separator in integer', () => {
    const toks = tokenizeLine('count=1_000_000').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '1_000_000', pos: 6 }]);
  });

  test('numeric separator in float fractional', () => {
    const toks = tokenizeLine('pi=3.14_159').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '3.14_159', pos: 3 }]);
  });

  test('bigint literal', () => {
    const toks = tokenizeLine('big=123n').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '123n', pos: 4 }]);
  });

  test('bigint with separator', () => {
    const toks = tokenizeLine('big=1_000n').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '1_000n', pos: 4 }]);
  });

  test('hex literal', () => {
    const toks = tokenizeLine('color=0xFF00AA').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '0xFF00AA', pos: 6 }]);
  });

  test('hex with separator and bigint suffix', () => {
    const toks = tokenizeLine('mask=0xDEAD_BEEFn').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '0xDEAD_BEEFn', pos: 5 }]);
  });

  test('binary literal', () => {
    const toks = tokenizeLine('flags=0b1010').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '0b1010', pos: 6 }]);
  });

  test('octal literal', () => {
    const toks = tokenizeLine('mode=0o755').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '0o755', pos: 5 }]);
  });

  test('underscore cannot lead digits', () => {
    // _42 should NOT be a number — it's an identifier (underscore-prefixed)
    const toks = tokenizeLine('x=_42');
    const numToks = toks.filter((t) => t.kind === 'number');
    expect(numToks).toEqual([]);
    const identToks = toks.filter((t) => t.kind === 'identifier');
    expect(identToks.some((t) => t.value === '_42')).toBe(true);
  });

  test('underscore cannot trail digits', () => {
    // 42_ — the trailing _ stops the number; the _ then becomes part of nothing
    const toks = tokenizeLine('x=42_').filter((t) => t.kind === 'number');
    expect(toks).toEqual([{ kind: 'number', value: '42', pos: 2 }]);
  });

  test('bigint with fractional part emits diagnostic', () => {
    const result = parseDocumentWithDiagnostics('let name=x type=number\n  fmt val=1.5n\n');
    const errs = result.diagnostics.filter((d) => d.code === 'INVALID_BIGINT');
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe('Single-quoted strings', () => {
  test('basic single-quoted string', () => {
    const toks = tokenizeLine("text='hello'").filter((t) => t.kind === 'quoted');
    expect(toks).toEqual([{ kind: 'quoted', value: 'hello', pos: 5 }]);
  });

  test('double-quoted string still works (regression)', () => {
    const toks = tokenizeLine('text="hello"').filter((t) => t.kind === 'quoted');
    expect(toks).toEqual([{ kind: 'quoted', value: 'hello', pos: 5 }]);
  });

  test('escaped single quote inside single-quoted string', () => {
    const toks = tokenizeLine("text='don\\'t'").filter((t) => t.kind === 'quoted');
    expect(toks[0].value).toBe("don't");
  });

  test('double quote inside single-quoted string is literal', () => {
    const toks = tokenizeLine('text=\'say "hi"\'').filter((t) => t.kind === 'quoted');
    expect(toks[0].value).toBe('say "hi"');
  });

  test('single quote inside double-quoted string is literal', () => {
    const toks = tokenizeLine('text="don\'t"').filter((t) => t.kind === 'quoted');
    expect(toks[0].value).toBe("don't");
  });
});
