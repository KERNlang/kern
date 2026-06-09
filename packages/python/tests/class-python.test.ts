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
});
