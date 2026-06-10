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
});
