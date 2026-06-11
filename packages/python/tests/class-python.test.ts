/** Single-source class slice — Python target.
 *
 *  KERN `class` nodes lower to pure Python (NOT FastAPI/Pydantic) via
 *  `generatePythonClass`. Class member bodies translate through the shared
 *  Python body emitter with `inClassBody`/`inConstructor`:
 *    - `this` -> `self` (symbol map)
 *    - `super(args)` -> `super().__init__(args)` (constructor only)
 *    - `super.m()` / `super.x` -> `super().m()` / `super().x` (any member)
 *
 *  Behaviour locked here was driven by an Agon review of the slice
 *  (setter-only synthesis + static-accessor skip closed two blocking findings).
 */

import type { IRNode } from '@kernlang/core';
import { parse } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports } from '../src/codegen-body-python.js';
import { generatePythonClass } from '../src/generators/data.js';

function handler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}
function param(name: string, type?: string): IRNode {
  return { type: 'param', props: type ? { name, type } : { name }, children: [] };
}

describe('Python class codegen (single-source class slice)', () => {
  test('emits a pure-Python class: __init__, this->self, instance method, getter', () => {
    const animal: IRNode = {
      type: 'class',
      props: { name: 'Animal' },
      children: [
        {
          type: 'constructor',
          props: {},
          children: [
            param('name', 'string'),
            param('legs', 'number'),
            handler([
              { type: 'assign', props: { target: 'this.name', value: 'name' }, children: [] },
              { type: 'assign', props: { target: 'this.legs', value: 'legs' }, children: [] },
            ]),
          ],
        },
        {
          type: 'getter',
          props: { name: 'legCount', returns: 'number' },
          children: [handler([{ type: 'return', props: { value: 'this.legs' }, children: [] }])],
        },
      ],
    };
    const code = generatePythonClass(animal).join('\n');
    expect(code).toContain('class Animal:');
    expect(code).toContain('def __init__(self, name: str, legs: float):');
    expect(code).toContain('self.name = name');
    expect(code).toContain('@property');
    expect(code).toContain('def leg_count(self) -> float:');
    expect(code).toContain('return self.legs');
    expect(code).not.toContain('this.'); // no JS-ism leaks
  });

  test('inheritance: super(...) -> super().__init__ in constructor, super.m() -> super().m()', () => {
    const dog: IRNode = {
      type: 'class',
      props: { name: 'Dog', extends: 'Animal' },
      children: [
        {
          type: 'constructor',
          props: {},
          children: [
            param('name', 'string'),
            handler([{ type: 'do', props: { value: 'super(name, 4)' }, children: [] }]),
          ],
        },
        {
          type: 'method',
          props: { name: 'summary', returns: 'string' },
          children: [handler([{ type: 'return', props: { value: '`${super.describe()}`' }, children: [] }])],
        },
      ],
    };
    const code = generatePythonClass(dog).join('\n');
    expect(code).toContain('class Dog(Animal):');
    expect(code).toContain('super().__init__(name, 4)');
    expect(code).toContain('super().describe()');
  });

  test('setter-only property synthesizes a write-only getter (valid Python, no NameError)', () => {
    const box: IRNode = {
      type: 'class',
      props: { name: 'Box' },
      children: [
        {
          type: 'setter',
          props: { name: 'items' },
          children: [
            param('next', 'object[]'),
            handler([{ type: 'assign', props: { target: 'this.store', value: 'next' }, children: [] }]),
          ],
        },
      ],
    };
    const code = generatePythonClass(box).join('\n');
    expect(code).toContain('def items(self):'); // synthesized getter precedes the setter
    expect(code).toContain('@items.setter');
  });

  test('static accessors lower to a per-class metaclass property (this -> cls)', () => {
    const reg: IRNode = {
      type: 'class',
      props: { name: 'Reg' },
      children: [
        {
          type: 'getter',
          props: { name: 'label', static: 'true', returns: 'string' },
          children: [handler([{ type: 'return', props: { value: 'this.store' }, children: [] }])],
        },
        {
          type: 'setter',
          props: { name: 'label', static: 'true' },
          children: [
            param('v', 'string'),
            handler([{ type: 'assign', props: { target: 'this.store', value: 'v' }, children: [] }]),
          ],
        },
      ],
    };
    const code = generatePythonClass(reg).join('\n');
    expect(code).toContain('class _RegMeta(type):');
    expect(code).toContain('class Reg(metaclass=_RegMeta):');
    expect(code).toContain('def label(cls) -> str:');
    expect(code).toContain('return cls.store'); // this -> cls inside a static accessor
    expect(code).toContain('@label.setter');
    expect(code).not.toContain('def label(self)');
  });

  test('static setter param shadowing the cls receiver fails codegen (no `def label(cls, cls):`)', () => {
    const reg: IRNode = {
      type: 'class',
      props: { name: 'Reg' },
      children: [
        {
          type: 'setter',
          props: { name: 'label', static: 'true' },
          children: [
            param('cls', 'string'), // snake-cases to the implicit metaclass receiver
            handler([{ type: 'assign', props: { target: 'this.store', value: 'cls' }, children: [] }]),
          ],
        },
      ],
    };
    expect(() => generatePythonClass(reg)).toThrow(/receiver/);
  });

  test('instance-field defaults emit in __init__, never as a shared class attr', () => {
    const bag: IRNode = {
      type: 'class',
      props: { name: 'Bag' },
      children: [
        {
          type: 'field',
          props: { name: 'items', type: 'object[]', value: { __expr: true, code: '[]' } },
          children: [],
        },
        {
          type: 'field',
          props: { name: 'tag', type: 'string', value: { __expr: true, code: '"empty"' } },
          children: [],
        },
      ],
    };
    const code = generatePythonClass(bag).join('\n');
    expect(code).toContain('def __init__(self):');
    expect(code).toContain('self.items = []');
    expect(code).toContain('self.tag = "empty"');
    // Shared-mutable-default trap: instance fields must NOT become class-level attrs.
    expect(code).not.toMatch(/^ {4}items\s*[:=]/m);
  });

  test('static field values are extracted from value={{...}} (not None)', () => {
    const reg: IRNode = {
      type: 'class',
      props: { name: 'Reg' },
      children: [
        {
          type: 'field',
          props: { name: 'kind', type: 'string', static: 'true', value: { __expr: true, code: '"audited"' } },
          children: [],
        },
      ],
    };
    const code = generatePythonClass(reg).join('\n');
    expect(code).toContain('kind: str = "audited"');
    expect(code).not.toContain('kind: str = None');
  });

  test('derived class without a constructor forwards to base init, then applies defaults', () => {
    const dog: IRNode = {
      type: 'class',
      props: { name: 'Dog', extends: 'Animal' },
      children: [
        {
          type: 'field',
          props: { name: 'tricks', type: 'object[]', value: { __expr: true, code: '[]' } },
          children: [],
        },
      ],
    };
    const code = generatePythonClass(dog).join('\n');
    expect(code).toContain('def __init__(self, *args, **kwargs):');
    expect(code).toContain('super().__init__(*args, **kwargs)');
    expect(code).toContain('self.tricks = []');
    expect(code.indexOf('super().__init__')).toBeLessThan(code.indexOf('self.tricks = []'));
  });

  test('field defaults run AFTER super() inside an explicit derived constructor', () => {
    const dog: IRNode = {
      type: 'class',
      props: { name: 'Dog', extends: 'Animal' },
      children: [
        {
          type: 'field',
          props: { name: 'tricks', type: 'object[]', value: { __expr: true, code: '[]' } },
          children: [],
        },
        {
          type: 'constructor',
          props: {},
          children: [param('name', 'string'), handler([{ type: 'do', props: { value: 'super(name)' }, children: [] }])],
        },
      ],
    };
    const code = generatePythonClass(dog).join('\n');
    expect(code).toContain('super().__init__(name)');
    expect(code.indexOf('super().__init__(name)')).toBeLessThan(code.indexOf('self.tricks = []'));
  });

  test('abstract instance method (handler-less, under abstract class) emits a fail-fast raise', () => {
    const shape: IRNode = {
      type: 'class',
      props: { name: 'Shape', abstract: 'true' },
      children: [{ type: 'method', props: { name: 'area', returns: 'number' }, children: [] }], // no handler -> abstract
    };
    const code = generatePythonClass(shape).join('\n');
    expect(code).toContain('class Shape:'); // abstract erased -> plain instantiable class (no ABC/metaclass)
    expect(code).toContain('raise NotImplementedError("abstract method Shape.area not implemented")');
  });

  test('abstract STATIC accessor emits a fail-fast raise (not a silent metaclass pass)', () => {
    const base: IRNode = {
      type: 'class',
      props: { name: 'Base', abstract: 'true' },
      children: [{ type: 'getter', props: { name: 'tag', static: 'true', returns: 'string' }, children: [] }],
    };
    const code = generatePythonClass(base).join('\n');
    // The metaclass static getter must raise, matching the TS throw — not `pass`/None.
    expect(code).toContain('raise NotImplementedError("abstract getter Base.tag not implemented")');
    expect(code).not.toMatch(/def tag\(cls\)[^\n]*:\n\s*pass\b/);
  });

  test('implements is erased on the Python target, left as a marker comment', () => {
    const user: IRNode = {
      type: 'class',
      props: { name: 'User', implements: 'Serializable' },
      children: [
        { type: 'field', props: { name: 'id', type: 'string', value: { __expr: true, code: '"x"' } }, children: [] },
      ],
    };
    const code = generatePythonClass(user).join('\n');
    expect(code).toContain('# implements: Serializable');
    expect(code).toContain('class User:'); // no Protocol/ABC base injected
    expect(code).not.toContain('Serializable)'); // implements is NOT a runtime base
  });

  test('list push on a pure receiver lowers to the shared append+len shim', () => {
    const bag: IRNode = {
      type: 'class',
      props: { name: 'Bag' },
      children: [
        {
          type: 'field',
          props: { name: 'items', type: 'number[]', value: { __expr: true, code: '[]' } },
          children: [],
        },
        {
          type: 'method',
          props: { name: 'add', returns: 'number' },
          children: [
            param('x', 'number'),
            handler([{ type: 'return', props: { value: 'this.items.push(x)' }, children: [] }]),
          ],
        },
      ],
    };
    const code = generatePythonClass(bag).join('\n');
    // Same lowering the route emitter uses — JS push's new-length return parity.
    expect(code).toContain('(self.items.append(x) or len(self.items))');
    expect(code).not.toContain('self.items.push'); // no JS-ism leaks
  });

  test('list push on an IMPURE receiver does NOT lower (no double-evaluation)', () => {
    // The shim names the receiver twice; a side-effectful receiver would run its
    // effects twice on Python and break parity. It must fall through unchanged.
    const box: IRNode = {
      type: 'class',
      props: { name: 'Box' },
      children: [
        {
          type: 'field',
          props: { name: 'items', type: 'number[]', value: { __expr: true, code: '[]' } },
          children: [],
        },
        {
          type: 'method',
          props: { name: 'fresh', returns: 'number[]' },
          children: [handler([{ type: 'return', props: { value: 'this.items' }, children: [] }])],
        },
        {
          type: 'method',
          props: { name: 'danger', returns: 'number' },
          children: [handler([{ type: 'return', props: { value: 'this.fresh().push(9)' }, children: [] }])],
        },
      ],
    };
    const code = generatePythonClass(box).join('\n');
    expect(code).not.toContain('.append(9)'); // shim NOT applied to the impure receiver
    expect(code).toContain('self.fresh().push(9)'); // receiver named exactly once
  });

  // ── scalar-method sweep: per-method purity contract ──
  // Single-eval methods (slice/includes) name the receiver ONCE, so they now
  // lower even on an IMPURE receiver (the old blanket guard wrongly skipped
  // them — the 0.97 agon-review finding). Multi-eval / mutating methods
  // (reverse/at) keep requiring a pure receiver and fall through unchanged.
  function impureReceiverClass(method: string, returns: string): IRNode {
    return {
      type: 'class',
      props: { name: 'Box' },
      children: [
        {
          type: 'field',
          props: { name: 'items', type: 'number[]', value: { __expr: true, code: '[1, 2, 3]' } },
          children: [],
        },
        {
          type: 'method',
          props: { name: 'fresh', returns: 'number[]' },
          children: [handler([{ type: 'return', props: { value: 'this.items' }, children: [] }])],
        },
        {
          type: 'method',
          props: { name: 'use', returns },
          children: [handler([{ type: 'return', props: { value: `this.fresh().${method}` }, children: [] }])],
        },
      ],
    };
  }

  test('single-eval slice on an IMPURE receiver NOW lowers (old blanket guard removed)', () => {
    const code = generatePythonClass(impureReceiverClass('slice(1)', 'number[]')).join('\n');
    // slice names the receiver once, so `this.fresh().slice(1)` lowers to a Python
    // slice on the call result — the impure receiver is evaluated exactly once.
    expect(code).toContain('self.fresh()[1:]');
    expect(code).not.toContain('self.fresh().slice(1)'); // no JS-ism leaks
  });

  test('single-eval includes on an IMPURE receiver NOW lowers', () => {
    const code = generatePythonClass(impureReceiverClass('includes(2)', 'boolean')).join('\n');
    // includes names the receiver once -> `(2 in self.fresh())`.
    expect(code).toContain('(2 in self.fresh())');
    expect(code).not.toContain('self.fresh().includes'); // no JS-ism leaks
  });

  test('multi-eval reverse on an IMPURE receiver does NOT lower (falls through)', () => {
    const code = generatePythonClass(impureReceiverClass('reverse()', 'number[]')).join('\n');
    // reverse names the receiver twice (`(recv.reverse() or recv)`), so an impure
    // receiver must fall through unchanged — no shim applied.
    expect(code).not.toContain('.reverse() or'); // shim NOT applied
    expect(code).toContain('self.fresh().reverse()'); // receiver named exactly once
  });

  test('multi-eval at on an IMPURE receiver does NOT lower (falls through)', () => {
    const code = generatePythonClass(impureReceiverClass('at(0)', 'number')).join('\n');
    // at names the receiver three times (value + two bounds), so an impure
    // receiver falls through unchanged.
    expect(code).not.toContain('-len('); // bounds shim NOT applied
    expect(code).toContain('self.fresh().at(0)'); // receiver named exactly once
  });

  test('derived constructor omitting super() gets an implicit super().__init__() first', () => {
    const box: IRNode = {
      type: 'class',
      props: { name: 'Box', extends: 'Base' },
      children: [
        { type: 'field', props: { name: 'x', type: 'number', value: { __expr: true, code: '0' } }, children: [] },
        {
          type: 'constructor',
          props: {},
          children: [
            param('v', 'number'),
            handler([{ type: 'assign', props: { target: 'this.x', value: 'v' }, children: [] }]),
          ],
        },
      ],
    };
    const code = generatePythonClass(box).join('\n');
    expect(code).toContain('super().__init__()');
    // Order must be: implicit super -> field default -> constructor body.
    expect(code.indexOf('super().__init__()')).toBeLessThan(code.indexOf('self.x = 0'));
    expect(code.indexOf('self.x = 0')).toBeLessThan(code.lastIndexOf('self.x = v'));
  });

  test('non-derived constructor gets NO implicit super (only derived classes base-init)', () => {
    const box: IRNode = {
      type: 'class',
      props: { name: 'Box' },
      children: [
        {
          type: 'constructor',
          props: {},
          children: [
            param('v', 'number'),
            handler([{ type: 'assign', props: { target: 'this.x', value: 'v' }, children: [] }]),
          ],
        },
      ],
    };
    const code = generatePythonClass(box).join('\n');
    expect(code).not.toContain('super().__init__');
  });
});

