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

  test('try/except block', () => {
    const handler = makeHandler([
      {
        type: 'try',
        children: [{ type: 'let', props: { name: 'x', value: '1' } }],
      },
      {
        type: 'catch',
        props: { name: 'err' },
        children: [{ type: 'return', props: { value: 'err' } }],
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
      { type: 'try', children: [] },
      { type: 'catch', props: { name: 'err' }, children: [] },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('try:');
    expect(out).toContain('    pass');
    expect(out).toContain('except Exception as err:');
    expect(out).toContain('    pass');
  });

  test('orphan catch throws', () => {
    const handler = makeHandler([{ type: 'catch', props: { name: 'err' }, children: [] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/orphan `catch`/);
  });
});
