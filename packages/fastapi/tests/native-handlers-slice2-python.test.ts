/** Native KERN handler bodies — slice 2 Python-side bundle.
 *
 *  Mirror of core/tests/native-handlers-slice2.test.ts for the Python target.
 *  Asserts:
 *    - 2b stdlib expansion lowers to idiomatic Python (Text.includes →
 *      `sub in s`, List.isEmpty → `len(xs) == 0`, etc.)
 *    - 2c arithmetic / comparison / unary lowering with `===`→`==`,
 *      `!`→`not`, `&&`→`and`, `||`→`or`.
 *    - 2c if/else uses Python whitespace-significant indent.
 *    - 2d object literal → Python dict literal (keys always JSON-quoted),
 *      array literal → Python list literal. */

import type { IRNode } from '@kernlang/core';
import { parseDocument, parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPython, emitPyExpression } from '../src/codegen-body-python.js';
import { generateFunction } from '../src/generators/core.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

// ── 2b: stdlib expansion (Python) ────────────────────────────────────────

describe('KERN-stdlib expansion — Python target', () => {
  test.each([
    // Text additions — Python `in` operator + Python method names
    ['Text.includes(s, "x")', '"x" in s'],
    ['Text.startsWith(s, "p")', 's.startswith("p")'],
    ['Text.endsWith(s, "p")', 's.endswith("p")'],
    ['Text.split(s, ",")', 's.split(",")'],
    // Review fix: replace-all semantics. Python `replace` is replace-all by
    // default; KERN normalizes both targets to the replace-all behavior.
    ['Text.replace(s, "a", "b")', 's.replace("a", "b")'],
    // List
    ['List.length(xs)', 'len(xs)'],
    ['List.isEmpty(xs)', 'len(xs) == 0'],
    ['List.includes(xs, x)', 'x in xs'],
    ['List.first(xs)', 'xs[0]'],
    ['List.last(xs)', 'xs[-1]'],
    // Review fix: Python list.index raises on miss; ternary returns -1 to
    // match TS semantics.
    ['List.indexOf(xs, x)', '(xs.index(x) if x in xs else -1)'],
    // Review fix: Python str.join requires string elements; map(str, …) wraps
    // numeric values to match TS behavior.
    ['List.join(xs, ",")', '",".join(map(str, xs))'],
    // Map (dict-like)
    ['Map.has(m, k)', 'k in m'],
    // Review fix: TS Map.get returns undefined; Python dict[k] raises KeyError.
    // Use dict.get(k) for None-on-miss parity.
    ['Map.get(m, k)', 'm.get(k)'],
    ['Map.size(m)', 'len(m)'],
    // Number — slice 3 review fix (Gemini): aliased to `__k_math` to avoid
    // shadowing when the user has a local binding or param named `math`.
    // Slice 3c flips Number.round to `__k_math.floor(n + 0.5)` to match JS
    // Math.round semantics (round-half-toward-+∞).
    ['Number.round(n)', '__k_math.floor(n + 0.5)'],
    ['Number.floor(n)', '__k_math.floor(n)'],
    ['Number.ceil(n)', '__k_math.ceil(n)'],
    ['Number.abs(n)', 'abs(n)'],
  ])('Python lowering: %s → %s', (kern, py) => {
    expect(emitPyExpression(parseExpression(kern))).toBe(py);
  });
});

// ── 2c: arithmetic + comparison (Python) ─────────────────────────────────

