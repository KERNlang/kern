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
import { KERN_FMT_HELPER_PY } from '../src/core/expr/helpers.js';
import { generateFunction } from '../src/generators/core.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

// A dynamic `typeof` references the `_KERN_UNDEFINED` sentinel, so any BODY that
// lowers one carries the coercion helper prelude (derived from the source const
// so it can never drift). Expression-only `emitPyExpression` returns just the
// expression — no prelude — since it discards the collected helper set.
const PY_PRELUDE = `${KERN_FMT_HELPER_PY}\n\n`;

const TYPEOF_VALUE_PY =
  '("undefined" if (__k_typeof1 := value) is _KERN_UNDEFINED else "object" if __k_typeof1 is None else "boolean" if isinstance(__k_typeof1, bool) else "number" if isinstance(__k_typeof1, (int, float)) else "string" if isinstance(__k_typeof1, str) else "function" if callable(__k_typeof1) else "object")';

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
    // `Number.isFinite` / `Number.isNaN` lower to `math.isfinite` / `math.isnan`
    // via the `__k_math` alias (same shadow-avoidance pattern as round/floor/ceil).
    ['Number.isFinite(n)', '__k_math.isfinite(n)'],
    ['Number.isNaN(n)', '__k_math.isnan(n)'],
  ])('Python lowering: %s → %s', (kern, py) => {
    expect(emitPyExpression(parseExpression(kern))).toBe(py);
  });
});

// ── 2c: arithmetic + comparison (Python) ─────────────────────────────────

