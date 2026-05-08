/** KERN-stdlib lowering — slice 2a (Text module).
 *
 *  Module-prefixed function calls (`Text.upper(s)`) are the native-KERN
 *  syntax for what TS expresses as method calls. This test verifies that
 *  the same KERN source emits idiomatic TS via `emitExpression` and the
 *  per-target lowering table picks the right shape (method / prop / freeFn). */

import { KERN_STDLIB_MODULES, lookupStdlib, suggestStdlibMethod } from '../src/codegen/kern-stdlib.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';

describe('KERN_STDLIB table — Text module slice 2a', () => {
  test('Text module is registered as known stdlib module', () => {
    expect(KERN_STDLIB_MODULES.has('Text')).toBe(true);
  });

  test('all four slice-2a Text ops are registered with both TS and Python lowerings', () => {
    for (const op of ['upper', 'lower', 'length', 'trim']) {
      const entry = lookupStdlib('Text', op);
      expect(entry).not.toBeNull();
      expect(entry!.ts).toBeDefined();
      expect(entry!.py).toBeDefined();
    }
  });

  test('lookupStdlib returns null for unknown module', () => {
    expect(lookupStdlib('NotAModule', 'upper')).toBeNull();
  });

  test('lookupStdlib returns null for unknown method on known module', () => {
    expect(lookupStdlib('Text', 'nonsense')).toBeNull();
  });

  test('suggestStdlibMethod returns a near match', () => {
    expect(suggestStdlibMethod('Text', 'uppr')).toBe('upper');
    expect(suggestStdlibMethod('Text', 'lwr')).toBe('lower');
    expect(suggestStdlibMethod('Text', 'trims')).toBe('trim');
  });

  test('suggestStdlibMethod returns null when no candidate is close enough', () => {
    expect(suggestStdlibMethod('Text', 'completelyOffTheMap')).toBeNull();
  });
});

describe('emitExpression — TS — KERN-stdlib dispatch', () => {
  test('Text.upper(s) lowers to TS s.toUpperCase()', () => {
    expect(emitExpression(parseExpression('Text.upper(s)'))).toBe('s.toUpperCase()');
  });

  test('Text.lower(s) lowers to TS s.toLowerCase()', () => {
    expect(emitExpression(parseExpression('Text.lower(name)'))).toBe('name.toLowerCase()');
  });

  test('Text.length(s) lowers to TS s.length (property, not call)', () => {
    expect(emitExpression(parseExpression('Text.length(s)'))).toBe('s.length');
  });

  test('Text.trim(s) lowers to TS s.trim()', () => {
    expect(emitExpression(parseExpression('Text.trim(input)'))).toBe('input.trim()');
  });

  test('nested stdlib calls compose', () => {
    expect(emitExpression(parseExpression('Text.upper(Text.trim(raw))'))).toBe('raw.trim().toUpperCase()');
  });

  test('Text.upper used inside another call falls through naturally', () => {
    // Result.ok is NOT a stdlib module — the outer call uses default emit.
    expect(emitExpression(parseExpression('Result.ok(Text.upper(s))'))).toBe('Result.ok(s.toUpperCase())');
  });

  test('unknown method on known module throws with did-you-mean', () => {
    expect(() => emitExpression(parseExpression('Text.uppr(s)'))).toThrow(/Text.upper/);
  });

  test('unknown method without close match throws without suggestion', () => {
    expect(() => emitExpression(parseExpression('Text.completelyOff(s)'))).toThrow(/Unknown KERN-stdlib method/);
  });

  test('non-stdlib module passes through unchanged', () => {
    // `user.email(x)` is NOT a stdlib call — emits verbatim.
    expect(emitExpression(parseExpression('user.email(x)'))).toBe('user.email(x)');
  });

  test('plain ident.method() (not module-prefixed-call style) still emits as-is when ident is not a known module', () => {
    expect(emitExpression(parseExpression('arr.push(x)'))).toBe('arr.push(x)');
  });

  test('lambda callbacks emit through normal TS calls', () => {
    expect(emitExpression(parseExpression('() => value'))).toBe('() => value');
    expect(emitExpression(parseExpression('(a, b) => a + b'))).toBe('(a, b) => a + b');
    expect(emitExpression(parseExpression('x => y => x + y'))).toBe('x => y => x + y');
    expect(emitExpression(parseExpression('users.map(user => user.name)'))).toBe('users.map(user => user.name)');
    expect(emitExpression(parseExpression('users.map((user) => user.name)'))).toBe('users.map((user) => user.name)');
    expect(emitExpression(parseExpression('users.map((user: User) => user.name)'))).toBe(
      'users.map((user: User) => user.name)',
    );
    expect(emitExpression(parseExpression('(x => x)(5)'))).toBe('(x => x)(5)');
    expect(emitExpression(parseExpression('cond ? x => 1 : x => 2'))).toBe('cond ? (x => 1) : (x => 2)');
    expect(emitExpression(parseExpression('{ cb: x => x }'))).toBe('{ cb: x => x }');
    expect(emitExpression(parseExpression('[x => x]'))).toBe('[x => x]');
    expect(emitExpression(parseExpression('x => a ? b : c'))).toBe('x => a ? b : c');
  });

  test('stdlib template args parenthesize lambda receivers', () => {
    expect(emitExpression(parseExpression('Text.length(x => x)'))).toBe('(x => x).length');
  });

  test('List.map and List.filter lower callback expressions to TS array methods', () => {
    expect(emitExpression(parseExpression('List.map(users, user => user.name)'))).toBe('users.map(user => user.name)');
    expect(emitExpression(parseExpression('List.filter(users, user => user.active)'))).toBe(
      'users.filter(user => user.active)',
    );
  });
});
