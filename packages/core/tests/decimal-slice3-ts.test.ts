/** DECIMAL Slice 3 — TS-leg emission, compile-time fail-close, preamble rendering,
 *  and producer-detection lockstep for div/mod/pow + the comparators.
 *
 *  The byte-exact RUNTIME parity is proven by the differential-EXECUTION oracle in
 *  `@kernlang/python` (`decimal-emission-slice3-python.test.ts`), which runs BOTH
 *  node+decimal.js and python3+decimal. THIS suite locks the TS-leg lowering shapes,
 *  the symmetric compile-time refusals, and that the auto-emitted file-level Decimal
 *  preamble now carries the guarded ops helpers. */

import {
  assertPortableDecimalPow,
  DECIMAL_OPERATOR_FAILCLOSE,
  DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
  decimalOfLiteralValue,
  decimalOpsHelpersTS,
  detectKernStdlibUsage,
  emitExpression,
  emitExpressionWithImports,
  kernStdlibPreamble,
  parseExpression,
} from '../src/index.js';
import type { IRNode } from '../src/types.js';

const ts = (src: string): string => emitExpression(parseExpression(src));

describe('Decimal Slice 3 — TS div/mod/pow lowering (guarded helpers)', () => {
  test('div → __k_decimal_div(...)', () => {
    expect(ts('Decimal.div(Decimal.of("1"), Decimal.of("3"))')).toBe(
      '__k_decimal_div(new Decimal("1"), new Decimal("3"))',
    );
  });
  test('mod → __k_decimal_mod(...)', () => {
    expect(ts('Decimal.mod(Decimal.of("-5.5"), Decimal.of("2"))')).toBe(
      '__k_decimal_mod(new Decimal("-5.5"), new Decimal("2"))',
    );
  });
  test('pow → __k_decimal_pow_int(...)', () => {
    expect(ts('Decimal.pow(Decimal.of("2"), Decimal.of("3"))')).toBe(
      '__k_decimal_pow_int(new Decimal("2"), new Decimal("3"))',
    );
  });
  test('div records the decimal.js import', () => {
    const r = emitExpressionWithImports(parseExpression('Decimal.div(Decimal.of("1"), Decimal.of("3"))'));
    expect([...r.imports]).toEqual(['decimal.js']);
  });
});

describe('Decimal Slice 3 — TS comparison lowering (native, NOT through stringifier)', () => {
  test('eq/ne/lt/lte/gt/gte → native decimal.js methods', () => {
    expect(ts('Decimal.eq(Decimal.of("1"), Decimal.of("1"))')).toBe('new Decimal("1").eq(new Decimal("1"))');
    expect(ts('Decimal.ne(Decimal.of("1"), Decimal.of("2"))')).toBe('!new Decimal("1").eq(new Decimal("2"))');
    expect(ts('Decimal.lt(Decimal.of("1"), Decimal.of("2"))')).toBe('new Decimal("1").lt(new Decimal("2"))');
    expect(ts('Decimal.lte(Decimal.of("2"), Decimal.of("2"))')).toBe('new Decimal("2").lte(new Decimal("2"))');
    expect(ts('Decimal.gt(Decimal.of("3"), Decimal.of("2"))')).toBe('new Decimal("3").gt(new Decimal("2"))');
    expect(ts('Decimal.gte(Decimal.of("3"), Decimal.of("3"))')).toBe('new Decimal("3").gte(new Decimal("3"))');
  });
  test('cmp → native .cmp() (plain number)', () => {
    expect(ts('Decimal.cmp(Decimal.of("1"), Decimal.of("2"))')).toBe('new Decimal("1").cmp(new Decimal("2"))');
  });
});

