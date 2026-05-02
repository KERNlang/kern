/** Native KERN handler bodies — slice 4d (each/spread, Python target). */

import type { IRNode } from '@kernlang/core';
import { parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPython, emitPyExpression } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('slice 4d — Python each/spread', () => {
  test('each loop (gensym iter var aliased to user name — slice 5a deferred-fix)', () => {
    // Python lacks block scope; to avoid clobbering an outer `x` and to
    // make multi-each-with-same-as= predictable, the iteration var is
    // gensym'd and aliased into the user-friendly name on each iteration.
    const handler = makeHandler([
      {
        type: 'each',
        props: { list: 'items', as: 'x' },
        children: [{ type: 'let', props: { name: 'y', value: 'x * 2' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for __k_each_1 in items:');
    expect(out).toContain('    x = __k_each_1');
    expect(out).toContain('    y = x * 2');
  });

  test('array spread', () => {
    expect(emitPyExpression(parseExpression('[...a, b]'))).toBe('[*a, b]');
  });

  test('object spread', () => {
    expect(emitPyExpression(parseExpression('{ ...a, b: 1 }'))).toBe('{**a, "b": 1}');
  });

  test('call spread', () => {
    expect(emitPyExpression(parseExpression('f(...args)'))).toBe('f(*args)');
  });
});
