/**
 * Slice 6 — bitwise / shift operators on the ToInt32 substrate (core leg).
 *
 * Proves the operators `& | ^ << >> >>> ~` become tokenizable + parseable in
 * KERN expression mode with EXACT JS precedence, round-trip through the TS
 * emitter with the needed parens, and evaluate to JS-identical Int32/Uint32
 * results in the core runtime (built on the landed slice-0.75
 * `numberToInt32` / `numberToUint32` kernel).
 *
 * Every expected value here was computed from the native JS oracle (`node -e`),
 * never by hand — see the S6 oracle tables. The TS leg IS the reference; the
 * Python leg (packages/python) reproduces it under python3.
 */

import { emitExpression } from '../src/codegen-expression.js';
import { createCoreRuntimeEnv, evalCoreExpression, toHostValue } from '../src/index.js';
import { parseExpression, tokenizeExpression } from '../src/parser-expression.js';

function kinds(src: string): string[] {
  return tokenizeExpression(src).map((t) => t.kind);
}

function roundtrip(src: string): string {
  return emitExpression(parseExpression(src));
}

function evalJs(src: string): unknown {
  return toHostValue(evalCoreExpression(src, undefined));
}

describe('S6 tokenizer — bitwise/shift operators', () => {
  test('binary bitwise/shift tokens (longest-match)', () => {
    expect(kinds('a | b')).toEqual(['ident', 'pipe', 'ident', 'eof']);
    expect(kinds('a & b')).toEqual(['ident', 'amp', 'ident', 'eof']);
    expect(kinds('a ^ b')).toEqual(['ident', 'caret', 'ident', 'eof']);
    expect(kinds('a << b')).toEqual(['ident', 'shl', 'ident', 'eof']);
    expect(kinds('a >> b')).toEqual(['ident', 'shr', 'ident', 'eof']);
    expect(kinds('a >>> b')).toEqual(['ident', 'ushr', 'ident', 'eof']);
  });

  test('unary tilde token', () => {
    expect(kinds('~a')).toEqual(['tilde', 'ident', 'eof']);
    expect(kinds('~~a')).toEqual(['tilde', 'tilde', 'ident', 'eof']);
  });

  test('longest-match: >>> before >> before >=/>; << before <=/<', () => {
    // `>>>` must win over `>>` and `>`; `>>=`-style is out of scope.
    expect(kinds('a >>> b >> c > d')).toEqual([
      'ident',
      'ushr',
      'ident',
      'shr',
      'ident',
      'gt',
      'ident',
      'eof',
    ]);
    expect(kinds('a << b <= c < d')).toEqual([
      'ident',
      'shl',
      'ident',
      'lte',
      'ident',
      'lt',
      'ident',
      'eof',
    ]);
  });

  test('|| still wins over |, && over &', () => {
    expect(kinds('a || b | c')).toEqual(['ident', 'or', 'ident', 'pipe', 'ident', 'eof']);
    expect(kinds('a && b & c')).toEqual(['ident', 'and', 'ident', 'amp', 'ident', 'eof']);
  });
});

describe('S6 parser — precedence ladder (exact JS)', () => {
  // The parse-shape rows from the oracle. We assert via the round-tripped TS
  // string (canonical paren form) AND the evaluated value, so a wrong tree is
  // caught structurally and semantically.
  test('shift sits between additive and relational', () => {
    expect(roundtrip('1 + 2 << 3')).toBe('(1 + 2) << 3');
    expect(roundtrip('1 << 2 + 3')).toBe('1 << (2 + 3)');
    expect(roundtrip('1 << 2 < 8')).toBe('(1 << 2) < 8');
  });

  test('bitwise AND/XOR/OR sit between equality and &&', () => {
    expect(roundtrip('1 & 3 === 1')).toBe('1 & (3 === 1)');
    expect(roundtrip('(1 & 3) === 1')).toBe('(1 & 3) === 1');
    expect(roundtrip('1 | 2 && 0')).toBe('(1 | 2) && 0');
    expect(roundtrip('1 ^ 3 & 1')).toBe('1 ^ (3 & 1)');
  });

  test('unary ~ binds tighter than shift', () => {
    expect(roundtrip('~1 << 2')).toBe('(~1) << 2');
  });

  test('~ binds tighter than await composition stays intact', () => {
    // ~await foo() must parse as ~(await foo()), not (~await) foo().
    const ir = parseExpression('~await foo()');
    expect(ir.kind).toBe('unary');
    expect((ir as { op: string }).op).toBe('~');
    expect((ir as { argument: { kind: string } }).argument.kind).toBe('await');
  });

  test('parse-shape: << is left-associative', () => {
    // (a << b) << c
    const ir = parseExpression('a << b << c') as {
      kind: string;
      op: string;
      left: { kind: string; op: string };
    };
    expect(ir.op).toBe('<<');
    expect(ir.left.kind).toBe('binary');
    expect(ir.left.op).toBe('<<');
  });
});