describe('Python block-bodied arrow closures (slices 0+1)', () => {
  function findHandler(node: IRNode | null): IRNode | null {
    if (!node) return null;
    if (node.type === 'handler') return node;
    for (const child of node.children ?? []) {
      const found = findHandler(child);
      if (found) return found;
    }
    return null;
  }

  test('method with a block arrow hoists a local def BEFORE its use, with indented body and call site', () => {
    const box: IRNode = {
      type: 'class',
      props: { name: 'Box' },
      children: [
        {
          type: 'method',
          props: { name: 'run', returns: 'number' },
          children: [
            {
              type: 'handler',
              props: { lang: 'kern' },
              children: [
                { type: 'let', props: { name: 'factor', value: '3' }, children: [] },
                {
                  type: 'let',
                  props: { name: 'scale', value: '(x) => { const t = x * factor; return t; }' },
                  children: [],
                },
                { type: 'return', props: { value: 'scale(7)' }, children: [] },
              ],
            },
          ],
        },
      ],
    };
    const code = generatePythonClass(box).join('\n');
    // The hoisted def appears BEFORE the `scale = __kern_closure_0` use line.
    const defIdx = code.indexOf('def __kern_closure_0(x):');
    const useIdx = code.indexOf('scale = __kern_closure_0');
    expect(defIdx).toBeGreaterThan(-1);
    expect(useIdx).toBeGreaterThan(-1);
    expect(defIdx).toBeLessThan(useIdx);
    // Body lines lowered + properly indented (def body sits at method-indent+1).
    expect(code).toContain('            t = x * factor');
    expect(code).toContain('            return t');
    // Call site preserved.
    expect(code).toContain('return scale(7)');
    // No naive `lambda` emission for a statement body.
    expect(code).not.toContain('lambda');
  });

  test('a closure capturing a SHADOW-RENAMED outer variable references the renamed Python name', () => {
    // outer `let x`; an inner if-block re-declares `x` (shadow → __k_shadow_x_N);
    // a closure inside that block READS x → its def body must reference the
    // RENAMED Python name (captures resolve through ctx; the param is NOT renamed).
    const kern = `screen name=S
  callback name=fn params="c:boolean"
    handler lang=kern
      let name=x value="1" kind=let
      if cond="c"
        let name=x value="2" kind=let
        let name=f value="(a) => { const r = a + x; return r; }"
        return value="f(10)"
      return value="x"`;
    const handler = findHandler(parse(kern));
    expect(handler).not.toBeNull();
    const { code } = emitNativeKernBodyPythonWithImports(handler as IRNode, { outerBindings: ['c'] });
    // The inner shadow rename happened.
    expect(code).toMatch(/__k_shadow_x_\d+ = 2/);
    // The closure body references the RENAMED name, not the bare `x`.
    expect(code).toMatch(/def __kern_closure_0\(a\):/);
    expect(code).toMatch(/r = __kern_add\(a, __k_shadow_x_\d+\)/);
    // The closure PARAM `a` is not renamed.
    expect(code).toContain('def __kern_closure_0(a):');
  });

  test('the hoisted def is placed inside the if-block (correct nested indent)', () => {
    const kern = `screen name=S
  callback name=fn params="c:boolean"
    handler lang=kern
      if cond="c"
        let name=g value="(x) => { const y = x + 1; return y; }"
        return value="g(4)"
      return value="0"`;
    const handler = findHandler(parse(kern));
    const { code } = emitNativeKernBodyPythonWithImports(handler as IRNode, { outerBindings: ['c'] });
    // The def is indented one level under the `if` (4 spaces) — flushed via the
    // nested emitChildrenPy call, not at the function-body top level.
    expect(code).toContain('    def __kern_closure_0(x):');
    expect(code).toContain('    g = __kern_closure_0');
  });

  test('a pinned loop-local REASSIGNED AFTER the closure fails closed (no silent divergence)', () => {
    // agon-review (claude 0.7) divergence fix: `let t = 0; fns.push(() => t);
    // t = t + x` — JS closures see the post-creation mutation ([1,2]); the
    // def-time pin would freeze t=0 ([0,0]). Must be a compile error, never
    // silently wrong output.
    const kern = `screen name=S
  callback name=fn params="c:boolean"
    handler lang=kern
      let name=fns value="[]" kind=let
      each name=x in="[1, 2]"
        let name=t value="0" kind=let
        do value="fns.push((p) => { return t; })"
        assign target="t" value="t + x"
      return value="fns"`;
    const handler = findHandler(parse(kern));
    expect(() => emitNativeKernBodyPythonWithImports(handler as IRNode, { outerBindings: ['c'] })).toThrow(
      /reassigned after the closure/,
    );
  });

  test('a pinned loop-local assigned BEFORE the closure still pins (assignment order respected)', () => {
    // The reject is order-aware: assignments at an EARLIER sibling index are
    // captured by the pin and remain legal.
    const kern = `screen name=S
  callback name=fn params="c:boolean"
    handler lang=kern
      let name=fns value="[]" kind=let
      each name=x in="[1, 2]"
        let name=t value="0" kind=let
        assign target="t" value="t + x"
        do value="fns.push((p) => { return t; })"
      return value="fns"`;
    const handler = findHandler(parse(kern));
    const { code } = emitNativeKernBodyPythonWithImports(handler as IRNode, { outerBindings: ['c'] });
    expect(code).toMatch(/def __kern_closure_0\(p, t=t\):/);
  });

  test('a pinned loop-local reassigned in the SAME top-level child as the closure fails closed (3b granularity)', () => {
    // Within-child statement order is NOT tracked (the whole top-level child
    // shares one index), so a closure and a later reassignment nested in the
    // SAME child (here both inside one `if`) cannot be order-distinguished.
    // Fail closed (>=) rather than silently freeze a value JS mutates.
    const kern = `screen name=S
  callback name=fn params="c:boolean"
    handler lang=kern
      let name=fns value="[]" kind=let
      each name=x in="[1, 2]"
        let name=t value="0" kind=let
        if cond="c"
          do value="fns.push((p) => { return t; })"
          assign target="t" value="t + x"
      return value="fns"`;
    const handler = findHandler(parse(kern));
    expect(() => emitNativeKernBodyPythonWithImports(handler as IRNode, { outerBindings: ['c'] })).toThrow(
      /reassigned after the closure/,
    );
  });

  test('a captured cell reassigned via `set` after the closure fails closed (3d set-node scan)', () => {
    // The later-assign scan must cover `set name=… to=…` (a bare-name cell
    // write), not just `assign`. A cell captured by a closure and then reassigned
    // via `set` in a later sibling must fail closed, exactly like an `assign`.
    const kern = `screen name=S
  callback name=fn params="c:boolean"
    handler lang=kern
      let name=fns value="[]" kind=let
      each name=x in="[1, 2]"
        cell name=t value="0"
        do value="fns.push((p) => { return t; })"
        set name=t to="t + x"
      return value="fns"`;
    const handler = findHandler(parse(kern));
    expect(() => emitNativeKernBodyPythonWithImports(handler as IRNode, { outerBindings: ['c'] })).toThrow(
      /reassigned after the closure/,
    );
  });

  test('a captured loop-local reassigned via a COMPOUND assign (op="+=") after the closure fails closed (3d compound coverage)', () => {
    // Compound (`+=`) and postfix (`++`) reassignments are the SAME `assign` node
    // type as plain `=`, distinguished only by `op=`, all rebinding `target=`, so
    // they are already covered by the later-assign scan. This proves it.
    const kern = `screen name=S
  callback name=fn params="c:boolean"
    handler lang=kern
      let name=fns value="[]" kind=let
      each name=x in="[1, 2]"
        let name=t value="0" kind=let
        do value="fns.push((p) => { return t; })"
        assign target="t" op="+=" value="x"
      return value="fns"`;
    const handler = findHandler(parse(kern));
    expect(() => emitNativeKernBodyPythonWithImports(handler as IRNode, { outerBindings: ['c'] })).toThrow(
      /reassigned after the closure/,
    );
  });

  test('a closure in an IF CONDITION hoists BEFORE the if header (per-level buffer isolation)', () => {
    // agon-review fix (claude 0.7): the condition's def was pushed to
    // pendingHoists before the if-branch recursed into its body, and the
    // BODY-level per-child flush stole it — emitting the def INSIDE the body,
    // AFTER `if __kern_closure_0(2):` already referenced it (runtime
    // NameError). Per-level buffer isolation in emitChildrenPy makes a header
    // def survive until the PARENT flush, landing before the whole statement.
    const kern = `screen name=S
  callback name=fn params="c:boolean"
    handler lang=kern
      if cond="((x) => { return x > 1; })(2)"
        return value="10"
      return value="20"`;
    const handler = findHandler(parse(kern));
    const { code } = emitNativeKernBodyPythonWithImports(handler as IRNode, { outerBindings: ['c'] });
    const defIdx = code.indexOf('def __kern_closure_0(x):');
    const ifIdx = code.indexOf('if __kern_closure_0(2):');
    expect(defIdx).toBeGreaterThan(-1);
    expect(ifIdx).toBeGreaterThan(-1);
    expect(defIdx).toBeLessThan(ifIdx);
    // The def sits at the function-body level (no extra indent under the if).
    expect(code).toContain('def __kern_closure_0(x):');
    expect(code).not.toContain('    def __kern_closure_0'); // not nested in the body
  });
});

