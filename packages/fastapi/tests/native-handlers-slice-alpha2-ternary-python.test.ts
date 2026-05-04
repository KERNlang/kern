/** Native KERN handler bodies — slice α-2 Python parity for ternary.
 *
 *  TS `test ? consequent : alternate` lowers to Python's expression-form
 *  conditional `consequent if test else alternate` (operand reorder). */

import { parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

describe('emitPyExpression — ternary lowering', () => {
  test('basic ternary reorders to Python form', () => {
    expect(emitPyExpression(parseExpression('a ? b : c'))).toBe('b if a else c');
  });

  test('binary test gets parens around the test in Python form', () => {
    // Python: `b if (a + 1) else c`
    expect(emitPyExpression(parseExpression('a + 1 ? b : c'))).toBe('b if (a + 1) else c');
  });

  test('nested ternary in alternate gets parens', () => {
    expect(emitPyExpression(parseExpression('a ? b : c ? d : e'))).toBe('b if a else (d if c else e)');
  });

  test('ternary inside call arg', () => {
    expect(emitPyExpression(parseExpression('f(a ? b : c)'))).toBe('f(b if a else c)');
  });
});
