/**
 * Runner-native ERROR substrate (Slice 1) — explicit `throw new Error("…")`.
 *
 * This is the third "leg" of the error-message differential oracle: the
 * ReferenceRunner executes an EXPLICIT canonical-Error throw natively, byte-
 * matching both emitted legs (TS `new Error("x").message` === Python
 * `str(Exception("x"))`). The caught-binding `.message` READ is handled in
 * `portable-scalar.ts`'s `member` case (it reads the tagged caught-error value
 * this module's {@link makeCaughtErrorValue} builds and `try.ts` binds).
 *
 * DOMAIN (admitted) — exactly the shape both emitters lower identically:
 *   - `throw new Error("<string-expr>")` where the argument evaluates to a
 *     portable STRING (a literal, a template, a string-binding read). The
 *     evaluated literal message is carried on the canonical error's `message`
 *     field (NOT messagePattern — that stays the imprecise path for implicit
 *     primitive throws whose raw text diverges across runtimes).
 *
 * FAIL-CLOSE (refused — the runner ABSTAINS so it never emits a one-leg value):
 *   - a bare-value throw (`throw "raw"`, `throw 42`) — JS `"raw".message` is
 *     `undefined` but Python wraps to `Exception` so `str(e)` === "raw". DIVERGE.
 *     {@link isExplicitErrorThrow} returns false for these → throw primitive
 *     precondition fails → abstain.
 */

import type { ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';
import { CAUGHT_ERROR_TAG, type CaughtErrorValue, evalPortableValue } from './portable-scalar.js';
import type { CanonicalError } from './trace.js';

/** Build a tagged caught-error value from a canonical error that carries an
 *  evaluated literal `message`. Returns `null` for an error WITHOUT a literal
 *  message (an implicit/primitive throw modeled by messagePattern) — those are
 *  out of this slice's domain, so the catch binding stays unset and any read of
 *  it abstains. */
export function makeCaughtErrorValue(error: CanonicalError): CaughtErrorValue | null {
  if (typeof error.message !== 'string') return null;
  return Object.freeze({ [CAUGHT_ERROR_TAG]: true as const, kind: error.kind, message: error.message });
}

/** True iff `node` is the canonical explicit-throw shape `new Error(<arg>)` —
 *  a `new` whose argument is a CALL of the bare `Error` ident with exactly one
 *  argument. This is the SAME shape the emitters recognize (TS keeps
 *  `new Error(x)`; Python remaps `Error` → `Exception`). Any other throw value
 *  (a bare string/number, `new TypeError(...)`, `new Error()` with no arg) is
 *  NOT matched → the runner abstains. */
export function isExplicitErrorThrow(node: ValueIR): node is Extract<ValueIR, { kind: 'new' }> {
  if (node.kind !== 'new') return false;
  const arg = node.argument;
  return (
    arg.kind === 'call' &&
    arg.callee.kind === 'ident' &&
    arg.callee.name === 'Error' &&
    !arg.optional &&
    arg.args.length === 1
  );
}

/**
 * Evaluate an explicit `new Error("<string-expr>")` throw value to a canonical
 * error carrying the evaluated LITERAL message. Throws (→ runner abstains) when:
 *   - `node` is not the canonical `new Error(<arg>)` shape, or
 *   - the single argument does not evaluate to a portable STRING (e.g. a number
 *     — the slice is scoped to string-literal messages, the only form both
 *     emitters and the oracle exercise).
 */
export function evalExplicitThrowError(node: ValueIR, env: SemanticEnv): CanonicalError {
  if (!isExplicitErrorThrow(node)) {
    throw new Error('portable-error: throw value is not a canonical `new Error(...)`');
  }
  const arg = (node.argument as Extract<ValueIR, { kind: 'call' }>).args[0];
  const message = evalPortableValue(arg, env);
  if (typeof message !== 'string') {
    throw new Error('portable-error: `new Error(...)` message argument must be a string');
  }
  return { kind: 'Error', message };
}
