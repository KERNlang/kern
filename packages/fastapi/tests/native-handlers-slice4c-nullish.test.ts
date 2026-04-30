/** Native KERN handler bodies — slice 4c (?? nullish coalesce, both targets).
 *
 *  Slice 4c lifts the slice-2 throw on `??` and ships full coverage:
 *    - TS: `??` is native; emit verbatim via the existing binary-op path
 *      (precedence already handled by needsBinaryParens).
 *    - Python: two shapes depending on whether the left side has
 *      observable side effects.
 *        - Pure (ident or non-optional member chain rooted at ident):
 *          `(L if L is not None else R)` — readable, double-name is safe.
 *        - Non-pure (call / await / binary): walrus operator binds the
 *          result inline so L is evaluated exactly once:
 *          `(__k_nc1 if (__k_nc1 := L) is not None else R)`
 *
 *  Slice 4c is the easy-win expansion picked after the 22.7% empirical-
 *  gate scan — adds an estimated +7% native eligibility on Agon-AI
 *  bodies (87 / 1249 disqualifying patterns lifted).
 */

import { parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

describe('slice 4c — ?? nullish coalesce on Python target', () => {
  test('ident left lowers to readable double-name form', () => {
    expect(emitPyExpression(parseExpression('user ?? guest'))).toBe('(user if user is not None else guest)');
  });

  test('member chain left also uses double-name form (pure receiver)', () => {
    expect(emitPyExpression(parseExpression('user.name ?? "anon"'))).toBe(
      '(user.name if user.name is not None else "anon")',
    );
  });

  test('deep member chain stays in pure form', () => {
    expect(emitPyExpression(parseExpression('user.profile.email ?? "no-email"'))).toBe(
      '(user.profile.email if user.profile.email is not None else "no-email")',
    );
  });

  test('call() left switches to walrus for single-eval', () => {
    expect(emitPyExpression(parseExpression('fetchName() ?? "default"'))).toBe(
      '(__k_nc1 if (__k_nc1 := fetchName()) is not None else "default")',
    );
  });

  test('await left switches to walrus', () => {
    expect(emitPyExpression(parseExpression('(await loadName()) ?? "default"'))).toBe(
      '(__k_nc1 if (__k_nc1 := await loadName()) is not None else "default")',
    );
  });

  test('binary left switches to walrus', () => {
    // a + b is a binary, which fails the receiver-purity check for the
    // double-name form (re-evaluating a + b is technically fine for pure
    // arithmetic, but the purity heuristic conservatively walrus-binds).
    expect(emitPyExpression(parseExpression('(a + b) ?? 0'))).toBe(
      '(__k_nc1 if (__k_nc1 := a + b) is not None else 0)',
    );
  });

  test('nested ?? — outer pure, inner non-pure — gensym counter increments', () => {
    // a ?? (call() ?? b) — outer pure (a is ident), inner non-pure (call).
    // Inner gets walrus __k_nc1; outer stays in double-name form.
    expect(emitPyExpression(parseExpression('a ?? (call() ?? b)'))).toBe(
      '(a if a is not None else (__k_nc1 if (__k_nc1 := call()) is not None else b))',
    );
  });

  test('two non-pure ?? in sequence get distinct gensym names', () => {
    // a ?? (call1() ?? call2()) — both inner sides non-pure.
    // call1 gets __k_nc1 (the LEFT walrus), the test on call2 is the RIGHT
    // side which doesn't itself trigger walrus (since walrus only fires on
    // the LEFT of a ??).
    expect(emitPyExpression(parseExpression('call1() ?? call2()'))).toBe(
      '(__k_nc1 if (__k_nc1 := call1()) is not None else call2())',
    );
  });

  test('?? with KERN-stdlib lowering on the left binds the lowered call', () => {
    // Number.floor(x) lowers to __k_math.floor(x) — a call expression,
    // hence non-pure for the purity check, hence walrus.
    expect(emitPyExpression(parseExpression('Number.floor(x) ?? 0'))).toBe(
      '(__k_nc1 if (__k_nc1 := __k_math.floor(x)) is not None else 0)',
    );
  });
});
