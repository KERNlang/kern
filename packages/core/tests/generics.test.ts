/** Slice 2f — generics on type, interface, fn, class via `generics=` prop. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { importTypeScript } from '../src/importer.js';
import { parse } from '../src/parser.js';

const gen = (src: string) => generateCoreNode(parse(src)).join('\n');

describe('Generics (Slice 2f)', () => {
  describe('type alias generics', () => {
    test('basic single type parameter', () => {
      const src = 'type name=Box generics="<T>" alias="{ value: T }"';
      expect(gen(src)).toBe('export type Box<T> = { value: T };');
    });

    test('multiple type parameters', () => {
      expect(gen('type name=Pair generics="<K, V>" alias="[K, V]"')).toBe('export type Pair<K, V> = [K, V];');
    });

    test('constrained type parameter', () => {
      expect(gen('type name=Bounded generics="<T extends number>" alias="T[]"')).toBe(
        'export type Bounded<T extends number> = T[];',
      );
    });

    test('default type parameter', () => {
      expect(gen('type name=Wrapper generics="<T = string>" alias="{ value: T }"')).toBe(
        'export type Wrapper<T = string> = { value: T };',
      );
    });
  });

  describe('interface generics', () => {
    test('generic interface with field referencing T', () => {
      const out = gen('interface name=List generics="<T>"\n  field name=items type="T[]"');
      expect(out).toContain('export interface List<T> {');
      expect(out).toContain('items: T[];');
    });

    test('generic interface extending another generic', () => {
      const out = gen('interface name=StringList generics="<T extends string>" extends="List<T>"');
      expect(out).toContain('export interface StringList<T extends string> extends List<T> {');
    });
  });

  describe('fn generics', () => {
    test('generic function with type-parameterised input/output', () => {
      const src =
        'fn name=identity generics="<T>" params="x:T" returns=T export=true\n  handler <<<\n    return x;\n  >>>';
      expect(gen(src)).toContain('export function identity<T>(x: T): T {');
    });

    test('generic function with constraint', () => {
      const src =
        'fn name=clone generics="<T extends object>" params="x:T" returns=T\n  handler <<<\n    return { ...x };\n  >>>';
      expect(gen(src)).toContain('function clone<T extends object>(x: T): T {');
    });

    test('async generic function', () => {
      const src =
        'fn name=fetchOne generics="<T>" params="url:string" returns="Promise<T>" async=true\n  handler <<<\n    return fetch(url).then((r) => r.json());\n  >>>';
      expect(gen(src)).toContain('async function fetchOne<T>(url: string): Promise<T> {');
    });

    test('generic function with overloads', () => {
      // Each overload signature emits the same generic block as the impl.
      const src =
        'fn name=ident generics="<T>" params="x:any" returns=any\n' +
        '  overload params="x:T" returns=T\n' +
        '  handler <<<\n' +
        '    return x;\n' +
        '  >>>';
      const out = gen(src);
      expect(out).toContain('function ident<T>(x: T): T;');
      expect(out).toContain('function ident<T>(x: any): any {');
    });
  });

  describe('class generics', () => {
    test('basic generic class', () => {
      const out = gen('class name=Container generics="<T>" export=true');
      expect(out).toContain('export class Container<T> {');
    });

    test('generic class with extends and implements', () => {
      const src = 'class name=Repo generics="<T extends Entity>" extends="BaseRepo<T>" implements="Iterable<T>"';
      const out = gen(src);
      expect(out).toContain('class Repo<T extends Entity> extends BaseRepo<T> implements Iterable<T> {');
    });
  });

  describe('TS importer round-trip', () => {
    test('imports type alias generics', () => {
      const result = importTypeScript('export type Box<T> = { value: T };', 'box.ts');
      expect(result.kern).toContain('generics="<T>"');
    });

    test('imports interface generics with constraint', () => {
      const result = importTypeScript('export interface List<T extends object> { items: T[]; }', 'list.ts');
      expect(result.kern).toContain('generics="<T extends object>"');
    });

    test('imports function generics', () => {
      const result = importTypeScript('export function identity<T>(x: T): T { return x; }', 'id.ts');
      expect(result.kern).toContain('generics="<T>"');
    });

    test('imports class generics', () => {
      const result = importTypeScript('export class Container<T> { value!: T; }', 'c.ts');
      expect(result.kern).toContain('generics="<T>"');
    });

    test('full round-trip for generic function', () => {
      const tsIn = 'export function identity<T>(x: T): T { return x; }';
      const kern = importTypeScript(tsIn, 'id.ts').kern;
      const tsOut = generateCoreNode(parse(kern)).join('\n');
      expect(tsOut).toContain('export function identity<T>(x: T): T {');
      expect(tsOut).toContain('return x;');
    });
  });

  describe('capability matrix', () => {
    test('generics is native on TS targets', () => {
      expect(capabilitySupport('lib', 'generics', 'top-level')).toBe('native');
    });

    test('generics is unsupported on Python', () => {
      expect(capabilitySupport('fastapi', 'generics', 'top-level')).toBe('unsupported');
    });
  });
});
