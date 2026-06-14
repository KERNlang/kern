/** Native KERN handler bodies — Python target (slice 1).
 *
 *  Mirrors core/tests/native-handlers.test.ts for the FastAPI/Python target.
 *  Verifies emitPyExpression lowering rules (none→None, true→True, etc.) and
 *  the statement-level propagation hoist in Python form. End-to-end test
 *  exercises the full parse → fastapi codegen pipeline on a `lang=kern` fn. */

import type { IRNode } from '@kernlang/core';
import { parseDocument, parseExpression } from '@kernlang/core';
import {
  emitNativeKernBodyPython,
  emitNativeKernBodyPythonWithImports,
  emitPyExpression,
  emitPyExpressionWithImports,
} from '../src/codegen-body-python.js';
import { KERN_FMT_HELPER_PY, KERN_JS_HELPER_PY, KERN_NULLISH_HELPER_PY } from '../src/core/expr/helpers.js';
import { generateFunction } from '../src/generators/core.js';

function makeHandler(stmts: Array<{ type: string; props: Record<string, unknown>; children?: IRNode[] }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: stmts.map((s) => ({ type: s.type, props: s.props, children: s.children })),
  };
}

// JS value→string coercion runtime prelude. Body-emit prepends this whole block
// (the _KERN_UNDEFINED sentinel + _kern_fmt + __kern_add helpers) whenever a body
// is lowered, ending with a blank-line separator before the body statements.
const PY_PRELUDE = `${KERN_FMT_HELPER_PY}\n\n`;
// Slice S7 — a body that ratchets a value-site miss to the undefined sentinel
// (destructure absent key / array out-of-range) surfaces the nullish helper
// block (which defines `_KERN_UNDEFINED`).
const PY_PRELUDE_NULLISH = `${KERN_NULLISH_HELPER_PY}\n\n`;
// Slice S4 — a body whose `if cond=`/ternary/`!`/`firstTruthy` touches the
// truthiness helper surfaces `KERN_JS_HELPER_PY`. `JS_PRELUDE` is that helper
// alone (bodies with no value coercion); `PY_PRELUDE_WITH_TRUTHY` is the JS
// helper followed by the fmt prelude (the JS helper is added to the Set first).
const JS_PRELUDE = `${KERN_JS_HELPER_PY}\n\n`;
const PY_PRELUDE_WITH_TRUTHY = `${KERN_JS_HELPER_PY}\n\n${KERN_FMT_HELPER_PY}\n\n`;

