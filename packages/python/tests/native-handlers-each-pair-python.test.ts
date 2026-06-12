/** Native KERN handler bodies — `each` pair-mode (Python target).
 *
 *  TS-side `for (const [k, v] of m)` lowers to Python
 *  `for k, v in _kern_pairs(m):` — `_kern_pairs` is a runtime helper that
 *  yields `m.items()` for Mapping inputs (the canonical dict shape) and
 *  `iter(m)` otherwise (so iterables of 2-tuples destructure cleanly,
 *  matching JS array-of-pairs semantics). The helper definition is
 *  co-emitted at module scope by the FastAPI generator (and inlined by
 *  the legacy `emitNativeKernBodyPython` string-only API). PR-4. */

import { type IRNode, parseDocumentStrict } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('each pair-mode — Python target', () => {
  test('pairKey + pairValue emits _kern_pairs iteration (normalises Mapping + array-of-pairs)', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
        children: [{ type: 'do', props: { value: 'log(k, v)' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for k, v in _kern_pairs(cache):');
    expect(out).toContain('log(k, v)');
    expect(out).toContain('def _kern_pairs(__k_v):');
  });

  test('pairKey + pairValue + entries=true keeps _kern_pairs iteration', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { pairKey: 'k', pairValue: 'v', in: 'record', entries: true },
        children: [{ type: 'do', props: { value: 'log(k, v)' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for k, v in _kern_pairs(record):');
    expect(out).toContain('log(k, v)');
  });

  test('entryKey emits dict.keys() iteration', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { entryKey: 'k', in: 'record', entries: true },
        children: [{ type: 'do', props: { value: 'log(k)' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for k in record.keys():');
    expect(out).toContain('log(k)');
  });

  test('entryValue emits dict.values() iteration', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { entryValue: 'v', in: 'record', entries: true },
        children: [{ type: 'do', props: { value: 'log(v)' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for v in record.values():');
    expect(out).toContain('log(v)');
  });

  test('parsed entries=true KERN handler emits Python _kern_pairs iteration', () => {
    const root = parseDocumentStrict(
      [
        'fn name=scan returns=void',
        '  handler lang=kern',
        '    each pairKey=k pairValue=v in="record" entries=true',
        '      do value="log(k, v)"',
      ].join('\n'),
    );
    const fn = root.children?.[0] as IRNode;
    const handler = fn.children?.find((child) => child.type === 'handler') as IRNode;
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for k, v in _kern_pairs(record):');
    expect(out).toContain('log(k, v)');
  });

  test('parsed entryKey entries=true KERN handler emits Python dict.keys() iteration', () => {
    const root = parseDocumentStrict(
      [
        'fn name=scan returns=void',
        '  handler lang=kern',
        '    each entryKey=k in="record" entries=true',
        '      do value="log(k)"',
      ].join('\n'),
    );
    const fn = root.children?.[0] as IRNode;
    const handler = fn.children?.find((child) => child.type === 'handler') as IRNode;
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for k in record.keys():');
    expect(out).toContain('log(k)');
  });

  test('pairKey + pairValue + entries=true rejects async iteration', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { pairKey: 'k', pairValue: 'v', in: 'record', entries: true, await: true },
        children: [{ type: 'do', props: { value: 'log(k, v)' } }],
      },
    ]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/entries=true/);
  });

  test('plain `name=` regression — still emits gensym + alias form', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [{ type: 'do', props: { value: 'process(item)' } }],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for __k_each_1 in items:');
    expect(out).toContain('item = __k_each_1');
  });

  test('pair-mode composes with continue inside the body', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
        children: [
          {
            type: 'if',
            props: { cond: 'v.expired' },
            children: [{ type: 'continue', props: {} }],
          },
          { type: 'do', props: { value: 'use(k, v)' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyPython(handler);
    expect(out).toContain('for k, v in _kern_pairs(cache):');
    // Slice S4 — `if cond=` wraps the condition in `_kern_truthy(...)`.
    expect(out).toContain('  if _kern_truthy(v.expired):');
    expect(out).toContain('    continue');
    expect(out).toContain('  use(k, v)');
  });
});
