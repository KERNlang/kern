/** Slice 2c — `indexer` child node for interfaces. Emits TS index signatures. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';
import { isKnownNodeType, RESERVED_FUTURE_NAMES } from '../src/spec.js';

const gen = (src: string) => generateCoreNode(parse(src)).join('\n');

describe('Indexer node (Slice 2c)', () => {
  describe('spec changes', () => {
    test("'indexer' is no longer reserved", () => {
      expect(RESERVED_FUTURE_NAMES.includes('indexer')).toBe(false);
    });

    test("'indexer' is a known core node", () => {
      expect(isKnownNodeType('indexer')).toBe(true);
      expect(isCoreNode('indexer')).toBe(true);
    });
  });

  describe('codegen', () => {
    test('basic string-keyed indexer', () => {
      const src = 'interface name=StringMap\n  indexer keyType=string type=number';
      const out = gen(src);
      expect(out).toContain('export interface StringMap {');
      expect(out).toContain('[key: string]: number;');
      expect(out).toContain('}');
    });

    test('number-keyed indexer', () => {
      const src = 'interface name=NumMap\n  indexer keyType=number type=string';
      expect(gen(src)).toContain('[key: number]: string;');
    });

    test('custom keyName', () => {
      const src = 'interface name=Cache\n  indexer keyName=cacheKey keyType=string type=Buffer';
      expect(gen(src)).toContain('[cacheKey: string]: Buffer;');
    });

    test('readonly indexer', () => {
      const src = 'interface name=Frozen\n  indexer keyType=string type=unknown readonly=true';
      expect(gen(src)).toContain('readonly [key: string]: unknown;');
    });

    test('indexer alongside fields', () => {
      const src = 'interface name=Mixed\n  field name=length type=number\n  indexer keyType=string type=any';
      const out = gen(src);
      expect(out).toContain('length: number;');
      expect(out).toContain('[key: string]: any;');
    });

    test('multiple indexers (string + number)', () => {
      // TS allows both string and number index signatures on the same type
      const src = 'interface name=DualKey\n  indexer keyType=string type=string\n  indexer keyType=number type=string';
      const out = gen(src);
      expect(out).toContain('[key: string]: string;');
      expect(out).toContain('[key: number]: string;');
    });

    test('complex value type', () => {
      const src = 'interface name=ListMap\n  indexer keyType=string type="number[]"';
      expect(gen(src)).toContain('[key: string]: number[];');
    });
  });

  describe('capability matrix', () => {
    test('index-signature is native on TS targets', () => {
      expect(capabilitySupport('lib', 'index-signature', 'top-level')).toBe('native');
    });

    test('index-signature is unsupported on Python', () => {
      expect(capabilitySupport('fastapi', 'index-signature', 'top-level')).toBe('unsupported');
    });
  });
});
