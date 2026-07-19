import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression, tokenizeExpression } from '../src/parser-expression.js';
import { KERN_POWER_HELPER_JS } from '../src/portable-power.js';
import type { ValueIR } from '../src/value-ir.js';

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

describe('binary exponentiation expression contract', () => {
  test('tokenizer fuses exactly two adjacent stars and rejects token neighbors downstream', () => {
    expect(tokenizeExpression('a ** b').map(({ kind, value }) => [kind, value])).toEqual([
      ['ident', 'a'],
      ['power', '**'],
      ['ident', 'b'],
      ['eof', ''],
    ]);
    for (const source of ['a *** b', 'a **** b', 'a * * b']) {
      expect(() => parseExpression(source)).toThrow();
    }
  });

  test('parser is right-associative and preserves explicit left nesting', () => {
    const rightNested = power(ident('a'), power(ident('b'), ident('c')));
    const leftNested = power(power(ident('a'), ident('b')), ident('c'));
    expect(structural(parseExpression('a ** b ** c'))).toEqual(rightNested);
    expect(structural(parseExpression('a ** (b ** c)'))).toEqual(rightNested);
    expect(structural(parseExpression('(a ** b) ** c'))).toEqual(leftNested);
  });

  test('power binds tighter than multiplicative operators', () => {
    expect(parseExpression('a * b ** c')).toEqual({
      kind: 'binary',
      op: '*',
      left: ident('a'),
      right: power(ident('b'), ident('c')),
    });
    expect(parseExpression('a ** b * c')).toEqual({
      kind: 'binary',
      op: '*',
      left: power(ident('a'), ident('b')),
      right: ident('c'),
    });
  });

  test('unparenthesized unary left operands reject while explicit operands remain host-neutral', () => {
    expect(() => parseExpression('-a ** b')).toThrow(/left operand of '\*\*'.*parenthesized/u);
    expect(structural(parseExpression('(-a) ** b'))).toEqual(
      power({ kind: 'unary', op: '-', argument: ident('a') }, ident('b')),
    );
    expect(structural(parseExpression('a ** -b'))).toEqual(
      power(ident('a'), { kind: 'unary', op: '-', argument: ident('b') }),
    );
    expect(structural(parseExpression('a ** (-b)'))).toEqual(
      power(ident('a'), { kind: 'unary', op: '-', argument: ident('b') }),
    );
  });

  test('all supported prefix-form left operands require explicit source parentheses', () => {
    for (const source of ['await a ** b', 'new Box() ** b']) {
      expect(() => parseExpression(source)).toThrow(/left operand of '\*\*'.*parenthesized/u);
    }
    for (const source of ['(await a) ** b', '(new Box()) ** b']) {
      expect(() => parseExpression(source)).not.toThrow();
    }
    for (const source of ['a ** await b', 'a ** new Box()']) {
      expect(() => parseExpression(source)).not.toThrow();
    }
  });

  test('spread operands fail closed at parser and direct-IR emission boundaries', () => {
    for (const source of ['...a ** b', '(...a) ** b', 'a ** ...b', 'a ** (...b)']) {
      expect(() => parseExpression(source)).toThrow(/spread operands/u);
    }

    const spread = { kind: 'spread', argument: ident('items') } as const;
    const wrappedSpreads = [
      spread,
      { kind: 'typeAssert', expression: spread, type: 'unknown' } as const,
      { kind: 'nonNull', expression: spread } as const,
      { kind: 'propagate', argument: spread, op: '?' } as const,
    ];
    for (const operand of wrappedSpreads) {
      const expressions = [power(operand, ident('b')), power(ident('a'), operand)];
      for (const expression of expressions) {
        expect(() => emitExpression(expression)).toThrow(/spread operands/u);
        expect(() =>
          emitExpression(expression, {
            coerceJsValues: true,
            isUserBinding: () => false,
          }),
        ).toThrow(/spread operands/u);
      }
    }
  });

  test('long power chains parse iteratively without overflowing the host call stack', () => {
    const source = new Array(10_001).fill('1').join(' ** ');
    expect(() => parseExpression(source)).not.toThrow(RangeError);
  });

  test('long power chains emit iteratively on raw and native TypeScript paths', () => {
    const source = new Array(10_001).fill('1').join(' ** ');
    const parsed = parseExpression(source);
    const raw = emitExpression(parsed);
    const native = emitExpression(parsed, {
      coerceJsValues: true,
      isUserBinding: () => false,
    });

    expect(raw.split(' ** ')).toHaveLength(10_001);
    expect(native.startsWith('__kern_pow_int([')).toBe(true);
    expect(native.split(', ')).toHaveLength(10_001);
  });

  test('native emission does not consume one host call argument per power operand', () => {
    const source = new Array(65_537).fill('1').join(' ** ');
    const native = emitExpression(parseExpression(source), {
      coerceJsValues: true,
      isUserBinding: () => false,
    });

    expect(() => Function(`${KERN_POWER_HELPER_JS}\nreturn ${native};`)()).not.toThrow();
  });

  test('TS emission preserves both trees and parenthesizes unary power operands', () => {
    const leftNested = power(power(ident('a'), ident('b')), ident('c'));
    const rightNested = power(ident('a'), power(ident('b'), ident('c')));
    expect(emitExpression(leftNested)).toBe('(a ** b) ** c');
    expect(emitExpression(rightNested)).toBe('a ** b ** c');
    expect(structural(parseExpression(emitExpression(leftNested)))).toEqual(leftNested);
    expect(structural(parseExpression(emitExpression(rightNested)))).toEqual(rightNested);
    expect(emitExpression(power({ kind: 'unary', op: '-', argument: ident('a') }, ident('b')))).toBe('(-a) ** b');
    expect(emitExpression(power(ident('a'), { kind: 'unary', op: '-', argument: ident('b') }))).toBe('a ** (-b)');
  });

  test('tree direction is value-discriminating', () => {
    const two = { kind: 'numLit', value: 2, raw: '2' } as const;
    const three = { kind: 'numLit', value: 3, raw: '3' } as const;
    const left = emitExpression(power(power(two, three), two));
    const right = emitExpression(power(two, power(three, two)));
    expect(Function(`return ${left}`)()).toBe(64);
    expect(Function(`return ${right}`)()).toBe(512);
  });

  test('native TS emission routes power through the private checked helper', () => {
    const emitted = emitExpression(power(ident('a'), ident('b')), {
      coerceJsValues: true,
      isUserBinding: () => false,
    });
    expect(emitted).toBe('__kern_pow_int([a, b])');
  });
});
