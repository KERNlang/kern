/** Native KERN handler bodies — slice 4c+4d review fixes (TS target).
 *
 *  OpenCode + Gemini both flagged two real bugs in the slice 4c+4d ship:
 *
 *    CRITICAL — Propagation `?` inside a `try` block hoists to a `return`
 *    that exits the whole function, BYPASSING the enclosing `catch`. Users
 *    who write `?` inside try almost certainly want the err to be caught,
 *    not silently bubbled up past the catch. Reject at codegen with a
 *    let-bind hint.
 *
 *    HIGH — Orphan `try` (no `catch` sibling) emits `try { ... }` on TS
 *    (legal but useless) and a Python SyntaxError. Same pattern as the
 *    slice-2 orphan-`else` rule: fail loud at codegen.
 */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('slice 4c+4d review fix — orphan `try` rejection (TS)', () => {
  // Slice 5a deferred-fix: orphan = `try` without a `catch` CHILD (schema
  // shape). The previous "missing catch sibling" check is replaced with
  // "missing catch child"; the error message uses the same wording.
  test('try without catch child throws with structural error', () => {
    const handler = makeHandler([{ type: 'try', props: {}, children: [{ type: 'return', props: { value: '1' } }] }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/orphan `try`/);
  });

  test('try with non-catch children (no catch present) also throws', () => {
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
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/orphan `try`/);
  });
});

describe('slice 4c+4d review fix — `?` propagation inside `try` rejection (TS)', () => {
  // Slice 5a deferred-fix: catch is a CHILD of try (schema-compliant
  // shape). Tests updated to mirror.
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
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
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
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
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
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/'\?' is not allowed inside a `try` block/);
  });

  test('top-level (outside try) `?` propagation still works as before', () => {
    // Sanity: the new restriction is scoped to inside-try only. Outside
    // try, the existing slice-1 propagation hoist semantics still apply.
    const handler = makeHandler([{ type: 'return', props: { value: 'call()?' } }]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = call();');
    expect(out).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(out).toContain('return __k_t1.value;');
  });

  test('`?` after a try (next sibling, not nested) still works', () => {
    // The restriction is depth-scoped, not lexical-position-scoped: once
    // we exit the try block, ctx.tryDepth decrements back to 0 and
    // propagation re-enables for subsequent statements.
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
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_t1 = call();');
  });
});
