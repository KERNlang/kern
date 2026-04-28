/** Slice 2b — `enum` node tests.
 *
 *  Numeric enum: `enum name=X values="A|B|C"` → `export enum X { A, B, C }`.
 *  String enum: `enum name=X` + `member name=A value="..."` children.
 *  Const enum: `enum name=X const=true ...` prepends `const`. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';
import { isKnownNodeType, RESERVED_FUTURE_NAMES } from '../src/spec.js';

const gen = (src: string) => generateCoreNode(parse(src)).join('\n');

describe('Enum node (Slice 2b)', () => {
  describe('spec changes', () => {
    test("'enum' is no longer a reserved future name", () => {
      expect(RESERVED_FUTURE_NAMES.includes('enum')).toBe(false);
    });

    test("'enum' is a known core node type", () => {
      expect(isKnownNodeType('enum')).toBe(true);
      expect(isCoreNode('enum')).toBe(true);
    });

    test("'member' is a known core node type", () => {
      expect(isKnownNodeType('member')).toBe(true);
      expect(isCoreNode('member')).toBe(true);
    });
  });

  describe('numeric enum (values=)', () => {
    test('basic three-member enum', () => {
      expect(gen('enum name=Status values="Pending|Active|Done"')).toBe('export enum Status { Pending, Active, Done }');
    });

    test('single-member enum', () => {
      expect(gen('enum name=One values="Only"')).toBe('export enum One { Only }');
    });

    test('export=false drops export prefix', () => {
      expect(gen('enum name=Hidden values="A|B" export=false')).toBe('enum Hidden { A, B }');
    });

    test('const enum', () => {
      expect(gen('enum name=Flag values="On|Off" const=true')).toBe('export const enum Flag { On, Off }');
    });

    test('empty enum (no values, no members)', () => {
      expect(gen('enum name=Empty')).toBe('export enum Empty {}');
    });
  });

  describe('string enum (member children)', () => {
    test('two string members', () => {
      const src = 'enum name=Direction\n  member name=Up value="UP"\n  member name=Down value="DOWN"';
      const out = gen(src);
      expect(out).toContain('export enum Direction {');
      expect(out).toContain('Up = "UP",');
      expect(out).toContain('Down = "DOWN",');
      expect(out).toContain('}');
    });

    test('member with bare numeric value', () => {
      const src = 'enum name=HttpCode\n  member name=Ok value=200\n  member name=NotFound value=404';
      const out = gen(src);
      expect(out).toContain('Ok = 200,');
      expect(out).toContain('NotFound = 404,');
    });

    test('member with expression-block value', () => {
      const src = 'enum name=Mask\n  member name=A value={{ 1 << 0 }}\n  member name=B value={{ 1 << 1 }}';
      const out = gen(src);
      expect(out).toContain('A = 1 << 0,');
      expect(out).toContain('B = 1 << 1,');
    });

    test('member without value emits bare name (default numeric)', () => {
      const src = 'enum name=Color\n  member name=Red\n  member name=Green';
      const out = gen(src);
      expect(out).toContain('Red,');
      expect(out).toContain('Green,');
    });

    test('member children take precedence over values=', () => {
      // If both are provided, members win and values is silently ignored.
      const src = 'enum name=X values="A|B"\n  member name=Custom value="custom"';
      const out = gen(src);
      expect(out).toContain('Custom = "custom",');
      expect(out).not.toContain('A,');
      expect(out).not.toContain('B,');
    });
  });

  describe('capability matrix', () => {
    test('enum-type is native on TS targets', () => {
      expect(capabilitySupport('lib', 'enum-type', 'top-level')).toBe('native');
      expect(capabilitySupport('nextjs', 'enum-type', 'top-level')).toBe('native');
    });

    test('enum-type is unsupported on Python until FastAPI generator handles it', () => {
      expect(capabilitySupport('fastapi', 'enum-type', 'top-level')).toBe('unsupported');
    });
  });
});
