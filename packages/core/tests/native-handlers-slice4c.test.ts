/** Native KERN handler bodies — slice 4c (try/catch/throw, TS target). */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('slice 4c — TS try/catch/throw', () => {
  test('throw with value', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: 'new Error("oops")' } }]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('throw new Error("oops");');
  });

  test('throw with propagation', () => {
    const handler = makeHandler([{ type: 'throw', props: { value: 'call()?' } }]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = call();');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('throw __k_t1.value;');
  });

  test('try/catch block (schema-compliant: catch is child of try)', () => {
    // Slice 5a deferred-fix: schema declares catch as a CHILD of try.
    // Body-emit was updated to match — sibling-shape now rejected.
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
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('try {');
    expect(out).toContain('  const x = 1;');
    expect(out).toContain('} catch (err) {');
    expect(out).toContain('  return err;');
    expect(out).toContain('}');
  });

  test('top-level catch throws (must be inside try)', () => {
    const handler = makeHandler([{ type: 'catch', props: { name: 'err' }, children: [] }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/`catch` must be a child of `try`/);
  });
});
