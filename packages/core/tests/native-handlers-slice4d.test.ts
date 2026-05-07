/** Native KERN handler bodies — slice 4d (each/spread, TS target). */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('slice 4d — TS each/spread', () => {
  test('each loop', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { list: 'items', as: 'x' },
        children: [{ type: 'let', props: { name: 'y', value: 'x * 2' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const x of items) {');
    expect(out).toContain('  const y = x * 2;');
    expect(out).toContain('}');
  });

  test('async each loop', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { in: 'stream', name: 'chunk', await: true },
        children: [{ type: 'do', props: { value: 'sink(chunk)' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for await (const chunk of stream) {');
    expect(out).toContain('  sink(chunk);');
  });

  test('async each rejects index mode', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { in: 'stream', name: 'chunk', index: 'i', await: true },
        children: [{ type: 'do', props: { value: 'sink(chunk)' } }],
      },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/cannot be combined with `index=`/);
  });

  test('array spread', () => {
    expect(emitExpression(parseExpression('[...a, b]'))).toBe('[...a, b]');
  });

  test('object spread', () => {
    expect(emitExpression(parseExpression('{ ...a, b: 1 }'))).toBe('{ ...a, b: 1 }');
  });

  test('call spread', () => {
    expect(emitExpression(parseExpression('f(...args)'))).toBe('f(...args)');
  });
});
