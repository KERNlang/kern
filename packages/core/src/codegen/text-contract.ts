/** TEXT first-class member — shared contract for KERN's `Text.*` string-ops
 *  surface (`Text.length`/`utf8Length`/`charAt`/`slice`/`indexOf`/`startsWith`), single-
 *  sourced across the THREE legs, mirroring the Decimal contract split
 *  (`decimal-contract.ts`):
 *    - the ReferenceRunner (`ir/semantics/portable-string.ts`) imports the
 *      PURE helpers below directly and executes them in-process;
 *    - the TS codegen emitter renders {@link textOpsHelpersTS} into the
 *      KERN-stdlib file preamble (`stdlib-preamble.ts`'s `usage.textOps`
 *      gate), mirroring the Decimal div/mod/pow helper pattern
 *      (`decimalOpsHelpersTS`);
 *    - the Python codegen emitter registers {@link KERN_TEXT_OPS_HELPER_PY}
 *      as a per-function inline helper block via the `'text-ops'` stdlib
 *      requirement, mirroring the Number/Math/Object/Array JS-emulation
 *      helpers in `packages/python/src/core/expr/helpers.ts`.
 *
 *  CONTRACT (tribunal-locked, run tribunal-1782979476717-1d9547): a KERN
 *  string is a sequence of Unicode CODE POINTS on all three legs.
 *  `Text.length`, `Text.charAt(i)`, `Text.slice(a, b)`, `Text.indexOf(needle)`,
 *  and `Text.startsWith(prefix)` all operate on CODE-POINT indices, while
 *  `Text.utf8Length` returns the RFC 3629 byte count of that scalar sequence — NOT
 *  JS's native UTF-16 code-UNIT indices, which diverge from Python's
 *  code-point indices for any character outside the Basic Multilingual
 *  Plane (BMP): a surrogate PAIR is two UTF-16 code units but ONE Unicode
 *  code point. Python's `str` is already code-point-native, so the Python
 *  leg's helpers are thin bounds/well-formedness guards around the native
 *  operators; the TS leg emulates code points over JS's UTF-16 strings via
 *  a full code-point walk (`Array.from`/the string iterator, which already
 *  pairs valid surrogate pairs correctly) — no BMP-only shortcut.
 *
 *  FAIL-CLOSED SET (milestone 5.1b's BMP-only risk valve is LIFTED by this
 *  slice — see git history / `runner-string-ops.test.ts` for the prior,
 *  narrower behavior): the ONLY rejected input is a MALFORMED UTF-16
 *  sequence — a lone high surrogate, a lone low surrogate, a reversed pair,
 *  or any high-high / low-low run. A WELL-FORMED non-BMP character (a real
 *  surrogate pair — an emoji, an astral CJK-extension character, a rare
 *  mathematical symbol) is now IN SCOPE and computed correctly on every leg.
 *
 *  BOUNDS POLICY (unchanged from 5.1b, applied identically by every op):
 *    - `charAt(i)` requires `0 <= i < length` (throws — JS's real `.charAt`
 *      silently returns `""` out of range; NOT inherited).
 *    - `slice(a, b)` requires `0 <= a <= b <= length` — no negative index,
 *      no silent clamping (JS `.slice` / Python `s[a:b]` both clamp/wrap;
 *      NOT inherited).
 *    - `indexOf(needle)` returns `-1` for "not found" (not an error). An
 *      empty needle matches at code-point index 0.
 *    - `startsWith(prefix)` returns a boolean; there is no out-of-range case.
 *
 *  DEPENDENCY-FREE: this module imports nothing (no `typescript`, no other
 *  KERN module) — it is reachable from the ReferenceRunner's browser-safe /
 *  standalone-runtime spine (`ir/semantics/`, `@kernlang/core/runner`), which
 *  is pinned to a `decimal.js`-only external-dependency set by
 *  `runner-entry-import-graph.test.ts`. */

const SURROGATE_HIGH_LO = 0xd800;
const SURROGATE_HIGH_HI = 0xdbff;
const SURROGATE_LOW_LO = 0xdc00;
const SURROGATE_LOW_HI = 0xdfff;

