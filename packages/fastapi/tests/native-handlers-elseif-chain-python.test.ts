/** Native KERN handler bodies — Python `elif` chain emission.
 *
 *  Mirror of the TS-side else-if chain test. The Python emitter recognises
 *  the same chainable shapes (else > if [+ inner else]) and emits `elif`
 *  instead of nesting. This keeps slice 5b's migrated output byte-equivalent
 *  to the raw `elif`-chain Python (when KERN compiles to FastAPI/Python).
 */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('emitNativeKernBodyPython — elif chain collapse', () => {
  test('else > if collapses to `elif` (no terminal else)', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a' },
        children: [{ type: 'return', props: { value: '1' } }],
      },
      {
        type: 'else',
        props: {},
        children: [
          {
            type: 'if',
            props: { cond: 'b' },
            children: [{ type: 'return', props: { value: '2' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('if a:');
    expect(out).toContain('elif b:');
    expect(out).not.toContain('else:\n  if');
    expect(out).not.toContain('else:\n    if');
  });

  test('three-level chain emits if / elif / elif / else', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a' },
        children: [{ type: 'return', props: { value: '1' } }],
      },
      {
        type: 'else',
        props: {},
        children: [
          {
            type: 'if',
            props: { cond: 'b' },
            children: [{ type: 'return', props: { value: '2' } }],
          },
          {
            type: 'else',
            props: {},
            children: [
              {
                type: 'if',
                props: { cond: 'c' },
                children: [{ type: 'return', props: { value: '3' } }],
              },
              {
                type: 'else',
                props: {},
                children: [{ type: 'return', props: { value: '4' } }],
              },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('if a:');
    expect(out).toContain('elif b:');
    expect(out).toContain('elif c:');
    expect(out).toContain('else:');
    expect(out).toContain('return 4');
  });

  test('non-chainable else (multiple children) emits plain `else:`', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a' },
        children: [{ type: 'return', props: { value: '1' } }],
      },
      {
        type: 'else',
        props: {},
        children: [
          { type: 'let', props: { name: 'x', value: '2' } },
          { type: 'return', props: { value: 'x' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('else:');
    expect(out).not.toContain('elif');
  });
});
