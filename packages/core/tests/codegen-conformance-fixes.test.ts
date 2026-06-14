/** Codegen fixes from the Plan v3 v1 Phase 7 conformance review.
 *
 *  Three independent regressions surfaced by Codex against the
 *  `examples/native-test/conformance-native-handlers.kern` fixture:
 *
 *    A. error-class constructor with `handler lang=kern` + `field` children
 *       must emit `super(...)` before the handler body so the subclass is
 *       legal TypeScript.
 *    B. `assign target=<state> value=...` inside a screen handler must
 *       lower to the matching `setX(...)` call. When the RHS references
 *       the target itself (`count = count + 1`), use the functional updater
 *       form `setCount((count) => count + step)` to stay React-batching-safe.
 *    C. `class <Name>` (positional name shorthand, no `name=`) must parse
 *       and emit with the declared name — the prior parser silently dropped
 *       the trailing identifier and codegen fell back to `UnknownClass`. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { parseDocument } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function compileTopLevel(src: string): string {
  // `parseDocument` always wraps top-level nodes in a synthetic `document`
  // root, so a single-node snippet (`class Foo`) is still iterable as a
  // child rather than returned bare.
  const tree = parseDocument(src);
  const children = tree.type === 'document' ? (tree.children ?? []) : [tree];
  const out: string[] = [];
  for (const child of children) {
    out.push(...generateCoreNode(child));
  }
  return out.join('\n');
}

function makeHandler(children: Array<{ type: string; props?: Record<string, unknown> }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: children.map((c) => ({ ...c, props: c.props ?? {} })),
  };
}

describe('error-class with handler-body — super() injection (Bug 1.A)', () => {
  test('emits super() before handler body when no message prop and no message param', () => {
    const src = [
      'error name=MyError extends=AgonError',
      '  field name=code type=number',
      '  handler lang=kern',
      '    assign target="this.code" value="404"',
    ].join('\n');
    const out = compileTopLevel(src);
    // Constructor must call super() before the handler body's this-assignments.
    const ctorBody = out.slice(out.indexOf('constructor'));
    const superIdx = ctorBody.indexOf('super(');
    const assignIdx = ctorBody.indexOf('this.code = 404');
    expect(superIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeGreaterThan(superIdx);
  });

  test('uses super(message) when first field is `message`', () => {
    const src = [
      'error name=MyError extends=Error',
      '  field name=message type=string',
      '  handler lang=kern',
      '    assign target="this.foo" value="42"',
    ].join('\n');
    const out = compileTopLevel(src);
    expect(out).toContain('super(message);');
  });

  test('uses super(`${message-template}`) when error.message= prop is set', () => {
    const src = [
      'error name=MyError extends=Error message="bad: ${code}"',
      '  field name=code type=number',
      '  handler lang=kern',
      '    assign target="this.code" value="code"',
    ].join('\n');
    const out = compileTopLevel(src);
    expect(out).toContain('super(`bad: ${code}`);');
  });

  test('does NOT double-inject super() when the handler body already calls super()', () => {
    const src = [
      'error name=MyError extends=AgonError',
      '  field name=code type=number',
      '  handler lang=kern',
      '    do value="super(`custom: ${code}`)"',
      '    assign target="this.code" value="code"',
    ].join('\n');
    const out = compileTopLevel(src);
    // Exactly one super(...) call — the one the author wrote.
    const matches = out.match(/super\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe('state-binding assign auto-lowers to setter (Bug 1.B)', () => {
  test('plain `=` with non-self-ref value → plain setter call', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'count', value: '42' } }]);
    const out = emitNativeKernBodyTS(handler, { stateBindings: ['count'] });
    expect(out).toBe('setCount(42);');
  });

  test('plain `=` with self-ref value → functional updater (param shadows cell)', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'count', value: 'count + step' } }]);
    const out = emitNativeKernBodyTS(handler, { stateBindings: ['count'] });
    expect(out).toBe('setCount((count) => count + step);');
  });

  test('compound `+=` keeps `(prev) => prev + …` form (regression)', () => {
    const handler = makeHandler([{ type: 'assign', props: { target: 'count', op: '+=', value: 'step' } }]);
    const out = emitNativeKernBodyTS(handler, { stateBindings: ['count'] });
    expect(out).toBe('setCount((prev) => prev + step);');
  });

  test('lambda RHS that shadows the cell name is NOT treated as self-ref', () => {
    // `count = items.map((count) => count * 2)` — the inner `count` is a
    // lambda param, not the surrounding cell. Should emit plain setter call.
    const handler = makeHandler([
      { type: 'assign', props: { target: 'count', value: 'items.map((count) => count * 2)' } },
    ]);
    const out = emitNativeKernBodyTS(handler, { stateBindings: ['count'] });
    expect(out).toBe('setCount(items.map((count) => count * 2));');
  });

  test('end-to-end through generateCoreNode — callback with self-ref assign', () => {
    const src = [
      'screen name=Counter',
      '  state name=count type=number initial=0',
      '  callback name=increment deps="count" params="step:number"',
      '    handler lang=kern',
      '      assign target="count" value="count + step"',
    ].join('\n');
    const out = compileTopLevel(src);
    // count must lower to its setter — no raw reassignment of the const.
    expect(out).not.toMatch(/^\s*count = count \+ step;/m);
    expect(out).toContain('setCount((count) => count + step);');
  });

  test('reads of state inside an effect body are not rewritten', () => {
    // Reading `count` in a `do value="count"` must stay a read; only writes
    // get the setter treatment.
    const handler = makeHandler([{ type: 'do', props: { value: 'count' } }]);
    const out = emitNativeKernBodyTS(handler, { stateBindings: ['count'] });
    expect(out).toBe('count;');
  });
});

describe('class positional-name shorthand (Bug 1.C)', () => {
  test('parses `class NativeClass` with no name= and emits the declared name', () => {
    const src = [
      'class NativeClass',
      '  constructor',
      '    handler lang=kern',
      '      do value="0"',
    ].join('\n');
    const out = compileTopLevel(src);
    expect(out).toContain('class NativeClass');
    expect(out).not.toContain('UnknownClass');
  });

  test('canonical `class name=Foo` form still works unchanged', () => {
    const src = ['class name=Foo', '  field name=x type=number'].join('\n');
    const out = compileTopLevel(src);
    expect(out).toContain('class Foo');
  });

  test('bareword + extends/implements still parse together', () => {
    const src = ['class Foo extends=Bar implements=Iface'].join('\n');
    const out = compileTopLevel(src);
    expect(out).toContain('class Foo extends Bar implements Iface');
  });
});
