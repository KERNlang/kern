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
    // `modulo: ROUND_DOWN` = TRUNCATED remainder = the sign-of-dividend convention
    // Python's `Decimal.__mod__` uses (`Decimal("-5.5") % Decimal("2")` → `-1.5` on
    // BOTH legs). This is the load-bearing `Decimal.mod` sign parity. ROUND_DOWN
    // happens to be decimal.js's DEFAULT modulo mode today, so pinning it is a
    // behavioural no-op — but it converts a COINCIDENTAL default into an EXPLICIT
    // cross-version guarantee, exactly as `rounding` is pinned for arithmetic parity.
    'Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN, modulo: Decimal.ROUND_DOWN });',
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

// ─────────────────────────────────────────────────────────────────────────────
// DECIMAL Slice 3 — div / mod / pow shared guarded helpers + comparison.
//
// decimal.js diverges from Python `decimal` at exactly THREE sharp seams, each
// cut here with a guard or a fail-close, NEVER a clever conversion:
//   1. div/mod BY ZERO — decimal.js yields Infinity/NaN, Python's default
//      `decimal` context RAISES (DivisionByZero / InvalidOperation). A SYMMETRIC
//      zero PREFLIGHT in the shared helper throws ONE byte-identical KERN
//      diagnostic on both legs BEFORE either native op runs, so neither
//      engine-specific behaviour is ever observed.
//   2. NON-INTEGER / negative-base pow — decimal.js computes a correctly-rounded
//      TRANSCENDENTAL power that can diverge from Python by ~1 ulp; integer
//      exponent on a non-negative base is EXACT on both. So pow is INTEGER-EXPONENT
//      ONLY with a non-negative base, fail-closed at COMPILE TIME otherwise.
//   3. NaN/Infinity comparison — cannot arise: div/mod are zero-guarded and pow is
//      integer-only with a guarded 0**neg, so no non-finite Decimal ever reaches a
//      comparator. Comparison therefore stays TOTAL and lowers natively.
//
// The div/mod/pow helpers are EMITTED (single-sourced from this module) into each
// leg's decimal preamble/prelude — TS via {@link decimalOpsHelpersTS} in the
// stdlib preamble, Python via {@link KERN_DECIMAL_OPS_HELPER_PY} registered at the
// emit site. A `Decimal.div(a,b)` call lowers to `__k_decimal_div(a, b)` on BOTH
// legs, so the zero-guard lives at ONE byte-identical diagnostic site per op.
// ─────────────────────────────────────────────────────────────────────────────

/** The ONE byte-identical runtime diagnostic a zero divisor/modulus raises — the
 *  message text the EMITTED helper throws on both legs (decimal.js leg + Python
 *  leg), so a `Decimal.div(x, Decimal.of("0"))` fails closed identically across
 *  targets at runtime. Pre-empts Python's DivisionByZero trap AND decimal.js's
 *  Infinity, replacing both with this single KERN error. */
export const DECIMAL_DIV_ZERO_FAILCLOSE = 'KERN Decimal division by zero';
export const DECIMAL_MOD_ZERO_FAILCLOSE = 'KERN Decimal modulo by zero';
/** `0 ** negative` is a zero-divide in disguise (decimal.js → Infinity, Python →
 *  Infinity, but it is mathematically a 1/0); the pow helper preflights it to the
 *  same byte-identical zero-error so the surface never yields a non-finite value. */
export const DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE = 'KERN Decimal 0 raised to a negative power (division by zero)';

/** COMPILE-TIME fail-close prefix when a `Decimal.pow` exponent is NOT a provably
 *  integer literal, or the base is a syntactically-negative literal. Integer
 *  exponent on a non-negative base is byte-exact across engines; a non-integer /
 *  negative-base power is correctly-rounded-transcendental on decimal.js and can
 *  diverge from Python by ~1 ulp, so it is REFUSED rather than lowered. */
export const DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE =
  'Decimal.pow supports only an integer exponent on a non-negative base';

/** Build the byte-identical compile-error for a non-portable `Decimal.pow`. The
 *  `reason` distinguishes the refused shape (non-literal / fractional exp /
 *  negative base) but the prefix + remediation are shared, so the refusal is
 *  observably symmetric across TS and Python (both legs throw this exact text). */