describe('Python closure loop-variable pinning (slice 2)', () => {
  function findHandler(node: IRNode | null): IRNode | null {
    if (!node) return null;
    if (node.type === 'handler') return node;
    for (const child of node.children ?? []) {
      const found = findHandler(child);
      if (found) return found;
    }
    return null;
  }
  function emit(kern: string): string {
    const handlerNode = findHandler(parse(kern));
    expect(handlerNode).not.toBeNull();
    return emitNativeKernBodyPythonWithImports(handlerNode as IRNode).code;
  }

  test('an `each` loop-var capture is pinned via a default arg (def __kern_closure_0(p, x=x))', () => {
    // The classic per-iteration capture: JS sees 0,1,2; a naive late-bound
    // Python def would see 2,2,2. The fix pins `x` as a default arg evaluated
    // at def time (the per-iteration hoist point).
    const code = emit(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[0, 1, 2]"
      do value="fns.push((p) => { return x; })"
    return value="fns"`,
    );
    expect(code).toContain('def __kern_closure_0(p, x=x):');
  });

  test('an OUTSIDE-loop capture is NOT pinned (no default arg added)', () => {
    // `total` is declared before the loop; JS captures it by reference (call
    // time value), and Python late binding is already parity-correct. Pinning
    // it would WRONGLY freeze the per-iteration value — so no default arg.
    const code = emit(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=total value="0" kind=let
    let name=fns value="[]"
    each name=x in="[1, 2]"
      do value="fns.push((p) => { return total; })"
    return value="fns"`,
    );
    expect(code).toContain('def __kern_closure_0(p):');
    expect(code).not.toMatch(/def __kern_closure_0\([^)]*total/);
  });

  test('a `while`-condition var captured inside the body is NOT pinned', () => {
    // The while-condition var `i` is declared OUTSIDE the loop, so it resolves
    // below the loop scope and stays late-bound (by-reference parity).
    const code = emit(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=i value="0" kind=let
    let name=fns value="[]"
    while cond="i < 2"
      do value="fns.push((p) => { return i; })"
      assign target="i" value="i + 1"
    return value="fns"`,
    );
    expect(code).toContain('def __kern_closure_0(p):');
    expect(code).not.toMatch(/def __kern_closure_0\([^)]*i=i/);
  });

  test('a SHADOW-RENAMED inner per-iteration binding pins the RENAMED Python name (P5 kill-switch)', () => {
    // Inside `each x`, an if-block re-declares `x` (shadow → __k_shadow_x_N)
    // from a sibling per-iteration local. The closure reads the inner `x`; the
    // pinned default param MUST be the renamed name on BOTH sides — proving the
    // TS-AST free-var set and the KERN rename resolution agree (the armed
    // tribunal kill-switch is satisfied, not tripped).
    const code = emit(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[1, 2]"
      let name=base value="x + 100"
      if cond="x > 0"
        let name=x value="base" kind=let
        do value="fns.push((p) => { return x; })"
    return value="fns"`,
    );
    expect(code).toMatch(/def __kern_closure_0\(p, __k_shadow_x_\d+=__k_shadow_x_\d+\):/);
    // The body references the same renamed name (no bare `x`).
    expect(code).toMatch(/return __k_shadow_x_\d+/);
  });

  test('nested loops pin BOTH loop vars (alphabetical default-arg order)', () => {
    const code = emit(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[1, 2]"
      each name=y in="[10, 20]"
        do value="fns.push((p) => { return x + y; })"
    return value="fns"`,
    );
    expect(code).toContain('def __kern_closure_0(p, x=x, y=y):');
  });

  test('a `for` range loop var captured in the body is pinned', () => {
    const code = emit(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    for name=i from=0 to=3
      do value="fns.push((p) => { return i; })"
    return value="fns"`,
    );
    expect(code).toContain('def __kern_closure_0(p, i=i):');
  });
});

