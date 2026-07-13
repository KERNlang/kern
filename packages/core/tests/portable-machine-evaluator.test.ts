import {
  DECIMAL_DIV_ZERO_FAILCLOSE,
  DECIMAL_MOD_ZERO_FAILCLOSE,
  DECIMAL_POW_NEGATIVE_BASE_FAILCLOSE,
  DECIMAL_SCALE_FAILCLOSE,
} from '../src/decimal/contract.js';
import { makeEnv } from '../src/ir/semantics/index.js';
import { isDecimalExpression } from '../src/ir/semantics/portable-decimal-evaluator.js';
import { evalPortableValue } from '../src/ir/semantics/portable-machine-evaluator.js';
import { makeDecimalValue } from '../src/ir/semantics/portable-scalar-domain.js';
import { parseExpression } from '../src/parser-expression.js';

function evaluate(source: string, bindings: ReadonlyMap<string, unknown> = new Map()): unknown {
  const env = makeEnv();
  for (const [name, value] of bindings) env.bindings.set(name, value);
  return evalPortableValue(parseExpression(source), env);
}

describe('portable machine evaluator', () => {
  test('owns the existing scalar, conditional, template, member, and index domain', () => {
    const bindings = new Map<string, unknown>([
      ['xs', Object.freeze([2, 3])],
      ['record', Object.freeze({ label: 'ok', items: Object.freeze([7, 8]) })],
    ]);
    expect(evaluate('(2 + 3) * 4', bindings)).toBe(20);
    expect(evaluate('true ? "yes" : "no"', bindings)).toBe('yes');
    expect(evaluate('`v=${xs[0]}`', bindings)).toBe('v=2');
    expect(evaluate('record.label', bindings)).toBe('ok');
    expect(evaluate('record.items.length', bindings)).toBe(2);
    expect(evaluate('record.items[1]', bindings)).toBe(8);
  });

  test('owns scalar Decimal comparisons, including nested value producers, without returning Decimal objects', () => {
    const bindings = new Map<string, unknown>([
      ['d', makeDecimalValue('2')],
      ['xs', Object.freeze([1, 2, 3])],
      ['m', new Map([['answer', 42]])],
    ]);
    expect(evaluate('Decimal.gt(d, Decimal.of("1"))', bindings)).toBe(true);
    expect(evaluate('Decimal.eq(Decimal.add(Decimal.of("1"), Decimal.of("2")), Decimal.of("3"))', bindings)).toBe(true);
    expect(() => evaluate('Decimal.add(Decimal.of("1"), Decimal.of("2"))', bindings)).toThrow(
      'unsupported non-identifier call',
    );
  });

  test('rejects comparator calls as Decimal value operands and identifies missing Decimal bindings', () => {
    expect(
      isDecimalExpression(
        parseExpression('Decimal.add(Decimal.eq(Decimal.of("1"), Decimal.of("1")), Decimal.of("2"))'),
      ),
    ).toBe(false);
    expect(() => evaluate('Decimal.eq(missing, Decimal.of("1"))')).toThrow(
      'portable-decimal: binding "missing" not found',
    );
  });

  test('preserves Decimal zero-divisor and computed-negative-base fences inside scalar comparisons', () => {
    expect(() => evaluate('Decimal.eq(Decimal.div(Decimal.of("1"), Decimal.of("0")), Decimal.of("0"))')).toThrow(
      DECIMAL_DIV_ZERO_FAILCLOSE,
    );
    expect(() => evaluate('Decimal.eq(Decimal.mod(Decimal.of("1"), Decimal.of("0")), Decimal.of("0"))')).toThrow(
      DECIMAL_MOD_ZERO_FAILCLOSE,
    );
    expect(() =>
      evaluate('Decimal.eq(Decimal.pow(Decimal.neg(Decimal.of("2")), Decimal.of("2")), Decimal.of("4"))'),
    ).toThrow(DECIMAL_POW_NEGATIVE_BASE_FAILCLOSE);
    expect(() =>
      evaluate('Decimal.eq(Decimal.pow(Decimal.neg(Decimal.of("2")), Decimal.of("01")), Decimal.of("4"))'),
    ).toThrow(DECIMAL_SCALE_FAILCLOSE);
    expect(() =>
      evaluate(
        'Decimal.eq(Decimal.div(Decimal.of("1"), zero), Decimal.of("0"))',
        new Map([['zero', makeDecimalValue('0')]]),
      ),
    ).toThrow(DECIMAL_DIV_ZERO_FAILCLOSE);
    expect(
      evaluate(
        'Decimal.eq(Decimal.pow(Decimal.neg(Decimal.sub(Decimal.of("1"), Decimal.of("1"))), Decimal.of("2")), Decimal.of("0"))',
      ),
    ).toBe(true);
  });

  test('owns List, Map, and Text reads without a reference host', () => {
    const bindings = new Map<string, unknown>([
      ['xs', Object.freeze([1, 2, 3])],
      ['m', new Map([['answer', 42]])],
    ]);
    expect(evaluate('List.length(xs)', bindings)).toBe(3);
    expect(evaluate('Map.get(m, "answer")', bindings)).toBe(42);
    expect(evaluate('Text.charAt("A😀B", 1)', bindings)).toBe('😀');
  });

  test('fails closed on zero divisors and uses canonical scalar string coercion', () => {
    expect(() => evaluate('1 / 0')).toThrow('must evaluate to a portable scalar');
    expect(() => evaluate('1 % 0')).toThrow('must evaluate to a portable scalar');
    expect(evaluate('String(true)')).toBe('true');
    expect(evaluate('String(false)')).toBe('false');
    expect(evaluate('String(null)')).toBe('null');
    expect(evaluate('`${true}/${false}/${null}`')).toBe('true/false/null');
  });

  test('fails closed on direct function and class execution', () => {
    const instance = {
      __kernRunnerClassInstance: true,
      className: 'Counter',
      fields: { value: 1 },
    };
    const bindings = new Map<string, unknown>([['counter', instance]]);
    expect(() => evaluate('helper()', bindings)).toThrow('function call "helper" is outside the machine scalar domain');
    expect(() => evaluate('counter.value', bindings)).toThrow('outside the portable scalar domain');
    expect(() => evaluate('counter.read()', bindings)).toThrow('unsupported non-identifier call');
    expect(() => evaluate('new Counter()', bindings)).toThrow('outside the portable scalar domain');
  });
});
