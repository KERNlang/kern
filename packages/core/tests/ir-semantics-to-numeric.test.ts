/**
 * Slice-0.75 ToNumericPrimitive substrate — TS leg of the differential battery.
 *
 * Asserts the dependency-free decision kernel against native JS `Number()` /
 * operators as the oracle for every fixture row (tribunal amendment 4). The
 * Python leg lives in `packages/python/tests/ir-semantics-to-number-py.test.ts`
 * and consumes the SAME fixture list, so the two targets are byte-aligned to one
 * oracle.
 */

import {
  numberToInt32,
  numberToUint32,
  stringToNumber,
  toInt32,
  toIntegerOrInfinity,
  toNumber,
  toUint32,
} from '../src/index.js';
// Battery data is intentionally NOT public API — import the fixture module
// directly (review finding: test data must not ship in the runtime barrel).
import {
  type IntFixture,
  TO_INT32_FIXTURES,
  TO_INTEGER_OR_INFINITY_FIXTURES,
  TO_NUMBER_FIXTURES,
  TO_UINT32_FIXTURES,
  type ToNumberFixture,
  UNDEFINED_INPUT,
} from '../src/ir/semantics/to-numeric-fixtures.js';

/** Map a fixture's semantic input to the actual value the kernel receives. */
function kernelInput(value: unknown): unknown {
  return value === UNDEFINED_INPUT ? undefined : value;
}

/** Native-JS oracle: what `Number(...)` (or the operator) does with the input. */
function nativeNumber(value: unknown): number {
  if (value === UNDEFINED_INPUT) return Number(undefined);
  return Number(value);
}

describe('ToNumericPrimitive kernel — toNumber primitive domain (vs native Number())', () => {
  it('covers every domain-table + grammar-killer row from the frozen oracle', () => {
    // Lock the row count so a dropped fixture is a visible regression.
    expect(TO_NUMBER_FIXTURES.length).toBe(48);
  });

  it.each(TO_NUMBER_FIXTURES.map((f) => [f.probe, f] as const))('%s', (_p, fixture: ToNumberFixture) => {
    const result = toNumber(kernelInput(fixture.value));

    if (fixture.failClosed) {
      expect(result.ok).toBe(false);
      return;
    }

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const got = result.value;

    switch (fixture.expected.kind) {
      case 'nan':
        expect(Number.isNaN(got)).toBe(true);
        break;
      case 'posinf':
        expect(got).toBe(Number.POSITIVE_INFINITY);
        break;
      case 'neginf':
        expect(got).toBe(Number.NEGATIVE_INFINITY);
        break;
      case 'negzero':
        expect(Object.is(got, -0)).toBe(true);
        break;
      case 'poszero':
        expect(Object.is(got, 0)).toBe(true);
        break;
      case 'value':
        expect(got).toBe(fixture.expected.n);
        break;
    }

    // Cross-check against the native-JS oracle for every non-fail-closed row.
    const oracle = nativeNumber(fixture.value);
    if (Number.isNaN(oracle)) {
      expect(Number.isNaN(got)).toBe(true);
    } else {
      // Object.is distinguishes -0 from +0, matching the sign-probe contract.
      expect(Object.is(got, oracle)).toBe(true);
    }
  });
});

describe('ToNumericPrimitive kernel — tsExpr column is live (review fix: declared JS source is verified)', () => {
  // Evaluate each row's declared JS source and run the SAME contract on it, so
  // a drifted/wrong tsExpr cannot silently coexist with a correct `value`.
  it.each(TO_NUMBER_FIXTURES.map((f) => [f.probe, f] as const))('%s', (_p, fixture: ToNumberFixture) => {
    // biome-ignore lint/security/noGlobalEval: test-only — fixtures are first-party source strings; evaluating tsExpr IS the differential column under test
    const evaluated: unknown = (0, eval)(`(${fixture.tsExpr})`);
    if (fixture.value === UNDEFINED_INPUT) {
      expect(evaluated).toBeUndefined();
    }
    const fromExpr = toNumber(evaluated);
    const fromValue = toNumber(kernelInput(fixture.value));
    expect(fromExpr.ok).toBe(fromValue.ok);
    if (fromExpr.ok && fromValue.ok) {
      if (Number.isNaN(fromValue.value)) {
        expect(Number.isNaN(fromExpr.value)).toBe(true);
      } else {
        expect(Object.is(fromExpr.value, fromValue.value)).toBe(true);
      }
    }
  });
});