export function decimalPowFailMessage(reason: string): string {
  return (
    `${DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE}: ${reason}. ` +
    `KERN's certified Decimal pow is INTEGER-exponent only (0**0=1, positive, and negative int like 2**-1) ` +
    `on a non-negative base — these are byte-exact across decimal.js and Python's stdlib decimal. ` +
    `A non-integer exponent or a negative base is correctly-rounded TRANSCENDENTAL on the TS leg ` +
    `(decimal.js) and can diverge from the Python leg by ~1 ulp, so KERN cannot guarantee byte-exact ` +
    `cross-target parity and refuses it at compile time. Pass an integer-literal exponent and a ` +
    `non-negative base (e.g. Decimal.pow(Decimal.of("2"), Decimal.of("3"))). ` +
    `Fractional/transcendental pow is deferred to a later correctly-rounded slice.`
  );
}

/** The shared zero-divide diagnostic for a SYNTACTICALLY-ZERO divisor/modulus
 *  literal caught at COMPILE time (the early-error nicety): the SAME message the
 *  runtime helper would throw, so literal `Decimal.div(x, Decimal.of("0"))` fails
 *  closed identically whether caught at compile or run time. Wired into the dispatch
 *  by {@link assertNonZeroDecimalDivisor}. */
export function decimalZeroDivisorFailMessage(op: 'div' | 'mod'): string {
  return op === 'div' ? DECIMAL_DIV_ZERO_FAILCLOSE : DECIMAL_MOD_ZERO_FAILCLOSE;
}

/** COMPILE-TIME fail-close for a SYNTACTICALLY-ZERO `Decimal.div`/`Decimal.mod`
 *  divisor literal (analogous to {@link assertPortableDecimalPow} for pow). When the
 *  divisor is a direct `Decimal.of("0")` literal — the ONLY canonical zero form, since
 *  `"0.0"`/`"-0"` are already refused by `assertPortableDecimalLiteral` upstream — the
 *  zero divide is provable at compile time, so we throw the byte-identical
 *  {@link decimalZeroDivisorFailMessage} on BOTH legs rather than waiting for the
 *  emitted runtime helper's `b.isZero()` guard to fire. A DYNAMIC zero (a variable, a
 *  computed Decimal) cannot be proven here and is left to that runtime guard — the
 *  compile-time check is a strict, sound NARROWING of the runtime one, never a
 *  replacement. `divisor` is the SECOND arg node of the `Decimal.div`/`Decimal.mod`
 *  call. No-op unless `op` is `div`/`mod`. Called from BOTH legs' dispatch site with
 *  the SAME divisor node, so the refusal is symmetric. */
export function assertNonZeroDecimalDivisor(op: string, divisor: unknown): void {
  if (op !== 'div' && op !== 'mod') return;
  const lit = decimalOfLiteralValue(divisor);
  // The canonical grammar admits exactly one zero form (`"0"`); `"0.0"`/`"-0"` etc.
  // are non-portable and already fail-closed at the `Decimal.of` construction site,
  // so they can never reach here as a `Decimal.of` literal value.
  if (lit === '0') {
    throw new Error(decimalZeroDivisorFailMessage(op));
  }
}

/** TS-leg helper functions for the divergent Decimal ops, single-sourced here and
 *  rendered into the file-level decimal preamble (alongside the `decimal.js`
 *  import) by `kernStdlibPreamble`. Each takes two `Decimal` values and returns a
 *  `Decimal`, with the SYMMETRIC zero/pow guards throwing the byte-identical KERN
 *  diagnostics above. `Decimal.div/mod/pow` lower to calls into these.
 *
 *  `__k_decimal_pow_int` mirrors the Python helper exactly: it special-cases
 *  `0**0 → 1` (so both legs agree even though Python's `**` raises for that input)
 *  and preflights `0**neg` to the zero-divide error. The compile-time fail-close
 *  already guarantees the exponent is an integer literal and the base non-negative,
 *  so the helper does no further integer validation — it only encodes the two
 *  value-level guards that keep a non-finite Decimal off the comparison surface. */
