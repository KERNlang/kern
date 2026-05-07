/** Native KERN handler bodies — while body-statement (Python target). */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('body-statement while — Python target', () => {
  test('emits while loop with nested body statements', () => {
    const handler = makeHandler([
      {
        type: 'while',
        props: { cond: 'queue.length > 0' },
        children: [
          { type: 'let', props: { name: 'item', value: 'queue.pop()' } },
          { type: 'do', props: { value: 'process(item)' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('while queue.length > 0:');
    expect(out).toContain('    item = queue.pop()');
    expect(out).toContain('    process(item)');
  });

  test('empty while body emits pass', () => {
    const handler = makeHandler([{ type: 'while', props: { cond: 'running' }, children: [] }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('while running:');
    expect(out).toContain('    pass');
  });

  test('rejects propagation in condition', () => {
    const handler = makeHandler([{ type: 'while', props: { cond: 'load()?' }, children: [] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/Propagation '\?' is not allowed in `while cond=`/);
  });
});
