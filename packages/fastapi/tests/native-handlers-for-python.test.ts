/** Native KERN handler bodies — for body-statement (Python target). */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('body-statement for — Python target', () => {
  test('emits range loop with cross-target List.length bound', () => {
    const handler = makeHandler([
      {
        type: 'for',
        props: { name: 'i', from: '0', to: 'List.length(items)' },
        children: [{ type: 'do', props: { value: 'visit(items[i])' } }],
      },
    ]);

    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('__k_for_missing_1 = object()');
    expect(out).toContain('__k_for_prev_1 = locals().get("i", __k_for_missing_1)');
    expect(out).toContain('for i in range(0, len(items)):');
    expect(out).toContain('finally:');
    expect(out).toContain('del i');
    expect(out).toContain('    visit(items[i])');
  });

  test('emits explicit positive step', () => {
    const handler = makeHandler([
      {
        type: 'for',
        props: { name: 'i', from: '1', to: '10', step: '2' },
        children: [{ type: 'do', props: { value: 'visit(i)' } }],
      },
    ]);

    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for i in range(1, 10, 2):');
  });

  test('empty for body emits pass', () => {
    const handler = makeHandler([{ type: 'for', props: { name: 'i', from: '0', to: '10' }, children: [] }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for i in range(0, 10):');
    expect(out).toContain('    pass');
  });

  test.each([
    '0',
    '-1',
    '0.5',
    '1.0',
    'someStep',
  ])('rejects non-positive, non-integer, or non-literal step %s', (step) => {
    const handler = makeHandler([{ type: 'for', props: { name: 'i', from: '0', to: '10', step }, children: [] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/for step=.*positive integer literal/);
  });

  test('rejects non-cross-target loop identifier', () => {
    const handler = makeHandler([{ type: 'for', props: { name: 'bad-name', from: '0', to: '10' }, children: [] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/for name=.*cross-target identifier/);
  });

  test('rejects fractional literal bounds', () => {
    const handler = makeHandler([{ type: 'for', props: { name: 'i', from: '0', to: '3.7' }, children: [] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/for to=.*integer expression/);
  });

  test('rejects propagation in range props', () => {
    const handler = makeHandler([{ type: 'for', props: { name: 'i', from: 'load()?', to: '10' }, children: [] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/Propagation '\?' is not allowed in `for from=`/);
  });
});
