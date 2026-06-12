/**
 * ToNumericPrimitive decision kernel — slice 0.75 substrate.
 *
 * A dependency-free, browser-safe pure-TS module that answers KERN's
 * ToNumber question for the FROZEN primitive domain (numbers, ECMA numeric
 * strings, booleans, null, and the `undefined` sentinel) and built-on integer
 * coercions (`toInt32` / `toUint32` / `toIntegerOrInfinity`). It is one of the
 * three artifacts of a slice-0.75 contract (charter §A.1): the kernel operates
 * on *semantic values*, never on text or ValueIR, and never imports `typescript`
 * or anything heavy.
 *
 * Why a real grammar (not `Number(...)` delegation):
 *   The kernel is the executable SPEC the differential battery validates
 *   against native JS `Number()`. Delegating to `Number()` would make the
 *   self-test tautological AND would not transfer to Python — Python's
 *   `float()` diverges from JS on three load-bearing cases: it accepts numeric
 *   separators (`float("1_000") === 1000.0`), case-insensitive infinity/NaN
 *   words (`float("infinity")`, `float("nan")`), and raises on `0x`/`0b`/`0o`
 *   prefixes. So both the TS kernel here and the emitted Python helper encode
 *   the ECMA-262 StringNumericLiteral grammar explicitly; the battery proves
 *   they agree with each other and with `Number()`.
 *
 * Fail-closed boundary (charter §A; oracle "Fail-Closed List"):
 *   Objects, arrays, functions, symbols, bigints, and custom-`valueOf` hosts
 *   are NOT coerced — full ToPrimitive (valueOf/toString ordering, array
 *   stringification) is out of slice scope. They return the discriminated
 *   `{ ok: false }` variant so the CALLER decides (diagnostic vs. throw), per
 *   the charter's "fail-closed result, NOT a throw-by-default" rule.
 *
 * Float mandate (tribunal amendment 1): every numeric output is a JS double
 * (the only number type JS has), so the Python twin must return `float` for
 * every numeric result including bool/null/hex inputs. `-0` sign is preserved
 * (amendment 2).
 */

/** A value the kernel will coerce. Exotic hosts fall into the fail-closed branch. */
export type KernNumericInput = unknown;

/**
 * Result of a ToNumber-family coercion.
 *
 *   - `{ ok: true, value }`  — a successful numeric result. For `toNumber`,
 *     `value` is a JS number (may be `NaN`, `±Infinity`, or `-0`). For the
 *     integer codomains it is an integer (`toInt32`/`toUint32`) or an
 *     integer-valued number / `±Infinity` (`toIntegerOrInfinity`).
 *   - `{ ok: false, reason }` — the input is outside the slice-0.75 primitive
 *     domain (object/array/function/symbol/bigint/custom-valueOf). The caller
 *     decides how to surface it (compile-time diagnostic or runtime refusal);
 *     the kernel never throws for this case.
 */
export type NumericResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: string };

/**
 * The sentinel a host passes for KERN `undefined`. The kernel recognizes the
 * JS primitive `undefined` directly; an explicit object sentinel can also be
 * tagged by callers using {@link isUndefinedSentinel}. Kept as a unique symbol
 * so it can never collide with a user value.
 */
export const KERN_UNDEFINED_SENTINEL: unique symbol = Symbol.for('kern.undefined');

function isUndefinedSentinel(x: unknown): boolean {
  return x === undefined || x === KERN_UNDEFINED_SENTINEL;
}

/* ------------------------------------------------------------------ *
 * ECMA-262 StringNumericLiteral grammar (string → number).
 * ------------------------------------------------------------------ */

/**
 * The exact set of code points ECMA-262 trims from both ends of a
 * StringNumericLiteral: `StrWhiteSpace` = `WhiteSpace` ∪ `LineTerminator`.
 * Verified against V8 `Number(ws + "5" + ws) === 5` for every member, and
 * against the *exclusions* `U+200B` (ZWSP), `U+0085` (NEL), `U+180E` which JS
 * does NOT trim.
 *
 * Order/membership is load-bearing: the Python twin embeds the identical set.
 */
export const ECMA_STR_WHITESPACE: readonly number[] = Object.freeze([
  0x09, // CHARACTER TABULATION
  0x0a, // LINE FEED (LineTerminator)
  0x0b, // LINE TABULATION
  0x0c, // FORM FEED
  0x0d, // CARRIAGE RETURN (LineTerminator)
  0x20, // SPACE
  0xa0, // NO-BREAK SPACE
  0x1680, // OGHAM SPACE MARK
  0x2000, // EN QUAD
  0x2001, // EM QUAD
  0x2002, // EN SPACE
  0x2003, // EM SPACE
  0x2004, // THREE-PER-EM SPACE
  0x2005, // FOUR-PER-EM SPACE
  0x2006, // SIX-PER-EM SPACE
  0x2007, // FIGURE SPACE
  0x2008, // PUNCTUATION SPACE
  0x2009, // THIN SPACE
  0x200a, // HAIR SPACE
  0x2028, // LINE SEPARATOR (LineTerminator)
  0x2029, // PARAGRAPH SEPARATOR (LineTerminator)
  0x202f, // NARROW NO-BREAK SPACE
  0x205f, // MEDIUM MATHEMATICAL SPACE
  0x3000, // IDEOGRAPHIC SPACE
  0xfeff, // ZERO WIDTH NO-BREAK SPACE (BOM)
]);

const WS_SET: ReadonlySet<number> = new Set(ECMA_STR_WHITESPACE);

function isEcmaWhitespace(cp: number): boolean {
  return WS_SET.has(cp);
}

