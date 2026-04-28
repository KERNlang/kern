import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression, tokenizeExpression } from '../src/parser-expression.js';

function roundtrip(src: string): string {
  return emitExpression(parseExpression(src));
}

describe('Expression tokenizer', () => {
  test('punctuation and operators', () => {
    const toks = tokenizeExpression('a?.b ?? c || d').map((t) => t.kind);
    expect(toks).toEqual(['ident', 'optDot', 'ident', 'nullish', 'ident', 'or', 'ident', 'eof']);
  });

  test('spread', () => {
    const toks = tokenizeExpression('...rest').map((t) => t.kind);
    expect(toks).toEqual(['spread', 'ident', 'eof']);
  });

  test('keywords vs identifiers', () => {
    const toks = tokenizeExpression('null undefined true false foo').map((t) => t.kind);
    expect(toks).toEqual(['kwNull', 'kwUndef', 'kwTrue', 'kwFalse', 'ident', 'eof']);
  });

  test('numbers (int, float, bigint, hex)', () => {
    const toks = tokenizeExpression('42 3.14 123n 0xFF').map((t) => ({ k: t.kind, v: t.value }));
    expect(toks).toEqual([
      { k: 'num', v: '42' },
      { k: 'num', v: '3.14' },
      { k: 'num', v: '123n' },
      { k: 'num', v: '0xFF' },
      { k: 'eof', v: '' },
    ]);
  });

  test('strings (single and double)', () => {
    const toks = tokenizeExpression('"hi" \'bye\'').map((t) => ({ k: t.kind, v: t.value }));
    expect(toks).toEqual([
      { k: 'str', v: 'hi' },
      { k: 'str', v: 'bye' },
      { k: 'eof', v: '' },
    ]);
  });
});

describe('Expression parser → ValueIR', () => {
  test('bare identifier', () => {
    expect(parseExpression('foo')).toEqual({ kind: 'ident', name: 'foo' });
  });

  test('member access', () => {
    expect(parseExpression('a.b.c')).toEqual({
      kind: 'member',
      object: { kind: 'member', object: { kind: 'ident', name: 'a' }, property: 'b', optional: false },
      property: 'c',
      optional: false,
    });
  });

  test('optional chaining', () => {
    expect(parseExpression('user?.profile?.name')).toEqual({
      kind: 'member',
      object: {
        kind: 'member',
        object: { kind: 'ident', name: 'user' },
        property: 'profile',
        optional: true,
      },
      property: 'name',
      optional: true,
    });
  });

  test('call expression', () => {
    expect(parseExpression('fetch("/api")')).toEqual({
      kind: 'call',
      callee: { kind: 'ident', name: 'fetch' },
      args: [{ kind: 'strLit', value: '/api', quote: '"' }],
      optional: false,
    });
  });

  test('optional call', () => {
    expect(parseExpression('cb?.(x)')).toEqual({
      kind: 'call',
      callee: { kind: 'ident', name: 'cb' },
      args: [{ kind: 'ident', name: 'x' }],
      optional: true,
    });
  });

  test('nullish coalesce', () => {
    expect(parseExpression('a ?? b')).toEqual({
      kind: 'binary',
      op: '??',
      left: { kind: 'ident', name: 'a' },
      right: { kind: 'ident', name: 'b' },
    });
  });

  test('spread', () => {
    expect(parseExpression('...rest')).toEqual({
      kind: 'spread',
      argument: { kind: 'ident', name: 'rest' },
    });
  });

  test('parenthesized grouping', () => {
    expect(parseExpression('(a ?? b).c')).toEqual({
      kind: 'member',
      object: {
        kind: 'binary',
        op: '??',
        left: { kind: 'ident', name: 'a' },
        right: { kind: 'ident', name: 'b' },
      },
      property: 'c',
      optional: false,
    });
  });

  test('chained call after optional member', () => {
    expect(parseExpression('user?.name.toUpperCase()')).toEqual({
      kind: 'call',
      callee: {
        kind: 'member',
        object: {
          kind: 'member',
          object: { kind: 'ident', name: 'user' },
          property: 'name',
          optional: true,
        },
        property: 'toUpperCase',
        optional: false,
      },
      args: [],
      optional: false,
    });
  });

  test('literals: bool/null/undefined/bigint', () => {
    expect(parseExpression('true')).toEqual({ kind: 'boolLit', value: true });
    expect(parseExpression('null')).toEqual({ kind: 'nullLit' });
    expect(parseExpression('undefined')).toEqual({ kind: 'undefLit' });
    expect(parseExpression('123n')).toEqual({ kind: 'numLit', value: 0, bigint: true, raw: '123n' });
  });
});

describe('Template literals', () => {
  test('plain template (no interpolation)', () => {
    const ir = parseExpression('`hello`');
    expect(ir).toEqual({ kind: 'tmplLit', quasis: ['hello'], expressions: [] });
  });

  test('single interpolation', () => {
    const ir = parseExpression('`hi ${name}`');
    expect(ir).toEqual({
      kind: 'tmplLit',
      quasis: ['hi ', ''],
      expressions: [{ kind: 'ident', name: 'name' }],
    });
  });

  test('multiple interpolations', () => {
    const ir = parseExpression('`${a}-${b}-${c}`');
    expect(ir).toEqual({
      kind: 'tmplLit',
      quasis: ['', '-', '-', ''],
      expressions: [
        { kind: 'ident', name: 'a' },
        { kind: 'ident', name: 'b' },
        { kind: 'ident', name: 'c' },
      ],
    });
  });

  test('expression inside ${}', () => {
    const ir = parseExpression('`user is ${user?.name ?? "guest"}`');
    expect((ir as { kind: 'tmplLit' }).kind).toBe('tmplLit');
    const tl = ir as Extract<typeof ir, { kind: 'tmplLit' }>;
    expect(tl.quasis).toEqual(['user is ', '']);
    expect(tl.expressions).toHaveLength(1);
    expect(tl.expressions[0].kind).toBe('binary');
  });

  test('escaped backtick and dollar inside template', () => {
    const ir = parseExpression('`a\\`b\\${c`');
    expect(ir).toEqual({ kind: 'tmplLit', quasis: ['a`b${c'], expressions: [] });
  });
});

