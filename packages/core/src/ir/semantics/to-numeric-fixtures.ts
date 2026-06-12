/**
 * Differential fixture battery for the slice-0.75 ToNumericPrimitive substrate.
 *
 * Single source of truth shared by both legs (charter §A.3):
 *   - TS leg (`packages/core/tests/ir-semantics-to-numeric.test.ts`) asserts the
 *     decision kernel against native JS `Number()` / operators for every row.
 *   - Python leg (`packages/python/tests/ir-semantics-to-number-py.test.ts`)
 *     emits the helper block + assertion calls into a module string and runs it
 *     under `python3`, checking value, `type(result) is float`, and the `-0`
 *     sign probe (tribunal amendments 1, 2 & 4).
 *
 * Every row encodes the input on BOTH targets so the two legs stay byte-aligned
 * to one oracle. `tsExpr` is JS source for the input; `pyExpr` is Python source
 * for the same value. The kernel-side input value (`value`) drives the TS leg
 * directly without re-parsing source.
 */

/** Marker for the expected numeric result, target-agnostic. */
export type ExpectedNumber =
  | { readonly kind: 'value'; readonly n: number } // ordinary finite/NaN/Inf value
  | { readonly kind: 'negzero' } // exactly -0 (sign-bit probed)
  | { readonly kind: 'poszero' } // exactly +0 (sign-bit probed as contrast)
  | { readonly kind: 'nan' }
  | { readonly kind: 'posinf' }
  | { readonly kind: 'neginf' };

export interface ToNumberFixture {
  /** Human-readable probe label, surfaced in failure output. */
  readonly probe: string;
  /** The semantic input value fed to the TS kernel directly. */
  readonly value: unknown;
  /** JS source expression producing `value` (TS leg sanity oracle = Number(tsExpr)). */
  readonly tsExpr: string;
  /** Python source expression producing the equivalent value. */
  readonly pyExpr: string;
  /** Expected ToNumber result. */
  readonly expected: ExpectedNumber;
  /**
   * Fail-closed row: the input is outside the slice-0.75 primitive domain, so
   * `toNumber` returns `{ ok:false }` (TS) and `_kern_to_number` raises (Python).
   * `expected` is ignored for these.
   */
  readonly failClosed?: true;
}

// Sentinel object the Python leg renders as `_KERN_UNDEFINED`; the TS leg maps
// it to the JS primitive `undefined`.
export const UNDEFINED_INPUT = Symbol('to-number-fixture:undefined');

const v = (n: number): ExpectedNumber => ({ kind: 'value', n });

/**
 * The primitive-domain battery. Mirrors the FROZEN oracle's Domain Table +
 * Five-Column Fixture Battery + tribunal amendment 3 grammar killers. Every
 * numeric row also asserts `type(result) is float` on the Python leg
 * (amendment 1) — that assertion is universal, not per-row data.
 */
