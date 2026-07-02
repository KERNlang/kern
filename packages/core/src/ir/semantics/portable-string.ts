/**
 * Portable STRING namespace calls for the ReferenceRunner — milestone 5.1b
 * string-ops slice, under the tribunal-locked contract (Option D — Unicode
 * scalar values / code points, decided 2026-07-02).
 *
 * LOCKED CONTRACT: a KERN string is a sequence of Unicode CODE POINTS.
 * `Text.length`, `Text.charAt(i)`, `Text.slice(a, b)`, `Text.indexOf(needle)`,
 * and `Text.startsWith(prefix)` all operate on CODE-POINT indices — NOT JS's
 * native UTF-16 code-UNIT indices, which diverge from Python's code-point
 * indices for any character outside the Basic Multilingual Plane (BMP): a
 * surrogate PAIR is two UTF-16 code units but ONE Unicode code point.
 *
 * SCOPE NARROWING — the RISK VALVE, exercised DELIBERATELY (see the
 * milestone report for full reasoning): this reference-runner
 * implementation supports the FULL contract for BMP-SAFE strings (every
 * character in U+0000..U+FFFF outside the surrogate range) — the
 * overwhelming majority of real text — and FAILS CLOSED (throws, never
 * guesses) on ANY string, receiver OR needle/prefix argument, that contains
 * a UTF-16 code unit in the surrogate range [0xD800, 0xDFFF]. That single
 * check covers BOTH genuinely malformed input (a lone high/low surrogate, a
 * reversed pair, high-high, low-low — the tribunal's explicit fail-closed
 * set) AND well-formed non-BMP characters (emoji, rare CJK extension
 * characters, mathematical symbols) — a valid surrogate PAIR is, after all,
 * still two code units in that same range. The fixture list's non-BMP cases
 * (😀, 𠀀, …) are consequently OUT OF SCOPE for this reference-runner
 * implementation and are documented as an explicit exclusion in
 * docs/runtime-roadmap.md. Full code-point-index emulation for non-BMP
 * strings (an offset table, or a `Array.from`-based code-point walk) is
 * deferred to a follow-up slice.
 *
 * WHY narrowing this way still delivers the CORRECT contract for BMP-safe
 * input with ZERO custom code-point arithmetic: every BMP character is
 * EXACTLY one UTF-16 code unit, so a BMP-safe JS string's UTF-16 code-unit
 * index IS its Unicode code-point index, identically. Python's native code
 * points agree trivially (Python never uses UTF-16 surrogate pairs
 * internally). So once the BMP-safety guard passes, this module reuses
 * NATIVE JS string operations (`.length`, `.charAt`, `.slice`, `.indexOf`,
 * `.startsWith`) directly — there is no off-by-one or emulation bug to
 * introduce, because the native operation already computes the exact
 * code-point-indexed answer for every string this slice admits.
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

import { hasBinding, type SemanticEnv } from './index.js';
import { evalPortableValue, type PortableScalar } from './portable-scalar.js';
import { isValueIR, type ValueIR } from '../../value-ir.js';

/**
 * True iff `s` contains NO UTF-16 code unit in the surrogate range
 * [0xD800, 0xDFFF]. A BMP-safe string's `.length` (and every native
 * character-indexed operation) is exactly its Unicode code-point count/index
 * — see this module's doc comment for why that equivalence holds.
 */
export function isBmpSafeString(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

function requireBmpSafeString(value: PortableScalar, label: string): string {
  if (typeof value !== 'string') throw new Error(`portable: ${label} requires a string`);
  if (!isBmpSafeString(value)) {
    throw new Error(
      `portable: ${label} contains a character outside the Basic Multilingual Plane (BMP) or a malformed surrogate — unsupported in this native runner preview`,
    );
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
 * invalid shape (wrong arity, non-BMP-safe operand, out-of-range index) so
 * the runner abstains atomically rather than guess.
 */
export function evalStringOpCall(node: Extract<ValueIR, { kind: 'call' }>, env: SemanticEnv): PortableScalar | undefined {
  if (node.optional) return undefined;
  const callee = node.callee;
  if (callee.kind !== 'member' || callee.optional) return undefined;
  if (!isTextNamespaceIdent(callee.object, env)) return undefined;
  const method = callee.property;
  const arity = STRING_OP_ARITY[method];
  if (arity === undefined) return undefined;
  const label = `Text.${method}`;
  if (node.args.length !== arity) throw new Error(`portable: ${label} expects exactly ${arity} argument${arity === 1 ? '' : 's'}`);

  const receiverArg = node.args[0];
  if (!isValueIR(receiverArg)) throw new Error(`portable: ${label} requires a string receiver`);
  const receiver = requireBmpSafeString(evalPortableValue(receiverArg, env), label);

  switch (method) {
    case 'length':
      return receiver.length;
    case 'charAt': {
      const index = requireSafeIntegerArg(node.args[1], env, label);
      if (index < 0 || index >= receiver.length) {
        throw new Error(`portable: ${label} index ${index} is out of bounds for a string of length ${receiver.length}`);
      }
      return receiver.charAt(index);
    }
    case 'slice': {
      const start = requireSafeIntegerArg(node.args[1], env, label);
      const end = requireSafeIntegerArg(node.args[2], env, label);
      if (start < 0 || end < 0 || start > receiver.length || end > receiver.length || start > end) {
        throw new Error(
          `portable: ${label}(${start}, ${end}) is out of bounds for a string of length ${receiver.length} (0 <= start <= end <= length required)`,
        );
      }
      return receiver.slice(start, end);
    }
    case 'indexOf': {
      const needle = requireBmpSafeString(evalPortableValue(node.args[1], env), label);
      return receiver.indexOf(needle);
    }
    case 'startsWith': {
      const prefix = requireBmpSafeString(evalPortableValue(node.args[1], env), label);
      return receiver.startsWith(prefix);
    }
    default:
      return undefined;
  }
}

function requireSafeIntegerArg(node: ValueIR, env: SemanticEnv, label: string): number {
  const value = evalPortableValue(node, env);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`portable: ${label} index arguments must be safe integers`);
  }
  return value;
}
