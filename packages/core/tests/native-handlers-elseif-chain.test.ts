/** Native KERN handler bodies — `else if` chain emission.
 *
 *  When the body emitter sees `else` whose first child is `if` (with an
 *  optional inner `else` sibling), it emits `else if (...)` instead of
 *  `else { if (...) { ... } else { ... } }`. This makes slice 5b's migrated
 *  output byte-equivalent to the raw `else if` chain it replaces, so
 *  `kern migrate native-handlers --verify` passes on else-if migrations
 *  instead of rolling back due to brace-shape drift.
 *
 *  Emitter precedent: a similar collapse (sibling `else`) is in slice 2c.
 *  This extension recognises chainable shapes recursively.
 */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('emitNativeKernBodyTS — else if chain collapse', () => {
  test('else > if collapses to `else if` (single chain, no terminal else)', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a' },
        children: [{ type: 'return', props: { value: '1' } }],
      },
      {
        type: 'else',
        props: {},
        children: [
          {
            type: 'if',
            props: { cond: 'b' },
            children: [{ type: 'return', props: { value: '2' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('if (a) {');
    expect(out).toContain('} else if (b) {');
    expect(out).toContain('  return 2;');
    // Critically: NO inner `} else {` and NO bare `if (b)` inside an `else { ... }`.
    expect(out).not.toMatch(/else \{[\s\S]*if \(b\)/);
  });

  test('else > [if, else_inner] chains and terminates with else', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a' },
        children: [{ type: 'return', props: { value: '1' } }],
      },
      {
        type: 'else',
        props: {},
        children: [
          {
            type: 'if',
            props: { cond: 'b' },
            children: [{ type: 'return', props: { value: '2' } }],
          },
          {
            type: 'else',
            props: {},
            children: [{ type: 'return', props: { value: '3' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('if (a) {');
    expect(out).toContain('} else if (b) {');
    expect(out).toContain('} else {');
    expect(out).toContain('  return 3;');
    // Exactly three statements at the outer-block boundary, no extra braces.
    const closingCount = (out.match(/^}$/gm) ?? []).length;
    expect(closingCount).toBe(1);
  });

  test('three-level chain (if/else if/else if/else)', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a' },
        children: [{ type: 'return', props: { value: '1' } }],
      },
      {
        type: 'else',
        props: {},
        children: [
          {
            type: 'if',
            props: { cond: 'b' },
            children: [{ type: 'return', props: { value: '2' } }],
          },
          {
            type: 'else',
            props: {},
            children: [
              {
                type: 'if',
                props: { cond: 'c' },
                children: [{ type: 'return', props: { value: '3' } }],
              },
              {
                type: 'else',
                props: {},
                children: [{ type: 'return', props: { value: '4' } }],
              },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('if (a) {');
    expect(out).toContain('} else if (b) {');
    expect(out).toContain('} else if (c) {');
    expect(out).toContain('} else {');
    expect(out).toContain('  return 4;');
    const closingCount = (out.match(/^}$/gm) ?? []).length;
    expect(closingCount).toBe(1);
  });

  test('non-chainable else (multiple children) emits plain `else { ... }`', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a' },
        children: [{ type: 'return', props: { value: '1' } }],
      },
      {
        type: 'else',
        props: {},
        children: [
          { type: 'let', props: { name: 'x', value: '2' } },
          { type: 'return', props: { value: 'x' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('} else {');
    expect(out).toContain('  const x = 2;');
    expect(out).not.toContain('else if');
  });

  test('else with a single non-if child (e.g. just a return) stays plain `else`', () => {
    const handler = makeHandler([
      {
        type: 'if',
        props: { cond: 'a' },
        children: [{ type: 'return', props: { value: '1' } }],
      },
      {
        type: 'else',
        props: {},
        children: [{ type: 'return', props: { value: '2' } }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('} else {');
    expect(out).toContain('  return 2;');
    expect(out).not.toContain('else if');
  });
});