const TO_NUMBER_FIXTURES_DATA: ToNumberFixture[] = [
  // --- numbers (NaN / ±Infinity / signed zero preserved) ---
  { probe: 'ToNumber(0)', value: 0, tsExpr: '0', pyExpr: '0.0', expected: { kind: 'poszero' } },
  { probe: 'ToNumber(-0)', value: -0, tsExpr: '-0', pyExpr: '-0.0', expected: { kind: 'negzero' } },
  { probe: 'ToNumber(1.5)', value: 1.5, tsExpr: '1.5', pyExpr: '1.5', expected: v(1.5) },
  { probe: 'ToNumber(-2.5)', value: -2.5, tsExpr: '-2.5', pyExpr: '-2.5', expected: v(-2.5) },
  { probe: 'ToNumber(NaN)', value: NaN, tsExpr: 'NaN', pyExpr: "float('nan')", expected: { kind: 'nan' } },
  {
    probe: 'ToNumber(Infinity)',
    value: Infinity,
    tsExpr: 'Infinity',
    pyExpr: "float('inf')",
    expected: { kind: 'posinf' },
  },
  {
    probe: 'ToNumber(-Infinity)',
    value: -Infinity,
    tsExpr: '-Infinity',
    pyExpr: "float('-inf')",
    expected: { kind: 'neginf' },
  },

  // --- empty / whitespace strings → +0 ---
  { probe: 'ToNumber("")', value: '', tsExpr: '""', pyExpr: "''", expected: { kind: 'poszero' } },
  {
    probe: 'ToNumber("   \\t\\n")',
    value: '   \t\n',
    tsExpr: '"   \\t\\n"',
    pyExpr: "'   \\t\\n'",
    expected: { kind: 'poszero' },
  },
  // unicode whitespace (amendment 3): NBSP / FORM FEED / LINE SEP / BOM all trim → 0
  {
    probe: 'ToNumber(unicode-ws-only)',
    value: '  ﻿',
    tsExpr: '"\\u00a0\\u000c\\u2028\\ufeff"',
    pyExpr: "'\\u00a0\\u000c\\u2028\\ufeff'",
    expected: { kind: 'poszero' },
  },
  {
    probe: 'ToNumber(unicode-ws-wrapped-5)',
    value: ' 　 5 ﻿',
    tsExpr: '"\\u00a0\\u3000 5\\u2009\\ufeff"',
    pyExpr: "'\\u00a0\\u3000 5\\u2009\\ufeff'",
    expected: v(5),
  },

  // --- trimmed decimal / exponent / fractional-edge strings ---
  { probe: 'ToNumber(" 1 ")', value: ' 1 ', tsExpr: '" 1 "', pyExpr: "' 1 '", expected: v(1) },
  { probe: 'ToNumber("-2.5")', value: '-2.5', tsExpr: '"-2.5"', pyExpr: "'-2.5'", expected: v(-2.5) },
  { probe: 'ToNumber("+3")', value: '+3', tsExpr: '"+3"', pyExpr: "'+3'", expected: v(3) },
  { probe: 'ToNumber("1e3")', value: '1e3', tsExpr: '"1e3"', pyExpr: "'1e3'", expected: v(1000) },
  { probe: 'ToNumber("-2.5e2")', value: '-2.5e2', tsExpr: '"-2.5e2"', pyExpr: "'-2.5e2'", expected: v(-250) },
  { probe: 'ToNumber(".5")', value: '.5', tsExpr: '".5"', pyExpr: "'.5'", expected: v(0.5) },
  { probe: 'ToNumber("1.")', value: '1.', tsExpr: '"1."', pyExpr: "'1.'", expected: v(1) },

  // --- radix-prefix strings (unsigned only) ---
  { probe: 'ToNumber("0x10")', value: '0x10', tsExpr: '"0x10"', pyExpr: "'0x10'", expected: v(16) },
  { probe: 'ToNumber("0b10")', value: '0b10', tsExpr: '"0b10"', pyExpr: "'0b10'", expected: v(2) },
  { probe: 'ToNumber("0o10")', value: '0o10', tsExpr: '"0o10"', pyExpr: "'0o10'", expected: v(8) },
  { probe: 'ToNumber("0xFF")', value: '0xFF', tsExpr: '"0xFF"', pyExpr: "'0xFF'", expected: v(255) },
  { probe: 'ToNumber("+0x10") → NaN', value: '+0x10', tsExpr: '"+0x10"', pyExpr: "'+0x10'", expected: { kind: 'nan' } },
  { probe: 'ToNumber("-0x10") → NaN', value: '-0x10', tsExpr: '"-0x10"', pyExpr: "'-0x10'", expected: { kind: 'nan' } },

  // --- invalid strings → NaN (amendment 3 grammar killers) ---
  { probe: 'ToNumber("abc") → NaN', value: 'abc', tsExpr: '"abc"', pyExpr: "'abc'", expected: { kind: 'nan' } },
  { probe: 'ToNumber("1,2") → NaN', value: '1,2', tsExpr: '"1,2"', pyExpr: "'1,2'", expected: { kind: 'nan' } },
  {
    probe: 'ToNumber("1_000") → NaN',
    value: '1_000',
    tsExpr: '"1_000"',
    pyExpr: "'1_000'",
    expected: { kind: 'nan' },
  },
  { probe: 'ToNumber("0x") → NaN', value: '0x', tsExpr: '"0x"', pyExpr: "'0x'", expected: { kind: 'nan' } },
  { probe: 'ToNumber("1e") → NaN', value: '1e', tsExpr: '"1e"', pyExpr: "'1e'", expected: { kind: 'nan' } },
  { probe: 'ToNumber(".") → NaN', value: '.', tsExpr: '"."', pyExpr: "'.'", expected: { kind: 'nan' } },
  { probe: 'ToNumber("+") → NaN', value: '+', tsExpr: '"+"', pyExpr: "'+'", expected: { kind: 'nan' } },
  {
    probe: 'ToNumber("0x1p3") → NaN',
    value: '0x1p3',
    tsExpr: '"0x1p3"',
    pyExpr: "'0x1p3'",
    expected: { kind: 'nan' },
  },

  // --- case-sensitive Infinity (amendment 3) ---
  {
    probe: 'ToNumber("infinity") → NaN',
    value: 'infinity',
    tsExpr: '"infinity"',
    pyExpr: "'infinity'",
    expected: { kind: 'nan' },
  },
  {
    probe: 'ToNumber("INFINITY") → NaN',
    value: 'INFINITY',
    tsExpr: '"INFINITY"',
    pyExpr: "'INFINITY'",
    expected: { kind: 'nan' },
  },
  {
    probe: 'ToNumber("Infinity")',
    value: 'Infinity',
    tsExpr: '"Infinity"',
    pyExpr: "'Infinity'",
    expected: { kind: 'posinf' },
  },
  {
    probe: 'ToNumber("+Infinity")',
    value: '+Infinity',
    tsExpr: '"+Infinity"',
    pyExpr: "'+Infinity'",
    expected: { kind: 'posinf' },
  },
  {
    probe: 'ToNumber("-Infinity")',
    value: '-Infinity',
    tsExpr: '"-Infinity"',
    pyExpr: "'-Infinity'",
    expected: { kind: 'neginf' },
  },

  // --- signed-zero strings (amendment 2 sign probes) ---
  { probe: 'ToNumber("-0") → -0', value: '-0', tsExpr: '"-0"', pyExpr: "'-0'", expected: { kind: 'negzero' } },
  { probe: 'ToNumber("0") → +0', value: '0', tsExpr: '"0"', pyExpr: "'0'", expected: { kind: 'poszero' } },

  // --- booleans → 1/0 (must be numeric, not boolean) ---
  { probe: 'ToNumber(true) → 1', value: true, tsExpr: 'true', pyExpr: 'True', expected: v(1) },
  { probe: 'ToNumber(false) → 0', value: false, tsExpr: 'false', pyExpr: 'False', expected: { kind: 'poszero' } },

  // --- null → +0, undefined → NaN ---
  { probe: 'ToNumber(null) → +0', value: null, tsExpr: 'null', pyExpr: 'None', expected: { kind: 'poszero' } },
  {
    probe: 'ToNumber(undefined) → NaN',
    value: UNDEFINED_INPUT,
    tsExpr: 'undefined',
    pyExpr: '_KERN_UNDEFINED',
    expected: { kind: 'nan' },
  },

  // --- fail-closed: object / array / custom-valueOf ---
  {
    probe: 'ToNumber({}) → diagnostic',
    value: {},
    tsExpr: '{}',
    pyExpr: '{}',
    expected: { kind: 'nan' },
    failClosed: true,
  },
  {
    probe: 'ToNumber([]) → diagnostic',
    value: [],
    tsExpr: '[]',
    pyExpr: '[]',
    expected: { kind: 'nan' },
    failClosed: true,
  },
  {
    probe: 'ToNumber([5]) → diagnostic',
    value: [5],
    tsExpr: '[5]',
    pyExpr: '[5]',
    expected: { kind: 'nan' },
    failClosed: true,
  },
  {
    probe: 'ToNumber([1,2]) → diagnostic',
    value: [1, 2],
    tsExpr: '[1,2]',
    pyExpr: '[1, 2]',
    expected: { kind: 'nan' },
    failClosed: true,
  },
  {
    probe: 'ToNumber(custom valueOf) → diagnostic',
    value: { valueOf: () => 7 },
    tsExpr: '({ valueOf() { return 7 } })',
    pyExpr: 'object()',
    expected: { kind: 'nan' },
    failClosed: true,
  },
];

