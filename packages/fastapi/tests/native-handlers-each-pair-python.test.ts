/** Native KERN handler bodies — `each` pair-mode (Python target).
 *
 *  TS-side `for (const [k, v] of m)` lowers to Python `for k, v in m.items():`
 *  for the canonical dict iteration shape. PEP-249 / collections.abc.Mapping
 *  subclasses typically expose `.items()`; iterables of 2-tuples should be
 *  passed through `.items()` upstream OR call sites should use the regular
 *  `each name=x in=pairs` form. */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('each pair-mode — Python target', () => {
  test('pairKey + pairValue emits dict.items() iteration', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
        children: [{ type: 'do', props: { value: 'log(k, v)' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for k, v in cache.items():');
    expect(out).toContain('log(k, v)');
  });

  test('plain `name=` regression — still emits gensym + alias form', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [{ type: 'do', props: { value: 'process(item)' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for __k_each_1 in items:');
    expect(out).toContain('item = __k_each_1');
  });

  test('pair-mode composes with continue inside the body', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
        children: [
          {
            type: 'if',
            props: { cond: 'v.expired' },
            children: [{ type: 'continue', props: {} }],
          },
          { type: 'do', props: { value: 'use(k, v)' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for k, v in cache.items():');
    expect(out).toContain('  if v.expired:');
    expect(out).toContain('    continue');
    expect(out).toContain('  use(k, v)');
  });
});
