/** Native KERN handler bodies — inline trailing comments (TS target, W1).
 *  The migrator captures a same-line `stmt; // note` into a `trailingComment=`
 *  prop on the simple body-stmt; the emitter re-attaches it inline so the
 *  migration round-trips byte-clean under `--verify` instead of dropping the
 *  comment onto its own line. Mirror Python test:
 *  `python/tests/native-handlers-trailing-comment-python.test.ts`. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('inline trailing comments — TS target', () => {
  test('return carries its trailing comment inline', () => {
    const out = emitNativeKernBodyTS(
      makeHandler([{ type: 'return', props: { value: 'total', trailingComment: '// done' } }]),
    );
    expect(out).toBe('return total; // done');
  });

  test('let / assign / do each carry their trailing comment', () => {
    const out = emitNativeKernBodyTS(
      makeHandler([
        { type: 'let', props: { name: 'total', kind: 'let', value: '0', trailingComment: '// running sum' } },
        { type: 'assign', props: { target: 'total', op: '+=', value: '5', trailingComment: '// add five' } },
        { type: 'do', props: { value: 'flush()', trailingComment: '// side effect' } },
      ]),
    );
    expect(out).toContain('let total = 0; // running sum');
    expect(out).toContain('total += 5; // add five');
    expect(out).toContain('flush(); // side effect');
  });

  test('block-form trailing comment is preserved verbatim', () => {
    const out = emitNativeKernBodyTS(
      makeHandler([{ type: 'return', props: { value: 'total', trailingComment: '/* done */' } }]),
    );
    expect(out).toBe('return total; /* done */');
  });

  test('continue / break carry their trailing comment inside a loop', () => {
    const out = emitNativeKernBodyTS(
      makeHandler([
        {
          type: 'each',
          props: { name: 'x', in: 'xs' },
          children: [
            { type: 'continue', props: { trailingComment: '// skip' } },
            { type: 'break', props: { trailingComment: '// stop' } },
          ],
        },
      ]),
    );
    expect(out).toContain('continue; // skip');
    expect(out).toContain('break; // stop');
  });

  test('a compound `if` never receives a trailing comment (simple stmts only)', () => {
    const out = emitNativeKernBodyTS(
      makeHandler([
        {
          type: 'if',
          props: { cond: 'a', trailingComment: '// nope' },
          children: [{ type: 'return', props: { value: '1' } }],
        },
      ]),
    );
    // The closing `}` line must not get a comment appended.
    expect(out).not.toContain('// nope');
  });

  test('no trailing comment prop leaves the statement unchanged', () => {
    const out = emitNativeKernBodyTS(makeHandler([{ type: 'return', props: { value: 'total' } }]));
    expect(out).toBe('return total;');
  });
});
