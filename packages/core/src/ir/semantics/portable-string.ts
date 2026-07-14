/**
 * Portable STRING namespace calls for the ReferenceRunner — milestone 5.1b
 * string-ops slice, under the tribunal-locked contract (Option D — Unicode
 * scalar values / code points, decided 2026-07-02).
 *
 * LOCKED CONTRACT: a KERN string is a sequence of Unicode CODE POINTS.
 * `Text.length`, `Text.charAt(i)`, `Text.slice(a, b)`, `Text.indexOf(needle)`,
 * and `Text.startsWith(prefix)` all operate on CODE-POINT indices — NOT
 * JS's native UTF-16 code-UNIT indices, which diverge from Python's
 * code-point indices for any character outside the Basic Multilingual Plane
 * (BMP): a surrogate PAIR is two UTF-16 code units but ONE Unicode code
 * point.
 *
 * FULL CONTRACT (KERN 4.5.0 item 3 — the milestone 5.1b BMP-only risk valve
 * is LIFTED here; see git history / the milestone report for the prior,
 * deliberately narrower behavior): every op is computed via a full
 * code-point walk (`Array.from`, which the JS string iterator already pairs
 * into correct code points for a well-formed surrogate pair), so a
 * WELL-FORMED non-BMP character — an emoji, an astral CJK-extension
 * character, a rare mathematical symbol — is IN SCOPE and computed
 * correctly, exactly like every other code point. The ONLY input this module
 * still fails closed on is a MALFORMED UTF-16 sequence: a lone high
 * surrogate, a lone low surrogate, a reversed pair, or any high-high /
 * low-low run — see {@link isWellFormedText} in `../../codegen/text-contract.js`,
 * the single-sourced kernel this module shares with both codegen legs
 * (`textOpsHelpersTS` for TS, `KERN_TEXT_OPS_HELPER_PY` for Python — see that
 * module's doc comment for the full three-leg architecture).
 *
 * BOUNDS POLICY (this slice's pick, applied identically to every op, per the
 * tribunal's "pick ONE bounds policy" instruction): out-of-range
 * single-position reads and out-of-range slice bounds THROW.
 *   - `charAt(i)` requires `0 <= i < length` (JS's real `.charAt` returns
 *     `""` for an out-of-range index — NOT inherited; this fails closed).
 *   - `slice(a, b)` requires `0 <= a <= b <= length` — no negative indices,
 *     no silent clamping (JS's `.slice`/Python's `s[a:b]` both clamp/wrap
 *     silently for an out-of-range argument — NOT inherited).
 *   - `indexOf(needle)` returns `-1` for "not found" — that is NOT an error
 *     per the locked contract ("indexOf returns a code-point offset or -1").
 *   - `startsWith(prefix)` returns a boolean; there is no out-of-range case.
 */

import {
  codePointIndexOf,
  isWellFormedText,
  textCodePoints,
  textMalformedSurrogateFailMessage,
} from '../../codegen/text-contract.js';
import { isValueIR, type ValueIR } from '../../value-ir.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import type { PortableScalar } from './portable-scalar-domain.js';
import { hasBinding, type SemanticEnv } from './semantic-env.js';

function requireWellFormedString(value: PortableScalar, label: string): string {
  if (typeof value !== 'string') throw new Error(`portable: ${label} requires a string`);
  if (!isWellFormedText(value)) {
    throw new Error(textMalformedSurrogateFailMessage(label));
  }
  return value;
}

/** True iff `node` is the builtin, UNSHADOWED `Text` namespace identifier —
 *  mirrors the Decimal/List/Map namespace-call gate so a user binding named
 *  `Text` shadows the builtin instead of silently colliding with it. */
function isTextNamespaceIdent(node: ValueIR, env: SemanticEnv): boolean {
  return node.kind === 'ident' && node.name === 'Text' && !hasBinding(env, 'Text');
}

const STRING_OP_ARITY: Readonly<Record<string, number>> = Object.freeze({
  length: 1,
  charAt: 2,
  slice: 3,
  indexOf: 2,
  startsWith: 2,
});

/**
 * `Text.length(s)` / `Text.charAt(s, i)` / `Text.slice(s, a, b)` /
 * `Text.indexOf(s, needle)` / `Text.startsWith(s, prefix)`. Returns
 * `undefined` when `node` is not one of these five shapes (so the caller
 * falls through to the generic call path); throws on a recognized-but-
 * invalid shape (wrong arity, malformed-surrogate operand, out-of-range
 * index) so the runner abstains atomically rather than guess.
 */
export function evalStringOpCall(
  node: Extract<ValueIR, { kind: 'call' }>,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
): PortableScalar | undefined {
  if (node.optional) return undefined;
  const callee = node.callee;
  if (callee.kind !== 'member' || callee.optional) return undefined;
  if (!isTextNamespaceIdent(callee.object, env)) return undefined;
  const method = callee.property;
  const arity = STRING_OP_ARITY[method];
  if (arity === undefined) return undefined;
  const label = `Text.${method}`;
  if (node.args.length !== arity)
    throw new Error(`portable: ${label} expects exactly ${arity} argument${arity === 1 ? '' : 's'}`);

  const receiverArg = node.args[0];
  if (!isValueIR(receiverArg)) throw new Error(`portable: ${label} requires a string receiver`);
  const receiver = requireWellFormedString(evaluate(receiverArg, env), label);

  switch (method) {
    case 'length':
      return textCodePoints(receiver).length;
    case 'charAt': {
      const index = requireSafeIntegerArg(node.args[1], env, evaluate, label);
      const cps = textCodePoints(receiver);
      if (index < 0 || index >= cps.length) {
        throw new Error(`portable: ${label} index ${index} is out of bounds for a string of length ${cps.length}`);
      }
      return cps[index];
    }
    case 'slice': {
      const start = requireSafeIntegerArg(node.args[1], env, evaluate, label);
      const end = requireSafeIntegerArg(node.args[2], env, evaluate, label);
      const cps = textCodePoints(receiver);
      if (start < 0 || end < 0 || start > cps.length || end > cps.length || start > end) {
        throw new Error(
          `portable: ${label}(${start}, ${end}) is out of bounds for a string of length ${cps.length} (0 <= start <= end <= length required)`,
        );
      }
      return cps.slice(start, end).join('');
    }
    case 'indexOf': {
      const needle = requireWellFormedString(evaluate(node.args[1], env), label);
      return codePointIndexOf(textCodePoints(receiver), textCodePoints(needle));
    }
    case 'startsWith': {
      const prefix = requireWellFormedString(evaluate(node.args[1], env), label);
      return receiver.startsWith(prefix);
    }
    default:
      return undefined;
  }
}

function requireSafeIntegerArg(node: ValueIR, env: SemanticEnv, evaluate: EvalPortableValue, label: string): number {
  // Float/int fence escape hatch (see `SemanticEnv`): bounds-checked, never printed.
  const value = evaluate(node, { ...env, intIndexCtx: true });
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`portable: ${label} index arguments must be safe integers`);
  }
  return value;
}