export function decimalOpsHelpersTS(): string {
  return [
    'function __k_decimal_div(a: Decimal, b: Decimal): Decimal {',
    `  if (b.isZero()) throw new Error(${JSON.stringify(DECIMAL_DIV_ZERO_FAILCLOSE)});`,
    '  return a.div(b);',
    '}',
    'function __k_decimal_mod(a: Decimal, b: Decimal): Decimal {',
    `  if (b.isZero()) throw new Error(${JSON.stringify(DECIMAL_MOD_ZERO_FAILCLOSE)});`,
    '  return a.mod(b);',
    '}',
    'function __k_decimal_pow_int(a: Decimal, b: Decimal): Decimal {',
    `  if (a.isZero() && b.lt(0)) throw new Error(${JSON.stringify(DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE)});`,
    '  if (a.isZero() && b.isZero()) return new Decimal(1);',
    '  return a.pow(b);',
    '}',
  ].join('\n');
}

/** Python-leg twin of {@link decimalOpsHelpersTS}: the SAME three guarded helpers,
 *  defined in Python and registered into the prelude (via the `decimal-ops`
 *  requirement). `__k_decimal_pow_int` special-cases `0**0 → 1` BEFORE the native
 *  `**` — load-bearing, because under the DEFAULT decimal context (which the
 *  generated Python runs under — prec/rounding are set on `getcontext()` but the
 *  `InvalidOperation` trap stays ENABLED at its default), `Decimal("0") **
 *  Decimal("0")` RAISES `InvalidOperation`, whereas decimal.js returns `1`
 *  (empirically verified, CPython 3.12 + decimal.js 10.6.0). The special-case makes
 *  both legs agree on `1`. `0**neg` is preflighted to the same byte-identical KERN
 *  zero-error string the TS leg throws — neither engine's native error is ever
 *  observed because the guard runs first. The `from decimal import Decimal as
 *  _KernDecimal` import rides along so `_KernDecimal(1)` resolves. */
export const KERN_DECIMAL_OPS_HELPER_PY = [
  'from decimal import Decimal as _KernDecimal',
  '',
  'def __k_decimal_div(a, b):',
  '    if b.is_zero():',
  `        raise Exception(${pyStr(DECIMAL_DIV_ZERO_FAILCLOSE)})`,
  '    return a / b',
  '',
  'def __k_decimal_mod(a, b):',
  '    if b.is_zero():',
  `        raise Exception(${pyStr(DECIMAL_MOD_ZERO_FAILCLOSE)})`,
  '    return a % b',
  '',
  'def __k_decimal_pow_int(a, b):',
  '    if a.is_zero() and b < 0:',
  `        raise Exception(${pyStr(DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE)})`,
  '    if a.is_zero() and b.is_zero():',
  '        return _KernDecimal(1)',
  '    return a ** b',
].join('\n');

/** Render a Python single-quoted string literal for the helper body. The KERN
 *  diagnostic strings contain only ASCII letters/spaces/parens (no quote, no
 *  backslash), so a plain single-quote wrap is byte-safe and keeps the emitted
 *  helper readable; assert the precondition defensively. */
function pyStr(s: string): string {
  if (s.includes("'") || s.includes('\\') || s.includes('\n')) {
    throw new Error(`decimal-contract: diagnostic string is not single-quote-safe: ${s}`);
  }
  return `'${s}'`;
}

/** A MINIMAL structural view of a value node, satisfied by the shared `ValueIR`
 *  union without importing it (keeps `decimal-contract.ts` dependency-free and
 *  callable from both the core TS emitter and the Python emitter). Only the fields
 *  the syntactic Decimal-producer check reads are modelled. */
interface DecimalProbeNode {
  kind: string;
  callee?: { kind: string; object?: { kind: string; name?: string }; property?: string };
  args?: Array<{ kind: string; value?: string }>;
}

