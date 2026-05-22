/** Native KERN handler bodies — inline trailing comments (Python target, W1).
 *  Mirror of the TS-target test in
 *  `core/tests/native-handlers-trailing-comment.test.ts`. The captured TS-form
 *  comment (`// note` / block comment) converts to an idiomatic Python inline
 *  `# note` (PEP 8 two-space gutter). The Python leg is not byte-checked by
 *  `--verify` (TS leg only) — this guards the cross-target parity invariant. */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('inline trailing comments — Python target', () => {
  test('return carries its trailing comment as a Python `#` comment', () => {
    const out = emitNativeKernBodyPython(
      makeHandler([{ type: 'return', props: { value: 'total', trailingComment: '// done' } }]),
    );
    expect(out).toBe('return total  # done');
  });

  test('block-form `/* done */` converts to `# done`', () => {
    const out = emitNativeKernBodyPython(
      makeHandler([{ type: 'return', props: { value: 'total', trailingComment: '/* done */' } }]),
    );
    expect(out).toBe('return total  # done');
  });

  test('let / assign carry the converted comment', () => {
    const out = emitNativeKernBodyPython(
      makeHandler([
        { type: 'let', props: { name: 'total', kind: 'let', value: '0', trailingComment: '// running sum' } },
        { type: 'assign', props: { target: 'total', op: '+=', value: '5', trailingComment: '// add five' } },
      ]),
    );
    expect(out).toContain('total = 0  # running sum');
    expect(out).toContain('total += 5  # add five');
  });

  test('no trailing comment prop leaves the statement unchanged', () => {
    const out = emitNativeKernBodyPython(makeHandler([{ type: 'return', props: { value: 'total' } }]));
    expect(out).toBe('return total');
  });
});
