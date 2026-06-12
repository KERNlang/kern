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
    expect(kinds('a >>> b >> c > d')).toEqual(['ident', 'ushr', 'ident', 'shr', 'ident', 'gt', 'ident', 'eof']);
    expect(kinds('a << b <= c < d')).toEqual(['ident', 'shl', 'ident', 'lte', 'ident', 'lt', 'ident', 'eof']);
  });

  test('|| still wins over |, && over &', () => {
    expect(kinds('a || b | c')).toEqual(['ident', 'or', 'ident', 'pipe', 'ident', 'eof']);
    expect(kinds('a && b & c')).toEqual(['ident', 'and', 'ident', 'amp', 'ident', 'eof']);
  });
});

describe('S6 review fixes — type-position boundaries for the new operators', () => {
  test('`^` after an `as` type is an expression boundary: (x as Foo) ^ y', () => {
    // Review fix (codex 0.97): `^` has no type-grammar meaning, so it must
    // terminate the type text — unlike `|`/`&`, which TS keeps in the type
    // as union/intersection.
    const a = parseExpression('x as Foo ^ y') as { kind: string; op?: string; left?: { kind: string; type?: string } };
    expect(a.kind).toBe('binary');
    expect(a.op).toBe('^');
    expect(a.left).toMatchObject({ kind: 'typeAssert', type: 'Foo' });
    // Union/intersection types stay in the type text (TS-compatible).
    expect(parseExpression('x as Foo | y')).toMatchObject({ kind: 'typeAssert', type: 'Foo | y' });
    expect(parseExpression('x as Foo & y')).toMatchObject({ kind: 'typeAssert', type: 'Foo & y' });
  });

  test('surplus `>` makes a generic-call lookahead FAIL instead of swallowing (f<Bar<Baz>>>(x))', () => {
    // Review fix (codex 0.95): `>>>` against an open depth of 2 is NOT a
    // type-argument list — the malformed form falls back to ordinary
    // comparison/shift parsing rather than silently parsing as f<Bar<Baz>>(x).
    const malformed = parseExpression('f<Bar<Baz>>>(x)') as { kind: string; typeArgs?: string };
    expect(malformed.kind).not.toBe('call');
    expect(malformed).not.toHaveProperty('typeArgs');
    // The well-formed neighbors still parse as generic calls.
    expect(parseExpression('f<Bar<Baz>>(x)')).toMatchObject({ kind: 'call', typeArgs: 'Bar<Baz>' });
    expect(parseExpression('make<A<B<C>>>(x)')).toMatchObject({ kind: 'call', typeArgs: 'A<B<C>>' });
  });

  test('regex literal can follow `>>>` (operator position starts a regex)', () => {
    // Review probe (kimi 0.85): `>>>` is in canStartRegex — verify end to end.
    const r = parseExpression('a >>> /b/.source.length') as { kind: string; op?: string };
    expect(r.kind).toBe('binary');
    expect(r.op).toBe('>>>');
  });
});

describe('S6 parser — precedence ladder (exact JS)', () => {
  // Assert the PARSE TREE shape directly: who is the root op, and which child
  // is the compound subtree. This is the discriminating check — it FAILS for
  // any wrong precedence wiring, independent of how the emitter chooses to
  // parenthesize. (The emitter omits parens that aren't semantically required;
  // round-trip STABILITY is verified separately below.)
  type Bin = { kind: 'binary'; op: string; left: { kind: string; op?: string }; right: { kind: string; op?: string } };

  test('shift sits between additive and relational', () => {
    // 1 + 2 << 3  ==>  (1 + 2) << 3   (additive binds tighter than shift)
    const a = parseExpression('1 + 2 << 3') as Bin;
    expect([a.op, a.left.op]).toEqual(['<<', '+']);
    // 1 << 2 + 3  ==>  1 << (2 + 3)
    const b = parseExpression('1 << 2 + 3') as Bin;
    expect([b.op, b.right.op]).toEqual(['<<', '+']);
    // 1 << 2 < 8  ==>  (1 << 2) < 8   (relational binds looser than shift)
    const c = parseExpression('1 << 2 < 8') as Bin;
    expect([c.op, c.left.op]).toEqual(['<', '<<']);
  });

  test('bitwise AND/XOR/OR sit between equality and &&', () => {
    // 1 & 3 === 1  ==>  1 & (3 === 1)   (equality binds tighter than &)
    const a = parseExpression('1 & 3 === 1') as Bin;
    expect([a.op, a.right.op]).toEqual(['&', '===']);
    // (1 & 3) === 1  — parens force the AND under the equality.
    const b = parseExpression('(1 & 3) === 1') as Bin;
    expect([b.op, b.left.op]).toEqual(['===', '&']);
    // 1 | 2 && 0  ==>  (1 | 2) && 0   (| binds tighter than &&)
    const c = parseExpression('1 | 2 && 0') as Bin;
    expect([c.op, c.left.op]).toEqual(['&&', '|']);
    // 1 ^ 3 & 1  ==>  1 ^ (3 & 1)   (& binds tighter than ^)
    const d = parseExpression('1 ^ 3 & 1') as Bin;
    expect([d.op, d.right.op]).toEqual(['^', '&']);
  });

  test('unary ~ binds tighter than shift', () => {
    // ~1 << 2  ==>  (~1) << 2
    const a = parseExpression('~1 << 2') as Bin;
    expect(a.op).toBe('<<');
    expect(a.left.kind).toBe('unary');
    expect((a.left as { op: string }).op).toBe('~');
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
  // Rows whose operands stay within the core runtime's strict type domain
  // (numbers / booleans the runtime already supports). The boolean-INTO-bitwise
  // row `1 & 3 === 1 => 0` relies on JS ToNumber(boolean) coercion that the
  // strict core runtime intentionally does NOT perform inside `&` — its VALUE
  // is proven on the TS (native JS) and Python legs instead; its PRECEDENCE is
  // proven structurally by the AST-shape test above.
  const rows: [string, unknown][] = [
    ['1 + 2 << 3', 24],
    ['1 << 2 + 3', 32],
    ['1 << 2 < 8', true],
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
    ['~~4294967296', 0],
  ];
  for (const [src, expected] of rows) {
    test(`${src} => ${expected}`, () => {
      expect(evalJs(src)).toBe(expected);
    });
  }

  // NOTE: `~~NaN => 0` / `~~Infinity => 0` are NOT exercised here. The core
  // runtime forbids non-finite numbers at the value boundary (`kNumber` throws
  // on NaN/±Infinity), so a non-finite operand can never be constructed to feed
  // the operator. The operator IS correct (it routes through `numberToInt32`,
  // which maps non-finite -> 0); that path is proven on the TS (native JS) and
  // Python execution legs, where NaN/Infinity are representable.

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
    // Nested unary args are parenthesized by the emitter (the same convention as
    // `!!a -> !(!a)`); the form is round-trip stable, which the idempotency test
    // below proves.
    expect(roundtrip('~~a')).toBe('~(~a)');
  });

  test('round-trip is idempotent (parse(emit(x)) == parse(x))', () => {
    for (const src of ['1 + 2 << 3', '1 & 3 === 1', '1 ^ 3 & 1', '~1 << 2', '(0x80000000 >>> 0) | 0']) {
      expect(roundtrip(roundtrip(src))).toBe(roundtrip(src));
    }
  });
});