describe('ValueIR → TS codegen round-trip', () => {
  test.each([
    'foo',
    'a.b.c',
    'user?.profile?.name',
    'fetch("/api")',
    'cb?.(x)',
    'a ?? b',
    'a || b',
    'a && b',
    '...rest',
    'getThing()',
    'user?.name.toUpperCase()',
    'true',
    'null',
    'undefined',
  ])('round-trip: %s', (src) => {
    expect(roundtrip(src)).toBe(src);
  });

  test('nullish + or requires parens for TS', () => {
    expect(roundtrip('(a ?? b) || c')).toBe('(a ?? b) || c');
  });

  test('template round-trip', () => {
    expect(roundtrip('`hi ${name}`')).toBe('`hi ${name}`');
    expect(roundtrip('`${a}-${b}`')).toBe('`${a}-${b}`');
  });

  test('numeric literal raw form preserved', () => {
    expect(roundtrip('1_000_000')).toBe('1_000_000');
    expect(roundtrip('0xFF')).toBe('0xFF');
    expect(roundtrip('123n')).toBe('123n');
  });
});

describe('Error handling', () => {
  test('unclosed paren throws', () => {
    expect(() => parseExpression('foo(a')).toThrow();
  });

  test('unclosed template throws', () => {
    expect(() => parseExpression('`hi ${name}')).toThrow();
  });

  test('unexpected operator at start throws', () => {
    expect(() => parseExpression('?? a')).toThrow();
  });
});

describe('Bug fixes from cross-AI review', () => {
  test('|| has lower precedence than && (a || b && c → a || (b && c))', () => {
    const ir = parseExpression('a || b && c');
    expect(ir).toEqual({
      kind: 'binary',
      op: '||',
      left: { kind: 'ident', name: 'a' },
      right: {
        kind: 'binary',
        op: '&&',
        left: { kind: 'ident', name: 'b' },
        right: { kind: 'ident', name: 'c' },
      },
    });
  });

  test('?? has lower precedence than || (a ?? b || c → (a ?? b) || c is invalid; we expect a ?? (b || c) but TS forbids unparenthesized — verify parens emitted)', () => {
    // Per JS, `a ?? b || c` is a SYNTAX ERROR — must be parenthesized.
    // Our parser uses ?? as lowest, so a ?? b || c parses as a ?? (b || c).
    const ir = parseExpression('a ?? b || c');
    expect((ir as { op: string }).op).toBe('??');
    // Codegen MUST add parens around the || child
    expect(emitExpression(ir)).toBe('a ?? (b || c)');
  });

  test('left-associativity of same-precedence ops', () => {
    expect(emitExpression(parseExpression('a && b && c'))).toBe('a && b && c');
    expect(emitExpression(parseExpression('a || b || c'))).toBe('a || b || c');
  });

  test('binary receiver wrapped in parens for member access', () => {
    expect(emitExpression(parseExpression('(a ?? b).c'))).toBe('(a ?? b).c');
  });

  test('binary receiver wrapped in parens for call', () => {
    expect(emitExpression(parseExpression('(factory || fallback)()'))).toBe('(factory || fallback)()');
  });

  test('strLit with newline preserves escape on emit', () => {
    expect(roundtrip('"a\\nb"')).toBe('"a\\nb"');
    expect(roundtrip('"line1\\nline2\\ttabbed"')).toBe('"line1\\nline2\\ttabbed"');
  });

  test('numeric separators: rejects 1__2 (double underscore)', () => {
    // Either throws or only consumes valid prefix
    let ok = false;
    try {
      const toks = tokenizeExpression('1__2');
      // If it tokenized, it should have stopped at the first underscore
      ok = toks[0].value === '1';
    } catch {
      ok = true;
    }
    expect(ok).toBe(true);
  });

  test('numeric separators: rejects trailing underscore', () => {
    const toks = tokenizeExpression('42_');
    expect(toks[0]).toMatchObject({ kind: 'num', value: '42' });
  });

  test('numeric separators: rejects leading underscore in hex digits', () => {
    // 0x_FF should not consume the underscore as part of the literal
    let bad = false;
    try {
      const toks = tokenizeExpression('0x_FF');
      // Should either throw (invalid) or stop at 0x
      bad = toks[0].value !== '0x_FF';
    } catch {
      bad = true;
    }
    expect(bad).toBe(true);
  });

  test('leading-dot float .5 parses in expression mode', () => {
    expect(parseExpression('.5')).toEqual({ kind: 'numLit', value: 0.5, raw: '.5' });
  });

  test('1.5n throws (BigInt cannot have fractional part)', () => {
    expect(() => parseExpression('1.5n')).toThrow();
  });

  test('nested template with escaped backtick inside ${...}', () => {
    // `outer ${ `inner` }` — simple nested template
    expect(() => parseExpression('`outer ${`inner`}`')).not.toThrow();
  });

  test('strLit codegen escapes \\b \\f \\v', () => {
    // String value containing literal backspace, form-feed, vertical-tab
    const str = '\b\f\v';
    const ir = { kind: 'strLit' as const, value: str, quote: '"' as const };
    expect(emitExpression(ir)).toBe('"\\b\\f\\v"');
  });
});
