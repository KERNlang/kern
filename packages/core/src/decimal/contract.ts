/** DECIMAL pure kernel — the FRAMEWORK-FREE Decimal contract, single-sourced.
 *
 *  This module is the ONE authority for KERN's Decimal *meaning* — the canonical
 *  literal grammar, the pinned arithmetic CONTEXT (precision 28, ROUND_HALF_EVEN,
 *  modulo ROUND_DOWN), the canonical stringifier rules, the fail-close message
 *  constants, and the guarded div/mod/pow LOGIC (incl. the `0**0 → 1` special
 *  case). It depends ONLY on `decimal.js` — NO codegen, NO IR, NO `typescript`
 *  package — so it is importable from BOTH:
 *    - the codegen leg (`codegen/decimal-contract.ts`, which re-exports the pure
 *      validators/messages it surfaces to the emitters — see that file), and
 *    - the ReferenceRunner (`ir/semantics/`), which EXECUTES `Decimal.of/add/mul`
 *      natively as a third "leg" of the decimal differential oracle, computing on a
 *      LOCAL cloned `Decimal` constructor and rendering through {@link kernDecimalStr}.
 *
 *  PRINCIPLE: own the meaning (this module's stringifier/context/fail-close),
 *  borrow the calculator (decimal.js). The transpile paths are UNTOUCHED — the
 *  emitters still lower `Decimal.*` to decimal.js (TS) / stdlib `decimal` (Python)
 *  exactly as before; this kernel only adds a runtime-evaluable twin of the SAME
 *  rules so the runner can be byte-identical to both emitted legs.
 *
 *  BROWSER-SPINE PIN: this file MUST NOT import the `typescript` npm package, and
 *  nothing it pulls in may either — it is reachable from `ir/semantics/`, which is
 *  on the browser-safe spine. decimal.js is a small standalone arithmetic library
 *  with no such dependency, so the pin (exactly 5 files importing `typescript`)
 *  stays intact. */

import DecimalImport from 'decimal.js';

// decimal.js's `.d.ts` merges a `class Decimal`, an `export declare function
// Decimal`, and an `export namespace Decimal`. Under `module: nodenext` +
// `esModuleInterop` the DEFAULT import's *type* resolves to the bare function
// overload, which hides the class statics (`.clone`, `.ROUND_HALF_EVEN`, …). The
// constructor + statics live on `typeof import('decimal.js').Decimal` (the class),
// so we derive the precise constructor/instance types from there and view the
// runtime default value through the constructor type. (This is a pure typing
// adapter — the runtime binding is the same `decimal.js` default export.)

/** The decimal.js CONSTRUCTOR type — the class, carrying both the `new` signature
 *  and the static surface (`clone`, `ROUND_*`). A clone of this is what
 *  {@link makeKDecimal} returns. */
export type KDecimalCtor = typeof import('decimal.js').Decimal;
/** A live Decimal *instance* — the runner's in-flight Decimal value representation
 *  during compute, rendered to a canonical STRING only at the output boundary. */
export type KDecimalValue = InstanceType<KDecimalCtor>;

/** The decimal.js default export, typed as the CONSTRUCTOR (statics included). */
const Decimal = DecimalImport as unknown as KDecimalCtor;

// ─────────────────────────────────────────────────────────────────────────────
// Canonical CONTEXT — the pinned values both emitted legs configure, mirrored
// here so the runner computes under the IDENTICAL envelope.
//
//   - precision 28 significant digits      (Python default `Context().prec`)
//   - ROUND_HALF_EVEN (banker's rounding)   (Python default rounding)
//   - modulo ROUND_DOWN (truncated remainder = sign-of-dividend, the Python
//     `Decimal.__mod__` convention; ROUND_DOWN is also decimal.js's default
//     modulo mode, so pinning converts a coincidental default into an explicit
//     cross-version guarantee — exactly as the TS preamble pins it).
//
// These are the SAME three knobs `decimalImportLineTS()` sets via `Decimal.set`
// on the TS leg. The runner NEVER calls the global `Decimal.set(...)` (that would
// corrupt the shared TS-leg constructor and any other consumer) — it uses a LOCAL
// cloned constructor from {@link makeKDecimal} instead.
// ─────────────────────────────────────────────────────────────────────────────

/** The pinned Decimal context the runner's local constructor is cloned with —
 *  the runtime twin of the `precision: 28, rounding: ROUND_HALF_EVEN,
 *  modulo: ROUND_DOWN` values `decimalImportLineTS()` writes into the TS leg. */
export const DECIMAL_CONTEXT = Object.freeze({
  precision: 28,
  rounding: Decimal.ROUND_HALF_EVEN,
  modulo: Decimal.ROUND_DOWN,
} as const);

