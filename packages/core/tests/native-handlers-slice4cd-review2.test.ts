/** Native KERN handler bodies — slice 4c+4d review fixes (Codex round).
 *
 *  Codex caught three findings OpenCode + Gemini missed:
 *
 *    P2 — Parser regressed `obj.new` and `{ new: 1 }` because slice 4c+4d
 *    promoted `new` to a global keyword token. `new` is a prefix-position-
 *    only operator; in member-access and object-key contexts it must
 *    stay a regular identifier. Fix: remove `new` from KEYWORDS map;
 *    special-case in parseUnary by checking the ident's value.
 *
 *    P1 — `each` body-emit read non-schema props `list`/`as`. Schema
 *    declares `name` and `in` (top-level data-binding convention).
 *    Schema-validated source `each name=x in=items` fell back to the
 *    `[]`/`item` defaults — silently emitted `for (const item of [])`.
 *    Fix: read `in` and `name` first; accept `list`/`as` as legacy
 *    fallback for tests pre-dating this fix.
 *
 *    P2-orphan-try — Already fixed in slice4cd-review.test.ts.
 *
 *    P2-try/catch-shape — Schema reserves `catch` as a CHILD of `try`
 *    (per schema.ts:535 `allowedChildren: ['step', 'handler', 'catch']`),
 *    body-emit currently expects sibling `catch`. The mismatch is
 *    LATENT — schema-validated source can't reach body-emit with
 *    body-statement try yet (validator rejects sibling shape). Defer
 *    rework to slice 5; documented in spec.
 */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('slice 4c+4d review fix (Codex P2) — `new` keyword regression', () => {
  test('`obj.new` parses as member access (was broken in slice 4c+4d ship)', () => {
    const ir = parseExpression('obj.new');
    expect(ir).toEqual({ kind: 'member', object: { kind: 'ident', name: 'obj' }, property: 'new', optional: false });
  });

  test('`{ new: 1 }` parses as object literal with `new` as key (regression fix)', () => {
    const ir = parseExpression('{ new: 1 }');
    expect(ir.kind).toBe('objectLit');
    if (ir.kind === 'objectLit') {
      expect(ir.entries).toEqual([{ key: 'new', value: { kind: 'numLit', value: 1, raw: '1' } }]);
    }
  });

  test('`new Error("oops")` still parses as new-expression (no regression on prefix use)', () => {
    const ir = parseExpression('new Error("oops")');
    expect(ir.kind).toBe('new');
    if (ir.kind === 'new') {
      expect(ir.argument.kind).toBe('call');
    }
  });

  test('`obj.new()` (call on a property named `new`) parses correctly', () => {
    // Member access first (`obj.new`) then call — NOT a new-expression.
    const ir = parseExpression('obj.new()');
    expect(ir.kind).toBe('call');
    if (ir.kind === 'call') {
      expect(ir.callee.kind).toBe('member');
    }
  });
});

describe('slice 4c+4d review fix (Codex P1) — `each` schema-compliant props', () => {
  test('`each name=item in=items` (schema-compliant) emits correct loop', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [{ type: 'return', props: { value: 'item' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const item of items) {');
    expect(out).toContain('return item;');
  });

  test('`each list=items as=item` (legacy) still works via fallback', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { list: 'items', as: 'item' },
        children: [{ type: 'return', props: { value: 'item' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const item of items) {');
    expect(out).toContain('return item;');
  });

  test('schema-compliant props win over legacy when both present', () => {
    // If a parallel-edit author specifies both, the schema-compliant
    // names take precedence (in/name beat list/as).
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'fromSchema', in: 'schemaItems', list: 'legacyItems', as: 'fromLegacy' },
        children: [{ type: 'return', props: { value: 'fromSchema' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const fromSchema of schemaItems) {');
  });
});