describe('emitPyExpression — slice 1 lowering rules', () => {
  test('booleans lower to Python True/False', () => {
    expect(emitPyExpression(parseExpression('true'))).toBe('True');
    expect(emitPyExpression(parseExpression('false'))).toBe('False');
  });

  test('null and `none` both lower to Python None', () => {
    expect(emitPyExpression(parseExpression('null'))).toBe('None');
    expect(emitPyExpression(parseExpression('none'))).toBe('None');
  });

  test('undefined lowers to the _KERN_UNDEFINED sentinel', () => {
    expect(emitPyExpression(parseExpression('undefined'))).toBe('_KERN_UNDEFINED');
  });

  test('structured expression API exposes helpers needed by Array.fill lowering', () => {
    const result = emitPyExpressionWithImports(parseExpression('arr.fill(v)'));
    expect(result.code).toBe('_kern_js_fill(arr, v, 0, _KERN_JS_FILL_ABSENT)');
    expect([...result.helpers].join('\n\n')).toContain('def _kern_js_fill');
  });

  test('await lowers to Python `await ${expr}`', () => {
    expect(emitPyExpression(parseExpression('await foo()'))).toBe('await foo()');
  });

  test('member access emits with dotted notation (data fields only at slice 1)', () => {
    expect(emitPyExpression(parseExpression('user.profile.email'))).toBe('user.profile.email');
  });

  test('call lowers verbatim', () => {
    expect(emitPyExpression(parseExpression('foo(a, b)'))).toBe('foo(a, b)');
  });

  test('call arguments allow a trailing comma', () => {
    expect(emitPyExpression(parseExpression('foo(a, b,)'))).toBe('foo(a, b)');
  });

  test('typed lambda return predicates erase on Python target', () => {
    // Slice S7 — `value !== null` routes the strict inequality through
    // `_kern_strict_equal` (so the null/undefined boundary matches JS).
    expect(
      emitPyExpression(parseExpression('values.filter((value: unknown): value is string => value !== null)')),
    ).toBe('values.filter(lambda value: (not _kern_strict_equal(value, None)))');
  });

  test('TS generic call args and non-null assertions erase on Python target', () => {
    expect(emitPyExpression(parseExpression('client.send<Result>("ping")'))).toBe('client.send("ping")');
    expect(emitPyExpression(parseExpression('new Set<string>()'))).toBe('Set()');
    expect(emitPyExpression(parseExpression('data[1]!'))).toBe('data[1]');
    expect(emitPyExpression(parseExpression('user!.name'))).toBe('user.name');
  });

  test('regex literals lower through Python re for common TS regex calls', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'pattern', value: '/^ok$/i' } },
      { type: 'let', props: { name: 'ok', value: '/^ok$/i.test(value)' } },
      { type: 'let', props: { name: 'negated', value: '!/^ok$/i.test(value)' } },
      { type: 'let', props: { name: 'bound', value: 'pattern.test(value)' } },
      { type: 'let', props: { name: 'clean', value: 'value.replace(/\\s+/g, " ")' } },
    ]);
    const result = emitNativeKernBodyPythonWithImports(h);
    expect(result.imports).toContain('re');
    // Milestone C, Slice 1 — emission-normalization now lowers `^`→`\A` / `$`→`\Z`
    // on the non-/m path and always injects `re.ASCII`. `/^ok$/i` therefore emits
    // `\Aok\Z` with `IGNORECASE | ASCII`, and `/\s+/g` normalizes `\s`→ the ASCII
    // whitespace class with `ASCII` flags (the `g` becomes count=0 in re.sub).
    expect(result.code).toContain('pattern = __k_re.compile("\\\\Aok\\\\Z", __k_re.IGNORECASE | __k_re.ASCII)');
    expect(result.code).toContain('__k_re.search("\\\\Aok\\\\Z", value, __k_re.IGNORECASE | __k_re.ASCII) is not None');
    // Slice S4 — `!x` consumes KERN ToBoolean: `(not _kern_truthy(...))`.
    expect(result.code).toContain(
      '(not _kern_truthy((__k_re.search("\\\\Aok\\\\Z", value, __k_re.IGNORECASE | __k_re.ASCII) is not None)))',
    );
    expect(result.code).toContain(
      'bound = (__k_re.search("\\\\Aok\\\\Z", value, __k_re.IGNORECASE | __k_re.ASCII) is not None)',
    );
    expect(result.code).toContain(
      '__k_re.sub("[ \\\\t\\\\n\\\\r\\\\f\\\\v]+", " ", value, count=0, flags=__k_re.ASCII)',
    );
  });

  test('regex lowering rejects JS-only match and flag semantics on Python target', () => {
    // Milestone C, Slice 3 — `.match(/.../g)` is now IN-CORE (was fail-close): it
    // lowers to `finditer.group(0)` full matches (D2). The remaining stateful and
    // flag rejections stay.
    expect(emitPyExpression(parseExpression('value.match(/x/g)'))).toBe(
      '([__k_m.group(0) for __k_m in __k_re.finditer("x", value, __k_re.ASCII)] or None)',
    );
    expect(() => emitPyExpression(parseExpression('/x/g.test(value)'))).toThrow(/RegExp\.test/);
    expect(() => emitPyExpression(parseExpression('/x/y.test(value)'))).toThrow(/regex flag/);
    // `.matchAll` WITHOUT /g still fail-closes (JS throws TypeError) — the new
    // Slice-3 symmetric reject.
    expect(() => emitPyExpression(parseExpression('value.matchAll(/x/)'))).toThrow(/matchAll requires the 'g' flag/);
  });

  test('strLit emits with double-quoted Python string', () => {
    expect(emitPyExpression(parseExpression('"hello"'))).toBe('"hello"');
  });

  test('numeric object literal keys lower to Python string keys', () => {
    expect(emitPyExpression(parseExpression('{ 0: "#000000", 10: "#55ff55" }'))).toBe(
      '{"0": "#000000", "10": "#55ff55"}',
    );
  });

  test('propagate at expression level throws — must hoist at statement level', () => {
    expect(() => emitPyExpression(parseExpression('foo()?'))).toThrow(/only allowed at statement level/);
  });

  test('binary ops became supported in slice 2c — verify lowering still works', () => {
    // Slice 1 originally forbade binary ops; slice 2c lifted that. The same
    // hand-constructed binary node now lowers cleanly.
    expect(
      emitPyExpression({
        kind: 'binary',
        op: '+',
        left: { kind: 'numLit', value: 1, raw: '1' },
        right: { kind: 'numLit', value: 2, raw: '2' },
      }),
    ).toBe('__kern_add(1, 2)');
  });
});

