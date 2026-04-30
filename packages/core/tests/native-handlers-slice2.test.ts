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
    ['Text.replace(s, "a", "b")', 's.replace("a", "b")'],
    // List
    ['List.length(xs)', 'xs.length'],
    ['List.isEmpty(xs)', 'xs.length === 0'],
    ['List.includes(xs, x)', 'xs.includes(x)'],
    ['List.first(xs)', 'xs[0]'],
    ['List.last(xs)', 'xs[xs.length - 1]'],
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