/** True iff `s` is Unicode WELL-FORMED — every high surrogate is immediately
 *  followed by a low surrogate and vice versa (i.e. no lone/reversed/
 *  high-high/low-low surrogate run). This is the platform's
 *  `String.prototype.isWellFormed()` notion, hand-rolled for portability:
 *  this module sits on the browser-safe runner spine, which must not assume
 *  a specific ES-version runtime feature (`isWellFormed()` is ES2024). */
export function isWellFormedText(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const unit = s.charCodeAt(i);
    if (unit >= SURROGATE_HIGH_LO && unit <= SURROGATE_HIGH_HI) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : Number.NaN;
      if (!(next >= SURROGATE_LOW_LO && next <= SURROGATE_LOW_HI)) return false;
      i += 1; // consumed as a valid pair — do not re-examine the low half
    } else if (unit >= SURROGATE_LOW_LO && unit <= SURROGATE_LOW_HI) {
      return false; // lone low surrogate (not consumed by a preceding high)
    }
  }
  return true;
}

/** Split a WELL-FORMED string into its Unicode CODE POINTS — each array
 *  element is one code point (a single UTF-16 code unit for a BMP
 *  character, the full two-unit surrogate pair rendered as one JS string
 *  for an astral character). The JS string iterator (which `Array.from`
 *  uses) already pairs valid surrogate pairs correctly; caller MUST have
 *  already validated {@link isWellFormedText} — this performs no re-check,
 *  so its result on a malformed string is unspecified. */
export function textCodePoints(s: string): string[] {
  return Array.from(s);
}

/** `hay`/`needle` are already-validated code-point ARRAYS (see
 *  {@link textCodePoints}). Returns the code-point index of the first
 *  occurrence of `needle` in `hay`, or `-1`. An empty needle matches at
 *  index 0 (mirrors JS `"".indexOf` / Python `str.find`). */
