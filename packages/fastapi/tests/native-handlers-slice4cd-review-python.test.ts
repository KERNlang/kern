/** Native KERN handler bodies — slice 4c+4d review fixes (Python target).
 *
 *  Mirror of native-handlers-slice4cd-review.test.ts for FastAPI/Python.
 *  Same two review-fix concerns:
 *
 *    CRITICAL — Propagation `?` inside `try` lowers to `return tmp` (or
 *    `raise HTTPException` in route mode); BOTH interact badly with the
 *    enclosing `except` clause:
 *      - `return` exits the function, bypassing the except — same bug as
 *        the TS side, but in Python the user might also expect the
 *        except to fire on `return`-via-err-propagation.
 *      - `raise HTTPException` IS caught by the bare `except Exception`
 *        we generate, silently swallowing the err — different surprise,
 *        same root cause.
 *    Reject at codegen with a let-bind hint.
 *
 *    HIGH — Orphan `try` is a Python SyntaxError (`try:` without
 *    `except:` is invalid). Same fail-loud-at-codegen rule as TS.
 */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('slice 4c+4d review fix — orphan `try` rejection (Python)', () => {
  // Slice 5a deferred-fix: orphan = `try` without a `catch` CHILD.
  test('try without catch child throws with structural error', () => {
    const handler = makeHandler([{ type: 'try', props: {}, children: [{ type: 'return', props: { value: '1' } }] }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/orphan `try`/);
  });

  test('try with non-catch children only also throws', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'return', props: { value: '1' } },
          { type: 'let', props: { name: 'x', value: '2' } },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/orphan `try`/);
  });
});

describe('slice 4c+4d review fix — `?` propagation inside `try` rejection (Python)', () => {
  // Slice 5a deferred-fix: catch is a CHILD of try (schema-compliant).
  test('`let x = call()?` inside try throws with let-bind hint', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'let', props: { name: 'x', value: 'call()?' } },
          { type: 'catch', props: { name: 'e' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
  });

  test('`return call()?` inside try also throws', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'return', props: { value: 'call()?' } },
          { type: 'catch', props: { name: 'e' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
  });

  test('`throw call()?` inside try also throws', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'throw', props: { value: 'call()?' } },
          { type: 'catch', props: { name: 'e' }, children: [] },
        ],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
  });

  test('top-level `?` propagation still works as before', () => {
    const handler = makeHandler([{ type: 'return', props: { value: 'call()?' } }]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('__k_t1 = call()');
    expect(out).toContain("if __k_t1.kind == 'err':");
    expect(out).toContain('return __k_t1');
    expect(out).toContain('return __k_t1.value');
  });

  test('`?` after a try sibling re-enables (depth-scoped, not lexical)', () => {
    const handler = makeHandler([
      {
        type: 'try',
        props: {},
        children: [
          { type: 'return', props: { value: '1' } },
          { type: 'catch', props: { name: 'e' }, children: [{ type: 'return', props: { value: '2' } }] },
        ],
      },
      { type: 'return', props: { value: 'call()?' } },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('__k_t1 = call()');
  });
});
