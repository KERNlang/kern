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