/** The provably-NON-Decimal literal node kinds. A `Decimal` binary/unary op
 *  (`Decimal.add/sub/mul/div/mod/pow`, `Decimal.neg/abs`, the comparators) takes
 *  ONLY Decimal operands; an operand of one of these kinds is, BY SYNTAX ALONE, a
 *  host number/string/bool/null/object/array/regex — NOT a Decimal — and would
 *  lower to a SILENT cross-target divergence (see {@link decimalNonDecimalOperandFailMessage}).
 *  The set is the {@link ValueIR} literal kinds whose VALUE can never be a Decimal:
 *    - `numLit`  — `Decimal.eq(Decimal.of("1"), 0.1)` → TS `.eq(0.1)` coerces the
 *      clean string `0.1`, Python `== 0.1` compares the EXACT binary float
 *      (`0.1000…0055`) → silent boolean divergence; a num as FIRST operand
 *      (`Decimal.eq(0.1, …)`) is even a TS runtime `TypeError` (`0.1.eq`).
 *    - `strLit`/`tmplLit`/`boolLit`/`nullLit`/`undefLit`/`regexLit`/`objectLit`/
 *      `arrayLit` — likewise never a Decimal value.
 *  NOT listed (and therefore PASS THROUGH, the conservative/sound default): `ident`,
 *  `call`, `member`, `binary`, `index`, … — a variable/param/return or a nested
 *  `Decimal.of(…)`/`Decimal.add(…)` producer may legitimately BE a Decimal, and KERN
 *  has no typed IR yet to prove otherwise. Requiring positive Decimal proof would
 *  reject the common `let d = Decimal.of("1.5"); Decimal.eq(d, e)` case — so we
 *  reject only operands that are provably NOT Decimal, mirroring how `Decimal.of`
 *  rejects a non-string-literal arg and how the `+`/`-`/`*` fail-close fires only on
 *  the syntactic producer shape. */
const NON_DECIMAL_OPERAND_LITERAL_KINDS = new Set([
  'numLit',
  'strLit',
  'tmplLit',
  'boolLit',
  'nullLit',
  'undefLit',
  'regexLit',
  'objectLit',
  'arrayLit',
]);

/** Diagnostic prefix when a `Decimal.<op>` argument is a provably-non-Decimal
 *  literal. Both legs throw this identical text (single-sourced), so the refusal is
 *  byte-identical across TS and Python. */
export const DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE = 'Decimal operation requires Decimal operands';

/** Diagnostic prefix when a `Decimal.<op>` argument is a UNARY-prefixed expression
 *  (`-Decimal.of("0")`, `~d`, `!d`). Both legs throw this identical text, so the
 *  refusal is byte-identical across TS and Python. A separate constant from the
 *  non-Decimal-literal family because it points users at the portable fix
 *  (`Decimal.neg(x)`), which a raw host-number literal does not have. */
export const DECIMAL_UNARY_OPERAND_FAILCLOSE = 'Decimal operation requires Decimal operands';

/** Build the byte-identical compile-error for a non-Decimal operand passed to a
 *  Decimal binary/unary op. Selected only by the offending method + operand kind,
 *  so the refusal is observably symmetric across TS and Python. */
export function decimalNonDecimalOperandFailMessage(method: string, operandKind: string): string {
  return (
    `${DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE}: Decimal.${method}(...) was passed a ${operandKind} operand, ` +
    `which is a host value (number/string/bool/…), NOT a Decimal. Mixing a Decimal with a raw host number ` +
    `silently diverges across targets — the TS leg (decimal.js) coerces it via its clean decimal string while ` +
    `Python's stdlib decimal compares/operates against the EXACT binary float (e.g. 0.1 → ` +
    `0.1000000000000000055511151231257827), so the two legs would disagree with NO error on either side. ` +
    `Wrap the operand in Decimal.of("...") (e.g. Decimal.${method}(x, Decimal.of("0.1"))) so both legs operate ` +
    `on the identical Decimal value.`
  );
}

/** Build the byte-identical compile-error for a UNARY-prefixed operand (`-x`, `~x`,
 *  `!x`) passed to a Decimal binary/unary op. A unary operator on a real Decimal
 *  silently DEGRADES on the TS leg only: JS `-new Decimal("0")` invokes decimal.js's
 *  `.valueOf()`, coercing the Decimal to a primitive (`-0`) BEFORE the helper sees it,
 *  so the guarded helper's `b.isZero()` throws a bare host `TypeError` instead of the
 *  KERN diagnostic — while Python's `-Decimal("0")` keeps a real Decimal and raises the
 *  INTENDED `KERN Decimal division by zero`. That asymmetry (same root as the natural
 *  `+`/`-`/`*` operator fail-close: decimal.js operators degrade via `.valueOf()`, here
 *  via UNARY minus/plus) is closed by refusing every unary-wrapped operand up front.
 *  Both legs throw this identical text (single-sourced), so the refusal is symmetric. */
