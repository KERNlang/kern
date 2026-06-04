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
} from '../src/codegen-body-python.js';
import { generateFunction } from '../src/generators/core.js';

function makeHandler(stmts: Array<{ type: string; props: Record<string, unknown>; children?: IRNode[] }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: stmts.map((s) => ({ type: s.type, props: s.props, children: s.children })),
  };
}

describe('emitPyExpression — slice 1 lowering rules', () => {
  test('booleans lower to Python True/False', () => {
    expect(emitPyExpression(parseExpression('true'))).toBe('True');
    expect(emitPyExpression(parseExpression('false'))).toBe('False');
  });

  test('null and `none` both lower to Python None', () => {
    expect(emitPyExpression(parseExpression('null'))).toBe('None');
    expect(emitPyExpression(parseExpression('none'))).toBe('None');
  });

  test('undefined lowers to None (slice 1 simplification)', () => {
    expect(emitPyExpression(parseExpression('undefined'))).toBe('None');
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
    expect(
      emitPyExpression(parseExpression('values.filter((value: unknown): value is string => value !== null)')),
    ).toBe('values.filter(lambda value: value != None)');
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
    expect(result.code).toContain('pattern = __k_re.compile("^ok$", __k_re.IGNORECASE)');
    expect(result.code).toContain('__k_re.search("^ok$", value, __k_re.IGNORECASE) is not None');
    expect(result.code).toContain('not (__k_re.search("^ok$", value, __k_re.IGNORECASE) is not None)');
    expect(result.code).toContain('bound = (__k_re.search("^ok$", value, __k_re.IGNORECASE) is not None)');
    expect(result.code).toContain('__k_re.sub("\\\\s+", " ", value, count=0, flags=0)');
  });

  test('regex lowering rejects JS-only match and flag semantics on Python target', () => {
    expect(() => emitPyExpression(parseExpression('value.match(/x/g)'))).toThrow(/String\.match/);
    expect(() => emitPyExpression(parseExpression('/x/g.test(value)'))).toThrow(/RegExp\.test/);
    expect(() => emitPyExpression(parseExpression('/x/y.test(value)'))).toThrow(/regex flag/);
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
    ).toBe('1 + 2');
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
    expect(emitNativeKernBodyPython(h)).toBe(['total = 0', 'if ready:', '    total += 1'].join('\n'));
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
    expect(emitNativeKernBodyPython(h, { symbolMap: { trackId: 'track_id' } })).toBe(
      ['__k_d1 = body', 'track_id = __k_d1.get("track_id")', 'options = __k_d1.get("options")', 'return track_id'].join(
        '\n',
      ),
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
    expect(emitNativeKernBodyPython(h)).toBe(['__k_d1 = body', 'id = __k_d1.get("id")'].join('\n'));
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
    expect(emitNativeKernBodyPython(h)).toBe(
      [
        '__k_d1 = pair',
        'first = (__k_d1[0] if len(__k_d1) > 0 else None)',
        'third = (__k_d1[2] if len(__k_d1) > 2 else None)',
      ].join('\n'),
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
