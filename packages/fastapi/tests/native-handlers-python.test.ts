/** Native KERN handler bodies — Python target (slice 1).
 *
 *  Mirrors core/tests/native-handlers.test.ts for the FastAPI/Python target.
 *  Verifies emitPyExpression lowering rules (none→None, true→True, etc.) and
 *  the statement-level propagation hoist in Python form. End-to-end test
 *  exercises the full parse → fastapi codegen pipeline on a `lang=kern` fn. */

import type { IRNode } from '@kernlang/core';
import { parseDocument, parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPython, emitPyExpression } from '../src/codegen-body-python.js';
import { generateFunction } from '../src/generators/core.js';

function makeHandler(stmts: Array<{ type: 'let' | 'return'; props: Record<string, unknown> }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: stmts.map((s) => ({ type: s.type, props: s.props })),
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

  test('strLit emits with double-quoted Python string', () => {
    expect(emitPyExpression(parseExpression('"hello"'))).toBe('"hello"');
  });

  test('propagate at expression level throws — must hoist at statement level', () => {
    expect(() => emitPyExpression(parseExpression('foo()?'))).toThrow(/statement-level only/);
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