export function codePointIndexOf(hay: readonly string[], needle: readonly string[]): number {
  const n = needle.length;
  if (n === 0) return 0;
  const limit = hay.length - n;
  for (let i = 0; i <= limit; i += 1) {
    let matched = true;
    for (let j = 0; j < n; j += 1) {
      if (hay[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

// ── Fail-close diagnostics — single-sourced message TEXT. The runner throws
//    these directly; both codegen legs render them into the emitted helper's
//    `throw`/`raise` via a string literal, so the core assertion text agrees
//    across all three legs even though the emitted helper LOGIC is
//    necessarily hand-mirrored per leg (JS UTF-16 vs Python native code
//    points) — the same trade-off `decimal-contract.ts`'s guarded div/mod/pow
//    helpers make (shared message, hand-duplicated arithmetic guard). ────────

export const TEXT_MALFORMED_SURROGATE_FAILCLOSE = 'contains a malformed (lone or reversed) UTF-16 surrogate';
export const TEXT_REQUIRES_STRING_FAILCLOSE = 'requires a string';

export function textMalformedSurrogateFailMessage(label: string): string {
  return (
    `portable: ${label} ${TEXT_MALFORMED_SURROGATE_FAILCLOSE} — a lone high/low surrogate, a reversed pair, or a ` +
    'high-high/low-low run is not a valid Unicode string on any leg. A WELL-FORMED non-BMP character (an emoji, ' +
    'an astral CJK-extension character — a real surrogate PAIR) is supported; only a MALFORMED sequence fails closed.'
  );
}

export function textCharAtOutOfRangeMessage(label: string, index: number, length: number): string {
  return `portable: ${label} index ${index} is out of bounds for a string of length ${length} (0 <= index < length required)`;
}

export function textSliceOutOfRangeMessage(label: string, start: number, end: number, length: number): string {
  return (
    `portable: ${label}(${start}, ${end}) is out of bounds for a string of length ${length} ` +
    '(0 <= start <= end <= length required)'
  );
}

export const TEXT_SCALAR_CONSTRUCTOR_FAILCLOSE =
  'requires a safe integer Unicode scalar (0..1114111 excluding surrogates)';

/** Reserved compiler/runtime lowering, kept with its private Text helpers. */
export const KERN_INTERNAL_TEXT_STDLIB = Object.freeze({
  textFromScalar: Object.freeze({
    arity: 1,
    ts: '__kern_text_from_scalar($0)',
    py: '_kern_text_from_scalar($0)',
    requires: Object.freeze({ py: 'text-ops' }),
  }),
});

/** TS-leg helper functions for the code-point-indexed Text ops, rendered
 *  into the file-level KERN-stdlib preamble (see `stdlib-preamble.ts`'s
 *  `usage.textOps` gate) exactly once per generated module — mirroring
 *  `decimalOpsHelpersTS`. `Text.length/utf8Length/charAt/slice/indexOf/startsWith`
 *  lower to calls into these (`__kern_text_*`). Generated output cannot
 *  `import` this compiler-internal module, so the well-formedness scan and
 *  code-point walk are hand-mirrored here from {@link isWellFormedText} /
 *  {@link textCodePoints} / {@link codePointIndexOf} — kept byte-close by
 *  inspection and pinned by the conformance/runner test suites (the same
 *  trade-off the Decimal guarded-helper block makes). */
export function textOpsHelpersTS(): string {
  return [
    'function __kern_text_well_formed(s: string): boolean {',
    '  for (let i = 0; i < s.length; i += 1) {',
    '    const unit = s.charCodeAt(i);',
    '    if (unit >= 0xd800 && unit <= 0xdbff) {',
    '      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : Number.NaN;',
    '      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;',
    '      i += 1;',
    '    } else if (unit >= 0xdc00 && unit <= 0xdfff) {',
    '      return false;',
    '    }',
    '  }',
    '  return true;',
    '}',
    'function __kern_text_require_well_formed(s: unknown, label: string): string {',
    `  if (typeof s !== 'string') throw new Error('portable: ' + label + ' ' + ${JSON.stringify(TEXT_REQUIRES_STRING_FAILCLOSE)});`,
    '  if (!__kern_text_well_formed(s)) {',
    `    throw new Error('portable: ' + label + ' ' + ${JSON.stringify(TEXT_MALFORMED_SURROGATE_FAILCLOSE)});`,
    '  }',
    '  return s;',
    '}',
    'function __kern_text_code_points(s: string): string[] {',
    '  return Array.from(s);',
    '}',
    'function __kern_text_from_scalar(value: number): string {',
    '  if (!Number.isSafeInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {',
    `    throw new Error('portable: KernInternal.textFromScalar ' + ${JSON.stringify(TEXT_SCALAR_CONSTRUCTOR_FAILCLOSE)});`,
    '  }',
    '  return String.fromCodePoint(value);',
    '}',
    'function __kern_text_length(s: string): number {',
    "  return __kern_text_code_points(__kern_text_require_well_formed(s, 'Text.length')).length;",
    '}',
    'function __kern_text_utf8_length(s: string): number {',
    "  s = __kern_text_require_well_formed(s, 'Text.utf8Length');",
    '  let bytes = 0;',
    '  for (let i = 0; i < s.length; i += 1) {',
    '    const unit = s.charCodeAt(i);',
    '    if (unit <= 0x7f) bytes += 1;',
    '    else if (unit <= 0x7ff) bytes += 2;',
    '    else if (unit >= 0xd800 && unit <= 0xdbff) { bytes += 4; i += 1; }',
    '    else bytes += 3;',
    '  }',
    '  return bytes;',
    '}',
    'function __kern_text_char_at(s: string, i: number): string {',
    "  const cps = __kern_text_code_points(__kern_text_require_well_formed(s, 'Text.charAt'));",
    '  if (!Number.isInteger(i) || i < 0 || i >= cps.length) {',
    "    throw new Error('portable: Text.charAt index ' + i + ' is out of bounds for a string of length ' + cps.length + ' (0 <= index < length required)');",
    '  }',
    '  return cps[i];',
    '}',
    'function __kern_text_slice(s: string, a: number, b: number): string {',
    "  const cps = __kern_text_code_points(__kern_text_require_well_formed(s, 'Text.slice'));",
    '  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > cps.length || b > cps.length || a > b) {',
    "    throw new Error('portable: Text.slice(' + a + ', ' + b + ') is out of bounds for a string of length ' + cps.length + ' (0 <= start <= end <= length required)');",
    '  }',
    "  return cps.slice(a, b).join('');",
    '}',
    'function __kern_text_index_of(s: string, needle: string): number {',
    "  const hay = __kern_text_code_points(__kern_text_require_well_formed(s, 'Text.indexOf'));",
    "  const nee = __kern_text_code_points(__kern_text_require_well_formed(needle, 'Text.indexOf'));",
    '  if (nee.length === 0) return 0;',
    '  const limit = hay.length - nee.length;',
    '  outer: for (let i = 0; i <= limit; i += 1) {',
    '    for (let j = 0; j < nee.length; j += 1) {',
    '      if (hay[i + j] !== nee[j]) continue outer;',
    '    }',
    '    return i;',
    '  }',
    '  return -1;',
    '}',
    'function __kern_text_starts_with(s: string, prefix: string): boolean {',
    "  __kern_text_require_well_formed(s, 'Text.startsWith');",
    "  __kern_text_require_well_formed(prefix, 'Text.startsWith');",
    '  return s.startsWith(prefix);',
    '}',
  ].join('\n');
}

/** Python-leg twin of {@link textOpsHelpersTS}. Python's `str` is already
 *  code-point-native (no UTF-16 surrogate-pair splitting), so the ops
 *  themselves are thin bounds/well-formedness guards around the native
 *  `len`/subscript/slice/`.find`/`.startswith` — but Python still needs an
 *  EXPLICIT well-formedness check (a KERN string literal can embed a lone
 *  surrogate CODE POINT via a `\uD800`-range escape, which Python's `str`
 *  happily stores without erroring — unlike JS, Python has no built-in
 *  surrogate-pairing concept to lean on) and explicit bounds checks (Python
 *  slicing/negative-indexing silently wraps/clamps, which the KERN contract
 *  does not inherit). Registered via the `'text-ops'` stdlib requirement
 *  (`registerStdlibRequirementPython`), which adds this block as a
 *  per-function inline helper — the SAME mechanism the Math/Number/Object/
 *  Array JS-emulation helpers use. */
export const KERN_TEXT_OPS_HELPER_PY = [
  'def _kern_text_well_formed(s):',
  '    for ch in s:',
  '        if 0xd800 <= ord(ch) <= 0xdfff:',
  '            return False',
  '    return True',
  '',
  'def _kern_text_require_well_formed(s, label):',
  `    if not isinstance(s, str): raise Exception('portable: ' + label + ' ' + ${pyStr(TEXT_REQUIRES_STRING_FAILCLOSE)})`,
  '    if not _kern_text_well_formed(s):',
  `        raise Exception('portable: ' + label + ' ' + ${pyStr(TEXT_MALFORMED_SURROGATE_FAILCLOSE)})`,
  '    return s',
  '',
  // INT/FLOAT parity (agon review, confirmed) — KERN arithmetic diverges by
  // NUMERIC TYPE across legs: `4 / 2` is the int-valued float `2.0` on Python
  // (true division) but the plain number `2` on JS, so a strict
  // `isinstance(i, int)` check accepted `Text.charAt(s, 2)` on the TS leg
  // while raising on Python — a silent cross-leg divergence (the exact trap
  // the runner's dynamic-index work documented). The contract on BOTH legs is
  // "any integer-VALUED number is a valid index": Python coerces an
  // `.is_integer()` float to int here (never bool — Python bool subclasses
  // int); the TS twin's `Number.isInteger` accepts the same value set by
  // construction (JS has only one number type, so `2.0 === 2`). A NON-integer
  // value (`3 / 2` = 1.5) returns None here and falls into the same bounds
  // error the TS leg throws for `!Number.isInteger(1.5)`.
  'def _kern_text_int_index(i):',
  '    if isinstance(i, bool):',
  '        return None',
  '    if isinstance(i, int):',
  '        return i',
  '    if isinstance(i, float) and i.is_integer():',
  '        return int(i)',
  '    return None',
  '',
  'def _kern_text_from_scalar(value):',
  '    k = _kern_text_int_index(value)',
  '    if k is None or k < 0 or k > 0x10ffff or 0xd800 <= k <= 0xdfff:',
  `        raise Exception('portable: KernInternal.textFromScalar ' + ${pyStr(TEXT_SCALAR_CONSTRUCTOR_FAILCLOSE)})`,
  '    return chr(k)',
  '',
  // Render an index for the bounds-error message with JS-parity: an
  // integer-valued float renders as its int form (JS String(2.0) is "2",
  // Python str(2.0) is "2.0" — coerce so both legs' messages agree); a
  // non-integer float renders identically on both legs already ("1.5").
  'def _kern_text_index_str(i):',
  '    k = _kern_text_int_index(i)',
  '    return str(k) if k is not None else str(i)',
  '',
  'def _kern_text_length(s):',
  "    return len(_kern_text_require_well_formed(s, 'Text.length'))",
  '',
  'def _kern_text_utf8_length(s):',
  "    s = _kern_text_require_well_formed(s, 'Text.utf8Length')",
  '    total = 0',
  '    for ch in s:',
  '        scalar = ord(ch)',
  '        if scalar <= 0x7f:',
  '            total += 1',
  '        elif scalar <= 0x7ff:',
  '            total += 2',
  '        elif scalar <= 0xffff:',
  '            total += 3',
  '        else:',
  '            total += 4',
  '    return total',
  '',
  'def _kern_text_char_at(s, i):',
  "    s = _kern_text_require_well_formed(s, 'Text.charAt')",
  '    k = _kern_text_int_index(i)',
  '    if k is None or k < 0 or k >= len(s):',
  "        raise Exception('portable: Text.charAt index ' + _kern_text_index_str(i) + ' is out of bounds for a string of length ' + str(len(s)) + ' (0 <= index < length required)')",
  '    return s[k]',
  '',
  'def _kern_text_slice(s, a, b):',
  "    s = _kern_text_require_well_formed(s, 'Text.slice')",
  '    n = len(s)',
  '    ka = _kern_text_int_index(a)',
  '    kb = _kern_text_int_index(b)',
  '    if ka is None or kb is None or ka < 0 or kb < 0 or ka > n or kb > n or ka > kb:',
  "        raise Exception('portable: Text.slice(' + _kern_text_index_str(a) + ', ' + _kern_text_index_str(b) + ') is out of bounds for a string of length ' + str(n) + ' (0 <= start <= end <= length required)')",
  '    return s[ka:kb]',
  '',
  'def _kern_text_index_of(s, needle):',
  "    s = _kern_text_require_well_formed(s, 'Text.indexOf')",
  "    needle = _kern_text_require_well_formed(needle, 'Text.indexOf')",
  '    return s.find(needle)',
  '',
  'def _kern_text_starts_with(s, prefix):',
  "    _kern_text_require_well_formed(s, 'Text.startsWith')",
  "    _kern_text_require_well_formed(prefix, 'Text.startsWith')",
  '    return s.startswith(prefix)',
].join('\n');

/** Render a Python single-quoted string literal for the helper body. The
 *  KERN diagnostic strings contain only ASCII letters/spaces/parens/hyphens
 *  (no quote, no backslash), so a plain single-quote wrap is byte-safe;
 *  assert the precondition defensively (mirrors `decimal-contract.ts`'s
 *  `pyStr`). */
function pyStr(s: string): string {
  if (s.includes("'") || s.includes('\\') || s.includes('\n')) {
    throw new Error(`text-contract: diagnostic string is not single-quote-safe: ${s}`);
  }
  return `'${s}'`;
}
