/** Slice 2e — function overloads via `overload` child of fn.
 *
 *  Each overload emits a `function name(params): R;` declaration before the
 *  implementation signature. The implementation handler runs at runtime;
 *  overload signatures are TS-only dispatch guides. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { importTypeScript } from '../src/importer.js';
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

  describe('default-param defense (Codex + Gemini)', () => {
    // TS forbids parameter initializers in overload signatures. parseParamList
    // must strip them when called with stripDefaults — otherwise overload
    // signatures emit invalid TS like `function f(x: number = 1);`.

    test('overload signatures strip default values', () => {
      const src =
        'fn name=add params="a:number,b:number" returns=number\n' +
        '  overload params="a:number=0,b:number=0" returns=number\n' +
        '  handler <<<\n' +
        '    return a + b;\n' +
        '  >>>';
      const out = gen(src);
      expect(out).toContain('function add(a: number, b: number): number;');
      // No defaults on the overload signature.
      expect(out).not.toMatch(/function add\(a: number = 0/);
    });

    test('implementation signature retains defaults', () => {
      const src =
        'fn name=add params="a:number=0,b:number=0" returns=number\n' +
        '  overload params="a:number,b:number" returns=number\n' +
        '  handler <<<\n' +
        '    return a + b;\n' +
        '  >>>';
      const out = gen(src);
      expect(out).toContain('function add(a: number = 0, b: number = 0): number {');
    });
  });

  describe('TS importer round-trip (Gemini)', () => {
    // convertFunction processed each TS FunctionDeclaration in isolation.
    // For overloaded TS functions, that produced N separate `fn` nodes — broken.
    // The fix groups consecutive same-named function declarations into a single
    // `fn` with `overload` children.

    test('groups TS overloads into one fn with overload children', () => {
      const ts = [
        'export function add(a: number, b: number): number;',
        'export function add(a: string, b: string): string;',
        'export function add(a: any, b: any): any {',
        '  return a + b;',
        '}',
      ].join('\n');
      const result = importTypeScript(ts, 'add.ts');
      // One fn header (impl), two overload children.
      const fnHeaderCount = (result.kern.match(/^fn name=add /gm) || []).length;
      expect(fnHeaderCount).toBe(1);
      expect(result.kern).toContain('overload params="a:number,b:number" returns=number');
      expect(result.kern).toContain('overload params="a:string,b:string" returns=string');
    });

    test('full TS → KERN → TS round-trip preserves overloads', () => {
      const tsIn = [
        'export function add(a: number, b: number): number;',
        'export function add(a: string, b: string): string;',
        'export function add(a: any, b: any): any {',
        '  return a + b;',
        '}',
      ].join('\n');
      const kern = importTypeScript(tsIn, 'add.ts').kern;
      const tsOut = generateCoreNode(parse(kern)).join('\n');
      expect(tsOut).toContain('export function add(a: number, b: number): number;');
      expect(tsOut).toContain('export function add(a: string, b: string): string;');
      expect(tsOut).toContain('export function add(a: any, b: any): any {');
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