export const TO_NUMBER_FIXTURES: readonly ToNumberFixture[] = Object.freeze(TO_NUMBER_FIXTURES_DATA);

/* ------------------------------------------------------------------ *
 * Integer-codomain carry-forward fixtures (oracle "Slice 3" section).
 * ------------------------------------------------------------------ */

export interface IntFixture {
  readonly probe: string;
  readonly value: unknown;
  readonly tsExpr: string;
  readonly pyExpr: string;
  readonly expected: number;
}

/** `toInt32` carry-forward fixtures (oracle Slice-3 mandatory rows). */
export const TO_INT32_FIXTURES: readonly IntFixture[] = Object.freeze([
  { probe: 'toInt32("0x10") → 16', value: '0x10', tsExpr: '"0x10"', pyExpr: "'0x10'", expected: 16 },
  { probe: 'toInt32("") → 0', value: '', tsExpr: '""', pyExpr: "''", expected: 0 },
  {
    probe: 'toInt32(undefined) → 0',
    value: UNDEFINED_INPUT,
    tsExpr: 'undefined',
    pyExpr: '_KERN_UNDEFINED',
    expected: 0,
  },
  { probe: 'toInt32(NaN) → 0', value: NaN, tsExpr: 'NaN', pyExpr: "float('nan')", expected: 0 },
  { probe: 'toInt32(Infinity) → 0', value: Infinity, tsExpr: 'Infinity', pyExpr: "float('inf')", expected: 0 },
  {
    probe: 'toInt32(2147483648) → -2147483648',
    value: 2147483648,
    tsExpr: '2147483648',
    pyExpr: '2147483648',
    expected: -2147483648,
  },
  { probe: 'toInt32(-1) → -1', value: -1, tsExpr: '-1', pyExpr: '-1', expected: -1 },
  { probe: 'toInt32(4294967297) → 1', value: 4294967297, tsExpr: '4294967297', pyExpr: '4294967297', expected: 1 },
  { probe: 'toInt32(true) → 1', value: true, tsExpr: 'true', pyExpr: 'True', expected: 1 },
  // Review hardening: beyond-2^53 / fractional-huge precision probes (expected
  // values produced by the native `x|0` oracle, never hand-computed).
  { probe: 'toInt32(2**53) → 0', value: 2 ** 53, tsExpr: '2**53', pyExpr: 'float(2**53)', expected: 0 },
  {
    probe: 'toInt32(2**53+2) → 2',
    value: 2 ** 53 + 2,
    tsExpr: '2**53+2',
    pyExpr: 'float(2**53+2)',
    expected: 2,
  },
  {
    probe: 'toInt32(1e21) → -559939584',
    value: 1e21,
    tsExpr: '1e21',
    pyExpr: '1e21',
    expected: -559939584,
  },
  {
    probe: 'toInt32(6442450943.5) → 2147483647',
    value: 6442450943.5,
    tsExpr: '6442450943.5',
    pyExpr: '6442450943.5',
    expected: 2147483647,
  },
]);

