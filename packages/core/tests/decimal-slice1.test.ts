/** DECIMAL first-class member — Slice 1 (feasibility foundation), CORE leg.
 *
 *  Locks the TYPESCRIPT emission + the external-npm import-requirement channel +
 *  the symmetric scale fail-close on the core side. The Python twin + the
 *  differential-EXECUTION proof live in
 *  `packages/python/tests/decimal-emission-slice1-python.test.ts`.
 *
 *  Slice-1 surface (minimal, proven dispatch via `KERN_STDLIB.Decimal`):
 *    - `Decimal.of("1.5")`   construct from a STRING literal → `new Decimal("1.5")`,
 *      with the `decimal.js` import requirement recorded in the emitter's `imports`
 *      sink (the FIRST stdlib member to need an EXTERNAL npm package on the TS leg).
 *    - `Decimal.add(a, b)`   addition → `a.plus(b)` (NOT `a + b`: JS `+` on
 *      decimal.js objects calls `.valueOf()` → float, losing precision).
 *
 *  Fail-close (symmetric on both legs — same shared-core message):
 *    - non-canonical scale/significance literals (`"1.10"`, `"1E+2"`, `"-0"`, `"0.00"`)
 *    - non-string-literal construction args (`Decimal.of(0.1)`)
 *    - the bare `Decimal(...)` construction form (deferred to a typed-IR slice). */

import {
  DECIMAL_BARE_CONSTRUCTION_FAILCLOSE,
  DECIMAL_SCALE_FAILCLOSE,
  decimalImportLineTS,
  emitExpression,
  emitExpressionWithImports,
  isPortableDecimalLiteral,
  parseExpression,
} from '../src/index.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const tsWithImports = (src: string) => emitExpressionWithImports(parseExpression(src));

describe('Decimal Slice 1 — TS construction + addition emission', () => {
  test('Decimal.of("1.5") → new Decimal("1.5") + decimal.js import requirement', () => {
    const r = tsWithImports('Decimal.of("1.5")');
    expect(r.code).toBe('new Decimal("1.5")');
    expect([...r.imports]).toEqual(['decimal.js']);
  });

  test('Decimal.of("0.1") → new Decimal("0.1")', () => {
    expect(ts('Decimal.of("0.1")')).toBe('new Decimal("0.1")');
  });

  test('Decimal.add(Decimal.of("0.1"), Decimal.of("0.2")) → .plus() chain (NOT +)', () => {
    const r = tsWithImports('Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))');
    expect(r.code).toBe('new Decimal("0.1").plus(new Decimal("0.2"))');
    // The import requirement is recorded exactly once despite two constructions.
    expect([...r.imports]).toEqual(['decimal.js']);
  });

  test('emitExpression (string-only) still works and discards imports', () => {
    expect(ts('Decimal.add(Decimal.of("1.5"), Decimal.of("2.5"))')).toBe('new Decimal("1.5").plus(new Decimal("2.5"))');
  });

  test('canonical context preamble pins precision 28 + ROUND_HALF_EVEN', () => {
    const preamble = decimalImportLineTS();
    expect(preamble).toContain("import Decimal from 'decimal.js';");
    expect(preamble).toContain('precision: 28');
    expect(preamble).toContain('Decimal.ROUND_HALF_EVEN');
  });
});

describe('Decimal Slice 1 — scale/significance fail-close (TS leg)', () => {
  // Every refusal carries the shared DECIMAL_SCALE_FAILCLOSE prefix so the
  // diagnostic is grep-stable and identical to the Python twin.
  for (const lit of ['1.10', '1.2300', '0.00', '-0', '1E+2', '1.5e-10', '1.0', '007']) {
    test(`Decimal.of("${lit}") fails closed (scale-divergent literal)`, () => {
      expect(() => ts(`Decimal.of("${lit}")`)).toThrow(DECIMAL_SCALE_FAILCLOSE);
    });
  }

  // Canonical literals that DO render identically on both engines are accepted.
  for (const lit of ['0', '1', '1.5', '0.1', '0.2', '0.3', '-1.5', '42', '123.456']) {
    test(`Decimal.of("${lit}") is accepted (canonical)`, () => {
      expect(() => ts(`Decimal.of("${lit}")`)).not.toThrow();
      expect(isPortableDecimalLiteral(lit)).toBe(true);
    });
  }

  test('Decimal.of(0.1) (numeric literal, not a string) fails closed', () => {
    expect(() => ts('Decimal.of(0.1)')).toThrow('Decimal construction requires a string literal');
  });

  test('bare Decimal("1.5") fails closed (deferred construction form)', () => {
    expect(() => ts('Decimal("1.5")')).toThrow(DECIMAL_BARE_CONSTRUCTION_FAILCLOSE);
  });
});

describe('Decimal Slice 1 — isPortableDecimalLiteral discrimination', () => {
  test('rejects trailing-zero significance decimal.js would discard', () => {
    expect(isPortableDecimalLiteral('1.10')).toBe(false);
    expect(isPortableDecimalLiteral('1.2300')).toBe(false);
    expect(isPortableDecimalLiteral('0.00')).toBe(false);
    expect(isPortableDecimalLiteral('2.0')).toBe(false);
  });
  test('rejects exponent + signed-zero forms', () => {
    expect(isPortableDecimalLiteral('1E+2')).toBe(false);
    expect(isPortableDecimalLiteral('1e-7')).toBe(false);
    expect(isPortableDecimalLiteral('-0')).toBe(false);
    expect(isPortableDecimalLiteral('-0.0')).toBe(false);
  });
  test('accepts the canonical numeric envelope', () => {
    expect(isPortableDecimalLiteral('0')).toBe(true);
    expect(isPortableDecimalLiteral('0.1')).toBe(true);
    expect(isPortableDecimalLiteral('123.456')).toBe(true);
    expect(isPortableDecimalLiteral('-42')).toBe(true);
  });
});
