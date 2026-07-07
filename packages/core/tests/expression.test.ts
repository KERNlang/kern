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

  // Regression: the keyword lookup used a bare `KEYWORDS[word]` on a plain
  // object, so identifiers that collide with `Object.prototype` members
  // (`toString`, `valueOf`, `toLocaleString`, `hasOwnProperty`, `constructor`,
  // …) resolved to inherited functions and mis-tokenized as keywords —
  // throwing `Expected ident, got function toString()` on `x.toString()`.
  test('prototype-member names tokenize as plain identifiers, not keywords', () => {
    for (const name of ['toString', 'valueOf', 'toLocaleString', 'hasOwnProperty', 'constructor', 'isPrototypeOf']) {
      const toks = tokenizeExpression(name).map((t) => t.kind);
      expect(toks).toEqual(['ident', 'eof']);
    }
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

  test('regex literals are tokenized only in expression-start positions', () => {
    expect(tokenizeExpression('/foo\\/[bar]+/gi.test(input)').map((t) => t.kind)).toEqual([
      'regex',
      'dot',
      'ident',
      'lparen',
      'ident',
      'rparen',
      'eof',
    ]);
    expect(tokenizeExpression('!/foo/.test(input)').map((t) => t.kind)).toEqual([
      'bang',
      'regex',
      'dot',
      'ident',
      'lparen',
      'ident',
      'rparen',
      'eof',
    ]);
    expect(tokenizeExpression('total / count').map((t) => t.kind)).toEqual(['ident', 'slash', 'ident', 'eof']);
    expect(tokenizeExpression('arr[0]! / total').map((t) => t.kind)).toEqual([
      'ident',
      'lbracket',
      'num',
      'rbracket',
      'bang',
      'slash',
      'ident',
      'eof',
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

  test('member access / calls named after Object.prototype members', () => {
    // These round-trip verbatim to TS (and likewise to Python) exactly as any
    // other host method (`x.toFixed(2)`) already does — the fix only removed an
    // arbitrary parse-time crash, it does not change the emit contract.
    expect(roundtrip('x.toString()')).toBe('x.toString()');
    expect(roundtrip('clock.now().toString()')).toBe('clock.now().toString()');
    expect(roundtrip('n.toString(36)')).toBe('n.toString(36)');
    expect(roundtrip('err.valueOf()')).toBe('err.valueOf()');
    expect(roundtrip('obj.hasOwnProperty("k")')).toBe('obj.hasOwnProperty("k")');
    expect(roundtrip('d.toLocaleString()')).toBe('d.toLocaleString()');
    expect(roundtrip('x.constructor')).toBe('x.constructor');
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

  test('generic call expression preserves type arguments for TS emit', () => {
    expect(parseExpression('new Set<string>()')).toEqual({
      kind: 'new',
      argument: {
        kind: 'call',
        callee: { kind: 'ident', name: 'Set' },
        args: [],
        optional: false,
        typeArgs: 'string',
      },
    });
    expect(roundtrip('client.send<Record<string, unknown>>("ping")')).toBe(
      'client.send<Record<string, unknown>>("ping")',
    );
    expect(roundtrip('new Map<string, number>()')).toBe('new Map<string, number>()');
  });

  test('generic-call lookahead does not hijack comparisons', () => {
    expect(roundtrip('count < limit && count > offset')).toBe('count < limit && count > offset');
    expect(roundtrip('a < b ? c : d')).toBe('(a < b) ? c : d');
  });

  test('instanceof — relational precedence binary operator', () => {
    expect(parseExpression('x instanceof Error')).toEqual({
      kind: 'binary',
      op: 'instanceof',
      left: { kind: 'ident', name: 'x' },
      right: { kind: 'ident', name: 'Error' },
    });
    // Round-trips verbatim to TS.
    expect(roundtrip('x instanceof Error')).toBe('x instanceof Error');
    // RHS may be a member chain.
    expect(roundtrip('x instanceof a.b.C')).toBe('x instanceof a.b.C');
    // Relational precedence: binds tighter than `&&`/`||`, looser than `as`.
    expect(roundtrip('a instanceof B && c')).toBe('a instanceof B && c');
    expect(roundtrip('!(x instanceof Y)')).toBe('!(x instanceof Y)');
    // The dominant real-world idiom.
    expect(roundtrip('err instanceof Error ? err.message : String(err)')).toBe(
      '(err instanceof Error) ? err.message : String(err)',
    );
    // `instanceof` is only an operator in operator position — it stays usable
    // as a property name / object key.
    expect(roundtrip('obj.instanceof')).toBe('obj.instanceof');
  });

  test('regex literals and non-null assertions round-trip', () => {
    expect(parseExpression('/foo\\/[bar]+/gi')).toEqual({ kind: 'regexLit', pattern: 'foo\\/[bar]+', flags: 'gi' });
    expect(roundtrip('/^x+$/i.test(input)')).toBe('/^x+$/i.test(input)');
    expect(roundtrip('!/^x+$/i.test(input)')).toBe('!/^x+$/i.test(input)');
    expect(roundtrip('typeof /x/')).toBe('typeof /x/');
    expect(roundtrip('data[1]!')).toBe('data[1]!');
    expect(roundtrip('user!.name')).toBe('user!.name');
    expect(roundtrip('arr[0]! / total')).toBe('arr[0]! / total');
    expect(roundtrip('a! / b! / c')).toBe('a! / b! / c');
    expect(roundtrip('(x as Foo)!')).toBe('(x as Foo)!');
    expect(roundtrip('x! as Foo')).toBe('x! as Foo');
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
        parenthesized: true,
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

  describe('String escape sequences', () => {
    test('\\x7f (DEL) decodes to the byte and re-emits as \\x7f', () => {
      const ir = parseExpression('"\\x7f"');
      expect(ir).toMatchObject({ kind: 'strLit', value: '\x7f' });
      expect(emitExpression(ir)).toBe('"\\x7f"');
    });

    test('\\x1b (ESC) decodes and re-emits cleanly', () => {
      expect(roundtrip('"\\x1b[31mred\\x1b[0m"')).toBe('"\\x1b[31mred\\x1b[0m"');
      const ir = parseExpression('"\\x1b"');
      expect(ir).toMatchObject({ kind: 'strLit', value: '\x1b' });
    });

    test('all named control escapes round-trip', () => {
      expect(roundtrip('"\\r"')).toBe('"\\r"');
      expect(roundtrip('"\\b"')).toBe('"\\b"');
      expect(roundtrip('"\\f"')).toBe('"\\f"');
      expect(roundtrip('"\\v"')).toBe('"\\v"');
      expect(roundtrip('"\\0"')).toBe('"\\x00"');
    });

    test('\\uHHHH unicode escape decodes', () => {
      const ir = parseExpression('"\\u00ff"');
      expect(ir).toMatchObject({ kind: 'strLit', value: 'ÿ' });
      // Emitter preserves the printable char (0xff is not in the control range)
      expect(emitExpression(ir)).toBe('"ÿ"');
    });

    test('\\u{...} codepoint escape decodes (astral plane)', () => {
      const ir = parseExpression('"\\u{1f600}"');
      expect(ir).toMatchObject({ kind: 'strLit', value: '\u{1f600}' });
    });

    test('unknown escapes drop the backslash (JS semantics)', () => {
      // `\z` in JS strings evaluates to `z`. KERN should match.
      const ir = parseExpression('"\\z"');
      expect(ir).toMatchObject({ kind: 'strLit', value: 'z' });
    });

    test('octal escape is rejected (no silent acceptance)', () => {
      expect(() => parseExpression('"\\012"')).toThrow();
    });

    test('legacy single-digit octal escapes \\1-\\9 are rejected', () => {
      for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
        expect(() => parseExpression(`"\\${d}"`)).toThrow();
      }
    });

    test('line continuation: \\<LF> evaluates to empty string', () => {
      const ir = parseExpression('"a\\\nb"');
      expect(ir).toMatchObject({ kind: 'strLit', value: 'ab' });
    });

    test('line continuation: \\<CRLF> consumes both chars', () => {
      const ir = parseExpression('"a\\\r\nb"');
      expect(ir).toMatchObject({ kind: 'strLit', value: 'ab' });
    });

    test('line continuation inside template literal', () => {
      const ir = parseExpression('`a\\\nb`');
      expect(ir).toMatchObject({ kind: 'tmplLit', quasis: ['ab'] });
    });

    test('template quasi codegen escapes named control chars (\\b \\f \\v)', () => {
      // Build a tmplLit IR with literal BS/FF/VT in the quasi.
      const ir = {
        kind: 'tmplLit' as const,
        quasis: ['\b\f\v'],
        expressions: [],
      };
      expect(emitExpression(ir)).toBe('`\\b\\f\\v`');
    });

    test('template quasi codegen escapes \\x7f', () => {
      const ir = {
        kind: 'tmplLit' as const,
        quasis: ['\x7f'],
        expressions: [],
      };
      expect(emitExpression(ir)).toBe('`\\x7f`');
    });

    test('invalid \\x escape throws', () => {
      expect(() => parseExpression('"\\xZZ"')).toThrow();
      expect(() => parseExpression('"\\x9"')).toThrow();
    });

    test('invalid \\u escape throws', () => {
      expect(() => parseExpression('"\\uZZZZ"')).toThrow();
      expect(() => parseExpression('"\\u{ZZ}"')).toThrow();
      expect(() => parseExpression('"\\u{}"')).toThrow();
      expect(() => parseExpression('"\\u{110000}"')).toThrow();
    });

    test('template literal: \\x7f decodes inside backticks', () => {
      const ir = parseExpression('`pre\\x7fpost`');
      expect(ir).toMatchObject({ kind: 'tmplLit', quasis: ['pre\x7fpost'] });
      expect(emitExpression(ir)).toBe('`pre\\x7fpost`');
    });

    test('template literal: control chars inside ${...} string still decode', () => {
      // The expression inside ${...} contains a string with an escape.
      const ir = parseExpression('`x${"\\x1b"}y`');
      expect(ir).toMatchObject({
        kind: 'tmplLit',
        expressions: [{ kind: 'strLit', value: '\x1b' }],
      });
    });

    test('codegen passes through high unicode without escaping', () => {
      const ir = { kind: 'strLit' as const, value: 'café', quote: '"' as const };
      expect(emitExpression(ir)).toBe('"café"');
    });
  });
});
