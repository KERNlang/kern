/** KERN-stdlib lowering — slice 2a Python target (Text module).
 *
 *  Mirror of core/tests/native-handlers-stdlib.test.ts for Python. Same
 *  `Text.*(...)` source emits idiomatic Python via the `py` column of the
 *  stdlib lowering table. */

import { parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

describe('emitPyExpression — KERN-stdlib dispatch (Text module)', () => {
  test('Text.upper(s) lowers to Python s.upper()', () => {
    expect(emitPyExpression(parseExpression('Text.upper(s)'))).toBe('s.upper()');
  });

  test('Text.lower(s) lowers to Python s.lower()', () => {
    expect(emitPyExpression(parseExpression('Text.lower(name)'))).toBe('name.lower()');
  });

  test('Text.length(s) lowers to Python len(s) (free fn, not method)', () => {
    expect(emitPyExpression(parseExpression('Text.length(s)'))).toBe('len(s)');
  });

  test('Text.trim(s) lowers to Python s.strip() (NOT s.trim — that is JS)', () => {
    expect(emitPyExpression(parseExpression('Text.trim(input)'))).toBe('input.strip()');
  });

  test('nested stdlib calls compose in Python form', () => {
    // Text.upper(Text.trim(raw)) → raw.strip().upper()
    expect(emitPyExpression(parseExpression('Text.upper(Text.trim(raw))'))).toBe('raw.strip().upper()');
  });

  test('Text.length nested inside another call lowers to len(...)', () => {
    expect(emitPyExpression(parseExpression('check(Text.length(s))'))).toBe('check(len(s))');
  });

  test('unknown method on Text throws with did-you-mean (Python target)', () => {
    expect(() => emitPyExpression(parseExpression('Text.uppr(s)'))).toThrow(/Text.upper/);
  });

  test('non-stdlib module passes through unchanged in Python', () => {
    expect(emitPyExpression(parseExpression('user.email(x)'))).toBe('user.email(x)');
  });

  test('lambda callbacks lower to Python lambda expressions', () => {
    expect(emitPyExpression(parseExpression('visit(() => value)'))).toBe('visit(lambda: value)');
    expect(emitPyExpression(parseExpression('visit((a, b) => a + b)'))).toBe('visit(lambda a, b: a + b)');
    expect(emitPyExpression(parseExpression('visit(user => user.name)'))).toBe('visit(lambda user: user.name)');
    expect(emitPyExpression(parseExpression('visit((user: User) => user.name)'))).toBe('visit(lambda user: user.name)');
  });

  test('List.map and List.filter lower one-param lambdas to Python comprehensions', () => {
    expect(emitPyExpression(parseExpression('List.map(users, user => user.name)'))).toBe(
      '[user.name for user in users]',
    );
    expect(emitPyExpression(parseExpression('List.filter(users, user => user.active)'))).toBe(
      '[user for user in users if user.active]',
    );
  });

  test('lambda params shadow outer symbol-map renames', () => {
    expect(
      emitPyExpression(parseExpression('List.map(users, userId => userId.name)'), {
        symbolMap: { userId: 'user_id' },
      }),
    ).toBe('[userId.name for userId in users]');
  });

  test('List.map and List.filter reject multi-param lambdas on Python target', () => {
    expect(() => emitPyExpression(parseExpression('List.map(pairs, (a, b) => a + b)'))).toThrow(/one-parameter/);
    expect(() => emitPyExpression(parseExpression('List.filter(pairs, (a, b) => a === b)'))).toThrow(/one-parameter/);
  });
});

describe('Cross-target parity — same KERN source, idiomatic per target', () => {
  test('Text.upper(s) parity', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Text.upper(s)';
    expect(emitExpression(parseExpression(src))).toBe('s.toUpperCase()');
    expect(emitPyExpression(parseExpression(src))).toBe('s.upper()');
  });

  test('Text.length(s) parity — TS property vs Python free fn', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Text.length(s)';
    expect(emitExpression(parseExpression(src))).toBe('s.length');
    expect(emitPyExpression(parseExpression(src))).toBe('len(s)');
  });

  test('Text.trim(s) parity — same name in KERN, different targets', async () => {
    const { emitExpression } = await import('@kernlang/core');
    const src = 'Text.trim(s)';
    expect(emitExpression(parseExpression(src))).toBe('s.trim()');
    expect(emitPyExpression(parseExpression(src))).toBe('s.strip()');
  });
});
