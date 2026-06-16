/** TERNARY-PRECEDENCE codegen fix — the discriminating RED-at-base oracle.
 *
 *  BUG (confirmed systemic, agon codex audit 2026-06-16 + verified empirically on both
 *  legs): KERN's expression emitter drops the parentheses a `conditional` operand needs
 *  when it sits under a higher-precedence operator. `?:` (TS) / `... if ... else ...`
 *  (Python) bind LOOSER than `*`/`await`/call, so an unwrapped conditional operand
 *  silently re-associates — `(true ? 2 : 3) * 5` compiles to `true ? 2 : 3 * 5` (= 2,
 *  not 10). It also breaks TS↔Python byte-parity (the Python call-callee + await cases
 *  emit unwrapped while TS wraps).
 *
 *  ROOT CAUSE: ad-hoc parenthesization instead of one precedence-aware "subexpression
 *  operand" policy. TS emitter = `packages/core/src/codegen-expression.ts`; Python =
 *  `packages/python/src/codegen-body-python.ts`. The fix must wrap a `conditional`
 *  child in EVERY low-precedence operand position on BOTH legs — and must NOT
 *  over-wrap (the guards below pin already-correct output so a "wrap everything" cheat
 *  fails).
 *
 *  Python note: `+` lowers to `__kern_add(...)` (call-delimited, inherently safe), so
 *  these fixtures use `*` (raw infix on BOTH legs) where the bug actually bites. */

import { emitExpression, parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

// ── RED at base — a `conditional` operand under a tighter operator must be wrapped ──
describe('ternary-precedence — conditional operand is parenthesized (currently RED)', () => {
  // #1 generic infix (binary `*`) — WRONG on BOTH legs at base.
  test('(ternary) * x — left operand, both legs', () => {
    expect(ts('(true ? 2 : 3) * 5')).toBe('(true ? 2 : 3) * 5');
    expect(py('(true ? 2 : 3) * 5')).toBe('(2 if _kern_truthy(True) else 3) * 5');
  });
  test('x * (ternary) — right operand, both legs', () => {
    expect(ts('5 * (false ? 2 : 3)')).toBe('5 * (false ? 2 : 3)');
    expect(py('5 * (false ? 2 : 3)')).toBe('5 * (2 if _kern_truthy(False) else 3)');
  });
  // #2 call callee — WRONG on Python (TS already wraps → also a parity divergence).
  test('(ternary)(x) — call callee, Python', () => {
    expect(py('(ok ? f : g)(x)')).toBe('(f if _kern_truthy(ok) else g)(x)');
  });
  // #3 await operand — WRONG on Python.
  test('await (ternary) — Python', () => {
    expect(py('await (ok ? a() : b())')).toBe('await (a() if _kern_truthy(ok) else b())');
  });
});

// ── GREEN guards — pin already-correct output so the fix can't OVER-wrap / regress ──
describe('ternary-precedence — guards (must stay byte-identical, no spurious parens)', () => {
  test('TS call callee + await already wrap correctly — must not break', () => {
    expect(ts('(ok ? f : g)(x)')).toBe('(ok ? f : g)(x)');
    expect(ts('await (ok ? a() : b())')).toBe('await (ok ? a() : b())');
  });
  test('member receiver of a ternary is wrapped on both legs — must stay', () => {
    expect(ts('(a ? b : c).d')).toBe('(a ? b : c).d');
    expect(py('(a ? b : c).d')).toBe('(b if _kern_truthy(a) else c).d');
  });
  test('plain binary chains gain NO spurious parentheses', () => {
    expect(ts('2 * 3 + 4')).toBe('2 * 3 + 4');
    expect(py('2 * 3 + 4')).toBe('__kern_add(2 * 3, 4)');
    expect(ts('2 * 5')).toBe('2 * 5');
    expect(py('a + b')).toBe('__kern_add(a, b)');
  });
});
