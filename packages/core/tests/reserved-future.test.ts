import { tokenizeLine } from '../src/parser.js';
import {
  KERN_RESERVED,
  RESERVED_FUTURE_NAMES,
  registerEvolvedType,
  unregisterEvolvedType,
} from '../src/spec.js';
import { capabilitySupport, CAPABILITY_MATRIX } from '../src/capability-matrix.js';

describe('RESERVED_FUTURE_NAMES', () => {
  test('all future names are present in KERN_RESERVED', () => {
    for (const name of RESERVED_FUTURE_NAMES) {
      expect(KERN_RESERVED.has(name)).toBe(true);
    }
  });

  test('expected names are reserved', () => {
    for (const name of ['Result', 'Option', 'loop', 'match', 'pipe', 'enum', 'generator', 'yield', 'use', 'from']) {
      expect(KERN_RESERVED.has(name)).toBe(true);
    }
  });

  test('registerEvolvedType throws on a future-reserved name', () => {
    expect(() => registerEvolvedType('Result')).toThrow(/reserved/);
    expect(() => registerEvolvedType('match')).toThrow(/reserved/);
    expect(() => registerEvolvedType('loop')).toThrow(/reserved/);
  });

  test('registerEvolvedType throws on a core node type', () => {
    expect(() => registerEvolvedType('button')).toThrow(/reserved/);
  });

  test('registerEvolvedType still accepts non-reserved names', () => {
    expect(() => registerEvolvedType('truly-unique-test-node-xyz')).not.toThrow();
    unregisterEvolvedType('truly-unique-test-node-xyz');
  });
});

describe('LexMode dispatch', () => {
  test('non-line modes throw not-implemented', () => {
    expect(() => tokenizeLine('foo', 'expression')).toThrow(/not yet implemented/);
    expect(() => tokenizeLine('foo', 'path')).toThrow(/not yet implemented/);
    expect(() => tokenizeLine('foo', 'regex')).toThrow(/not yet implemented/);
  });

  test('line mode (default) still works', () => {
    expect(() => tokenizeLine('width=42')).not.toThrow();
    expect(() => tokenizeLine('width=42', 'line')).not.toThrow();
  });
});

describe('Capability matrix', () => {
  test('all 13 targets have entries (or empty array)', () => {
    const targets = Object.keys(CAPABILITY_MATRIX);
    expect(targets).toHaveLength(14); // 13 + 'auto'
  });

  test('lookup returns native for nextjs literal-float', () => {
    expect(capabilitySupport('nextjs', 'literal-float', 'expression')).toBe('native');
  });

  test('lookup returns lowered for fastapi literal-bigint', () => {
    expect(capabilitySupport('fastapi', 'literal-bigint', 'expression')).toBe('lowered');
  });

  test('lookup returns unsupported for unknown feature', () => {
    expect(capabilitySupport('nextjs', 'definitely-not-a-feature', 'expression')).toBe('unsupported');
  });
});
