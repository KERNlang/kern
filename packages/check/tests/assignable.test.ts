/**
 * Unit tests for the `assignable` ergonomic wrapper and the re-exported core
 * functions. Behavioural equivalence to the originals is proven separately in
 * equivalence.test.ts; here we pin the wrapper's tri-state shape and reasons.
 */
import { describe, expect, test } from '../../../scripts/node-test-compat.ts';

import type { NominalClassInfo } from '../dist/assignable.js';
import { assignable, checkOverrideVariance, isNominalSubtype } from '../dist/assignable.js';

function universe(): Map<string, NominalClassInfo> {
  return new Map<string, NominalClassInfo>([
    ['Animal', { name: 'Animal' }],
    ['Dog', { name: 'Dog', baseName: 'Animal' }],
    ['Puppy', { name: 'Puppy', baseName: 'Dog' }],
    ['Cat', { name: 'Cat', baseName: 'Animal' }],
  ]);
}

describe('assignable wrapper', () => {
  test('subtype → ok:true, no reason', () => {
    expect(assignable('Dog', 'Animal', universe())).toEqual({ ok: true });
    expect(assignable('Puppy', 'Animal', universe())).toEqual({ ok: true });
  });

  test('identity → ok:true', () => {
    expect(assignable('Dog', 'Dog', universe())).toEqual({ ok: true });
  });

  test('non-subtype → ok:false with reason', () => {
    const r = assignable('Animal', 'Dog', universe());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('Animal is not a subtype of Dog');
  });

  test('sibling → ok:false', () => {
    expect(assignable('Cat', 'Dog', universe()).ok).toBe(false);
  });

  test('undefined name → ok:unknown with reason', () => {
    const r = assignable(undefined, 'Dog', universe());
    expect(r.ok).toBe('unknown');
    expect(r.reason).toContain('cannot decide');
    expect(r.reason).toContain('undefined');
  });

  test('unknown (non-class) name → ok:unknown', () => {
    const r = assignable('Ghost', 'Dog', universe());
    expect(r.ok).toBe('unknown');
  });

  test('empty universe, distinct names → unknown', () => {
    expect(assignable('Dog', 'Animal', new Map()).ok).toBe('unknown');
  });

  test('empty universe, identical names → true (=== short-circuit)', () => {
    expect(assignable('Dog', 'Dog', new Map())).toEqual({ ok: true });
  });
});

describe('re-exported core functions', () => {
  test('isNominalSubtype tri-state', () => {
    const u = universe();
    expect(isNominalSubtype('Puppy', 'Animal', u)).toBe(true);
    expect(isNominalSubtype('Animal', 'Puppy', u)).toBe(false);
    expect(isNominalSubtype('prim', 'Animal', u)).toBe('unknown');
    expect(isNominalSubtype(undefined, undefined, u)).toBe('unknown');
  });

  test('checkOverrideVariance verdicts', () => {
    const u = universe();
    // covariant return narrow → ok (null)
    expect(
      checkOverrideVariance(
        { kind: 'method', arity: 0, returns: 'Dog', paramTypes: [] },
        { kind: 'method', arity: 0, returns: 'Animal', paramTypes: [] },
        u,
      ),
    ).toBe(null);
    // covariant return widen → return-mismatch
    expect(
      checkOverrideVariance(
        { kind: 'method', arity: 0, returns: 'Animal', paramTypes: [] },
        { kind: 'method', arity: 0, returns: 'Dog', paramTypes: [] },
        u,
      ),
    ).toBe('return-mismatch');
    // contravariant param narrow → param-mismatch
    expect(
      checkOverrideVariance(
        { kind: 'method', arity: 1, returns: 'Animal', paramTypes: ['Dog'] },
        { kind: 'method', arity: 1, returns: 'Animal', paramTypes: ['Animal'] },
        u,
      ),
    ).toBe('param-mismatch');
    // mixed accessor kinds → skip (null)
    expect(
      checkOverrideVariance(
        { kind: 'getter', arity: 0, returns: 'Animal', paramTypes: [] },
        { kind: 'setter', arity: 1, returns: undefined, paramTypes: ['Animal'] },
        u,
      ),
    ).toBe(null);
  });
});
