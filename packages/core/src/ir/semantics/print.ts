/**
 * `print` runtime semantics — KERN's portable stdout primitive.
 *
 * Operational semantics:
 *   1. Evaluate `value=` once over the portable-scalar domain
 *      (`evalPortableValue(parseExpression(value), env)`).
 *   2. Coerce the result to its KERN-canonical string via {@link printText}
 *      (null -> "null", bool -> "true"/"false", string -> exact, finite SAFE
 *      integer -> base-10).
 *   3. Emit ONE observable `{op:'stdout', text}` event and complete normally.
 *
 * Portability domain (identical fence philosophy to `fmt`'s `canonicalFmt`,
 * TIGHTENED to safe integers):
 *   - Admitted: null, boolean, string, finite integer in the IEEE-754 safe
 *     range. For these, JS template-literal coercion (`console.log(`${x}`)`),
 *     the Python `_kern_fmt` helper (`print(_kern_fmt(x))`), and this reference
 *     all produce byte-identical output, so the 3-leg stdout is portable.
 *   - Fail-close (precondition fails -> the runner ABSTAINS): non-integer
 *     floats (the runner refuses to certify them even though both emitters
 *     happen to agree — mirrors `fmt`'s conservative integer-only rule),
 *     UNSAFE integers (|n| > 2^53-1: JS rounds `9007199254740993` to
 *     `...992` while CPython keeps full precision -> a REAL divergence, the
 *     one hole `Number.isInteger` would miss), and objects / arrays /
 *     undefined / NaN / Infinity.
 *
 * `print` carries no value and always completes normally; its only observable
 * is the single stdout event. Production codegen lowers it to a real
 * `console.log` / `print(...)` that appends exactly one newline on both
 * targets — the trailing `\n` is the platform default, never hand-emitted.
 */

import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { type NodeContract, type NodeFixture, registerContract, type SemanticEnv } from './index.js';
import { evalPortableValue } from './portable-scalar.js';
import type { Trace } from './trace.js';

const NO_FIXTURES: readonly NodeFixture[] = [];

interface PrintProps {
  value?: unknown;
}

/**
 * KERN-canonical coercion of a printed value to its stdout text (WITHOUT the
 * trailing newline — production codegen's `console.log`/`print` supplies that).
 * Throws on any value outside the portable domain so the precondition can
 * fail-close. `Number.isSafeInteger` (not `Number.isInteger`) closes the
 * 2^53-precision hole: JS silently rounds large integers, Python does not.
 */
function printText(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('print: value must be a portable scalar (null, boolean, string, or safe integer)');
}

function resolvePrintText(ir: IRNode, env: SemanticEnv): string {
  const raw = (ir.props as PrintProps)?.value;
  if (typeof raw !== 'string') throw new Error('print: value= must be a string expression');
  return printText(evalPortableValue(parseExpression(raw), env));
}

function printPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  try {
    resolvePrintText(ir, env);
    return true;
  } catch {
    return false;
  }
}

function printEffects(ir: IRNode, env: SemanticEnv): Trace {
  const text = resolvePrintText(ir, env);
  return { events: [{ op: 'stdout', text }], completion: { kind: 'normal' } };
}

function printCompletion(_ir: IRNode, _env: SemanticEnv) {
  return { kind: 'normal' } as const;
}

const FORBIDDEN_REWRITES: readonly string[] = Object.freeze([
  'suppress or reorder a print relative to its surrounding side effects',
  'coalesce adjacent prints into one stdout write (newline boundaries are observable)',
  'raw Python str()/print() coercion for bool/null without canonicalization (True/None vs true/null)',
  'admit unsafe integers (>2^53) — JS rounds, Python keeps precision',
  'append the newline by hand instead of relying on console.log / print default',
]);

export const printContract: NodeContract = {
  nodeType: 'print',
  preconditions: printPreconditions,
  effects: printEffects,
  completion: printCompletion,
  forbiddenRewrites: FORBIDDEN_REWRITES,
  fixtures: NO_FIXTURES,
};

let registered = false;

/** Idempotent registration. Test cleanup that clears the registry must re-call. */
export function registerPrintContract(): void {
  if (registered) return;
  registerContract(printContract);
  registered = true;
}

/** Reset registration flag — only for test cleanup that clears the registry. */
export function _resetPrintContractForTest(): void {
  registered = false;
}