describe('S6 precedence kill rows (evaluated)', () => {
  const rows: [string, unknown][] = [
    ['1 + 2 << 3', 24],
    ['1 << 2 + 3', 32],
    ['1 << 2 < 8', true],
    ['1 & 3 === 1', 0],
    ['(1 & 3) === 1', true],
    ['1 | 2 && 0', 0],
    ['1 ^ 3 & 1', 0],
    ['~1 << 2', -8],
  ];
  for (const [src, expected] of rows) {
    test(`${src} => ${String(expected)}`, () => {
      expect(evalJs(src)).toBe(expected);
    });
  }
});

describe('S6 core-runtime values — Int32 ops', () => {
  const rows: [string, number][] = [
    // Shift-count mask
    ['1 << 33', 2],
    ['1 << 32', 1],
    ['-8 >> 33', -4],
    ['-8 >> 32', -8],
    ['8 >>> 33', 4],
    ['8 >>> 32', 8],
    // Zero-fill / Uint32 result
    ['-1 >>> 0', 4294967295],
    ['-1 >>> 1', 2147483647],
    ['-2147483648 >>> 1', 1073741824],
    ['0x80000000 >>> 0', 2147483648],
    ['0xffffffff >>> 4', 268435455],
    // Bitwise Int32, truncate-toward-zero
    ['5.9 | 0', 5],
    ['-5.9 | 0', -5],
    ['5.5 & 3', 1],
    ['5 ^ 3', 6],
    ['~0', -1],
    ['~-1', 0],
    // Composition idioms
    ['(-1 >>> 0) | 0', -1],
    ['(-1 >>> 1) | 0', 2147483647],
    ['(0x80000000 >>> 0) | 0', -2147483648],
    ['2147483648 | 0', -2147483648],
    ['~~5.9', 5],
    ['~~-5.9', -5],
    ['~~NaN', 0],
    ['~~Infinity', 0],
    ['~~4294967296', 0],
  ];
  for (const [src, expected] of rows) {
    test(`${src} => ${expected}`, () => {
      expect(evalJs(src)).toBe(expected);
    });
  }

  test('-0.0 | 0 kills negative-zero preservation (result is +0)', () => {
    const env = createCoreRuntimeEnv({ globals: { x: -0 } });
    const r = toHostValue(evalCoreExpression('x | 0', env));
    expect(r).toBe(0);
    // Int32 of -0 is +0: the sign must NOT survive.
    expect(Object.is(r, -0)).toBe(false);
  });
});

describe('S6 TS round-trip — operators + parens preserved', () => {
  test('operators emit verbatim', () => {
    expect(roundtrip('a | b')).toBe('a | b');
    expect(roundtrip('a & b')).toBe('a & b');
    expect(roundtrip('a ^ b')).toBe('a ^ b');
    expect(roundtrip('a << b')).toBe('a << b');
    expect(roundtrip('a >> b')).toBe('a >> b');
    expect(roundtrip('a >>> b')).toBe('a >>> b');
    expect(roundtrip('~a')).toBe('~a');
    expect(roundtrip('~~a')).toBe('~~a');
  });

  test('round-trip is idempotent (parse(emit(x)) == parse(x))', () => {
    for (const src of ['1 + 2 << 3', '1 & 3 === 1', '1 ^ 3 & 1', '~1 << 2', '(0x80000000 >>> 0) | 0']) {
      expect(roundtrip(roundtrip(src))).toBe(roundtrip(src));
    }
  });
});