describe('Decimal Slice 3 — compile-time pow fail-close (TS leg)', () => {
  test('non-integer exponent literal', () => {
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.of("0.5"))')).toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
  test('negative base literal', () => {
    expect(() => ts('Decimal.pow(Decimal.of("-2"), Decimal.of("3"))')).toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
  test('non-literal (dynamic) exponent — the soundness-critical refusal', () => {
    expect(() => ts('Decimal.pow(Decimal.of("2"), x)')).toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.add(Decimal.of("1"), Decimal.of("1")))')).toThrow(
      DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
    );
  });
  test('integer exponent on non-negative base ships (incl. 0**0 and negative exp)', () => {
    expect(() => ts('Decimal.pow(Decimal.of("0"), Decimal.of("0"))')).not.toThrow();
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.of("3"))')).not.toThrow();
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.of("-1"))')).not.toThrow();
  });
  test('assertPortableDecimalPow is callable directly on raw IR', () => {
    const goodBase = parseExpression('Decimal.of("2")');
    const goodExp = parseExpression('Decimal.of("3")');
    expect(() => assertPortableDecimalPow(goodBase, goodExp)).not.toThrow();
    const badExp = parseExpression('Decimal.of("2.5")');
    expect(() => assertPortableDecimalPow(goodBase, badExp)).toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
});

describe('Decimal Slice 3 — decimalOfLiteralValue helper', () => {
  test('extracts the literal from a Decimal.of("...") call', () => {
    expect(decimalOfLiteralValue(parseExpression('Decimal.of("3")'))).toBe('3');
    expect(decimalOfLiteralValue(parseExpression('Decimal.of("-7")'))).toBe('-7');
  });
  test('returns null for a non-Decimal.of shape', () => {
    expect(decimalOfLiteralValue(parseExpression('x'))).toBeNull();
    expect(decimalOfLiteralValue(parseExpression('Decimal.add(Decimal.of("1"), Decimal.of("2"))'))).toBeNull();
    expect(decimalOfLiteralValue(parseExpression('Other.of("3")'))).toBeNull();
  });
});

describe('Decimal Slice 3 — operator fail-close extends to div/mod/pow producers', () => {
  // div/mod/pow PRODUCE a Decimal, so `Decimal.div(a,b) + 1` trips the operator
  // fail-close exactly like add (a JS `+` on a decimal.js value degrades to float).
  test('Decimal.div(...) + Decimal.of(...) fails closed', () => {
    expect(() => ts('Decimal.div(Decimal.of("1"), Decimal.of("3")) + Decimal.of("1")')).toThrow(
      DECIMAL_OPERATOR_FAILCLOSE,
    );
  });
  // Comparators return bool/int — NOT a Decimal — so `Decimal.eq(a,b) + 1` is
  // ordinary boolean→number arithmetic and must NOT be refused.
  test('Decimal.eq(...) + 1 is NOT a Decimal-operator misuse (bool result)', () => {
    expect(() => ts('Decimal.eq(Decimal.of("1"), Decimal.of("1")) + 1')).not.toThrow();
  });
  test('Decimal.cmp(...) + 1 is NOT a Decimal-operator misuse (int result)', () => {
    expect(() => ts('Decimal.cmp(Decimal.of("1"), Decimal.of("2")) + 1')).not.toThrow();
  });
});

describe('Decimal Slice 3 — file-level preamble carries the guarded ops helpers', () => {
  function kernHandlerUsing(expr: string): IRNode {
    return {
      type: 'fn',
      props: { name: 'f' },
      children: [{ type: 'handler', props: { lang: 'kern' }, children: [{ type: 'return', props: { value: expr } }] }],
    };
  }

  test('a div handler flips usage.decimal and the preamble emits the helpers', () => {
    const usage = detectKernStdlibUsage(kernHandlerUsing('Decimal.div(Decimal.of("1"), Decimal.of("3"))'));
    expect(usage.decimal).toBe(true);
    const preamble = kernStdlibPreamble(usage).join('\n');
    expect(preamble).toContain("import Decimal from 'decimal.js';");
    expect(preamble).toContain('function __k_decimal_div');
    expect(preamble).toContain('function __k_decimal_mod');
    expect(preamble).toContain('function __k_decimal_pow_int');
  });

  test('a comparator-only handler ALSO pulls the decimal preamble (native .eq needs the import)', () => {
    const usage = detectKernStdlibUsage(kernHandlerUsing('Decimal.eq(Decimal.of("1"), Decimal.of("1"))'));
    expect(usage.decimal).toBe(true);
  });

  test('the ops-helper text references only the imported Decimal + Error', () => {
    const helpers = decimalOpsHelpersTS();
    expect(helpers).toContain('b.isZero()');
    expect(helpers).toContain('a.isZero() && b.lt(0)');
    expect(helpers).toContain('a.isZero() && b.isZero()');
    expect(helpers).toContain('new Decimal(1)');
  });

  test('a Decimal-FREE handler does NOT flip usage.decimal (no helper leak)', () => {
    const usage = detectKernStdlibUsage(kernHandlerUsing('Math.max(a, b)'));
    expect(usage.decimal).toBeFalsy();
  });
});