describe('Python lambda-bearing array methods (map/filter/some/every)', () => {
  function findHandler(node: IRNode | null): IRNode | null {
    if (!node) return null;
    if (node.type === 'handler') return node;
    for (const child of node.children ?? []) {
      const found = findHandler(child);
      if (found) return found;
    }
    return null;
  }
  function emitFull(kern: string, options?: Parameters<typeof emitNativeKernBodyPythonWithImports>[1]) {
    const handlerNode = findHandler(parse(kern));
    expect(handlerNode).not.toBeNull();
    return emitNativeKernBodyPythonWithImports(handlerNode as IRNode, options);
  }

  test('M2-shape: hoisted `def __kern_closure_0` precedes the statement whose comprehension calls it', () => {
    // A block lambda inside map lowers to a hoisted closure def; the def MUST be
    // emitted BEFORE the `return [...]` line that references it (a NameError
    // otherwise). emitChildrenPy flushes the hoist immediately before the
    // statement, so the def precedes the comprehension.
    const { code } = emitFull(
      `fn name=probe returns=number[]
  handler lang=kern
    return value="[1, 2, 3].map((x) => { const y = x + 1; return y * y; })"`,
    );
    const defIdx = code.indexOf('def __kern_closure_0(x):');
    const useIdx = code.indexOf('__kern_closure_0(__kern_el_');
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(useIdx).toBeGreaterThan(defIdx);
    expect(code).toMatch(/\[__kern_closure_0\(__kern_el_\d+\) for __kern_el_\d+ in \[1, 2, 3\]\]/);
  });

  test('expression lambda is hoisted as `__kern_cb_0 = lambda ...` before the comprehension that calls it', () => {
    const { code } = emitFull(
      `fn name=probe returns=number[]
  handler lang=kern
    return value="[1, 2, 3].map((x) => x * 2)"`,
    );
    const hoistIdx = code.indexOf('__kern_cb_0 = lambda x: x * 2');
    const useIdx = code.indexOf('__kern_cb_0(__kern_el_');
    expect(hoistIdx).toBeGreaterThanOrEqual(0);
    expect(useIdx).toBeGreaterThan(hoistIdx);
  });

  test('a 2-arity callback lowers to an enumerate comprehension', () => {
    const { code } = emitFull(
      `fn name=probe returns=number[]
  handler lang=kern
    return value="[10, 20, 30].map((x, i) => x + i)"`,
    );
    expect(code).toMatch(/for __kern_ix_\d+, __kern_el_\d+ in enumerate\(\[10, 20, 30\]\)/);
    expect(code).toMatch(/__kern_cb_0\(__kern_el_\d+, __kern_ix_\d+\)/);
  });

  test('a bare LOCAL identifier callback lowers to a call-by-name comprehension', () => {
    const { code } = emitFull(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=f value="(x) => x * 3"
    return value="[1, 2].map(f)"`,
    );
    // No hoisted lambda assignment for a named callback — the comprehension
    // calls the resolved ident directly, single-arg (arity unknown).
    expect(code).toMatch(/\[f\(__kern_el_\d+\) for __kern_el_\d+ in \[1, 2\]\]/);
    expect(code).not.toContain('__kern_cb_');
  });

  test('filter wraps the predicate in js_truthy and includes the helper source EXACTLY once', () => {
    const { code, helpers } = emitFull(
      `fn name=probe returns=number[]
  handler lang=kern
    return value="[1, 2, 3].filter((x) => x)"`,
    );
    expect(code).toContain('js_truthy(');
    expect(code).toMatch(/if js_truthy\(__kern_cb_0\(__kern_el_\d+\)\)\]/);
    // The helper lands once via the helpers Set (a single def js_truthy source).
    const helperList = [...helpers];
    const jsHelpers = helperList.filter((h) => h.includes('def js_truthy('));
    expect(jsHelpers.length).toBe(1);
  });

  test('some/every lower to any()/all() with a js_truthy-wrapped predicate', () => {
    const someCode = emitFull(
      `fn name=probe returns=boolean
  handler lang=kern
    return value="[0, 1].some((x) => x > 1)"`,
    ).code;
    expect(someCode).toMatch(/any\(js_truthy\(__kern_cb_0\(__kern_el_\d+\)\) for __kern_el_\d+ in \[0, 1\]\)/);
    const everyCode = emitFull(
      `fn name=probe returns=boolean
  handler lang=kern
    return value="[[], []].every((x) => x)"`,
    ).code;
    expect(everyCode).toMatch(/all\(js_truthy\(__kern_cb_0\(__kern_el_\d+\)\) for __kern_el_\d+ in \[\[\], \[\]\]\)/);
  });

  test('member-expression callback (`this.fmt`) is NOT lowered — falls through verbatim', () => {
    // JS `.map(this.fmt)` passes the method UNBOUND, so the TS target is broken
    // for it; lowering on Python would create works-on-Python/breaks-on-TS
    // anti-parity. The gate rejects a `member` arg, so the call emits verbatim.
    const { code } = emitFull(
      `fn name=run returns=number[]
  handler lang=kern
    return value="this.items.map(this.fmt)"`,
      { inClassBody: true, symbolMap: { this: 'self' } },
    );
    expect(code).toContain('self.items.map(self.fmt)');
    expect(code).not.toContain('__kern_el_');
    expect(code).not.toContain('js_truthy');
  });

  test('a 3-param callback (el, i, arr) is NOT lowered (would be called with 2 args → TypeError)', () => {
    // The enumerate comprehension only supplies (el, i); a 3-param lambda is
    // defined with 3 params but called with 2, raising a runtime TypeError. Such
    // a shape must fall through verbatim (the pre-slice status quo), never lower.
    const { code } = emitFull(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=arr value="[1, 2, 3]"
    return value="arr.map((el, i, all) => el + i)"`,
    );
    // Must NOT produce the broken lowered comprehension that calls the callback
    // with fewer args than it declares.
    expect(code).not.toContain('__kern_el_');
    expect(code).not.toContain('__kern_ix_');
    expect(code).not.toContain('__kern_cb_');
  });
});

