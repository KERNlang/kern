import { isIntProvenancedExpr } from '../src/ir/semantics/portable-scalar-domain.js';
import { makeEnv } from '../src/ir/semantics/semantic-env.js';
import { parseExpression } from '../src/parser-expression.js';

describe('portable integer provenance for power chains', () => {
  test('checks a 10,001-operand power chain without consuming the host call stack', () => {
    const expression = parseExpression(new Array(10_001).fill('1').join(' ** '));

    expect(() => isIntProvenancedExpr(expression, makeEnv())).not.toThrow(RangeError);
    expect(isIntProvenancedExpr(expression, makeEnv())).toBe(true);
  });
});
