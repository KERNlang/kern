import { spawnSync } from 'node:child_process';

import { parseExpression } from '../../core/src/parser-expression.js';
import type { ValueIR } from '../../core/src/value-ir.js';
import { emitPyExpression, emitPyExpressionWithImports } from '../src/codegen-body-python.js';

function ident(name: string): ValueIR {
  return { kind: 'ident', name };
}

function power(left: ValueIR, right: ValueIR): ValueIR {
  return { kind: 'binary', op: '**', left, right };
}

function structural(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structural);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== 'parenthesized' || record.kind === 'lambda')
      .map(([key, entry]) => [key, structural(entry)]),
  );
}

function executePython(node: ValueIR) {
  const emitted = emitPyExpressionWithImports(node);
  const source = [...emitted.helpers, `print(${emitted.code})`].join('\n\n');
  return spawnSync('python3', ['-c', source], { encoding: 'utf8' });
}

function evaluatePython(node: ValueIR): number {
  const result = executePython(node);
  expect(result.status).toBe(0);
  return Number(result.stdout.trim());
}

describe('Python binary exponentiation contract', () => {
  test('emission preserves both trees and reparses to the same KERN IR', () => {
    const leftNested = power(power(ident('a'), ident('b')), ident('c'));
    const rightNested = power(ident('a'), power(ident('b'), ident('c')));
    const raw = { coerceJsValues: false } as const;
    expect(emitPyExpression(leftNested, raw)).toBe('(a ** b) ** c');
    expect(emitPyExpression(rightNested, raw)).toBe('a ** b ** c');
    expect(structural(parseExpression(emitPyExpression(leftNested, raw)))).toEqual(leftNested);
    expect(structural(parseExpression(emitPyExpression(rightNested, raw)))).toEqual(rightNested);
  });

  test('unary operands use the same explicit spelling as TS', () => {
    const raw = { coerceJsValues: false } as const;
    expect(emitPyExpression(power({ kind: 'unary', op: '-', argument: ident('a') }, ident('b')), raw)).toBe(
      '(-a) ** b',
    );
    expect(emitPyExpression(power(ident('a'), { kind: 'unary', op: '-', argument: ident('b') }), raw)).toBe(
      'a ** (-b)',
    );
  });

  test('native emission registers and calls the checked integer-power helper', () => {
    const emitted = emitPyExpressionWithImports(power(ident('a'), ident('b')));
    expect(emitted.code).toBe('_kern_pow_int([a, b])');
    expect(emitted.helpers.size).toBe(1);
    expect([...emitted.helpers][0]).toContain('def _kern_pow_int(operands):');
  });

  test('spread operands fail closed on raw and native Python emission', () => {
    const spread = { kind: 'spread', argument: ident('items') } as const;
    const wrappedSpreads = [
      spread,
      { kind: 'typeAssert', expression: spread, type: 'unknown' } as const,
      { kind: 'nonNull', expression: spread } as const,
      { kind: 'propagate', argument: spread, op: '?' } as const,
    ];
    for (const operand of wrappedSpreads) {
      for (const expression of [power(operand, ident('b')), power(ident('a'), operand)]) {
        expect(() => emitPyExpression(expression, { coerceJsValues: false })).toThrow(/spread operands/u);
        expect(() => emitPyExpressionWithImports(expression)).toThrow(/spread operands/u);
      }
    }
  });

  test('Python helper does not resolve safety builtins through authored module bindings', () => {
    const emitted = emitPyExpressionWithImports(parseExpression('2 ** 53'));
    const source = [
      'abs = lambda value: 0',
      'len = lambda values: 2',
      'isinstance = lambda value, kind: True',
      'int = lambda value: value',
      'float = object()',
      'bool = object()',
      'range = lambda *args: [0]',
      'type = lambda value: int',
      'Exception = RuntimeError',
      ...emitted.helpers,
      `print(${emitted.code})`,
    ].join('\n\n');
    const result = spawnSync('python3', ['-c', source], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('portable: ** result exceeds the safe-integer domain');
  });

  test('Python helper rejects hostile numeric subclasses before invoking overloaded operators', () => {
    const emitted = emitPyExpressionWithImports(parseExpression('2 ** 3'));
    for (const [definition, value] of [
      ['class Hostile(int):\n    pass', 'Hostile(2)'],
      ['class Hostile(float):\n    pass', 'Hostile(2.0)'],
    ] as const) {
      const source = [...emitted.helpers, definition, `print(_kern_pow_int([${value}, 3]))`].join('\n\n');
      const result = spawnSync('python3', ['-c', source], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'portable: ** requires a safe-integer base and nonnegative safe-integer exponent',
      );
    }
  });

  test('long power chains emit one flat checked call without host recursion', () => {
    const parsed = parseExpression(new Array(10_001).fill('1').join(' ** '));
    const emitted = emitPyExpressionWithImports(parsed);
    expect(emitted.code.startsWith('_kern_pow_int([')).toBe(true);
    expect(emitted.code.split(', ')).toHaveLength(10_001);
  });

  test('Python execution discriminates left and right nesting', () => {
    const two = { kind: 'numLit', value: 2, raw: '2' } as const;
    const three = { kind: 'numLit', value: 3, raw: '3' } as const;
    expect(evaluatePython(power(power(two, three), two))).toBe(64);
    expect(evaluatePython(power(two, power(three, two)))).toBe(512);
  });

  test('Python helper agrees on safe extremes and rejects invalid domains before host power', () => {
    expect(evaluatePython(parseExpression('1 ** 9007199254740991'))).toBe(1);
    expect(evaluatePython(parseExpression('(-1) ** 9007199254740991'))).toBe(-1);

    for (const [source, diagnostic] of [
      ['2 ** -1', 'portable: ** requires a safe-integer base and nonnegative safe-integer exponent'],
      ['(-0) ** 3', 'portable: ** requires a safe-integer base and nonnegative safe-integer exponent'],
      ['2 ** 53', 'portable: ** result exceeds the safe-integer domain'],
    ] as const) {
      const result = executePython(parseExpression(source));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(diagnostic);
    }
  });
});