/** `toUint32` carry-forward fixtures. */
export const TO_UINT32_FIXTURES: readonly IntFixture[] = Object.freeze([
  { probe: 'toUint32(-1) → 4294967295', value: -1, tsExpr: '-1', pyExpr: '-1', expected: 4294967295 },
  { probe: 'toUint32("0x10") → 16', value: '0x10', tsExpr: '"0x10"', pyExpr: "'0x10'", expected: 16 },
  { probe: 'toUint32(NaN) → 0', value: NaN, tsExpr: 'NaN', pyExpr: "float('nan')", expected: 0 },
  { probe: 'toUint32(4294967296) → 0', value: 4294967296, tsExpr: '4294967296', pyExpr: '4294967296', expected: 0 },
  {
    probe: 'toUint32(2147483648) → 2147483648',
    value: 2147483648,
    tsExpr: '2147483648',
    pyExpr: '2147483648',
    expected: 2147483648,
  },
  // Review hardening: precision probes mirrored from the int32 set.
  {
    probe: 'toUint32(1e21) → 3735027712',
    value: 1e21,
    tsExpr: '1e21',
    pyExpr: '1e21',
    expected: 3735027712,
  },
  {
    probe: 'toUint32("0xFFFFFFFFFFFFFFFFFF") → 0',
    value: '0xFFFFFFFFFFFFFFFFFF',
    tsExpr: '"0xFFFFFFFFFFFFFFFFFF"',
    pyExpr: "'0xFFFFFFFFFFFFFFFFFF'",
    expected: 0,
  },
]);

/**
 * `toIntegerOrInfinity` carry-forward fixtures. `expected` may be `±Infinity`.
 * (Distinct return type from int32/uint32: number, possibly non-finite.)
 */
export const TO_INTEGER_OR_INFINITY_FIXTURES: readonly IntFixture[] = Object.freeze([
  { probe: 'toIntegerOrInfinity("3.9") → 3', value: '3.9', tsExpr: '"3.9"', pyExpr: "'3.9'", expected: 3 },
  { probe: 'toIntegerOrInfinity(-3.9) → -3', value: -3.9, tsExpr: '-3.9', pyExpr: '-3.9', expected: -3 },
  { probe: 'toIntegerOrInfinity(NaN) → 0', value: NaN, tsExpr: 'NaN', pyExpr: "float('nan')", expected: 0 },
  {
    probe: 'toIntegerOrInfinity(Infinity) → Infinity',
    value: Infinity,
    tsExpr: 'Infinity',
    pyExpr: "float('inf')",
    expected: Infinity,
  },
  {
    probe: 'toIntegerOrInfinity(-Infinity) → -Infinity',
    value: -Infinity,
    tsExpr: '-Infinity',
    pyExpr: "float('-inf')",
    expected: -Infinity,
  },
  {
    probe: 'toIntegerOrInfinity(undefined) → 0',
    value: UNDEFINED_INPUT,
    tsExpr: 'undefined',
    pyExpr: '_KERN_UNDEFINED',
    expected: 0,
  },
]);