describe('emitPyExpression — arithmetic + comparison + unary', () => {
  test('addition lowers to __kern_add (JS + string-coercion guard)', () => {
    expect(emitPyExpression(parseExpression('a + b'))).toBe('__kern_add(a, b)');
  });

  test('multiplication binds tighter (precedence)', () => {
    expect(emitPyExpression(parseExpression('a + b * c'))).toBe('__kern_add(a, b * c)');
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

  // `instanceof` has no infix Python form — emitting it verbatim would be a
  // Python SyntaxError, so it MUST lower to the `isinstance(...)` call form.
  // Host `Error` maps to Python `Exception` (spec §2); user-class / qualified-
  // member RHS emit as-is.
  test('instanceof lowers to Python isinstance(...)', () => {
    expect(emitPyExpression(parseExpression('x instanceof Error'))).toBe('isinstance(x, Exception)');
    expect(emitPyExpression(parseExpression('xs instanceof Array'))).toBe('isinstance(xs, list)');
    expect(emitPyExpression(parseExpression('x instanceof a.b.C'))).toBe('isinstance(x, a.b.C)');
    expect(emitPyExpression(parseExpression('a instanceof B && c'))).toBe('isinstance(a, B) and c');
    // The dominant idiom — mirrors the TS-side round-trip in core/expression.test.ts.
    expect(emitPyExpression(parseExpression('err instanceof Error ? err.message : String(err)'))).toBe(
      "err.message if (isinstance(err, Exception)) else (lambda __k_v: ('true' if __k_v else 'false') if isinstance(__k_v, bool) else 'null' if __k_v is None else str(int(__k_v)) if isinstance(__k_v, float) and __k_v.is_integer() else str(__k_v))(err)",
    );
  });

  test('new Error(...) maps to Exception(...) on Python (host Error mapping, spec §1)', () => {
    expect(emitPyExpression(parseExpression('new Error("x")'))).toBe('Exception("x")');
    // `new TypeError(...)` is NOT remapped — Python has a native TypeError.
    expect(emitPyExpression(parseExpression('new TypeError("t")'))).toBe('TypeError("t")');
    // A user class constructor is unaffected.
    expect(emitPyExpression(parseExpression('new Point(3, 4)'))).toBe('Point(3, 4)');
  });

  test('instanceof rejected RHS throws fail-closed at emission (spec §2/§3 defense-in-depth)', () => {
    expect(() => emitPyExpression(parseExpression('x instanceof String'))).toThrow(/instanceof-rhs-wrapper-rejected/);
    expect(() => emitPyExpression(parseExpression('x instanceof Promise'))).toThrow(
      /instanceof-rhs-unsupported-builtin/,
    );
    expect(() => emitPyExpression(parseExpression('x instanceof getClass()'))).toThrow(
      /instanceof-rhs-not-a-type-name/,
    );
  });

  test('unary ! lowers to Python not', () => {
    expect(emitPyExpression(parseExpression('!isReady'))).toBe('not isReady');
  });

  test('unary typeof lowers to a single-eval Python type string expression', () => {
    expect(emitPyExpression(parseExpression('typeof value'))).toBe(TYPEOF_VALUE_PY);
  });

  test('typeof type guard composes with strict equality', () => {
    expect(emitPyExpression(parseExpression('typeof value === "string"'))).toBe(`${TYPEOF_VALUE_PY} == "string"`);
  });

  test('typeof literals lower without dynamic temp binding', () => {
    expect(emitPyExpression(parseExpression('typeof "x"'))).toBe('"string"');
    expect(emitPyExpression(parseExpression('typeof `${x}`'))).toBe('"string"');
    expect(emitPyExpression(parseExpression('typeof true'))).toBe('"boolean"');
    expect(emitPyExpression(parseExpression('typeof 1'))).toBe('"number"');
    expect(emitPyExpression(parseExpression('typeof 1n'))).toBe('"bigint"');
    expect(emitPyExpression(parseExpression('typeof undefined'))).toBe('"undefined"');
    expect(emitPyExpression(parseExpression('typeof null'))).toBe('"object"');
    expect(emitPyExpression(parseExpression('typeof none'))).toBe('"object"');
  });

  test('typeof in return body codegen does not throw on Python target', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'typeof value === "string"' }, children: [] }]);
    expect(emitNativeKernBodyPython(handler)).toBe(`${PY_PRELUDE}return ${TYPEOF_VALUE_PY} == "string"`);
  });

  test('typeof composes in Python if conditions', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'typeof value === "string"' },
        children: [{ type: 'return', props: { value: 'value' }, children: [] }],
      },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(`${PY_PRELUDE}if ${TYPEOF_VALUE_PY} == "string":\n    return value`);
  });

  test('nested typeof and await keep stable temp numbering', () => {
    expect(emitPyExpression(parseExpression('typeof typeof value'))).toBe(
      '("undefined" if (__k_typeof2 := (("undefined" if (__k_typeof1 := value) is _KERN_UNDEFINED else "object" if __k_typeof1 is None else "boolean" if isinstance(__k_typeof1, bool) else "number" if isinstance(__k_typeof1, (int, float)) else "string" if isinstance(__k_typeof1, str) else "function" if callable(__k_typeof1) else "object"))) is _KERN_UNDEFINED else "object" if __k_typeof2 is None else "boolean" if isinstance(__k_typeof2, bool) else "number" if isinstance(__k_typeof2, (int, float)) else "string" if isinstance(__k_typeof2, str) else "function" if callable(__k_typeof2) else "object")',
    );
    expect(emitPyExpression(parseExpression('typeof await readValue()'))).toBe(
      '("undefined" if (__k_typeof1 := (await readValue())) is _KERN_UNDEFINED else "object" if __k_typeof1 is None else "boolean" if isinstance(__k_typeof1, bool) else "number" if isinstance(__k_typeof1, (int, float)) else "string" if isinstance(__k_typeof1, str) else "function" if callable(__k_typeof1) else "object")',
    );
  });

  test('typeof object shorthand lowers as a normal Python dict entry', () => {
    expect(emitPyExpression(parseExpression('{ typeof }'))).toBe('{"typeof": typeof}');
  });

  test('typeof composes in Python ternary expressions', () => {
    expect(emitPyExpression(parseExpression('typeof value === "string" ? "s" : "x"'))).toBe(
      `"s" if (${TYPEOF_VALUE_PY} == "string") else "x"`,
    );
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

describe('emitNativeKernBodyPython — assignment body statement', () => {
  test('plain assignment targets emit as Python statements', () => {
    const handler = makeHandler([
      { type: 'assign', props: { target: 'x', value: '1' } },
      { type: 'assign', props: { target: 'obj.x', value: 'x' } },
      { type: 'assign', props: { target: 'arr[0]', value: 'obj.x' } },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('x = 1');
    expect(out).toContain('obj.x = x');
    expect(out).toContain('arr[0] = obj.x');
  });

  test('compound assignment emits supported Python operators', () => {
    const handler = makeHandler([
      { type: 'assign', props: { target: 'total', op: '+=', value: 'item.value' } },
      { type: 'assign', props: { target: 'obj.count', op: '+=', value: '1' } },
      { type: 'assign', props: { target: 'arr[0]', op: '|=', value: 'mask' } },
      { type: 'assign', props: { target: 'mask', op: '|=', value: 'Flag.Ready' } },
      { type: 'assign', props: { target: 'count', op: '**=', value: '2' } },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('total += item.value');
    expect(out).toContain('obj.count += 1');
    expect(out).toContain('arr[0] |= mask');
    expect(out).toContain('mask |= Flag.Ready');
    expect(out).toContain('count **= 2');
  });

  test('assignment rejects unsupported Python operators', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'x', op: '&&=', value: 'next' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/assign op=.*&&=/);
  });

  test('assignment rejects non-lvalue targets', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'a + b', value: '1' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/identifier, member access, or index access/);
  });

  test('assignment rejects optional-chain targets', () => {
    expect(() =>
      emitNativeKernBodyPython(makeHandler([{ type: 'assign', props: { target: 'obj?.x', value: '1' } }])),
    ).toThrow(/identifier, member access, or index access/);
    expect(() =>
      emitNativeKernBodyPython(makeHandler([{ type: 'assign', props: { target: 'arr?.[0]', value: '1' } }])),
    ).toThrow(/identifier, member access, or index access/);
  });

  test('assignment rejects propagation values', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'x', value: 'load()?' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/bind to `let` first/);
  });

  test('assignment allows optional access inside index rvalue', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'arr[obj?.idx]', value: '1' } }]);
    expect(emitNativeKernBodyPython(handler)).toContain('arr[(obj.idx if obj is not None else None)] = 1');
  });

  test('assignment composes inside nested control-flow body statements', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [
          {
            type: 'if',
            props: { cond: 'item.ok' },
            children: [{ type: 'assign', props: { target: 'last', value: 'item.value' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for __k_each_1 in items:');
    expect(out).toContain('if item.ok:');
    expect(out).toContain('last = item.value');
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

describe('emitPyExpression — index access', () => {
  test('array index access', () => {
    expect(emitPyExpression(parseExpression('items[0]'))).toBe('items[0]');
  });

  test('computed object key access', () => {
    expect(emitPyExpression(parseExpression('record[key]'))).toBe('record[key]');
  });

  test('index access composes with member and call chains', () => {
    expect(emitPyExpression(parseExpression('items[0].name'))).toBe('items[0].name');
    expect(emitPyExpression(parseExpression('load()[idx]'))).toBe('load()[idx]');
  });

  test('index receiver wraps lower-precedence expression', () => {
    expect(emitPyExpression(parseExpression('(a || b)[0]'))).toBe('(a or b)[0]');
    expect(emitPyExpression(parseExpression('(c ? a : b)[0]'))).toBe('(a if c else b)[0]');
    expect(emitPyExpression(parseExpression('(await load())[0]'))).toBe('(await load())[0]');
  });

  test('nested and string-literal index access', () => {
    expect(emitPyExpression(parseExpression('matrix[0][1]'))).toBe('matrix[0][1]');
    expect(emitPyExpression(parseExpression('obj["key"]'))).toBe('obj["key"]');
  });

  test('optional element access short-circuits trailing chains', () => {
    expect(emitPyExpression(parseExpression('arr?.[i]'))).toBe('(arr[i] if arr is not None else None)');
    expect(emitPyExpression(parseExpression('users?.[id].name'))).toBe(
      '(users[id].name if users is not None else None)',
    );
    expect(emitPyExpression(parseExpression('users?.[id]?.name'))).toBe(
      '(users[id].name if users is not None and users[id] is not None else None)',
    );
    expect(emitPyExpression(parseExpression('obj?.field[0]'))).toBe('(obj.field[0] if obj is not None else None)');
    expect(emitPyExpression(parseExpression('arr?.[i][j]'))).toBe('(arr[i][j] if arr is not None else None)');
    expect(emitPyExpression(parseExpression('users[id]?.name'))).toBe(
      '(users[id].name if users[id] is not None else None)',
    );
  });

  test('optional element access keeps index expressions branch-local', () => {
    expect(emitPyExpression(parseExpression('arr?.[nextIndex()]'))).toBe(
      '(arr[nextIndex()] if arr is not None else None)',
    );
  });

  test('optional element access rejects side-effecting Python receiver inputs', () => {
    expect(() => emitPyExpression(parseExpression('load()?.[i]'))).toThrow(/requires a side-effect-free receiver/);
  });
});

describe('emitPyExpression — type assertions', () => {
  test('TS-style as-expression erases to the underlying expression', () => {
    expect(emitPyExpression(parseExpression('params.filePath as string'))).toBe('params.filePath');
  });

  test('as const inside object literal erases for Python', () => {
    expect(emitPyExpression(parseExpression('{ role: "user" as const }'))).toBe('{"role": "user"}');
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
  test('`??` nullish coalesce lowers to Python ternary with None check', () => {
    expect(emitPyExpression(parseExpression('user ?? guest'))).toBe(
      '(user if (user is not None and user is not _KERN_UNDEFINED) else guest)',
    );
  });

  test('`??` on member chain also works', () => {
    expect(emitPyExpression(parseExpression('user.id ?? 0'))).toBe(
      '(user.id if (user.id is not None and user.id is not _KERN_UNDEFINED) else 0)',
    );
  });

  test('`??` with side-effecting left side uses walrus for single-eval (slice 4c)', () => {
    expect(emitPyExpression(parseExpression('call() ?? b'))).toBe(
      '(__k_nc1 if ((__k_nc1 := call()) is not None and __k_nc1 is not _KERN_UNDEFINED) else b)',
    );
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
    // comparison-comparison nesting). The `+` lowers to __kern_add; the `-`
    // is a non-`+` op and stays verbatim.
    expect(emitPyExpression(parseExpression('a + b - c'))).toBe('__kern_add(a, b) - c');
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