export function decimalUnaryOperandFailMessage(method: string, op: string): string {
  return (
    `${DECIMAL_UNARY_OPERAND_FAILCLOSE}: Decimal.${method}(...) was passed a '${op}'-prefixed (unary) operand. ` +
    `A unary operator on a Decimal silently diverges across targets — the TS leg (decimal.js) coerces the Decimal ` +
    `to a primitive via its '.valueOf()' (e.g. '-new Decimal("0")' becomes the host number -0, so the helper's ` +
    `Decimal guards throw a bare TypeError), while Python keeps a real Decimal and behaves correctly, so the two ` +
    `legs would disagree. For negation use the portable method form Decimal.neg(x) (e.g. ` +
    `Decimal.${method}(..., Decimal.neg(x))), which lowers to a real Decimal on BOTH legs.`
  );
}

/** The provably-non-Decimal kind of an operand node, or null if the operand is not
 *  provably a non-Decimal literal.
 *
 *  TOP-LEVEL only: a UNARY-prefixed operand (`-x`, `~x`, `!x`) is now rejected ahead
 *  of this check by {@link topLevelUnaryOp} (a unary on a Decimal degrades on the TS
 *  leg via `.valueOf()` — see {@link decimalUnaryOperandFailMessage}), so by the time
 *  this runs the node is NOT a `unary`. We therefore inspect the node's OWN kind
 *  directly: a bare `numLit`/`strLit`/`boolLit`/… is provably never a Decimal and is
 *  refused; `ident`/`call`/`member`/`binary`/… flow through (they MAY be a Decimal and
 *  KERN has no typed IR to prove otherwise — the conservative/sound default). */
function nonDecimalOperandKind(node: unknown): string | null {
  if (typeof node !== 'object' || node === null) return null;
  const kind = (node as { kind?: unknown }).kind;
  return typeof kind === 'string' && NON_DECIMAL_OPERAND_LITERAL_KINDS.has(kind) ? kind : null;
}

/** The unary operator (`-`, `~`, `!`) if `node`'s TOP-LEVEL kind is `unary`, else null.
 *  A unary-prefixed operand to any Decimal op but `of` is fail-closed (see
 *  {@link decimalUnaryOperandFailMessage}): on the TS leg a unary operator coerces a
 *  real Decimal to a host primitive via decimal.js's `.valueOf()` BEFORE the guarded
 *  helper runs, so `Decimal.div(Decimal.of("1"), -Decimal.of("0"))` throws a bare
 *  `TypeError` instead of the KERN division-by-zero diagnostic, while Python keeps a
 *  real Decimal and raises the intended error — an asymmetry. Refusing EVERY unary
 *  operand (not just the unary-wrapped non-Decimal LITERAL the old unwrap caught) is
 *  the sound minimal boundary: a unary on a Decimal degrades; a unary on a non-Decimal
 *  literal (`-0.1`) was already invalid — so both fail closed here, before the more
 *  specific literal check. We do NOT treat `typeAssert` (`x as Decimal`) as unary —
 *  that is the author's explicit type claim and the future typed-IR escape hatch. */
function topLevelUnaryOp(node: unknown): string | null {
  if (typeof node !== 'object' || node === null) return null;
  if ((node as { kind?: unknown }).kind !== 'unary') return null;
  const op = (node as { op?: unknown }).op;
  return typeof op === 'string' ? op : '';
}

