/** DECIMAL first-class member — Slice 1 shared contract (TS↔Python parity).
 *
 *  KERN's Decimal surface lowers to decimal.js on the TS leg and Python's stdlib
 *  `decimal` module on the Python leg. A de-risking probe (decimal.js 10.6.0 vs
 *  CPython `decimal`, 150 cases) proved that ARITHMETIC VALUE parity is byte-exact
 *  once both engines are configured to the SAME context (28 significant digits,
 *  ROUND_HALF_EVEN): `Decimal("0.1") + Decimal("0.2")` renders as exactly `0.3` on
 *  BOTH legs, division/precision/rounding all agree.
 *
 *  The ONE fundamental divergence is SIGNIFICANCE / SCALE. Python's `decimal`
 *  preserves the scale of a literal and rides it through arithmetic:
 *      str(Decimal("1.10"))      == "1.10"     (trailing zero kept)
 *      str(Decimal("0.00"))      == "0.00"
 *      str(Decimal("1E+2"))      == "1E+2"
 *      str(Decimal("-0"))        == "-0"
 *  decimal.js NORMALIZES significance away — it has no concept of scale:
 *      new Decimal("1.10").toString()  === "1.1"
 *      new Decimal("0.00").toString()  === "0"
 *      new Decimal("1E+2").toString()  === "100"
 *      new Decimal("-0").toString()    === "0"
 *
 *  Because KERN's invariant is byte-exact cross-target parity, KERN does NOT
 *  promise that `str(Decimal("1.10")) == "1.10"`. The v1 contract binds Decimal to
 *  NUMERIC semantics with a KERN-owned canonical stringifier, and FAILS CLOSED — at
 *  compile time, symmetrically on BOTH legs — for any Decimal string literal that
 *  carries scale/significance the two engines render differently. That is the set
 *  this module detects: a portable Decimal literal is one whose VALUE and canonical
 *  rendering are identical on both engines, so no scale promise is ever made.
 *
 *  Both the TS emitter (`codegen-expression.ts`) and the Python emitter
 *  (`codegen-body-python.ts`) import {@link assertPortableDecimalLiteral} and
 *  {@link decimalScaleFailMessage} from THIS one module, so the refusal is
 *  byte-identical (single-sourced) across targets — exactly the regex fail-close
 *  pattern (`scanRegexAstral` / `regexAstralFailMessage`). */

/** Diagnostic prefix for the Slice-1 Decimal scale/significance fail-close. */
export const DECIMAL_SCALE_FAILCLOSE = 'Decimal literal carries non-canonical scale/significance';

/** The npm package the TS leg's Decimal lowering depends on. This is the value a
 *  `Decimal.*` stdlib entry declares in `requires.ts`, surfaced into the TS
 *  expression emitter's `imports` set so a caller can render the import line. */
export const DECIMAL_TS_PACKAGE = 'decimal.js';

/** Render the TS-leg preamble that a `Decimal.*` lowering requires: the
 *  `decimal.js` import PLUS a one-time global context configuration that mirrors
 *  CPython's DEFAULT decimal context, so the two engines agree byte-for-byte on
 *  ARITHMETIC results (the de-risking probe's qualified-pass envelope):
 *    - precision 28 significant digits      (Python default `Context().prec`)
 *    - ROUND_HALF_EVEN (banker's rounding)  (Python default rounding)
 *    - toExpNeg/-toExpPos kept at decimal.js defaults (-7 / 21); KERN's canonical
 *      Decimal literal set is fail-closed to forms whose value rendering agrees
 *      regardless of the sci-notation threshold, so the exponent knobs do not
 *      affect any IN-CORE literal.
 *
 *  This is the KERN-OWNED canonical-context rule applied to the TS leg. The
 *  Python leg gets the same numeric envelope for free from its stdlib default
 *  context (prec 28, ROUND_HALF_EVEN), so no Python preamble is needed beyond the
 *  `import decimal as __k_decimal` the `requires.py: 'decimal'` path injects. */
export function decimalImportLineTS(): string {
  return [
    `import Decimal from '${DECIMAL_TS_PACKAGE}';`,
    'Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });',
  ].join('\n');
}

/** The strict canonical Decimal-literal grammar KERN guarantees portable in v1.
 *
 *  Accepted (value === canonical rendering on BOTH decimal.js and Python decimal):
 *    - optional leading `-` (but NOT on a zero value — `-0` diverges)
 *    - an integer part with NO superfluous leading zeros (`0`, `1`, `42`, `123`),
 *      so `01` / `007` are refused (decimal.js drops them, scale-ambiguous)
 *    - an OPTIONAL fractional part: a single `.` then >=1 digit, whose LAST digit
 *      is non-zero when the value is non-zero (no trailing zeros — those are the
 *      significance decimal.js discards), and which is not an all-zero fraction
 *      (`0.00`, scale-only)
 *    - NO exponent (`E`/`e`): exponent literals render divergently (`1E+2` vs `100`)
 *
 *  Examples accepted: `0`, `1`, `1.5`, `0.1`, `0.2`, `0.3`, `-1.5`, `42`, `123.456`.
 *  Examples refused: `1.10`, `1.2300`, `0.00`, `-0`, `1E+2`, `1.5e-10`, `007`, `1.0`.
 *
 *  NOTE: the regex below is the SINGLE source of the portable surface; both legs
 *  call {@link isPortableDecimalLiteral} so they admit/refuse the identical set.
 *  The trailing-zero / all-zero-fraction / signed-zero checks that the bare regex
 *  cannot express cleanly are layered in {@link isPortableDecimalLiteral}. */