describe('emitPyExpression — arithmetic + comparison + unary', () => {
  test('addition emits verbatim', () => {
    expect(emitPyExpression(parseExpression('a + b'))).toBe('a + b');
  });

  test('multiplication binds tighter (precedence)', () => {
    expect(emitPyExpression(parseExpression('a + b * c'))).toBe('a + b * c');
  });

  test('strict equality === lowers to Python ==', () => {
    expect(emitPyExpression(parseExpression('x === 0'))).toBe('x == 0');
  });

  test('strict inequality !== lowers to Python !=', () => {
    expect(emitPyExpression(parseExpression('x !== 0'))).toBe('x != 0');
  });

  test('logical && lowers to Python and', () => {
    expect(emitPyExpression(parseExpression('a && b'))).toBe('a and b');
  });

  test('logical || lowers to Python or', () => {
    expect(emitPyExpression(parseExpression('a || b'))).toBe('a or b');
  });

  test('unary ! lowers to Python not', () => {
    expect(emitPyExpression(parseExpression('!isReady'))).toBe('not isReady');
  });

  test('combined Text.length + comparison', () => {
    // Text.length(s) > 0 → len(s) > 0 (free-fn lowering, then >)
    expect(emitPyExpression(parseExpression('Text.length(s) > 0'))).toBe('len(s) > 0');
  });

  test('relational ops with paren-wrapped binary args inside stdlib call', () => {
    // Number.abs(a - b) → abs((a - b)) — receiver is paren-wrapped because
    // it's a binary expression and Math/abs templates use $0 directly.
    expect(emitPyExpression(parseExpression('Number.abs(a - b)'))).toBe('abs((a - b))');
  });
});

// ── 2c: if/else body codegen (Python whitespace-significant) ──────────────

