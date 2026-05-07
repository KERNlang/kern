/** Native KERN handler bodies — `each` pair-mode (TS target).
 *
 *  Closes the gap that blocked self-hosting any TS function with a
 *  `for (const [k, v] of m)` Map iteration in `lang="kern"` form. Authors
 *  previously had to drop into a raw `<<<JS>>>` handler for any
 *  Map walk — `each name=X in=map` collapsed the entries to a single
 *  binding, losing the key.
 *
 *  Three forms now supported:
 *    - `each name=x in=xs`                    → for (const x of xs)
 *    - `each name=x index=i in=xs`            → for (const [i, x] of xs.entries())
 *    - `each pairKey=k pairValue=v in=m`      → for (const [k, v] of m)   ← NEW
 *
 *  Note: `pairKey`/`pairValue` are deliberately distinct from `key=`,
 *  which is reserved for the React render-key in JSX context. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { validateSchema } from '../src/schema.js';
import { validateSemantics } from '../src/semantic-validator.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('each pair-mode — TS target', () => {
  test('pairKey + pairValue emits Map destructuring', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
        children: [{ type: 'do', props: { value: 'log(k, v)' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const [k, v] of cache) {');
    expect(out).toContain('log(k, v);');
  });

  test('pairKey + pairValue does NOT call .entries() (Map is already iterable of pairs)', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
        children: [{ type: 'do', props: { value: 'log(k, v)' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).not.toContain('.entries()');
  });

  test('index= still emits .entries() form (regression check)', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', index: 'i', in: 'items' },
        children: [{ type: 'do', props: { value: 'log(i, item)' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const [i, item] of (items).entries()) {');
  });

  test('plain `name=` still emits the simple for...of form (regression check)', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [{ type: 'do', props: { value: 'process(item)' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const item of items) {');
    expect(out).not.toContain('.entries()');
  });

  test('pair-mode nests under each + composes with continue', () => {
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
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const [k, v] of cache) {');
    expect(out).toContain('  if (v.expired) {');
    expect(out).toContain('    continue;');
    expect(out).toContain('  use(k, v);');
  });
});

describe('each pair-mode — schema validation', () => {
  test('pair-mode is schema-valid (name= optional)', () => {
    const node: IRNode = {
      type: 'fn',
      props: { name: 'iter', returns: 'void' },
      children: [
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [
            {
              type: 'each',
              props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
              children: [{ type: 'do', props: { value: 'log(k, v)' } }],
            },
          ],
        },
      ],
    };
    const violations = validateSchema(node);
    // No `name=` — schema would normally complain because each.name is required.
    // The conditional-required exemption in checkRequiredProps suppresses it
    // when both pairKey and pairValue are present.
    expect(violations.filter((v) => v.message.includes("requires prop 'name'"))).toHaveLength(0);
  });

  test('pairKey alone (without pairValue) is rejected', () => {
    const node: IRNode = {
      type: 'each',
      props: { name: 'x', pairKey: 'k', in: 'm' },
      children: [],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes('pair-mode requires both'))).toBe(true);
  });

  test('pairKey + pairValue + index= is rejected (mutual exclusion)', () => {
    const node: IRNode = {
      type: 'each',
      props: { pairKey: 'k', pairValue: 'v', index: 'i', in: 'm' },
      children: [],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes('mutually exclusive with'))).toBe(true);
  });

  test('await=true + index= is rejected (async iterators have no stable entries index)', () => {
    const node: IRNode = {
      type: 'each',
      props: { name: 'x', await: true, index: 'i', in: 'stream' },
      children: [],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes('await=true'))).toBe(true);
  });

  test('non-pair-mode each still requires name= (regression)', () => {
    const node: IRNode = {
      type: 'each',
      props: { in: 'items' },
      children: [],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes("requires prop 'name'"))).toBe(true);
  });

  test('malformed pair-mode (pairKey: null) does NOT bypass name= requirement (codex review-fix)', () => {
    // Cast through unknown so we can hand the validator deliberately
    // malformed props (non-string pairKey) without TS rejecting the literal.
    const node: IRNode = {
      type: 'each',
      props: { pairKey: null as unknown as string, pairValue: 'v', in: 'cache' },
      children: [],
    };
    const violations = validateSchema(node);
    // pairKey is non-string → treated as absent → pair-mode shape rule fires
    // AND name= is still required.
    expect(violations.some((v) => v.message.includes("requires prop 'name'"))).toBe(true);
  });

  test('empty-string pair-mode props are treated as absent (regression for codex strict-string fix)', () => {
    const node: IRNode = {
      type: 'each',
      props: { pairKey: '', pairValue: '', in: 'cache' },
      children: [],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes("requires prop 'name'"))).toBe(true);
  });
});

describe('each pair-mode — semantic validation (render scope)', () => {
  test('pair-mode inside render is rejected (would silently emit broken .map)', () => {
    // Opencode mid-build review fix: render-path codegen reads name/index/key
    // but NOT pairKey/pairValue, so a render-position pair-mode each would
    // silently degrade to a single-binding .map(). Reject up front.
    const tree: IRNode = {
      type: 'screen',
      props: { name: 'CacheView' },
      children: [
        {
          type: 'render',
          props: {},
          children: [
            {
              type: 'each',
              props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
              children: [{ type: 'handler', props: {}, children: [] }],
            },
          ],
        },
      ],
    };
    const violations = validateSemantics(tree);
    expect(violations.some((v) => v.rule === 'each-pair-mode-body-stmt-only')).toBe(true);
  });

  test('pair-mode outside render is accepted', () => {
    const tree: IRNode = {
      type: 'fn',
      props: { name: 'walk', returns: 'void' },
      children: [
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [
            {
              type: 'each',
              props: { pairKey: 'k', pairValue: 'v', in: 'cache' },
              children: [{ type: 'do', props: { value: 'log(k, v)' } }],
            },
          ],
        },
      ],
    };
    const violations = validateSemantics(tree);
    expect(violations.filter((v) => v.rule === 'each-pair-mode-body-stmt-only')).toHaveLength(0);
  });
});