const CANONICAL_DECIMAL_GRAMMAR = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** True iff `raw` is a portable KERN Decimal literal per the v1 canonical grammar
 *  — i.e. decimal.js and Python `decimal` render it to the byte-identical string,
 *  so binding it makes NO scale promise. Drives the symmetric fail-close on both
 *  legs. `raw` is the literal's STRING value (the content of `Decimal("...")`). */
export function isPortableDecimalLiteral(raw: string): boolean {
  // Reject empty / whitespace outright (decimal.js trims, Python is stricter —
  // not worth modelling the whitespace corner for v1; canonical only).
  if (raw.length === 0) return false;
  // Exponent form is always scale-divergent (`1E+2` -> Python `1E+2`, JS `100`).
  if (/[eE]/.test(raw)) return false;
  if (!CANONICAL_DECIMAL_GRAMMAR.test(raw)) return false;

  // `-0` / `-0.0...` : Python keeps the sign (`-0`), decimal.js drops it (`0`).
  // A negative literal whose magnitude is zero is non-canonical.
  if (raw.startsWith('-')) {
    const magnitude = raw.slice(1);
    if (/^0(?:\.0+)?$/.test(magnitude)) return false;
  }

  const dot = raw.indexOf('.');
  if (dot !== -1) {
    const frac = raw.slice(dot + 1);
    // Trailing zero in the fraction is the significance decimal.js discards
    // (`1.10` -> `1.1`, `1.2300` -> `1.23`). An all-zero fraction is scale-only
    // (`0.00` -> `0`, `2.00` -> `2`). Either way the rendered strings diverge.
    if (frac.endsWith('0')) return false;
  }
  return true;
}

/** Build the (target-agnostic) compile-error for a non-canonical Decimal literal.
 *  Both emitters throw this identical text — selected only by the offending literal
 *  — so the refusal is observably symmetric across TS and Python. */
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
 *  Called by BOTH legs at the `Decimal(...)` / `Decimal.of(...)` lowering site. */
export function assertPortableDecimalLiteral(raw: string): void {
  if (!isPortableDecimalLiteral(raw)) {
    throw new Error(decimalScaleFailMessage(raw));
  }
}

/** Diagnostic for a `Decimal(...)` construction whose argument is NOT a string
 *  literal. v1 only supports construction from a STRING literal (the string form
 *  avoids float-precision loss: `Decimal(0.1)` would already have lost precision
 *  before the call). A non-literal arg (an ident, a number literal, an expression)
 *  is refused symmetrically on both legs. */
export const DECIMAL_NON_STRING_LITERAL_FAILCLOSE = 'Decimal construction requires a string literal argument';

export function decimalNonStringLiteralFailMessage(): string {
  return (
    `${DECIMAL_NON_STRING_LITERAL_FAILCLOSE}. Slice-1 KERN Decimal is constructed ` +
    `ONLY from a string literal — Decimal.of("1.5") — because a numeric literal (Decimal.of(0.1)) ` +
    `has already lost binary-float precision before the call, and a dynamic argument cannot ` +
    `be scale-validated at compile time. Pass a quoted canonical decimal string.`
  );
}

/** Diagnostic for the BARE `Decimal(...)` construction form. Slice 1 registers
 *  the canonical `Decimal.of(...)` / `Decimal.add(...)` namespace dispatch; the
 *  bare `Decimal(...)` call would otherwise verbatim-emit an undefined global on
 *  both legs (no `import` is injected for it), so it is fail-closed SYMMETRICALLY
 *  with a redirect to `Decimal.of`. (The `+` operator and bare construction are
 *  deferred to a typed-IR slice — see the Slice-1 report.) */
export const DECIMAL_BARE_CONSTRUCTION_FAILCLOSE = 'Bare Decimal(...) construction is not portable in Slice 1';

export function decimalBareConstructionFailMessage(): string {
  return (
    `${DECIMAL_BARE_CONSTRUCTION_FAILCLOSE}. Use the namespace form Decimal.of("1.5") to construct a ` +
    `Decimal and Decimal.add(a, b) to add — these lower to decimal.js on the TS leg and Python's ` +
    `stdlib decimal on the Python leg with byte-exact parity. The bare Decimal(...) call and the ` +
    `\`+\` operator on Decimal values are deferred to a later slice (they need a type-carrying IR so ` +
    `\`+\` can dispatch to decimal.js .plus() on the TS leg).`
  );
}

