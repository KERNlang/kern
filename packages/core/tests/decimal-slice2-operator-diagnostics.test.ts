/** DECIMAL Slice 2 — remediation Finding 2: the operator fail-close must NOT mask
 *  the real diagnostic of a bad Decimal operand (CORE / TypeScript leg).
 *
 *  Before the remediation, the binary-emit site asserted `assertNoDecimalOperator`
 *  BEFORE lowering operands, and `isSyntacticDecimalProducer` treated ANY
 *  `Decimal.<member>(...)` as Decimal-producing. So:
 *    - `Decimal.nope("1") + 1`     reported the generic operator error instead of
 *      the real "unknown stdlib member" error, and
 *    - `Decimal.of("1.10") + 1`    reported the generic operator error instead of
 *      the real non-canonical-literal error.
 *
 *  The remediation (a) narrows `isSyntacticDecimalProducer` to the KNOWN producing
 *  methods (`of`/`add`/`sub`/`mul`/`neg`/`abs`) so an unknown member is no longer a
 *  "proven producer", and (b) lowers operands BEFORE the operator assert so a bad
 *  operand throws its own diagnostic first. The valid-producer operator fail-close
 *  (`Decimal.of("1") + Decimal.of("2")`) still fires. The Python twin asserts the
 *  byte-identical behaviour in `packages/python/tests/decimal-emission-slice2-python.test.ts`. */

import {
  DECIMAL_OPERATOR_FAILCLOSE,
  DECIMAL_SCALE_FAILCLOSE,
  emitExpression,
  isSyntacticDecimalProducer,
  parseExpression,
} from '../src/index.js';

const ts = (src: string): string => emitExpression(parseExpression(src));

describe('Decimal Slice 2 — operator fail-close no longer masks the real diagnostic (Finding 2)', () => {
  test('Decimal.nope("1") + 1 → unknown-member error (NOT the operator error)', () => {
    expect(() => ts('Decimal.nope("1") + 1')).toThrow(/Unknown KERN-stdlib method\/member 'Decimal\.nope'/);
    // It must NOT be masked by the generic operator fail-close.
    expect(() => ts('Decimal.nope("1") + 1')).not.toThrow(DECIMAL_OPERATOR_FAILCLOSE);
  });

  test('Decimal.of("1.10") + 1 → non-canonical-literal error (NOT the operator error)', () => {
    expect(() => ts('Decimal.of("1.10") + 1')).toThrow(DECIMAL_SCALE_FAILCLOSE);
    expect(() => ts('Decimal.of("1.10") + 1')).not.toThrow(DECIMAL_OPERATOR_FAILCLOSE);
  });

  test('Decimal.of("1") + Decimal.of("2") → operator fail-close STILL fires on valid producers', () => {
    expect(() => ts('Decimal.of("1") + Decimal.of("2")')).toThrow(DECIMAL_OPERATOR_FAILCLOSE);
  });

  test('the narrowing also covers -/* (sub/mul producers still trip the operator fail-close)', () => {
    expect(() => ts('Decimal.of("3") - Decimal.of("1")')).toThrow(DECIMAL_OPERATOR_FAILCLOSE);
    expect(() => ts('Decimal.of("2") * Decimal.of("4")')).toThrow(DECIMAL_OPERATOR_FAILCLOSE);
  });

  test('plain numeric arithmetic is completely unaffected', () => {
    expect(ts('1 + 2')).toBe('1 + 2');
    expect(ts('a - b')).toBe('a - b');
  });

  describe('isSyntacticDecimalProducer is narrowed to the known producing methods', () => {
    const call = (src: string): unknown => parseExpression(src);

    test('known producers return true', () => {
      for (const method of ['of', 'add', 'sub', 'mul', 'neg', 'abs']) {
        const src =
          method === 'of' || method === 'neg' || method === 'abs'
            ? `Decimal.${method}("1")`
            : `Decimal.${method}(a, b)`;
        expect(isSyntacticDecimalProducer(call(src))).toBe(true);
      }
    });

    test('an UNKNOWN Decimal member is NOT a proven producer', () => {
      expect(isSyntacticDecimalProducer(call('Decimal.nope("1")'))).toBe(false);
      expect(isSyntacticDecimalProducer(call('Decimal.div(a, b)'))).toBe(false);
      expect(isSyntacticDecimalProducer(call('Decimal.toString()'))).toBe(false);
    });

    test('non-Decimal receivers and non-call shapes return false', () => {
      expect(isSyntacticDecimalProducer(call('Math.max(a, b)'))).toBe(false);
      expect(isSyntacticDecimalProducer(call('decimal.of("1")'))).toBe(false);
      expect(isSyntacticDecimalProducer(call('1 + 2'))).toBe(false);
    });
  });
});