describe('Python find-family + flatMap + reduce array methods (class/native path)', () => {
  function findHandler(node: IRNode | null): IRNode | null {
    if (!node) return null;
    if (node.type === 'handler') return node;
    for (const child of node.children ?? []) {
      const found = findHandler(child);
      if (found) return found;
    }
    return null;
  }
  function emitFull(kern: string, options?: Parameters<typeof emitNativeKernBodyPythonWithImports>[1]) {
    const handlerNode = findHandler(parse(kern));
    expect(handlerNode).not.toBeNull();
    return emitNativeKernBodyPythonWithImports(handlerNode as IRNode, options);
  }

  test('find lowers to a next((...), None) generator with a js_truthy-wrapped predicate', () => {
    const { code } = emitFull(
      `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 3, 4].find((x) => x > 2)"`,
    );
    expect(code).toContain('js_truthy(');
    expect(code).toMatch(
      /next\(\(__kern_el_\d+ for __kern_el_\d+ in \[1, 2, 3, 4\] if js_truthy\(__kern_cb_0\(__kern_el_\d+\)\)\), None\)/,
    );
  });

  test('findIndex/findLast/findLastIndex lower to index/element next() with the right miss + reversal', () => {
    const idx = emitFull(
      `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 2].findIndex((x) => x === 2)"`,
    ).code;
    // findIndex always iterates enumerate and yields the index; miss → -1.
    expect(idx).toMatch(
      /next\(\(__kern_ix_\d+ for __kern_ix_\d+, __kern_el_\d+ in enumerate\(\[1, 2, 2\]\) if js_truthy\(__kern_cb_0\(__kern_el_\d+\)\)\), -1\)/,
    );

    const last = emitFull(
      `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 2].findLast((x) => x === 2)"`,
    ).code;
    // findLast scans a reversed view and yields the element; miss → None.
    expect(last).toMatch(
      /next\(\(__kern_el_\d+ for __kern_el_\d+ in reversed\(\[1, 2, 2\]\) if js_truthy\(__kern_cb_0\(__kern_el_\d+\)\)\), None\)/,
    );

    const lastIdx = emitFull(
      `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 2].findLastIndex((x) => x === 2)"`,
    ).code;
    // findLastIndex reverses list(enumerate(recv)) and yields the index; miss → -1.
    expect(lastIdx).toMatch(
      /next\(\(__kern_ix_\d+ for __kern_ix_\d+, __kern_el_\d+ in reversed\(list\(enumerate\(\[1, 2, 2\]\)\)\) if js_truthy\(__kern_cb_0\(__kern_el_\d+\)\)\), -1\)/,
    );
  });

  test('flatMap binds the callback result ONCE per element (single-call, no double-eval)', () => {
    const { code } = emitFull(
      `fn name=probe returns=number[]
  handler lang=kern
    return value="[1, 2, 3].flatMap((x) => [x, x * 10])"`,
    );
    // THE single-call idiom: the callback is named in a one-element `for`,
    // then flattened one level. (The route's body-substitution emits the body
    // text twice; this binds it exactly once.) No js_truthy (flatMap has no
    // predicate).
    expect(code).toMatch(/for __kern_r_0 in \[__kern_cb_0\(__kern_el_\d+\)\]/);
    expect(code).toMatch(/for __kern_y_0 in \(__kern_r_0 if isinstance\(__kern_r_0, list\) else \[__kern_r_0\]\)/);
    expect(code).not.toContain('js_truthy');
  });

  test('reduce emits __k_functools.reduce with the hoisted expression-lambda callback', () => {
    const { code, imports } = emitFull(
      `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 3].reduce((a, c) => a + c, 10)"`,
    );
    expect(code).toContain('__kern_cb_0 = lambda a, c:');
    expect(code).toContain('__k_functools.reduce(__kern_cb_0, [1, 2, 3], 10)');
    // functools registered exactly once via the imports Set.
    expect([...imports].filter((m) => m === 'functools')).toHaveLength(1);
  });

  test('reduce with a BLOCK lambda passes the hoisted def NAME to functools.reduce', () => {
    const { code } = emitFull(
      `fn name=probe returns=number
  handler lang=kern
    return value="[1, 2, 3].reduce((a, c) => { const t = a + c; return t; }, 0)"`,
    );
    const defIdx = code.indexOf('def __kern_closure_0(a, c):');
    const useIdx = code.indexOf('__k_functools.reduce(__kern_closure_0, [1, 2, 3], 0)');
    expect(defIdx).toBeGreaterThanOrEqual(0);
    expect(useIdx).toBeGreaterThan(defIdx);
  });

  test('reduceRight reverses the receiver with [::-1]', () => {
    const { code } = emitFull(
      `fn name=probe returns=string
  handler lang=kern
    return value="[\\"a\\", \\"b\\", \\"c\\"].reduceRight((a, c) => a + c)"`,
    );
    expect(code).toContain('__k_functools.reduce(__kern_cb_0, ["a", "b", "c"][::-1])');
  });

  test('a 3-param reduce callback (idx) is NOT lowered — falls through verbatim', () => {
    // functools.reduce calls the callback with exactly (acc, cur); a 3-param
    // callback declaring an index would be mis-called, so the shape must fall
    // through to a verbatim `.reduce(` emit (the pre-slice status quo).
    const { code } = emitFull(
      `fn name=probe returns=number
  handler lang=kern
    let name=arr value="[1, 2, 3]"
    return value="arr.reduce((a, c, i) => a + c + i, 0)"`,
    );
    expect(code).not.toContain('__k_functools.reduce');
    expect(code).toContain('.reduce(');
  });

  test('member-expression callback (`this.fold`) on reduce is NOT lowered — falls through verbatim', () => {
    // Same unbound-this policy as map/filter: a member callback would be passed
    // unbound, breaking the TS target, so it falls through rather than lower.
    const { code } = emitFull(
      `fn name=run returns=number
  handler lang=kern
    return value="this.items.reduce(this.fold, 0)"`,
      { inClassBody: true, symbolMap: { this: 'self' } },
    );
    expect(code).toContain('self.items.reduce(self.fold, 0)');
    expect(code).not.toContain('__k_functools.reduce');
  });
});

