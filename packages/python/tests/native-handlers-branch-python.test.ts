/** Native KERN handler bodies — body-statement `branch` (Python target).
 *
 *  Python has no `switch`. We lower body-statement `branch` to an
 *  `if/elif/else` chain over a gensymmed subject variable so the `on=`
 *  expression isn't double-evaluated across cases. PEP-634 `match` is
 *  deferred. Mirror of `packages/core/tests/native-handlers-branch.test.ts`. */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('body-statement branch — Python target', () => {
  test('branch with quoted-string paths emits if/elif chain', () => {
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'route', on: 'kind' },
        children: [
          {
            type: 'path',
            props: { value: 'paid' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'mark_paid()' } }],
          },
          {
            type: 'path',
            props: { value: 'pending' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'mark_pending()' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('__k_branch_1 = kind');
    expect(out).toContain('if __k_branch_1 == "paid":');
    expect(out).toContain('elif __k_branch_1 == "pending":');
    expect(out).toContain('mark_paid()');
    expect(out).toContain('mark_pending()');
  });

  test('branch with identifier path values emits unquoted comparison', () => {
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'route', on: 'status' },
        children: [
          {
            type: 'path',
            props: { value: 'PaymentStatus.Paid' },
            children: [{ type: 'do', props: { value: 'log("paid")' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('if __k_branch_1 == PaymentStatus.Paid:');
    expect(out).not.toContain('"PaymentStatus.Paid"');
  });

  test('branch with default path emits trailing else: clause', () => {
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'route', on: 'kind' },
        children: [
          {
            type: 'path',
            props: { value: 'paid' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'mark_paid()' } }],
          },
          {
            type: 'path',
            props: { default: true },
            children: [{ type: 'do', props: { value: 'log("unknown")' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('if __k_branch_1 == "paid":');
    expect(out).toContain('else:');
    expect(out).toContain('log("unknown")');
  });

  test('subject expression is gensymmed so call() is not re-evaluated per case', () => {
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'route', on: 'compute_kind()' },
        children: [
          {
            type: 'path',
            props: { value: 'a' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'log("a")' } }],
          },
          {
            type: 'path',
            props: { value: 'b' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'log("b")' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    // Subject is bound once; comparisons reference the gensym, not compute_kind().
    const subjectAssignments = (out.match(/__k_branch_\d+ = compute_kind\(\)/g) ?? []).length;
    expect(subjectAssignments).toBe(1);
    const callsInComparisons = (out.match(/== compute_kind\(\)/g) ?? []).length;
    expect(callsInComparisons).toBe(0);
  });

  test('branch indents under nested each (continue still works)', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [
          {
            type: 'branch',
            props: { name: 'r', on: 'item.kind' },
            children: [
              {
                type: 'path',
                props: { value: 'a' },
                __quotedProps: ['value'],
                children: [{ type: 'continue', props: {} }],
              },
              {
                type: 'path',
                props: { default: true },
                children: [{ type: 'do', props: { value: 'process(item)' } }],
              },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for __k_each_1 in items:');
    expect(out).toContain('  __k_branch_2 = item.kind');
    expect(out).toContain('  if __k_branch_2 == "a":');
    expect(out).toContain('    continue');
    expect(out).toContain('  else:');
    expect(out).toContain('    process(item)');
  });

  test('branch with only a default path (no value paths) emits the body unconditionally', () => {
    // No leading `if`/`elif` to attach `else:` to → emit body at branch
    // indent without an else: header (avoids Python SyntaxError).
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'r', on: 'x' },
        children: [
          {
            type: 'path',
            props: { default: true },
            children: [{ type: 'do', props: { value: 'fallback()' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('__k_branch_1 = x');
    expect(out).toContain('fallback()');
    // No orphan `else:` line.
    expect(out.split('\n').some((l) => l.trim() === 'else:')).toBe(false);
  });
});
