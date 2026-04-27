/** Slice 2a — tuple type support.
 *
 *  Tuples are implemented via the existing `type.alias` prop + `emitTypeAnnotation`'s
 *  bracket-balance pass; this slice formalises that contract with regression coverage
 *  and capability-matrix declaration. No new node type is added — the `tuple` reserved
 *  name in spec.ts is kept reserved for a possible future syntactic-sugar slice. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';

const gen = (src: string) => generateCoreNode(parse(src)).join('\n');

describe('Tuple types (Slice 2a)', () => {
  describe('via type.alias', () => {
    test('two-element tuple', () => {
      expect(gen('type name=Pair alias="[string, number]"')).toBe('export type Pair = [string, number];');
    });

    test('single-element tuple', () => {
      expect(gen('type name=Single alias="[string]"')).toBe('export type Single = [string];');
    });

    test('three-element tuple', () => {
      expect(gen('type name=Triple alias="[string, number, boolean]"')).toBe(
        'export type Triple = [string, number, boolean];',
      );
    });

    test('tuple with optional trailing element', () => {
      expect(gen('type name=Opt alias="[string, number?]"')).toBe('export type Opt = [string, number?];');
    });

    test('tuple with rest element', () => {
      expect(gen('type name=Rest alias="[string, ...number[]]"')).toBe('export type Rest = [string, ...number[]];');
    });

    test('labeled (named) tuple elements', () => {
      expect(gen('type name=Person alias="[name: string, age: number]"')).toBe(
        'export type Person = [name: string, age: number];',
      );
    });

    test('nested tuple', () => {
      expect(gen('type name=Nested alias="[string, [number, boolean]]"')).toBe(
        'export type Nested = [string, [number, boolean]];',
      );
    });

    test('empty tuple', () => {
      expect(gen('type name=Empty alias="[]"')).toBe('export type Empty = [];');
    });
  });

  describe('via field.type', () => {
    test('tuple as interface field type', () => {
      const out = gen('interface name=Pair\n  field name=value type="[string, number]"');
      expect(out).toContain('value: [string, number];');
    });
  });

  describe('via fn.returns', () => {
    test('tuple as fn return type', () => {
      const out = gen('fn name=getPair returns="[string, number]"');
      expect(out).toContain('): [string, number] {');
    });
  });

  describe('capability-matrix', () => {
    test('tuple-type is declared native on TS targets', () => {
      // pick one representative TS target — they all share TS_NUMERIC_LITERALS
      expect(capabilitySupport('lib', 'tuple-type', 'top-level')).toBe('native');
      expect(capabilitySupport('nextjs', 'tuple-type', 'top-level')).toBe('native');
      expect(capabilitySupport('terminal', 'tuple-type', 'top-level')).toBe('native');
    });

    test('tuple-type is declared lowered on Python target (fastapi)', () => {
      // Python has tuples, but the form differs from TS; flag for slice-by-slice attention.
      expect(capabilitySupport('fastapi', 'tuple-type', 'top-level')).toBe('lowered');
    });
  });
});