describe('emitNativeKernBodyPython — expression-v1 and nested fn statements', () => {
  test('expression-v1 emits a scalar binding through Python expression lowering', () => {
    const handler = makeHandler([
      { type: 'expression-v1', props: { name: 'label', expr: 'String(value)' } },
      { type: 'return', props: { value: 'label' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      PY_PRELUDE + ['label = _kern_fmt(value)', 'return label'].join('\n'),
    );
  });

  test('nested fn supports legacy params and returns inside body emit', () => {
    const handler = makeHandler([
      {
        type: 'fn',
        props: { name: 'add', params: 'a:number,b:number', returns: 'number' },
        children: [
          { type: 'handler', props: { lang: 'kern' }, children: [{ type: 'return', props: { value: 'a + b' } }] },
        ],
      },
      { type: 'return', props: { value: 'add(2, 3)' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      PY_PRELUDE +
        ['def add(a: float, b: float) -> float:', '    return __kern_add(a, b)', 'return add(2, 3)'].join('\n'),
    );
  });

  test('nested fn supports structured param children', () => {
    const handler = makeHandler([
      {
        type: 'fn',
        props: { name: 'add', returns: 'number' },
        children: [
          { type: 'param', props: { name: 'a', type: 'number' } },
          { type: 'param', props: { name: 'b', type: 'number' } },
          { type: 'handler', props: { lang: 'kern' }, children: [{ type: 'return', props: { value: 'a + b' } }] },
        ],
      },
      { type: 'return', props: { value: 'add(2, 3)' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toContain('def add(a: float, b: float) -> float:');
  });

  test('nested async fn preserves await expressions in body emit', () => {
    const handler = makeHandler([
      {
        type: 'fn',
        props: { name: 'loadTotal', params: 'amount:number', returns: 'number', async: 'true' },
        children: [
          {
            type: 'handler',
            props: { lang: 'kern' },
            children: [
              { type: 'let', props: { name: 'loaded', value: 'await load(amount)' } },
              { type: 'return', props: { value: 'loaded + 5' } },
            ],
          },
        ],
      },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      PY_PRELUDE +
        [
          'async def loadTotal(amount: float) -> float:',
          '    loaded = await load(amount)',
          '    return __kern_add(loaded, 5)',
        ].join('\n'),
    );
  });

  test('String() portable coercion requires exactly one arg', () => {
    expect(() => emitPyExpression(parseExpression('String()'))).toThrow(/expects exactly one argument/);
    expect(() => emitPyExpression(parseExpression('String(a, b)'))).toThrow(/expects exactly one argument/);
  });

  test('standalone String(value) lowering is self-contained', () => {
    expect(emitPyExpression(parseExpression('String(value)'))).toBe(
      "(lambda __k_v: ('true' if __k_v else 'false') if isinstance(__k_v, bool) else 'null' if __k_v is None else str(int(__k_v)) if isinstance(__k_v, float) and __k_v.is_integer() else str(__k_v))(value)",
    );
  });

  test('expression-v1 accepts ExprObject expr props', () => {
    const handler = makeHandler([
      { type: 'expression-v1', props: { name: 'total', expr: { __expr: true, code: 'amount + 1' } } },
      { type: 'return', props: { value: 'total' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      PY_PRELUDE + ['total = __kern_add(amount, 1)', 'return total'].join('\n'),
    );
  });

  test('nested fn rejects mixed legacy and structured params', () => {
    const handler = makeHandler([
      {
        type: 'fn',
        props: { name: 'mixed', params: 'a:number' },
        children: [
          { type: 'param', props: { name: 'b', type: 'number' } },
          { type: 'handler', props: { lang: 'kern' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/cannot mix legacy `params=`/);
  });
});

describe('emitNativeKernBodyPython — slice 1 statements', () => {
  test('let with simple call', () => {
    const h = makeHandler([{ type: 'let', props: { name: 'x', value: 'foo()' } }]);
    expect(emitNativeKernBodyPython(h)).toBe('x = foo()');
  });

  test('multiline block comments lower to valid Python comments', () => {
    const h = makeHandler([{ type: 'comment', props: { raw: '/* first\n * second */' } }]);
    expect(emitNativeKernBodyPython(h)).toBe(['# first', '# second'].join('\n'));
  });

  test('multiline text comments lower every line to a Python comment', () => {
    const h = makeHandler([{ type: 'comment', props: { text: 'first\nsecond' } }]);
    expect(emitNativeKernBodyPython(h)).toBe(['# first', '# second'].join('\n'));
  });

  test('let kind=let lowers to Python assignment', () => {
    const h = makeHandler([{ type: 'let', props: { name: 'x', kind: 'let', value: 'foo()' } }]);
    expect(emitNativeKernBodyPython(h)).toBe('x = foo()');
  });

  test('let kind=let can be reassigned by assign', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'total', kind: 'let', value: '0' } },
      { type: 'assign', props: { target: 'total', op: '+=', value: '1' } },
    ]);
    expect(emitNativeKernBodyPython(h)).toBe(['total = 0', 'total += 1'].join('\n'));
  });

  // KERN-GAPS gap `expr-stmt-mutation` — Python has no postfix `++`/`--`,
  // so `assign op="++"` lowers to the canonical compound assignment
  // (`total += 1`). The TS target keeps emitting `total++;` from the same IR
  // (see native-handlers-source-roundtrip.test.ts); only emit shape differs.
  test('assign op="++" lowers to `target += 1` on Python', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'count', kind: 'let', value: '0' } },
      { type: 'assign', props: { target: 'count', op: '++' } },
      { type: 'assign', props: { target: 'count', op: '--' } },
    ]);
    expect(emitNativeKernBodyPython(h)).toBe(['count = 0', 'count += 1', 'count -= 1'].join('\n'));
  });

  // Opencode impl-review P3 polish: Python member/index access were untested.
  test('assign op="++" with member-access target lowers to `obj.foo += 1` on Python', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'obj', kind: 'let', value: '{ "foo": 0 }' } },
      { type: 'assign', props: { target: 'obj.foo', op: '++' } },
    ]);
    expect(emitNativeKernBodyPython(h)).toBe(['obj = {"foo": 0}', 'obj.foo += 1'].join('\n'));
  });

  test('assign op="++" with index-access target lowers to `arr[i] += 1` on Python', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'arr', kind: 'let', value: '[0]' } },
      { type: 'let', props: { name: 'i', value: '0' } },
      { type: 'assign', props: { target: 'arr[i]', op: '++' } },
    ]);
    expect(emitNativeKernBodyPython(h)).toBe(['arr = [0]', 'i = 0', 'arr[i] += 1'].join('\n'));
  });

  test('assign op="++" with value= is rejected on Python', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'count', kind: 'let', value: '0' } },
      { type: 'assign', props: { target: 'count', op: '++', value: '1' } },
    ]);
    expect(() => emitNativeKernBodyPython(h)).toThrow(/value-less|remove `value=`/);
  });

  // Codex review fix (impl-review): the emitter rejects ANY present `value`
  // — including empty string — for postfix op. Schema mirrors this. Without
  // it, programmatic IR with `value: ''` would slip past codegen silently.
  test('assign op="++" with empty-string value= is rejected on Python', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'count', kind: 'let', value: '0' } },
      { type: 'assign', props: { target: 'count', op: '++', value: '' } },
    ]);
    expect(() => emitNativeKernBodyPython(h)).toThrow(/value-less|remove `value=`/);
  });

  test('assign rejects reassignment of default immutable let binding', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'total', value: '0' } },
      { type: 'assign', props: { target: 'total', value: '1' } },
    ]);
    expect(() => emitNativeKernBodyPython(h)).toThrow(/cannot reassign immutable/);
  });

  test('let kind=let can be reassigned inside a nested block', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'total', kind: 'let', value: '0' } },
      {
        type: 'if',
        props: { cond: 'ready' },
        children: [{ type: 'assign', props: { target: 'total', op: '+=', value: '1' }, children: [] }],
      },
    ]);
    // Slice S4 — `if cond=` wraps the condition in `_kern_truthy(...)` and
    // surfaces the truthiness helper prelude.
    expect(emitNativeKernBodyPython(h)).toBe(
      JS_PRELUDE + ['total = 0', 'if _kern_truthy(ready):', '    total += 1'].join('\n'),
    );
  });

  test('duplicate local let in the same scope is rejected', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'total', kind: 'let', value: '0' } },
      { type: 'let', props: { name: 'total', kind: 'let', value: '1' } },
    ]);
    expect(() => emitNativeKernBodyPython(h)).toThrow(/already declared/);
  });

  test('assign rejects reassignment of loop binding that shadows an outer mutable let', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'item', kind: 'let', value: 'null' } },
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [{ type: 'assign', props: { target: 'item', value: '2' }, children: [] }],
      },
    ]);
    expect(() => emitNativeKernBodyPython(h)).toThrow(/cannot reassign immutable/);
  });

  test('let invalid kind is rejected', () => {
    const h = makeHandler([{ type: 'let', props: { name: 'x', kind: 'var', value: 'foo()' } }]);
    expect(() => emitNativeKernBodyPython(h)).toThrow(/supports only `const` or `let`/);
  });

  test('let with propagation hoists in Python form', () => {
    const h = makeHandler([{ type: 'let', props: { name: 'u', value: 'fetchUser(raw)?' } }]);
    const out = emitNativeKernBodyPython(h);
    expect(out).toContain('__k_t1 = fetchUser(raw)');
    expect(out).toContain("if __k_t1.kind == 'err':");
    expect(out).toContain('    return __k_t1');
    expect(out).toContain('u = __k_t1.value');
  });

  test('let with await + propagation', () => {
    const h = makeHandler([{ type: 'let', props: { name: 'u', value: 'await fetchUser(raw)?' } }]);
    const out = emitNativeKernBodyPython(h);
    expect(out).toContain('__k_t1 = await fetchUser(raw)');
    expect(out).toContain("if __k_t1.kind == 'err':");
    expect(out).toContain('u = __k_t1.value');
  });

  test('return with value', () => {
    const h = makeHandler([{ type: 'return', props: { value: 'Result.ok(u)' } }]);
    expect(emitNativeKernBodyPython(h)).toBe('return Result.ok(u)');
  });

  test('bare return emits `return`', () => {
    const h = makeHandler([{ type: 'return', props: {} }]);
    expect(emitNativeKernBodyPython(h)).toBe('return');
  });

  test('return with propagation hoists', () => {
    const h = makeHandler([{ type: 'return', props: { value: 'fetchUser(raw)?' } }]);
    const out = emitNativeKernBodyPython(h);
    expect(out).toContain('__k_t1 = fetchUser(raw)');
    expect(out).toContain('return __k_t1.value');
  });

  test('per-handler gensym counter', () => {
    const h = makeHandler([
      { type: 'let', props: { name: 'a', value: 'first()?' } },
      { type: 'let', props: { name: 'b', value: 'second()?' } },
    ]);
    const out = emitNativeKernBodyPython(h);
    expect(out).toContain('__k_t1 = first()');
    expect(out).toContain('__k_t2 = second()');
  });

  test('object destructuring lowers to missing-safe dict reads', () => {
    const h = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'const', source: 'body' },
        children: [
          { type: 'binding', props: { name: 'trackId', key: 'track_id' } },
          { type: 'binding', props: { name: 'options' } },
        ],
      },
      { type: 'return', props: { value: 'trackId' } },
    ]);
    // Slice S7 — absent keys default to the undefined sentinel (so `typeof
    // missing` is "undefined"); a present key whose value is the sentinel is
    // preserved by `.get`.
    expect(emitNativeKernBodyPython(h, { symbolMap: { trackId: 'track_id' } })).toBe(
      `${PY_PRELUDE_NULLISH}${[
        '__k_d1 = body',
        'track_id = __k_d1.get("track_id", _KERN_UNDEFINED)',
        'options = __k_d1.get("options", _KERN_UNDEFINED)',
        'return track_id',
      ].join('\n')}`,
    );
  });

  test('empty key is treated like an omitted rename in Python destructuring', () => {
    const h = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'const', source: 'body' },
        children: [{ type: 'binding', props: { name: 'id', key: '' } }],
      },
    ]);
    expect(emitNativeKernBodyPython(h)).toBe(
      `${PY_PRELUDE_NULLISH}${['__k_d1 = body', 'id = __k_d1.get("id", _KERN_UNDEFINED)'].join('\n')}`,
    );
  });

  test('array destructuring lowers to missing-safe index reads', () => {
    const h = makeHandler([
      {
        type: 'destructure',
        props: { kind: 'const', source: 'pair' },
        children: [
          { type: 'element', props: { name: 'first', index: '0' } },
          { type: 'element', props: { name: 'third', index: '2' } },
        ],
      },
    ]);
    // Slice S7 — out-of-range array-destructure elements default to the sentinel.
    expect(emitNativeKernBodyPython(h)).toBe(
      `${PY_PRELUDE_NULLISH}${[
        '__k_d1 = pair',
        'first = (__k_d1[0] if len(__k_d1) > 0 else _KERN_UNDEFINED)',
        'third = (__k_d1[2] if len(__k_d1) > 2 else _KERN_UNDEFINED)',
      ].join('\n')}`,
    );
  });
});

