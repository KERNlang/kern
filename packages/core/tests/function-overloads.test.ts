/** Slice 2e — function overloads via `overload` child of fn.
 *
 *  Each overload emits a `function name(params): R;` declaration before the
 *  implementation signature. The implementation handler runs at runtime;
 *  overload signatures are TS-only dispatch guides. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';
import { isKnownNodeType, RESERVED_FUTURE_NAMES } from '../src/spec.js';

const gen = (src: string) => generateCoreNode(parse(src)).join('\n');

describe('Function overloads (Slice 2e)', () => {
  describe('spec changes', () => {
    test("'overload' is not a reserved future name", () => {
      expect(RESERVED_FUTURE_NAMES.includes('overload')).toBe(false);
    });

    test("'overload' is a known core node", () => {
      expect(isKnownNodeType('overload')).toBe(true);
      expect(isCoreNode('overload')).toBe(true);
    });
  });

  describe('codegen', () => {
    test('two overloads + implementation', () => {
      const src =
        'fn name=add params="a:any,b:any" returns=any export=true\n' +
        '  overload params="a:number,b:number" returns=number\n' +
        '  overload params="a:string,b:string" returns=string\n' +
        '  handler <<<\n' +
        '    return a + b;\n' +
        '  >>>';
      const out = gen(src);
      expect(out).toContain('export function add(a: number, b: number): number;');
      expect(out).toContain('export function add(a: string, b: string): string;');
      expect(out).toContain('export function add(a: any, b: any): any {');
      expect(out).toContain('return a + b;');
    });

    test('single overload + implementation', () => {
      const src =
        'fn name=greet params="x:any" returns=string\n' +
        '  overload params="x:string" returns=string\n' +
        '  handler <<<\n' +
        '    return `Hello, ${x}`;\n' +
        '  >>>';
      const out = gen(src);
      expect(out).toContain('function greet(x: string): string;');
      expect(out).toContain('function greet(x: any): string {');
    });

    test('overload signature without returns omits the colon', () => {
      const src =
        'fn name=ident params="x:any" returns=any\n' +
        '  overload params="x:T"\n' +
        '  handler <<<\n' +
        '    return x;\n' +
        '  >>>';
      const out = gen(src);
      expect(out).toContain('function ident(x: T);');
    });

    test('overloads emit in source order before implementation', () => {
      const src =
        'fn name=parse params="input:any" returns=unknown\n' +
        '  overload params="input:string" returns=string\n' +
        '  overload params="input:number" returns=number\n' +
        '  overload params="input:boolean" returns=boolean\n' +
        '  handler <<<\n' +
        '    return input;\n' +
        '  >>>';
      const out = gen(src);
      const lines = out.split('\n');
      const stringIdx = lines.findIndex((l) => l.includes('input: string'));
      const numberIdx = lines.findIndex((l) => l.includes('input: number'));
      const booleanIdx = lines.findIndex((l) => l.includes('input: boolean'));
      const implIdx = lines.findIndex((l) => l.includes('input: any'));
      expect(stringIdx).toBeGreaterThanOrEqual(0);
      expect(numberIdx).toBeGreaterThan(stringIdx);
      expect(booleanIdx).toBeGreaterThan(numberIdx);
      expect(implIdx).toBeGreaterThan(booleanIdx);
    });

    test('non-exported fn with overloads omits export prefix on signatures too', () => {
      const src =
        'fn name=internal params="x:any" returns=any export=false\n' +
        '  overload params="x:number" returns=number\n' +
        '  handler <<<\n' +
        '    return x;\n' +
        '  >>>';
      const out = gen(src);
      expect(out).toMatch(/^function internal\(x: number\): number;/m);
      expect(out).not.toContain('export function internal');
    });
  });

  describe('capability matrix', () => {
    test('function-overloads is native on TS targets', () => {
      expect(capabilitySupport('lib', 'function-overloads', 'top-level')).toBe('native');
    });

    test('function-overloads is unsupported on Python', () => {
      expect(capabilitySupport('fastapi', 'function-overloads', 'top-level')).toBe('unsupported');
    });
  });
});