describe('emitNativeKernBodyPython — if / else control flow', () => {
  test('plain if with single child uses Python whitespace-significant body', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'x === 0' },
        children: [{ type: 'return', props: { value: '"empty"' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('if x == 0:');
    expect(out).toContain('    return "empty"');
  });

  test('if/else pair', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'x === 0' },
        children: [{ type: 'return', props: { value: '"empty"' } }],
      },
      {
        type: 'else',
        props: {},
        children: [{ type: 'return', props: { value: '"non-empty"' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('if x == 0:');
    expect(out).toContain('    return "empty"');
    expect(out).toContain('else:');
    expect(out).toContain('    return "non-empty"');
  });

  test('empty if-branch emits `pass`', () => {
    const handler = makeHandler([{ type: 'if', props: { cond: 'x === 0' }, children: [] }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('if x == 0:');
    expect(out).toContain('    pass');
  });
});

// ── 2d: object + array literals (Python dict/list) ───────────────────────

describe('emitPyExpression — literals', () => {
  test('object literal → Python dict with quoted keys', () => {
    expect(emitPyExpression(parseExpression('{ a: 1, b: 2 }'))).toBe('{"a": 1, "b": 2}');
  });

  test('string keys in object literal also quoted', () => {
    expect(emitPyExpression(parseExpression('{ "a-b": 1 }'))).toBe('{"a-b": 1}');
  });

  test('object literal with True/False values', () => {
    expect(emitPyExpression(parseExpression('{ ok: true, ready: false }'))).toBe('{"ok": True, "ready": False}');
  });

  test('empty dict literal', () => {
    expect(emitPyExpression(parseExpression('{}'))).toBe('{}');
  });

  test('array literal → Python list', () => {
    expect(emitPyExpression(parseExpression('[1, 2, 3]'))).toBe('[1, 2, 3]');
  });

  test('nested array of dicts', () => {
    expect(emitPyExpression(parseExpression('[{ id: 1 }, { id: 2 }]'))).toBe('[{"id": 1}, {"id": 2}]');
  });

  test('object literal with stdlib call value', () => {
    expect(emitPyExpression(parseExpression('{ name: Text.upper(raw) }'))).toBe('{"name": raw.upper()}');
  });
});

// ── End-to-end: native fn (Python target) ─────────────────────────────────

describe('FastAPI fn lang=kern with slice-2 features', () => {
  test('compiles a fn that uses if/else, stdlib, propagation, literal — Python output', () => {
    const source = [
      'module name=test',
      'fn name=processRaw params="raw:string" returns=Result async=true',
      '  handler lang=kern',
      '    let name=trimmed value="Text.trim(raw)"',
      '    if cond="Text.length(trimmed) === 0"',
      '      return value="Result.err({ kind: \\"empty\\" })"',
      '    return value="Result.ok(Text.upper(trimmed))"',
    ].join('\n');
    const ir = parseDocument(source);
    const fnNode = ir.children?.find((c) => c.type === 'fn');
    expect(fnNode).toBeDefined();
    if (!fnNode) return;
    const out = generateFunction(fnNode).join('\n');
    expect(out).toContain('trimmed = raw.strip()');
    expect(out).toContain('if len(trimmed) == 0:');
    expect(out).toContain('return Result.err({"kind": "empty"})');
    expect(out).toContain('return Result.ok(trimmed.upper())');
  });
});

// ── Cross-target parity for the high-divergence stdlib ops ───────────────

describe('Cross-target parity — slice 2 stdlib hard cases', () => {
  test.each([
    ['Text.includes(s, "x")', 's.includes("x")', '"x" in s'],
    ['List.isEmpty(xs)', 'xs.length === 0', 'len(xs) == 0'],
    ['List.last(xs)', 'xs.at(-1)', 'xs[-1]'],
    ['List.join(xs, ",")', 'xs.join(",")', '",".join(map(str, xs))'],
    ['Map.has(m, k)', 'm.has(k)', 'k in m'],
    ['Map.get(m, k)', 'm.get(k)', 'm.get(k)'],
    ['Number.floor(n)', 'Math.floor(n)', '__k_math.floor(n)'],
  ])('%s → TS %s / Python %s', async (kern, ts, py) => {
    const { emitExpression } = await import('@kernlang/core');
    expect(emitExpression(parseExpression(kern))).toBe(ts);
    expect(emitPyExpression(parseExpression(kern))).toBe(py);
  });
});

// ── Review-fix tests (post-buddy-review) — Python target ─────────────────

describe('Review fixes — Python', () => {
  test('`??` nullish coalesce throws with deferral guidance', () => {
    expect(() => emitPyExpression(parseExpression('a ?? b'))).toThrow(/Nullish coalesce/);
  });

  test('comparison chaining gets force-parens to disable Python chaining', () => {
    // KERN/JS precedence: `<` (11) binds tighter than `===` (10), so
    // `a === b < c` parses as `a === (b < c)`. Without force-parens, Python
    // would interpret `a == b < c` as chained `(a == b) and (b < c)` —
    // different semantics. The force-paren on comparison-comparison nesting
    // preserves the AST shape: `a == (b < c)`.
    expect(emitPyExpression(parseExpression('a === b < c'))).toBe('a == (b < c)');
  });

  test('non-comparison binary ops do NOT trigger force-paren', () => {
    // `a + b - c` should NOT get extra parens (force-paren only applies to
    // comparison-comparison nesting).
    expect(emitPyExpression(parseExpression('a + b - c'))).toBe('a + b - c');
  });

  test('stdlib arity mismatch — Python target also throws', () => {
    expect(() => emitPyExpression(parseExpression('Text.upper(s, extra)'))).toThrow(/takes 1 arg, got 2/);
  });

  test('orphan `else` rejected — Python target', () => {
    const handler: IRNode = {
      type: 'handler',
      props: { lang: 'kern' },
      children: [{ type: 'else', props: {}, children: [{ type: 'return', props: {} }] }],
    };
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/orphan `else`/);
  });

  test('propagation `?` rejected inside `if cond` — Python target', () => {
    const handler: IRNode = {
      type: 'handler',
      props: { lang: 'kern' },
      children: [{ type: 'if', props: { cond: 'call()?' }, children: [{ type: 'return', props: {} }] }],
    };
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/Propagation '\?' is not allowed in `if cond=`/);
  });

  test('List.indexOf returns -1 for missing item (matches TS semantics)', () => {
    // Verifies the ternary lowering — Python `list.index` would otherwise raise.
    expect(emitPyExpression(parseExpression('List.indexOf(xs, x)'))).toBe('(xs.index(x) if x in xs else -1)');
  });

  test('Map.get returns None for missing key (matches TS undefined)', () => {
    expect(emitPyExpression(parseExpression('Map.get(m, k)'))).toBe('m.get(k)');
  });

  test('List.join wraps elements with str() to handle non-string lists', () => {
    expect(emitPyExpression(parseExpression('List.join(xs, ",")'))).toBe('",".join(map(str, xs))');
  });
});
