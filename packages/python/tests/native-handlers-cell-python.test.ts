/** Native KERN handler bodies — `cell` body-statement, Python target (slice C-cell-v3).
 *
 *  Python+FastAPI lowering for `cell` is plain mutable assignment — FastAPI
 *  request handlers don't need reactivity (each request resets state), so a
 *  cell is indistinguishable from `let kind=let` at runtime on this target.
 *  The distinction is semantic intent: cell signals "this is reactive state
 *  on targets that support it (React)", lets future Python targets (Plotly
 *  Dash, Streamlit) specialize the lowering without breaking author code. */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';
import { KERN_FMT_HELPER_PY } from '../src/core/expr/helpers.js';

function makeHandler(children: Array<{ type: string; props?: Record<string, unknown> }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: children.map((c) => ({ ...c, props: c.props ?? {} })),
  };
}

// JS value→string coercion runtime prelude (sentinel + _kern_fmt + __kern_add),
// prepended whenever a body lowers a `+` to __kern_add (string-coercion guard).
const PY_PRELUDE = `${KERN_FMT_HELPER_PY}\n\n`;

describe('cell body-statement — Python codegen', () => {
  test('lowers to plain assignment', () => {
    const handler = makeHandler([{ type: 'cell', props: { name: 'count', initial: '0' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('count = 0');
  });

  test('lowers without initial to `= None`', () => {
    const handler = makeHandler([{ type: 'cell', props: { name: 'value' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('value = None');
  });

  test('multi-character cell name preserved verbatim', () => {
    const handler = makeHandler([{ type: 'cell', props: { name: 'isLoading', initial: 'False' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('isLoading = False');
  });

  test('set node lowers to plain reassignment', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'set', props: { name: 'count', to: 'count + 1' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      PY_PRELUDE + ['count = 0', 'count = __kern_add(count, 1)'].join('\n'),
    );
  });

  test('throws on missing name', () => {
    const handler = makeHandler([{ type: 'cell', props: { initial: '0' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/name/);
  });

  test('throws on `set` with missing `to`', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'set', props: { name: 'count' } },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/to=/);
  });

  test('throws on propagation `?` inside set', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'set', props: { name: 'count', to: 'load()?' } },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/[Pp]ropagation/);
  });

  test('composes with let + return', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'let', props: { name: 'doubled', value: 'count * 2' } },
      { type: 'return', props: { value: 'doubled' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(['count = 0', 'doubled = count * 2', 'return doubled'].join('\n'));
  });

  test('symbolMap rewrites cell name for python idiom', () => {
    const handler = makeHandler([{ type: 'cell', props: { name: 'isLoading', initial: 'False' } }]);
    expect(emitNativeKernBodyPython(handler, { symbolMap: { isLoading: 'is_loading' } })).toBe('is_loading = False');
  });
});
