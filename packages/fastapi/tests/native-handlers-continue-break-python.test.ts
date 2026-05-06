/** Native KERN handler bodies — continue / break body-statements (Python target).
 *  Mirror of the TS-target test in `core/tests/native-handlers-continue-break.test.ts`. */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('continue / break body-statements — Python target', () => {
  test('bare continue inside each emits `continue`', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [
          {
            type: 'if',
            props: { cond: 'item.skip' },
            children: [{ type: 'continue', props: {} }],
          },
          { type: 'do', props: { value: 'process(item)' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for __k_each_1 in items:');
    expect(out).toContain('item = __k_each_1');
    expect(out).toContain('if item.skip:');
    expect(out).toContain('continue');
    expect(out).toContain('process(item)');
  });

  test('bare break inside each emits `break`', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [
          {
            type: 'if',
            props: { cond: 'item.matches' },
            children: [
              { type: 'let', props: { name: 'found', value: 'item' } },
              { type: 'break', props: {} },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for __k_each_1 in items:');
    expect(out).toContain('item = __k_each_1');
    expect(out).toContain('if item.matches:');
    expect(out).toContain('found = item');
    expect(out).toContain('break');
  });
});
