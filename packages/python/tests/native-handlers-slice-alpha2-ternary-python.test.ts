/** Native KERN handler bodies — slice α-2 Python parity for ternary.
 *
 *  TS `test ? consequent : alternate` lowers to Python's expression-form
 *  conditional `consequent if test else alternate` (operand reorder). */

import { parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

// Slice S4 — the ternary condition consumes KERN ToBoolean: the test is wrapped
// in `_kern_truthy(...)` so `{} ? a : b`/`[] ? a : b` take the consequent and
// `NaN ? a : b` takes the alternate. `_kern_truthy(...)` already parenthesizes
// the test, so the prior binary-test paren wrap is subsumed.
describe('emitPyExpression — ternary lowering', () => {
  test('basic ternary reorders to Python form (KERN truthiness test)', () => {
    expect(emitPyExpression(parseExpression('a ? b : c'))).toBe('b if _kern_truthy(a) else c');
  });

  test('binary test routes through KERN truthiness in Python form', () => {
    // Python: `b if _kern_truthy(__kern_add(a, 1)) else c` — the `+` test lowers
    // to __kern_add, then `_kern_truthy(...)` wraps it (subsuming the old parens).
    expect(emitPyExpression(parseExpression('a + 1 ? b : c'))).toBe('b if _kern_truthy(__kern_add(a, 1)) else c');
  });

  test('nested ternary in alternate gets parens', () => {
    expect(emitPyExpression(parseExpression('a ? b : c ? d : e'))).toBe(
      'b if _kern_truthy(a) else (d if _kern_truthy(c) else e)',
    );
  });

  test('ternary inside call arg', () => {
    expect(emitPyExpression(parseExpression('f(a ? b : c)'))).toBe('f(b if _kern_truthy(a) else c)');
  });
});
