import { makeEnv } from '../src/ir/semantics/index.js';
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

  test('owns Decimal comparators and List, Map, and Text reads without a reference host', () => {
    const bindings = new Map<string, unknown>([
      ['d', makeDecimalValue('2')],
      ['xs', Object.freeze([1, 2, 3])],
      ['m', new Map([['answer', 42]])],
    ]);
    expect(evaluate('Decimal.gt(d, Decimal.of("1"))', bindings)).toBe(true);
    expect(evaluate('List.length(xs)', bindings)).toBe(3);
    expect(evaluate('Map.get(m, "answer")', bindings)).toBe(42);
    expect(evaluate('Text.charAt("A😀B", 1)', bindings)).toBe('😀');
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