describe('ToNumericPrimitive kernel — stringToNumber equals native Number() for strings', () => {
  const stringRows = TO_NUMBER_FIXTURES.filter((f) => typeof f.value === 'string');
  it.each(stringRows.map((f) => [f.probe, f] as const))('%s', (_p, fixture) => {
    const s = fixture.value as string;
    const got = stringToNumber(s);
    const oracle = Number(s);
    if (Number.isNaN(oracle)) {
      expect(Number.isNaN(got)).toBe(true);
    } else {
      expect(Object.is(got, oracle)).toBe(true);
    }
  });
});

describe('ToNumericPrimitive kernel — toInt32 (vs native x|0)', () => {
  it.each(TO_INT32_FIXTURES.map((f) => [f.probe, f] as const))('%s', (_p, fixture: IntFixture) => {
    const result = toInt32(kernelInput(fixture.value));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(fixture.expected);
    // Native oracle: JS `Number(x) | 0` IS ToInt32.
    if (fixture.value !== UNDEFINED_INPUT) {
      expect(result.value).toBe(Number(fixture.value) | 0);
    }
  });
});

describe('ToNumericPrimitive kernel — toUint32 (vs native x>>>0)', () => {
  it.each(TO_UINT32_FIXTURES.map((f) => [f.probe, f] as const))('%s', (_p, fixture: IntFixture) => {
    const result = toUint32(kernelInput(fixture.value));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(fixture.expected);
    if (fixture.value !== UNDEFINED_INPUT) {
      expect(result.value).toBe(Number(fixture.value) >>> 0);
    }
  });
});

describe('ToNumericPrimitive kernel — toIntegerOrInfinity', () => {
  it.each(TO_INTEGER_OR_INFINITY_FIXTURES.map((f) => [f.probe, f] as const))('%s', (_p, fixture: IntFixture) => {
    const result = toIntegerOrInfinity(kernelInput(fixture.value));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(fixture.expected);
  });
});

describe('ToNumericPrimitive kernel — numberToInt32 / numberToUint32 wrap domain', () => {
  it.each([
    [0, 0, 0],
    [2147483647, 2147483647, 2147483647],
    [2147483648, -2147483648, 2147483648],
    [4294967295, -1, 4294967295],
    [4294967296, 0, 0],
    [-1, -1, 4294967295],
  ] as const)('value %d → int32 %d / uint32 %d', (value, int32, uint32) => {
    expect(numberToInt32(value)).toBe(int32);
    expect(numberToUint32(value)).toBe(uint32);
    // Native operator parity.
    expect(numberToInt32(value)).toBe(value | 0);
    expect(numberToUint32(value)).toBe(value >>> 0);
  });

  it('NaN and ±Infinity zero out under both wraps', () => {
    for (const nonFinite of [NaN, Infinity, -Infinity]) {
      expect(numberToInt32(nonFinite)).toBe(0);
      expect(numberToUint32(nonFinite)).toBe(0);
    }
  });
});

describe('ToNumericPrimitive kernel — fail-closed result is data, never a throw', () => {
  it('returns { ok:false } for objects/arrays/functions/symbols/bigint', () => {
    const exotics: unknown[] = [{}, [], [5], { valueOf: () => 7 }, () => 1, Symbol('s'), 10n];
    for (const x of exotics) {
      expect(() => toNumber(x)).not.toThrow();
      const r = toNumber(x);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(typeof r.reason).toBe('string');
    }
  });

  it('propagates fail-closed through the integer codomains', () => {
    expect(toInt32({}).ok).toBe(false);
    expect(toUint32([]).ok).toBe(false);
    expect(toIntegerOrInfinity(Symbol('s')).ok).toBe(false);
  });
});
