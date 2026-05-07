/** Native KERN handler bodies — slice 2 bundle (2b + 2c + 2d).
 *
 *  - 2b: KERN-stdlib expansion (Text+, List, Map, Number) via templated lowering.
 *  - 2c: arithmetic + comparison ops in parseExpression; `if`/`else` control
 *    flow in body codegen.
 *  - 2d: object + array literals as ValueIR shapes with per-target codegen.
 *
 *  Cross-target parity is verified for the constructs that diverge most:
 *  Text.includes / List.isEmpty / List.last / List.join / Map.has / Map.get
 *  / Number.floor — all of these have non-trivial template differences. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseDocument } from '../src/parser.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';

// ── 2b: stdlib expansion ──────────────────────────────────────────────────

describe('KERN-stdlib expansion — Text+, List, Map, Number', () => {
  test.each([
    // Text additions
    ['Text.includes(s, "x")', 's.includes("x")'],
    ['Text.startsWith(s, "p")', 's.startsWith("p")'],
    ['Text.endsWith(s, "p")', 's.endsWith("p")'],
    ['Text.split(s, ",")', 's.split(",")'],
    // Review fix: KERN normalizes to replace-all semantics; TS uses replaceAll.
    ['Text.replace(s, "a", "b")', 's.replaceAll("a", "b")'],
    // List
    ['List.length(xs)', 'xs.length'],
    ['List.isEmpty(xs)', 'xs.length === 0'],
    ['List.includes(xs, x)', 'xs.includes(x)'],
    ['List.first(xs)', 'xs[0]'],
    // Review fix: `.at(-1)` is single-eval (avoids the `xs.length` re-eval bug
    // when the receiver is a function call).
    ['List.last(xs)', 'xs.at(-1)'],
    ['List.indexOf(xs, x)', 'xs.indexOf(x)'],
    ['List.join(xs, ",")', 'xs.join(",")'],
    // Map
    ['Map.has(m, k)', 'm.has(k)'],
    ['Map.get(m, k)', 'm.get(k)'],
    ['Map.size(m)', 'm.size'],
    // Number
    ['Number.round(n)', 'Math.round(n)'],
    ['Number.floor(n)', 'Math.floor(n)'],
    ['Number.ceil(n)', 'Math.ceil(n)'],
    ['Number.abs(n)', 'Math.abs(n)'],
    // `Number.isFinite` / `Number.isNaN` (NOT the coercive globals) — these
    // are the strict, type-safe forms that return false on non-numbers
    // instead of doing JS-style coercion.
    ['Number.isFinite(n)', 'Number.isFinite(n)'],
    ['Number.isNaN(n)', 'Number.isNaN(n)'],
  ])('TS lowering: %s → %s', (kern, ts) => {
    expect(emitExpression(parseExpression(kern))).toBe(ts);
  });
});

// ── 2c: arithmetic + comparison parser ───────────────────────────────────

describe('parseExpression — arithmetic + comparison ops', () => {
  test('addition/subtraction left-associative', () => {
    expect(emitExpression(parseExpression('a + b - c'))).toBe('a + b - c');
  });

  test('multiplication binds tighter than addition (precedence)', () => {
    // a + b * c → a + (b * c) — but the right-side b*c doesn't need parens
    // when emitted because mul precedence > add.
    expect(emitExpression(parseExpression('a + b * c'))).toBe('a + b * c');
  });

  test('explicit precedence override via parens preserves grouping', () => {
    expect(emitExpression(parseExpression('(a + b) * c'))).toBe('(a + b) * c');
  });

  test('strict equality emits ===', () => {
    expect(emitExpression(parseExpression('x === 0'))).toBe('x === 0');
  });

  test('relational ops emit verbatim in TS', () => {
    expect(emitExpression(parseExpression('x < 10'))).toBe('x < 10');
    expect(emitExpression(parseExpression('x <= 10'))).toBe('x <= 10');
    expect(emitExpression(parseExpression('x > 10'))).toBe('x > 10');
    expect(emitExpression(parseExpression('x >= 10'))).toBe('x >= 10');
  });

  test('unary not emits as !x', () => {
    expect(emitExpression(parseExpression('!isReady'))).toBe('!isReady');
  });

  test('unary minus emits as -x', () => {
    expect(emitExpression(parseExpression('-x'))).toBe('-x');
  });

  test('await wraps lower-precedence argument', () => {
    expect(emitExpression(parseExpression('await (a + b)'))).toBe('await (a + b)');
  });

  test('new wraps lower-precedence argument', () => {
    expect(emitExpression(parseExpression('new (a || b)'))).toBe('new (a || b)');
  });

  test('combined logical + comparison precedence', () => {
    // `a && b === c` → a && (b === c) since === binds tighter than &&.
    expect(emitExpression(parseExpression('a && b === c'))).toBe('a && b === c');
  });

  test('stdlib-call inside an arithmetic expression preserves dispatch', () => {
    // Text.length(s) > 0 → s.length > 0
    expect(emitExpression(parseExpression('Text.length(s) > 0'))).toBe('s.length > 0');
  });
});

// ── 2c: if/else body codegen ─────────────────────────────────────────────

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('emitNativeKernBodyTS — if / else control flow', () => {
  test('plain if with single child', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'x === 0' },
        children: [{ type: 'return', props: { value: '"empty"' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('if (x === 0) {');
    expect(out).toContain('  return "empty";');
    expect(out).toContain('}');
  });

  test('if/else pair with sibling-`else` walks together', () => {
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
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('if (x === 0) {');
    expect(out).toContain('  return "empty";');
    expect(out).toContain('} else {');
    expect(out).toContain('  return "non-empty";');
  });

  test('let inside if-branch scopes correctly', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a > 0' },
        children: [
          { type: 'let', props: { name: 'doubled', value: 'a * 2' } },
          { type: 'return', props: { value: 'doubled' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('  const doubled = a * 2;');
    expect(out).toContain('  return doubled;');
  });

  test('propagation hoist inside if-branch keeps gensym counter monotonic', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'a', value: 'first()?' } },
      {
        type: 'if',
        props: { cond: 'a === 0' },
        children: [{ type: 'let', props: { name: 'b', value: 'second()?' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = first();');
    expect(out).toContain('  const __k_t2 = second();');
  });
});

describe('emitNativeKernBodyTS — assignment body statement', () => {
  test('plain assignment targets emit as statements', () => {
    const handler = makeHandler([
      { type: 'assign', props: { target: 'x', value: '1' } },
      { type: 'assign', props: { target: 'obj.x', value: 'x' } },
      { type: 'assign', props: { target: 'arr[0]', value: 'obj.x' } },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('x = 1;');
    expect(out).toContain('obj.x = x;');
    expect(out).toContain('arr[0] = obj.x;');
  });

  test('assignment rejects non-lvalue targets', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'a + b', value: '1' } }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/identifier, member access, or index access/);
  });

  test('assignment rejects optional-chain targets', () => {
    expect(() =>
      emitNativeKernBodyTS(makeHandler([{ type: 'assign', props: { target: 'obj?.x', value: '1' } }])),
    ).toThrow(/identifier, member access, or index access/);
    expect(() =>
      emitNativeKernBodyTS(makeHandler([{ type: 'assign', props: { target: 'arr?.[0]', value: '1' } }])),
    ).toThrow(/identifier, member access, or index access/);
  });

  test('assignment rejects propagation values', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'x', value: 'load()?' } }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/bind to `let` first/);
  });

  test('assignment allows optional access inside index rvalue', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'arr[obj?.idx]', value: '1' } }]);
    expect(emitNativeKernBodyTS(handler)).toContain('arr[obj?.idx] = 1;');
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
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const item of items) {');
    expect(out).toContain('if (item.ok) {');
    expect(out).toContain('last = item.value;');
  });
});

// ── 2d: object + array literals ───────────────────────────────────────────

describe('parseExpression + emitExpression — literals', () => {
  test('object literal with bare-ident keys', () => {
    expect(emitExpression(parseExpression('{ a: 1, b: 2 }'))).toBe('{ a: 1, b: 2 }');
  });

  test('object literal with string keys (kept JSON-quoted in TS)', () => {
    expect(emitExpression(parseExpression('{ "a-b": 1 }'))).toBe('{ "a-b": 1 }');
  });

  test('empty object literal emits as `{}`', () => {
    expect(emitExpression(parseExpression('{}'))).toBe('{}');
  });

  test('array literal', () => {
    expect(emitExpression(parseExpression('[1, 2, 3]'))).toBe('[1, 2, 3]');
  });

  test('empty array literal', () => {
    expect(emitExpression(parseExpression('[]'))).toBe('[]');
  });

  test('nested literal — array of objects', () => {
    expect(emitExpression(parseExpression('[{ id: 1 }, { id: 2 }]'))).toBe('[{ id: 1 }, { id: 2 }]');
  });

  test('object literal with computed call value', () => {
    expect(emitExpression(parseExpression('{ name: Text.upper(raw) }'))).toBe('{ name: raw.toUpperCase() }');
  });

  test('trailing comma in object literal is permitted', () => {
    expect(emitExpression(parseExpression('{ a: 1, }'))).toBe('{ a: 1 }');
  });
});

describe('parseExpression + emitExpression — index access', () => {
  test('array index access', () => {
    expect(emitExpression(parseExpression('items[0]'))).toBe('items[0]');
  });

  test('computed object key access', () => {
    expect(emitExpression(parseExpression('record[key]'))).toBe('record[key]');
  });

  test('index access composes with member and call chains', () => {
    expect(emitExpression(parseExpression('items[0].name'))).toBe('items[0].name');
    expect(emitExpression(parseExpression('load()[idx]'))).toBe('load()[idx]');
  });

  test('index receiver wraps lower-precedence expression', () => {
    expect(emitExpression(parseExpression('(a || b)[0]'))).toBe('(a || b)[0]');
    expect(emitExpression(parseExpression('(c ? a : b)[0]'))).toBe('(c ? a : b)[0]');
    expect(emitExpression(parseExpression('(await load())[0]'))).toBe('(await load())[0]');
  });

  test('member receiver wraps lower-precedence expression', () => {
    expect(emitExpression(parseExpression('(c ? a : b).field'))).toBe('(c ? a : b).field');
    expect(emitExpression(parseExpression('(await load()).field'))).toBe('(await load()).field');
  });

  test('nested and string-literal index access', () => {
    expect(emitExpression(parseExpression('matrix[0][1]'))).toBe('matrix[0][1]');
    expect(emitExpression(parseExpression('obj["key"]'))).toBe('obj["key"]');
  });

  test('optional element access composes with index and trailing chains', () => {
    expect(emitExpression(parseExpression('arr?.[i]'))).toBe('arr?.[i]');
    expect(emitExpression(parseExpression('users?.[id].name'))).toBe('users?.[id].name');
    expect(emitExpression(parseExpression('users?.[id]?.name'))).toBe('users?.[id]?.name');
    expect(emitExpression(parseExpression('items?.[0]?.[1]'))).toBe('items?.[0]?.[1]');
    expect(emitExpression(parseExpression('items[0]?.[1]'))).toBe('items[0]?.[1]');
  });

  test('optional index receiver wraps lower-precedence expression', () => {
    expect(emitExpression(parseExpression('(load ?? fallback)?.[i]'))).toBe('(load ?? fallback)?.[i]');
  });
});

describe('parseExpression + emitExpression — type assertions', () => {
  test('simple as-expression preserves TS assertion', () => {
    expect(emitExpression(parseExpression('params.filePath as string'))).toBe('params.filePath as string');
  });

  test('as const inside object literal value', () => {
    expect(emitExpression(parseExpression('{ role: "user" as const }'))).toBe('{ role: "user" as const }');
  });

  test('assertion can be used inside call args', () => {
    expect(emitExpression(parseExpression('JSON.parse(params.variables as string)'))).toBe(
      'JSON.parse(params.variables as string)',
    );
  });

  test('assertion stops before outer equality operator', () => {
    expect(emitExpression(parseExpression('value as string === expected'))).toBe('(value as string) === expected');
  });

  test('assertion stops before outer relational operators', () => {
    expect(emitExpression(parseExpression('value as Foo < expected'))).toBe('(value as Foo) < expected');
    expect(emitExpression(parseExpression('value as Foo <= expected'))).toBe('(value as Foo) <= expected');
    expect(emitExpression(parseExpression('value as Foo >= expected'))).toBe('(value as Foo) >= expected');
  });

  test('assertion preserves simple array and generic type text', () => {
    expect(emitExpression(parseExpression('value as string[]'))).toBe('value as string[]');
    expect(emitExpression(parseExpression('value as Record<string, unknown>'))).toBe(
      'value as Record<string, unknown>',
    );
  });

  test('assertion preserves union and intersection type text', () => {
    expect(emitExpression(parseExpression('value as string | null'))).toBe('value as string | null');
    expect(emitExpression(parseExpression('value as A & B'))).toBe('value as A & B');
  });

  test('chained assertions remain nested assertions', () => {
    expect(emitExpression(parseExpression('value as unknown as string'))).toBe('(value as unknown) as string');
  });
});

// ── End-to-end: native fn with all slice-2 features ──────────────────────

describe('end-to-end fn lang=kern with slice-2 features', () => {
  test('compiles a fn that uses if/else, stdlib, propagation, literal', () => {
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
    const out = generateCoreNode(fnNode).join('\n');
    expect(out).toContain('const trimmed = raw.trim();');
    expect(out).toContain('if (trimmed.length === 0) {');
    expect(out).toContain('return Result.err({ kind: "empty" });');
    expect(out).toContain('return Result.ok(trimmed.toUpperCase());');
  });
});

// ── Review-fix tests (post-buddy-review) ──────────────────────────────────

describe('Review fixes — TS', () => {
  test('unary `!` wraps binary args in parens', () => {
    expect(emitExpression(parseExpression('!(a === b)'))).toBe('!(a === b)');
  });

  test('unary `-` wraps binary args in parens', () => {
    expect(emitExpression(parseExpression('-(a + b)'))).toBe('-(a + b)');
  });

  test('mid-expression `?` rejected with helpful guidance', () => {
    expect(() => emitExpression(parseExpression('Text.upper(call()?)'))).toThrow(/bind the call to a `let` first/);
  });

  test('stdlib arity mismatch — extra args throw', () => {
    expect(() => emitExpression(parseExpression('Text.upper(s, extra)'))).toThrow(/takes 1 arg, got 2/);
  });

  test('stdlib arity mismatch — too few args throw', () => {
    expect(() => emitExpression(parseExpression('Text.replace(s, "a")'))).toThrow(/takes 3 args, got 2/);
  });

  test('orphan `else` rejected', () => {
    const handler: IRNode = {
      type: 'handler',
      props: { lang: 'kern' },
      children: [{ type: 'else', props: {}, children: [{ type: 'return', props: {} }] }],
    };
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/orphan `else`/);
  });

  test('propagation `?` rejected inside `if cond`', () => {
    const handler: IRNode = {
      type: 'handler',
      props: { lang: 'kern' },
      children: [{ type: 'if', props: { cond: 'call()?' }, children: [{ type: 'return', props: {} }] }],
    };
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/Propagation '\?' is not allowed in `if cond=`/);
  });

  test('List.last single-eval semantics — `.at(-1)`', () => {
    // Doesn't matter what the receiver is; `.at(-1)` does not duplicate it.
    expect(emitExpression(parseExpression('List.last(load())'))).toBe('load().at(-1)');
  });

  test('Text.replace uses replace-all semantics in TS', () => {
    expect(emitExpression(parseExpression('Text.replace(s, "a", "b")'))).toBe('s.replaceAll("a", "b")');
  });
});