describe('Python closure mutation v1 (local/free assigns + nonlocal + pinned-write throw)', () => {
  function findHandler(node: IRNode | null): IRNode | null {
    if (!node) return null;
    if (node.type === 'handler') return node;
    for (const child of node.children ?? []) {
      const found = findHandler(child);
      if (found) return found;
    }
    return null;
  }
  function emit(kern: string, outerBindings?: string[]): string {
    const handlerNode = findHandler(parse(kern));
    expect(handlerNode).not.toBeNull();
    return emitNativeKernBodyPythonWithImports(handlerNode as IRNode, outerBindings ? { outerBindings } : undefined)
      .code;
  }

  test('a free-var read+write closure (MUT1) prepends `nonlocal n` as the def first body line', () => {
    // The classic accumulator: a method-local `n` written from inside the
    // closure needs `nonlocal n` so Python rebinds the OUTER binding instead of
    // creating a def-local shadow (without it: UnboundLocalError on the read).
    const code = emit(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=n value="0" kind=let
    let name=inc value="() => { n = n + 1; return n; }"
    return value="[inc(), inc(), inc()]"`,
    );
    expect(code).toContain('def __kern_closure_0():');
    // `nonlocal n` is the FIRST body line, immediately under the def header and
    // before the assignment that uses it.
    expect(code).toMatch(/def __kern_closure_0\(\):\n\s+nonlocal n\n/);
    const nlIdx = code.indexOf('nonlocal n');
    const writeIdx = code.indexOf('n = __kern_add(n, 1)');
    expect(nlIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(nlIdx);
  });

  test('a closure PARAM write lowers as a def-local assignment — NO nonlocal, NO reject', () => {
    // `(x) => { x = x + 1; return x; }` — `x` is the closure PARAM, not a free
    // capture. The gate (which cannot see params) accepts the bare-ident shape;
    // the lowerer EXCLUDES params from the written-free set → a plain local
    // assignment with no `nonlocal`. (Fixes the earlier param-write
    // misclassification.)
    const code = emit(
      `fn name=probe returns=number
  handler lang=kern
    let name=f value="(x) => { x = x + 1; return x; }"
    return value="f(4)"`,
    );
    expect(code).toContain('def __kern_closure_0(x):');
    expect(code).not.toContain('nonlocal');
    expect(code).toContain('x = __kern_add(x, 1)');
  });

  test('a compound free-var write (`x *= 2`) emits the Python compound op + nonlocal', () => {
    const code = emit(
      `fn name=probe returns=number
  handler lang=kern
    let name=x value="10" kind=let
    let name=f value="() => { x *= 2; return 0; }"
    do value="f()"
    return value="x"`,
    );
    expect(code).toMatch(/def __kern_closure_0\(\):\n\s+nonlocal x\n/);
    expect(code).toContain('x *= 2');
  });

  test('a statement-position ++ on a free var lowers to `x += 1` with nonlocal', () => {
    const code = emit(
      `fn name=probe returns=number
  handler lang=kern
    let name=x value="0" kind=let
    let name=f value="() => { x++; return 0; }"
    do value="f()"
    return value="x"`,
    );
    expect(code).toMatch(/def __kern_closure_0\(\):\n\s+nonlocal x\n/);
    expect(code).toContain('x += 1');
  });

  test('an index member write mutates a captured object by reference — NO nonlocal', () => {
    // `acc[0] = acc[0] + 1` mutates the captured list in place; Python needs no
    // `nonlocal` for a member/index write (the binding is not rebound).
    const code = emit(
      `fn name=probe returns=number
  handler lang=kern
    let name=acc value="[0]"
    let name=f value="() => { acc[0] = acc[0] + 1; return 0; }"
    do value="f()"
    return value="acc[0]"`,
    );
    expect(code).toContain('def __kern_closure_0():');
    expect(code).not.toContain('nonlocal');
    expect(code).toContain('acc[0] = __kern_add(acc[0], 1)');
  });

  test('a pinned-read + nonlocal-write closure (MUT8) emits BOTH the default-arg pin and the nonlocal', () => {
    // Inside `each x`, the closure reads the per-iteration `x` (pinned via a
    // default arg `x=x`) AND writes the outside-loop accumulator `outer`
    // (nonlocal). Both mechanisms must apply in ONE def. They target different
    // names, so the pinned/nonlocal disjointness invariant holds.
    const code = emit(
      `fn name=probe returns=number[]
  handler lang=kern
    let name=outer value="0" kind=let
    let name=fns value="[]"
    each name=x in="[1, 2]"
      do value="fns.push(() => { outer = outer + 1; return x; })"
    return value="fns"`,
    );
    expect(code).toContain('def __kern_closure_0(x=x):');
    expect(code).toContain('nonlocal outer');
  });

  test('a WRITE to a per-iteration loop capture throws closure-pinned-write (eligibility≢lowerability)', () => {
    // A free write whose binding IS a per-iteration loop-local cannot be lowered
    // in v1: the def-time default-arg pin freezes the value, and `nonlocal`
    // would rebind the wrong binding. The single-statement gate cannot see the
    // enclosing loop, so this fails closed LOUDLY at emission. Here the closure
    // writes the each-var `x` itself (a per-iteration capture).
    const kern = `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[1, 2]"
      do value="fns.push(() => { x = x + 1; return x; })"
    return value="fns"`;
    const handlerNode = findHandler(parse(kern));
    expect(() => emitNativeKernBodyPythonWithImports(handlerNode as IRNode)).toThrow(
      /per-iteration loop capture 'x'.*cell-boxing/s,
    );
  });
});