/** Throw the symmetric fail-close when any argument of a `Decimal.<method>` call
 *  (other than the `Decimal.of` constructor, whose arg is a validated STRING literal)
 *  is unsafe across targets. Two refusals, checked in order per operand:
 *    1. UNARY-prefixed (`-Decimal.of("0")`, `~d`, `!d`) — see {@link topLevelUnaryOp}.
 *       A unary on a Decimal degrades on the TS leg via decimal.js's `.valueOf()`
 *       (the `Decimal.div(Decimal.of("1"), -Decimal.of("0"))` repro: TS throws a bare
 *       `TypeError`, Python raises the KERN diagnostic). Refused with the
 *       `Decimal.neg(x)`-pointing {@link decimalUnaryOperandFailMessage}. This ALSO
 *       catches a unary-signed non-Decimal literal (`-0.1`), which was already invalid.
 *    2. A provably-non-Decimal LITERAL (`0.1`, `"x"`, `true`, …) — see
 *       {@link nonDecimalOperandKind} — refused with {@link decimalNonDecimalOperandFailMessage}.
 *  Called from BOTH legs' dispatch site with the SAME `{method, args}`, so the refusal
 *  is byte-identical. A no-op for `of` and for operands that are neither a unary nor a
 *  provably-non-Decimal literal (idents/calls/members flow through — they MAY be a
 *  Decimal; KERN has no typed IR to prove otherwise, the conservative/sound default). */
export function assertDecimalOperands(method: string, args: ReadonlyArray<unknown>): void {
  if (method === 'of') return;
  for (const arg of args) {
    const unaryOp = topLevelUnaryOp(arg);
    if (unaryOp !== null) {
      throw new Error(decimalUnaryOperandFailMessage(method, unaryOp));
    }
    const kind = nonDecimalOperandKind(arg);
    if (kind !== null) {
      throw new Error(decimalNonDecimalOperandFailMessage(method, kind));
    }
  }
}

/** Extract the literal STRING value `s` of a `Decimal.of("s")` call node, or null
 *  if `node` is not exactly that syntactic shape. Used by the compile-time pow
 *  fail-close to read the exponent / base literal. CONSERVATIVE: only a direct
 *  `Decimal.of(<strLit>)` is recognised — a variable, a `Decimal.add(...)` result,
 *  or any non-literal exponent returns null and is therefore REFUSED by the caller
 *  (it cannot be proven an integer at compile time, the soundness-critical default). */
export function decimalOfLiteralValue(node: unknown): string | null {
  if (typeof node !== 'object' || node === null) return null;
  const n = node as DecimalProbeNode;
  if (n.kind !== 'call') return null;
  const callee = n.callee;
  if (!callee || callee.kind !== 'member' || callee.property !== 'of') return null;
  if (callee.object?.kind !== 'ident' || callee.object.name !== 'Decimal') return null;
  const arg = n.args?.[0];
  if (!arg || arg.kind !== 'strLit' || typeof arg.value !== 'string') return null;
  return arg.value;
}

/** COMPILE-TIME fail-close for `Decimal.pow(base, exp)`: ship ONLY a provably
 *  integer exponent literal on a non-negative base; refuse everything else with the
 *  byte-identical {@link decimalPowFailMessage}. Called from BOTH legs' dispatch
 *  site with the SAME `{base, exp}` arg nodes, so the refusal is symmetric.
 *
 *  Rules (each maps to a concrete divergence the integer-only contract avoids):
 *    - exponent MUST be a `Decimal.of("<int>")` literal — a non-literal (variable /
 *      arithmetic result) cannot be proven integer at compile time, so it is
 *      refused (the soundness-critical conservative default: a runtime check would
 *      let a fractional dynamic exponent reach decimal.js's transcendental pow and
 *      diverge from Python by ~1 ulp before any guard fires).
 *    - exponent literal MUST have NO fractional part (`"2.5"` → refused).
 *    - base, IF a `Decimal.of("<lit>")` literal, MUST NOT be syntactically negative
 *      (`Decimal.of("-2")` → refused; negative base + non-even exponent is
 *      complex/sign-divergent territory). A non-literal base is allowed through —
 *      the helper never produces a non-finite from a non-negative-or-any real base
 *      with an integer exponent except `0**neg`, which the runtime guard catches.
 *
 *  UPSTREAM-GATE DEPENDENCY (makes the string checks EXACT, not heuristic): any
 *  literal reaching here as a `Decimal.of("<lit>")` arg has ALREADY passed
 *  `assertPortableDecimalLiteral` at its construction site, so `<lit>` is in the
 *  canonical grammar `^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$` — NO exponent (`E`/`e`),
 *  NO whitespace, NO leading/signed zero, NO trailing-zero fraction, and any
 *  fraction has an integer part. So `.includes(".")` is an EXACT integer test
 *  (`"-.5"`, `"3.0E2"`, `"  -3 "` cannot appear — they fail the literal gate first)
 *  and a leading `-` is an EXACT sign test (sci-notation negatives like `"-3E2"`
 *  cannot appear). The checks are not string heuristics over arbitrary input. */