describe('emitNativeKernBodyPython — clamp body statement', () => {
  test('emits named-field clamp as a local binding', () => {
    const handler = makeHandler([
      { type: 'clamp', props: { name: 'bounded', value: 'score', min: '0', max: '100' } },
      { type: 'return', props: { value: 'bounded' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(['bounded = max(0, min(100, score))', 'return bounded'].join('\n'));
  });

  test('rejects propagation in clamp props', () => {
    const handler = makeHandler([
      { type: 'clamp', props: { name: 'bounded', value: 'loadScore()?', min: '0', max: '100' } },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/[Pp]ropagation/);
  });

  test('emits assignment trace hook for clamp binding', () => {
    const handler = makeHandler([{ type: 'clamp', props: { name: 'bounded', value: 'score', min: '0', max: '100' } }]);
    expect(emitNativeKernBodyPython(handler, { traceHooks: { letAssign: true } })).toBe(
      [
        'bounded = max(0, min(100, score))',
        '_kern_trace({"op": "assign", "target": "bounded", "value": bounded})',
      ].join('\n'),
    );
  });

  test('unwraps expression-object clamp props', () => {
    const handler = makeHandler([
      {
        type: 'clamp',
        props: {
          name: 'bounded',
          value: { __expr: true, code: 'score' },
          min: { __expr: true, code: 'limits["min"]' },
          max: { __expr: true, code: 'limits["max"]' },
        },
      },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe('bounded = max(limits["min"], min(limits["max"], score))');
  });
});

describe('emitNativeKernBodyPython — objectMerge body statement', () => {
  test('emits a shallow dict unpack local binding', () => {
    const handler = makeHandler([
      { type: 'objectMerge', props: { name: 'merged', sources: 'base, overrides, { extra: 1, label: "a,b" }' } },
      { type: 'return', props: { value: 'merged' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      ['merged = {**(base), **(overrides), **({"extra": 1, "label": "a,b"})}', 'return merged'].join('\n'),
    );
  });

  test('rejects propagation in objectMerge sources', () => {
    const handler = makeHandler([{ type: 'objectMerge', props: { name: 'merged', sources: 'load()?, overrides' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/[Pp]ropagation/);
  });

  test('emits assignment trace hook for objectMerge binding', () => {
    const handler = makeHandler([{ type: 'objectMerge', props: { name: 'merged', sources: 'base, overrides' } }]);
    expect(emitNativeKernBodyPython(handler, { traceHooks: { letAssign: true } })).toBe(
      ['merged = {**(base), **(overrides)}', '_kern_trace({"op": "assign", "target": "merged", "value": merged})'].join(
        '\n',
      ),
    );
  });

  test('unwraps expression-object objectMerge sources', () => {
    const handler = makeHandler([
      {
        type: 'objectMerge',
        props: { name: 'merged', sources: { __expr: true, code: 'base, overrides' } },
      },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe('merged = {**(base), **(overrides)}');
  });
});

describe('emitNativeKernBodyPython — objectPick/objectOmit body statements', () => {
  test('objectPick emits a shallow own-key dict binding and can return missing keys', () => {
    const handler = makeHandler([
      { type: 'objectPick', props: { name: 'picked', in: 'user', keys: "['id', 'missing']" } },
      { type: 'return', props: { value: 'picked' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      [
        'picked = (lambda __kern_source: {key: (__kern_source[key] if key in __kern_source else None) for key in ["id", "missing"]})(user)',
        'return picked',
      ].join('\n'),
    );
  });

  test('objectOmit emits an immutable shallow dict filter binding', () => {
    const handler = makeHandler([
      { type: 'objectOmit', props: { name: 'safe', in: 'user', keys: "['password']" } },
      { type: 'return', props: { value: 'safe' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      ['safe = {key: value for key, value in user.items() if key not in ["password"]}', 'return safe'].join('\n'),
    );
  });

  test('rejects propagation in objectPick props', () => {
    const handler = makeHandler([{ type: 'objectPick', props: { name: 'picked', in: 'loadUser()?', keys: "['id']" } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/Propagation/);
  });
});

describe('emitNativeKernBodyPython — firstTruthy body statement', () => {
  // Slice S4 — `firstTruthy` selects the first KERN-truthy candidate via a
  // `_kern_truthy`-gated, single-evaluation, lazy walrus chain (so `[]`/`{}`
  // win and NaN is skipped), not bare Python `a or b`. Temps build right-to-left
  // (`__k_ft2` wraps `__k_ft1`); the final candidate is the unguarded fallthrough.
  test('firstTruthy emits a KERN-truthiness-gated ordered fallback binding', () => {
    const handler = makeHandler([
      { type: 'firstTruthy', props: { name: 'label', values: "preferred, nickname, 'Anonymous'" } },
      { type: 'return', props: { value: 'label' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      JS_PRELUDE +
        [
          'label = (__k_ft2 if _kern_truthy(__k_ft2 := preferred) else (__k_ft1 if _kern_truthy(__k_ft1 := nickname) else "Anonymous"))',
          'return label',
        ].join('\n'),
    );
  });

  test('firstTruthy parenthesizes conditional operands before gating fallbacks', () => {
    const handler = makeHandler([
      { type: 'firstTruthy', props: { name: 'label', values: "ready ? preferred : nickname, 'Anonymous'" } },
      { type: 'return', props: { value: 'label' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      JS_PRELUDE +
        [
          'label = (__k_ft1 if _kern_truthy(__k_ft1 := (preferred if _kern_truthy(ready) else nickname)) else "Anonymous")',
          'return label',
        ].join('\n'),
    );
  });

  test('rejects propagation in firstTruthy values', () => {
    const handler = makeHandler([{ type: 'firstTruthy', props: { name: 'label', values: 'load()?, fallback' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/Propagation/);
  });
});

describe('emitNativeKernBodyPython — coalesce / firstDefined body statement', () => {
  test('coalesce emits None-only fallback logic', () => {
    const handler = makeHandler([
      { type: 'coalesce', props: { name: 'winner', values: "count, flag, label, 'fallback'" } },
      { type: 'return', props: { value: 'winner' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      PY_PRELUDE +
        [
          'winner = (count if (count is not None and count is not _KERN_UNDEFINED) else (flag if (flag is not None and flag is not _KERN_UNDEFINED) else (label if (label is not None and label is not _KERN_UNDEFINED) else "fallback")))',
          'return winner',
        ].join('\n'),
    );
  });

  test('firstDefined aliases the same body emitter', () => {
    const handler = makeHandler([
      { type: 'firstDefined', props: { name: 'winner', values: 'primary, secondary' } },
      { type: 'return', props: { value: 'winner' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      PY_PRELUDE +
        [
          'winner = (primary if (primary is not None and primary is not _KERN_UNDEFINED) else secondary)',
          'return winner',
        ].join('\n'),
    );
  });

  test('rejects propagation in coalesce values', () => {
    const handler = makeHandler([{ type: 'coalesce', props: { name: 'winner', values: 'load()?, fallback' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/Propagation/);
  });
});

describe('FastAPI fn handler lang=kern — Python codegen integration', () => {
  test('emits Python body for a native-KERN fn', () => {
    const source = [
      'module name=test',
      'fn name=parseAndEcho params="raw:string" returns=Result async=true',
      '  handler lang=kern',
      '    let name=u value="await fetchUser(raw)?"',
      '    return value="Result.ok(u)"',
    ].join('\n');
    const ir = parseDocument(source);
    const fnNode = ir.children?.find((c) => c.type === 'fn');
    expect(fnNode).toBeDefined();
    if (!fnNode) return;
    const out = generateFunction(fnNode).join('\n');
    expect(out).toContain('async def parse_and_echo(raw: str)');
    expect(out).toContain('__k_t1 = await fetchUser(raw)');
    expect(out).toContain("if __k_t1.kind == 'err':");
    expect(out).toContain('return __k_t1');
    expect(out).toContain('u = __k_t1.value');
    expect(out).toContain('return Result.ok(u)');
  });

  test('legacy raw `<<<…>>>` body still emits Python verbatim', () => {
    const source = [
      'module name=test',
      'fn name=add params="a:number,b:number" returns=number',
      '  handler <<<',
      '    return a + b',
      '  >>>',
    ].join('\n');
    const ir = parseDocument(source);
    const fnNode = ir.children?.find((c) => c.type === 'fn');
    if (!fnNode) return;
    const out = generateFunction(fnNode).join('\n');
    expect(out).toContain('return a + b');
    // Native body emitter must NOT have produced gensym lines.
    expect(out).not.toContain('__k_t1');
  });
});

describe('Cross-target parity — same KERN source emits valid TS and Python', () => {
  test('Result-propagating handler shape parallels in both targets', async () => {
    const { generateCoreNode } = await import('@kernlang/core');
    const source = [
      'module name=test',
      'fn name=parseAndEcho params="raw:string" returns=Result async=true',
      '  handler lang=kern',
      '    let name=u value="await fetchUser(raw)?"',
      '    return value="Result.ok(u)"',
    ].join('\n');
    const ir = parseDocument(source);
    const fnNode = ir.children?.find((c) => c.type === 'fn');
    expect(fnNode).toBeDefined();
    if (!fnNode) return;
    const tsOut = (generateCoreNode as (n: IRNode) => string[])(fnNode).join('\n');
    const pyOut = generateFunction(fnNode).join('\n');

    // Both targets use the same temp name and propagation shape.
    expect(tsOut).toContain('const __k_t1 = await fetchUser(raw);');
    expect(pyOut).toContain('__k_t1 = await fetchUser(raw)');

    // Both early-return on the same discriminant.
    expect(tsOut).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(pyOut).toContain("if __k_t1.kind == 'err':");

    // Both bind .value before continuing.
    expect(tsOut).toContain('const u = __k_t1.value;');
    expect(pyOut).toContain('u = __k_t1.value');

    // Both return the wrapped success value.
    expect(tsOut).toContain('return Result.ok(u);');
    expect(pyOut).toContain('return Result.ok(u)');
  });
});