/** Build a LOCAL Decimal constructor pinned to {@link DECIMAL_CONTEXT}. Cloning —
 *  NEVER `Decimal.set(...)` on the global — keeps the runner's precision-28 context
 *  isolated from the shared `Decimal` the codegen import line configures and from
 *  any other decimal.js consumer in the process. Used by the runner's native
 *  `Decimal.of/add/mul` evaluation. */
export function makeKDecimal(): KDecimalCtor {
  return Decimal.clone({
    precision: DECIMAL_CONTEXT.precision,
    rounding: DECIMAL_CONTEXT.rounding,
    modulo: DECIMAL_CONTEXT.modulo,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical LITERAL grammar + validators (the portable surface). These were the
// pure validator family; both the codegen emitters (via the
// `codegen/decimal-contract.ts` re-export) and the runner call them so the
// admit/refuse set is byte-identical across all three legs.
// ─────────────────────────────────────────────────────────────────────────────

/** Diagnostic prefix for the Slice-1 Decimal scale/significance fail-close. */
export const DECIMAL_SCALE_FAILCLOSE = 'Decimal literal carries non-canonical scale/significance';

/** The npm package the TS leg's Decimal lowering depends on. Surfaced into the TS
 *  expression emitter's `imports` set so a caller can render the import line. */
export const DECIMAL_TS_PACKAGE = 'decimal.js';

/** The strict canonical Decimal-literal grammar KERN guarantees portable in v1.
 *
 *  Accepted (value === canonical rendering on BOTH decimal.js and Python decimal):
 *    - optional leading `-` (but NOT on a zero value — `-0` diverges)
 *    - an integer part with NO superfluous leading zeros (`0`, `1`, `42`, `123`),
 *      so `01` / `007` are refused (decimal.js drops them, scale-ambiguous)
 *    - an OPTIONAL fractional part: a single `.` then >=1 digit, whose LAST digit
 *      is non-zero when the value is non-zero (no trailing zeros), and which is not
 *      an all-zero fraction (`0.00`, scale-only)
 *    - NO exponent (`E`/`e`): exponent literals render divergently (`1E+2` vs `100`)
 *
 *  Examples accepted: `0`, `1`, `1.5`, `0.1`, `0.2`, `0.3`, `-1.5`, `42`, `123.456`.
 *  Examples refused: `1.10`, `1.2300`, `0.00`, `-0`, `1E+2`, `1.5e-10`, `007`, `1.0`. */
const CANONICAL_DECIMAL_GRAMMAR = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** True iff `raw` is a portable KERN Decimal literal per the v1 canonical grammar
 *  — i.e. decimal.js and Python `decimal` render it to the byte-identical string,
 *  so binding it makes NO scale promise. Drives the symmetric fail-close on all
 *  legs. `raw` is the literal's STRING value (the content of `Decimal.of("...")`). */
export function isPortableDecimalLiteral(raw: string): boolean {
  // Reject empty / whitespace outright (decimal.js trims, Python is stricter).
  if (raw.length === 0) return false;
  // Exponent form is always scale-divergent (`1E+2` -> Python `1E+2`, JS `100`).
  if (/[eE]/.test(raw)) return false;
  if (!CANONICAL_DECIMAL_GRAMMAR.test(raw)) return false;

  // `-0` / `-0.0...` : Python keeps the sign (`-0`), decimal.js drops it (`0`).
  if (raw.startsWith('-')) {
    const magnitude = raw.slice(1);
    if (/^0(?:\.0+)?$/.test(magnitude)) return false;
  }

  const dot = raw.indexOf('.');
  if (dot !== -1) {
    const frac = raw.slice(dot + 1);
    // Trailing zero in the fraction is the significance decimal.js discards
    // (`1.10` -> `1.1`). An all-zero fraction is scale-only (`0.00` -> `0`).
    if (frac.endsWith('0')) return false;
  }
  return true;
}

/** Build the (target-agnostic) compile-error for a non-canonical Decimal literal.
 *  All legs throw this identical text — selected only by the offending literal — so
 *  the refusal is observably symmetric across TS, Python, AND the runner. */
export function decimalScaleFailMessage(raw: string): string {
  return (
    `${DECIMAL_SCALE_FAILCLOSE}: Decimal("${raw}") cannot be lowered portably. ` +
    `KERN's certified Decimal subset is NUMERIC: the TS leg (decimal.js) discards ` +
    `trailing-zero / exponent / signed-zero significance (Decimal("${raw}") would ` +
    `render differently than Python's stdlib decimal, which preserves scale), so KERN ` +
    `cannot guarantee byte-exact cross-target rendering for this literal. Use a ` +
    `canonical form with no trailing zeros, no exponent, and no signed zero ` +
    `(e.g. "1.5", "0.1", "42").`
  );
}

/** Throw the symmetric scale fail-close if `raw` is not a portable Decimal literal.
 *  Called by ALL legs at the `Decimal(...)` / `Decimal.of(...)` lowering / eval site. */
export function assertPortableDecimalLiteral(raw: string): void {
  if (!isPortableDecimalLiteral(raw)) {
    throw new Error(decimalScaleFailMessage(raw));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guarded div / mod / pow runtime LOGIC + their fail-close message constants.
//
// The EMITTED helpers (`decimalOpsHelpersTS` / `KERN_DECIMAL_OPS_HELPER_PY`, which
// live in `codegen/decimal-contract.ts` and render these SAME guards into each
// leg's preamble) and the runner's native compute both encode the identical three
// guards, so a zero-divide / `0**0` / `0**neg` fails or special-cases IDENTICALLY
// across all legs. These functions are the runner's executable form of that logic.
// ─────────────────────────────────────────────────────────────────────────────

/** The ONE byte-identical diagnostic a zero divisor raises (the text the emitted
 *  helper throws on both legs), so a `Decimal.div(x, Decimal.of("0"))` fails closed
 *  identically across targets. */
export const DECIMAL_DIV_ZERO_FAILCLOSE = 'KERN Decimal division by zero';
/** The byte-identical diagnostic a zero modulus raises. */
export const DECIMAL_MOD_ZERO_FAILCLOSE = 'KERN Decimal modulo by zero';
/** `0 ** negative` is a zero-divide in disguise; the pow helper preflights it to
 *  this byte-identical zero-error so the surface never yields a non-finite value. */
export const DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE = 'KERN Decimal 0 raised to a negative power (division by zero)';

/** Guarded division LOGIC: throws the byte-identical {@link DECIMAL_DIV_ZERO_FAILCLOSE}
 *  on a zero divisor, else `a / b` under the caller's pinned constructor. The
 *  executable twin of the emitted `__k_decimal_div` helper. */
export function kDecimalDiv(a: KDecimalValue, b: KDecimalValue): KDecimalValue {
  if (b.isZero()) throw new Error(DECIMAL_DIV_ZERO_FAILCLOSE);
  return a.div(b);
}

/** Guarded modulo LOGIC: throws {@link DECIMAL_MOD_ZERO_FAILCLOSE} on a zero
 *  modulus, else `a % b` (truncated remainder under the pinned ROUND_DOWN modulo).
 *  The executable twin of the emitted `__k_decimal_mod` helper. */
export function kDecimalMod(a: KDecimalValue, b: KDecimalValue): KDecimalValue {
  if (b.isZero()) throw new Error(DECIMAL_MOD_ZERO_FAILCLOSE);
  return a.mod(b);
}

/** Integer-power LOGIC mirroring the emitted `__k_decimal_pow_int`: special-cases
 *  `0**0 → 1` (so both legs agree even though Python's `**` raises that input under
 *  the default context) and preflights `0**neg` to the byte-identical zero-divide
 *  error. `KDecimal` is the local pinned constructor (so `new KDecimal(1)` carries
 *  the same context). The compile-time fail-close already guarantees the exponent
 *  is an integer literal and the base non-negative, so no further validation here. */
export function kDecimalPowInt(KDecimal: KDecimalCtor, a: KDecimalValue, b: KDecimalValue): KDecimalValue {
  if (a.isZero() && b.lt(0)) throw new Error(DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE);
  if (a.isZero() && b.isZero()) return new KDecimal(1);
  return a.pow(b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical STRINGIFIER (TS form). The runner renders its in-flight Decimal value
// to a canonical STRING at the output boundary through this function.
//
// The TS emitted leg renders a result via plain decimal.js `.toString()` under the
// pinned context (the oracle's `console.log(String(...))`), with the single KERN
// canonicalization that a zero magnitude is ALWAYS unsigned `"0"` (decimal.js
// already drops `-0` for `new Decimal("-0")`, but a computed `a*0` / `a-a` can
// surface a `-0` instance whose `.toString()` is `"-0"`; this clamps it to `"0"`
// so the runner matches the Python `_kern_decimal_str` zero rule and the TS leg).
// ─────────────────────────────────────────────────────────────────────────────

/** Render a live Decimal value to its KERN-canonical STRING — the runtime twin of
 *  the TS leg's `String(decimalResult)`: decimal.js `.toString()` under the pinned
 *  context, with the one KERN rule that a ZERO value renders as unsigned `"0"`
 *  (never `"-0"`), matching the Python `_kern_decimal_str` zero canonicalization
 *  and the TS leg. (decimal.js `.toString()` already yields `"0"` for a literal
 *  `new Decimal("-0")`, but a COMPUTED `-0` instance can stringify to `"-0"`, so
 *  the explicit `isZero()` clamp closes that boundary.) */
export function kernDecimalStr(value: KDecimalValue): string {
  if (value.isZero()) return '0';
  return value.toString();
}