/** Trim ECMA StrWhiteSpace from both ends (NOT `String.prototype.trim`'s set). */
function ecmaTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end) {
    const cp = text.codePointAt(start);
    if (cp === undefined || !isEcmaWhitespace(cp)) break;
    start += 1;
  }
  while (end > start) {
    const cp = text.codePointAt(end - 1);
    if (cp === undefined || !isEcmaWhitespace(cp)) break;
    end -= 1;
  }
  return text.slice(start, end);
}

// StrDecimalLiteral: optional sign, then a decimal body. Each body alternative
// requires at least one digit (so `.`, `+`, `1e`, `e3` all fail), and an
// exponent, if present, requires digits (so `1e` fails). No numeric separators.
const DECIMAL_RE = /^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|[0-9]+)$/;
// Unsigned radix prefixes only — JS rejects `+0x10`/`-0x10`. Case-insensitive
// prefix letter and digits (`0X10`, `0xFF`). No hex float (`0x1p3` → NaN).
const HEX_RE = /^0[xX][0-9a-fA-F]+$/;
const BIN_RE = /^0[bB][01]+$/;
const OCT_RE = /^0[oO][0-7]+$/;

/**
 * ECMA-262 `StringToNumber` over a StringNumericLiteral.
 *
 * Returns a JS number, using `NaN` for any string outside the grammar. Empty
 * and all-whitespace strings are `+0`. `-0` survives. `"Infinity"` is
 * case-sensitive (only the exact word, optionally signed). Radix prefixes
 * `0x`/`0b`/`0o` (any case) are unsigned-only.
 */
export function stringToNumber(raw: string): number {
  const text = ecmaTrim(raw);
  if (text.length === 0) return 0; // "" and all-whitespace → +0

  if (text === 'Infinity' || text === '+Infinity') return Infinity;
  if (text === '-Infinity') return -Infinity;

  if (HEX_RE.test(text)) return parseInt(text.slice(2), 16);
  if (BIN_RE.test(text)) return parseInt(text.slice(2), 2);
  if (OCT_RE.test(text)) return parseInt(text.slice(2), 8);

  if (!DECIMAL_RE.test(text)) return NaN;
  // The grammar above is a strict subset of what JS `Number` accepts for
  // decimals, so `Number(text)` here only finishes the float conversion of an
  // already-validated decimal literal — it cannot re-admit `1_000`/`0x..`.
  return Number(text);
}

/* ------------------------------------------------------------------ *
 * ToNumber over the slice-0.75 primitive domain.
 * ------------------------------------------------------------------ */

/**
 * ECMA-262 `ToNumber` restricted to the slice-0.75 primitive domain.
 *
 *   number    → itself (NaN, ±Infinity, -0 preserved)
 *   boolean   → 1 / 0
 *   null      → +0
 *   undefined → NaN  (JS primitive `undefined` or {@link KERN_UNDEFINED_SENTINEL})
 *   string    → {@link stringToNumber}
 *   else      → fail-closed `{ ok: false }` (object/array/function/symbol/bigint)
 */
export function toNumber(x: KernNumericInput): NumericResult {
  if (isUndefinedSentinel(x)) return { ok: true, value: NaN };
  if (x === null) return { ok: true, value: 0 };
  if (typeof x === 'boolean') return { ok: true, value: x ? 1 : 0 };
  if (typeof x === 'number') return { ok: true, value: x };
  if (typeof x === 'string') return { ok: true, value: stringToNumber(x) };
  // object / array / function / symbol / bigint / custom-valueOf host →
  // fail-closed; full ToPrimitive is out of slice 0.75.
  return {
    ok: false,
    reason: `ToNumber: ${describe(x)} is outside the slice-0.75 primitive domain (full ToPrimitive deferred)`,
  };
}

function describe(x: unknown): string {
  if (Array.isArray(x)) return 'array';
  const t = typeof x;
  if (t === 'object') return 'object';
  return t;
}

/* ------------------------------------------------------------------ *
 * Integer codomains, built on ToNumber.
 * ------------------------------------------------------------------ */

/** ECMA-262 `ToInt32`: ToNumber then modular wrap to signed 32-bit. */
export function toInt32(x: KernNumericInput): NumericResult {
  const n = toNumber(x);
  if (!n.ok) return n;
  return { ok: true, value: numberToInt32(n.value) };
}

/** ECMA-262 `ToUint32`: ToNumber then modular wrap to unsigned 32-bit. */
export function toUint32(x: KernNumericInput): NumericResult {
  const n = toNumber(x);
  if (!n.ok) return n;
  return { ok: true, value: numberToUint32(n.value) };
}

/**
 * ECMA-262 `ToIntegerOrInfinity`: ToNumber then truncate toward zero.
 * `NaN → +0`; `±Infinity → ±Infinity`; otherwise the integer part (a number,
 * not necessarily int32-ranged).
 */
export function toIntegerOrInfinity(x: KernNumericInput): NumericResult {
  const n = toNumber(x);
  if (!n.ok) return n;
  return { ok: true, value: numberToIntegerOrInfinity(n.value) };
}

/** Signed 32-bit modular wrap of an already-numeric value (shift-mask domain). */
export function numberToInt32(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const int = Math.trunc(value);
  const wrapped = ((int % 0x1_0000_0000) + 0x1_0000_0000) % 0x1_0000_0000;
  return wrapped >= 0x8000_0000 ? wrapped - 0x1_0000_0000 : wrapped;
}

/** Unsigned 32-bit modular wrap of an already-numeric value. */
export function numberToUint32(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const int = Math.trunc(value);
  return ((int % 0x1_0000_0000) + 0x1_0000_0000) % 0x1_0000_0000;
}

/** Truncate toward zero, mapping NaN→+0 and preserving ±Infinity. */
export function numberToIntegerOrInfinity(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value === Infinity || value === -Infinity) return value;
  return Math.trunc(value);
}
