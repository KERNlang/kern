/** Native KERN handler bodies — slice α-1 Python parity for `do` body-statement.
 *
 *  Mirrors core/tests/native-handlers-slice-alpha1-do.test.ts on the
 *  FastAPI/Python target. Bare-call ExpressionStatement → `do value="…"` →
 *  Python emits the bare expression line (no statement separator). */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: Array<{ type: string; props?: Record<string, unknown> }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: children.map((c) => ({ ...c, props: c.props ?? {} })),
  };
}

describe('do body-statement — Python codegen', () => {
  test('lowers to bare expression line', () => {
    const handler = makeHandler([{ type: 'do', props: { value: 'reg.load(engDir)' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('reg.load(engDir)');
  });

  test('empty value emits nothing', () => {
    const handler = makeHandler([{ type: 'do', props: {} }]);
    expect(emitNativeKernBodyPython(handler)).toBe('');
  });

  test('composes with let + return', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'reg', value: 'EngineRegistry()' } },
      { type: 'do', props: { value: 'reg.load(engDir)' } },
      { type: 'return', props: { value: 'reg' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      ['reg = EngineRegistry()', 'reg.load(engDir)', 'return reg'].join('\n'),
    );
  });

  test('await inside `do` lowers to bare `await expr` line', () => {
    const handler = makeHandler([{ type: 'do', props: { value: 'await cleanup()' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('await cleanup()');
  });

  test('propagation `?` discards the value, preserves err-branch', () => {
    const handler = makeHandler([{ type: 'do', props: { value: 'mayFail()?' } }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('__k_t1 = mayFail()');
    expect(out).toContain("if __k_t1.kind == 'err':");
    // No value-bind line — distinguishes `do` from `let`/`return`.
    expect(out).not.toMatch(/^\w+\s+=\s+__k_t1\.value/m);
  });
});
