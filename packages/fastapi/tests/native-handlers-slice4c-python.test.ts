/** Native KERN handler bodies — slice 4c (try/catch/throw, Python target). */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('slice 4c — Python try/catch/throw', () => {
  test('throw with value', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: 'Exception("oops")' } }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('raise Exception("oops")');
  });

  test('throw with propagation', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: 'call()?' } }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('__k_t1 = call()');
    expect(out).toContain("if __k_t1.kind == 'err':");
    expect(out).toContain('return __k_t1');
    expect(out).toContain('raise __k_t1.value');
  });

  test('try/except block (schema-compliant: catch is child of try)', () => {
    // Slice 5a deferred-fix: schema declares catch as a CHILD of try.
    const handler = makeHandler([
      {
        type: 'try',
        children: [
          { type: 'let', props: { name: 'x', value: '1' } },
          {
            type: 'catch',
            props: { name: 'err' },
            children: [{ type: 'return', props: { value: 'err' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('try:');
    expect(out).toContain('    x = 1');
    expect(out).toContain('except Exception as err:');
    expect(out).toContain('    return err');
  });

  test('empty try/except emits pass', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [{ type: 'catch', props: { name: 'err' }, children: [] }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('try:');
    expect(out).toContain('    pass');
    expect(out).toContain('except Exception as err:');
    expect(out).toContain('    pass');
  });

  test('top-level catch throws (must be inside try)', () => {
    const handler = makeHandler([{ type: 'catch', props: { name: 'err' }, children: [] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/`catch` must be a child of `try`/);
  });
});

// Slice 5a deferred-fix: TS `throw "msg"` lowers to `raise Exception("msg")`
// in Python. `raise` only accepts BaseException subclasses; raising a bare
// string/number/literal would raise TypeError at runtime. Wrap literals in
// Exception(...). Calls / new / member access / identifiers pass through
// unwrapped (could legitimately be Exception subclasses).
describe('slice 4c — Python throw of non-Exception literals wraps in Exception', () => {
  test('throw "msg" → raise Exception("msg")', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: '"oops"' } }]);
    expect(emitNativeKernBodyPython(handler)).toContain('raise Exception("oops")');
  });

  test('throw 42 → raise Exception(42)', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: '42' } }]);
    expect(emitNativeKernBodyPython(handler)).toContain('raise Exception(42)');
  });

  test('throw object literal → raise Exception({...})', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: '{ code: "x" }' } }]);
    // Python emit uses double-quoted keys for object literals.
    expect(emitNativeKernBodyPython(handler)).toContain('raise Exception({"code": "x"})');
  });

  test('throw new Error(...) passes through unwrapped', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: 'new Error("oops")' } }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('raise Error("oops")');
    expect(out).not.toContain('raise Exception(Error');
  });

  test('throw call expression passes through unwrapped', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: 'makeError(code)' } }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('raise makeError(code)');
    expect(out).not.toContain('raise Exception(makeError');
  });

  test('throw identifier (caught exception) passes through unwrapped', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: 'e' } }]);
    expect(emitNativeKernBodyPython(handler)).toContain('raise e');
  });
});