export function assertPortableDecimalPow(base: unknown, exp: unknown): void {
  const expLit = decimalOfLiteralValue(exp);
  if (expLit === null) {
    throw new Error(
      decimalPowFailMessage(
        'the exponent must be an integer Decimal literal (e.g. Decimal.of("3")), not a variable or computed value',
      ),
    );
  }
  if (expLit.includes('.')) {
    throw new Error(decimalPowFailMessage(`the exponent Decimal.of("${expLit}") is not an integer`));
  }
  const baseLit = decimalOfLiteralValue(base);
  if (baseLit !== null && baseLit.startsWith('-')) {
    throw new Error(decimalPowFailMessage(`the base Decimal.of("${baseLit}") is negative`));
  }
}

/** The EXACT set of `Decimal.<method>` calls that PRODUCE a Decimal value — the
 *  KERN_STDLIB.Decimal surface (`packages/core/src/codegen/kern-stdlib.ts`). The
 *  operator fail-close must fire ONLY on these, so an UNKNOWN member like
 *  `Decimal.nope(...)` falls through to the real "unknown stdlib member"
 *  diagnostic, and `Decimal.of("1.10") + 1` falls through to the non-canonical-
 *  literal diagnostic — instead of both being masked by the generic operator
 *  error (Slice-2 remediation, Finding 2). Keep in lockstep with the stdlib
 *  Decimal entry: adding a new producing method (e.g. `div`) means adding it
 *  here too, on BOTH legs (this single source is imported by both). */
// Slice 3: `div`/`mod`/`pow` PRODUCE a Decimal, so a `Decimal.div(a,b) + 1` etc.
// trips the operator fail-close exactly like `add`. The COMPARATORS
// (`eq`/`ne`/`lt`/`lte`/`gt`/`gte`/`cmp`) are deliberately NOT here — they return a
// bool/int, not a Decimal, so a `Decimal.eq(a,b) + 1` is ordinary boolean→number
// arithmetic and must NOT be refused as a Decimal-operator misuse.
const DECIMAL_PRODUCER_METHODS = new Set(['of', 'add', 'sub', 'mul', 'neg', 'abs', 'div', 'mod', 'pow']);

/** True iff `node` is, BY SYNTAX ALONE, unambiguously a Decimal-producing call:
 *  a call whose callee is a member access `Decimal.<method>` on the literal `Decimal`
 *  namespace identifier AND whose method is one of the KNOWN Decimal-producing
 *  members (`Decimal.of(...)`, `Decimal.add(...)`, `Decimal.sub(...)`, …).
 *
 *  CONSERVATIVE BY DESIGN (the critical soundness property): it fires ONLY on this
 *  exact shape. It does NOT track types through variables, params, returns, or
 *  member chains — a `let d = Decimal.of("1.5"); d + x` is NOT caught here (that
 *  needs the typed IR of slice 3; a `// SLICE 3:` note marks the generalization).
 *  It therefore can NEVER false-fire on ordinary numeric `+`/`-`/`*` (a `numLit`,
 *  `ident`, plain `call`, member-read, etc. all return false).
 *
 *  Finding-2 narrowing: the method MUST be a known producer. `Decimal.nope(...)`
 *  is NOT a producer, so it returns false here and the binary-emit site lowers
 *  its operands normally — surfacing the unknown-member / non-canonical-literal
 *  diagnostic the operand actually has, rather than the generic operator error. */
export function isSyntacticDecimalProducer(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as DecimalProbeNode;
  if (n.kind !== 'call') return false;
  const callee = n.callee;
  if (!callee || callee.kind !== 'member') return false;
  // Only the known Decimal-producing methods count. An unknown member is NOT a
  // proven Decimal producer — let the operand lower so its real diagnostic fires.
  if (typeof callee.property !== 'string' || !DECIMAL_PRODUCER_METHODS.has(callee.property)) return false;
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
