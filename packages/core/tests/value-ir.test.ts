import { isValueIR, type ValueIR } from '../src/value-ir.js';

describe('ValueIR', () => {
  test('constructs each variant with discriminated narrowing', () => {
    const variants: ValueIR[] = [
      { kind: 'numLit', value: 3.14, raw: '3.14' },
      { kind: 'numLit', value: 0, bigint: true, raw: '123n' },
      { kind: 'strLit', value: 'hi', quote: '"' },
      { kind: 'strLit', value: 'hi', quote: "'" },
      { kind: 'tmplLit', quasis: ['a', 'b'], expressions: [{ kind: 'ident', name: 'x' }] },
      { kind: 'boolLit', value: true },
      { kind: 'nullLit' },
      { kind: 'undefLit' },
      { kind: 'regexLit', pattern: 'foo', flags: 'gi' },
      { kind: 'ident', name: 'user' },
      {
        kind: 'member',
        object: { kind: 'ident', name: 'user' },
        property: 'name',
        optional: true,
      },
      {
        kind: 'call',
        callee: { kind: 'ident', name: 'fetch' },
        args: [{ kind: 'strLit', value: '/api', quote: '"' }],
        optional: false,
      },
      {
        kind: 'binary',
        op: '??',
        left: { kind: 'ident', name: 'a' },
        right: { kind: 'ident', name: 'b' },
      },
      { kind: 'unary', op: '!', argument: { kind: 'ident', name: 'flag' } },
      { kind: 'spread', argument: { kind: 'ident', name: 'rest' } },
    ];

    for (const v of variants) {
      expect(isValueIR(v)).toBe(true);
    }
  });

  test('JSON round-trips losslessly', () => {
    const node: ValueIR = {
      kind: 'binary',
      op: '+',
      left: { kind: 'numLit', value: 1, raw: '1' },
      right: {
        kind: 'member',
        object: { kind: 'ident', name: 'obj' },
        property: 'count',
        optional: true,
        loc: { line: 3, col: 5 },
      },
    };
    const round: ValueIR = JSON.parse(JSON.stringify(node));
    expect(round).toEqual(node);
    expect(isValueIR(round)).toBe(true);
  });

  test('isValueIR rejects non-IR shapes', () => {
    expect(isValueIR(null)).toBe(false);
    expect(isValueIR(undefined)).toBe(false);
    expect(isValueIR('numLit')).toBe(false);
    expect(isValueIR({ kind: 'unknown' })).toBe(false);
    expect(isValueIR({ value: 1 })).toBe(false);
  });
});