/** DECIMAL Slice 2 (item 3) — fail-close prefix for the `+`/`-`/`*` operator on
 *  syntactically-proven Decimal operands. Today `Decimal.of("1.5") + Decimal.of("2.5")`
 *  would emit `a + b` on both legs — and on TS, decimal.js's `+` invokes `.valueOf()`
 *  and DEGRADES TO FLOAT (silent precision loss + a TS↔Python divergence). We block
 *  it at compile time with a byte-identical diagnostic on both targets. This is the
 *  syntactic SEED of slice-3's `provenType:'decimal'` typed-IR work; it is
 *  deliberately CONSERVATIVE — see {@link isSyntacticDecimalProducer}. */
export const DECIMAL_OPERATOR_FAILCLOSE = 'Decimal does not support the arithmetic operator';

/** Operators the fail-close covers. `/`/`%` are NOT here (Decimal.div/mod are a
 *  later slice with their own divergence axes); comparison operators are a later
 *  slice too. */
const DECIMAL_BLOCKED_OPERATORS = new Set(['+', '-', '*']);

/** The safe-method redirect for each blocked operator. */
const DECIMAL_OPERATOR_REDIRECT: Record<string, string> = {
  '+': 'Decimal.add(a, b)',
  '-': 'Decimal.sub(a, b)',
  '*': 'Decimal.mul(a, b)',
};

/** Build the byte-identical compile-error for a blocked Decimal operator. Selected
 *  only by the offending operator, so the refusal is observably symmetric across
 *  TS and Python (both legs throw this exact text). */
export function decimalOperatorFailMessage(op: string): string {
  const redirect = DECIMAL_OPERATOR_REDIRECT[op] ?? 'Decimal.add(a, b)';
  return (
    `${DECIMAL_OPERATOR_FAILCLOSE} \`${op}\` — JS \`${op}\` on a decimal.js value calls .valueOf() and ` +
    `silently degrades to a binary float (losing precision and diverging from the Python leg). ` +
    `Use ${redirect} instead, which lowers to decimal.js on the TS leg and Python's stdlib decimal ` +
    `on the Python leg with byte-exact parity. (Natural operators on Decimal values are deferred to ` +
    `a later slice that carries a type-tagged IR.)`
  );
}

/** A MINIMAL structural view of a value node, satisfied by the shared `ValueIR`
 *  union without importing it (keeps `decimal-contract.ts` dependency-free and
 *  callable from both the core TS emitter and the Python emitter). Only the fields
 *  the syntactic Decimal-producer check reads are modelled. */
interface DecimalProbeNode {
  kind: string;
  callee?: { kind: string; object?: { kind: string; name?: string }; property?: string };
}

/** True iff `node` is, BY SYNTAX ALONE, unambiguously a Decimal-producing call:
 *  a call whose callee is a member access `Decimal.<method>` on the literal `Decimal`
 *  namespace identifier (`Decimal.of(...)`, `Decimal.add(...)`, `Decimal.sub(...)`, …).
 *
 *  CONSERVATIVE BY DESIGN (the critical soundness property): it fires ONLY on this
 *  exact shape. It does NOT track types through variables, params, returns, or
 *  member chains — a `let d = Decimal.of("1.5"); d + x` is NOT caught here (that
 *  needs the typed IR of slice 3; a `// SLICE 3:` note marks the generalization).
 *  It therefore can NEVER false-fire on ordinary numeric `+`/`-`/`*` (a `numLit`,
 *  `ident`, plain `call`, member-read, etc. all return false). */
export function isSyntacticDecimalProducer(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as DecimalProbeNode;
  if (n.kind !== 'call') return false;
  const callee = n.callee;
  if (!callee || callee.kind !== 'member') return false;
  const obj = callee.object;
  // The receiver MUST be the bare `Decimal` namespace identifier — NOT a user
  // binding named `decimal`, NOT a member chain. (User-binding shadowing of the
  // `Decimal` namespace is already fail-closed at construction by slice 1, so a
  // syntactic `Decimal.<m>(...)` here is genuinely the stdlib namespace.)
  return obj?.kind === 'ident' && obj.name === 'Decimal';
}

/** DECIMAL Slice 2 (item 3) — throw the symmetric operator fail-close when a binary
 *  `+`/`-`/`*` has an operand that is a syntactically-proven Decimal producer. A
 *  no-op for every other operator and for operands that are not the proven shape, so
 *  ordinary numeric arithmetic is completely unaffected. Called from BOTH legs'
 *  binary-emit site with the SAME `{op, left, right}` shape, so the refusal is
 *  byte-identical.
 *
 *  SLICE 3: generalize the operand test from `isSyntacticDecimalProducer` (syntax
 *  only) to a typed-IR `provenType === 'decimal'` check so Decimal values that flow
 *  through a binding/param/return are also caught — and `+`/`-`/`*` can then be
 *  lowered (dispatched to `.plus()`/`.minus()`/`.times()` on TS) rather than refused. */
export function assertNoDecimalOperator(node: { op: string; left: unknown; right: unknown }): void {
  if (!DECIMAL_BLOCKED_OPERATORS.has(node.op)) return;
  if (isSyntacticDecimalProducer(node.left) || isSyntacticDecimalProducer(node.right)) {
    throw new Error(decimalOperatorFailMessage(node.op));
  }
}
