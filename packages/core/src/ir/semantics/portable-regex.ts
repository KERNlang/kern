import {
  expandRegexIFold,
  normalizeRegexClasses,
  REGEX_MATCHALL_NO_G_FAILCLOSE,
  REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE,
  REGEX_TEST_G_FAILCLOSE,
  regexIFoldFailMessage,
  regexLiteralReceiverIR,
  scanRegexAstral,
  validateRegexNamedGroupsPortable,
} from '../../codegen/regex-normalize.js';
import type { ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';
import { evalPortableValue } from './portable-scalar.js';

// SLICE-1 SEAM (review G): the tagged RegExpValue is DEFINED BUT UNWIRED — slice 1
// binds NO handle because `.test` is TERMINAL (returns a bool directly). It exists
// for slice 2, and slice 2 is NOT just "wire this in": the stateful ops it unlocks
// (.exec / .matchAll / .lastIndex) break the per-call trial-eval shape — a shared
// mutable `lastIndex` cannot be re-derived per evaluation and stay byte-identical
// across legs, so slice 2 needs a PERSISTENT RegExpValue binding model (an explicit
// lastIndex/cursor field in the runner heap), not this frozen pattern+flags pair.
export const REGEXP_VALUE_TAG: unique symbol = Symbol('kern.regexpValue');

export interface RegExpValue {
  readonly [REGEXP_VALUE_TAG]: true;
  readonly pattern: string;
  readonly flags: string;
}

export function makeRegExpValue(pattern: string, flags: string): RegExpValue {
  return Object.freeze({ [REGEXP_VALUE_TAG]: true as const, pattern, flags });
}

export function isRegExpValue(value: unknown): value is RegExpValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [REGEXP_VALUE_TAG]?: unknown })[REGEXP_VALUE_TAG] === true &&
    typeof (value as { pattern?: unknown }).pattern === 'string' &&
    typeof (value as { flags?: unknown }).flags === 'string'
  );
}

export const REGEXP_MATCH_VALUE_TAG: unique symbol = Symbol('kern.regexpMatchValue');

export interface RegExpMatchValue {
  readonly [REGEXP_MATCH_VALUE_TAG]: true;
  readonly full: string;
  readonly groups: readonly (string | null)[];
  readonly index: number;
  readonly named: Readonly<Record<string, string | null>>;
}

export function makeRegExpMatchValue(value: {
  full: string;
  groups: readonly (string | null)[];
  index: number;
  named: Readonly<Record<string, string | null>>;
}): RegExpMatchValue {
  return Object.freeze({ [REGEXP_MATCH_VALUE_TAG]: true as const, ...value });
}

export function isRegExpMatchValue(value: unknown): value is RegExpMatchValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [REGEXP_MATCH_VALUE_TAG]?: unknown })[REGEXP_MATCH_VALUE_TAG] === true &&
    typeof (value as { full?: unknown }).full === 'string' &&
    Array.isArray((value as { groups?: unknown }).groups) &&
    typeof (value as { index?: unknown }).index === 'number' &&
    typeof (value as { named?: unknown }).named === 'object' &&
    (value as { named?: unknown }).named !== null
  );
}

// SLICE-3 (review): the bound value for the two GLOBAL array ops (`/g .match` →
// `string[]`, `.matchAll` → `[{full,groups,index}, …]`) is a TAGGED WRAPPER, NOT a
// bare array. The wrapper is a non-array object, so any downstream portable read
// (`m[0]`, `m.length`, iteration) hits the tag and ABSTAINS — the slice certifies
// only the BINDING's trace observable (the differential value); downstream array
// VALUE semantics are a later slice (same terminal boundary as slice-2's match
// object). The TRACE `assign.value` is the PLAIN array (the observable); the
// env BINDING holds this wrapper.
export const REGEXP_MATCH_LIST_VALUE_TAG: unique symbol = Symbol('kern.regexpMatchListValue');

export interface RegExpMatchListValue {
  readonly [REGEXP_MATCH_LIST_VALUE_TAG]: true;
  readonly items: readonly unknown[];
}

export function makeRegExpMatchListValue(items: readonly unknown[]): RegExpMatchListValue {
  return Object.freeze({ [REGEXP_MATCH_LIST_VALUE_TAG]: true as const, items });
}

export function isRegExpMatchListValue(value: unknown): value is RegExpMatchListValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [REGEXP_MATCH_LIST_VALUE_TAG]?: unknown })[REGEXP_MATCH_LIST_VALUE_TAG] === true &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

const RUNNER_REGEX_TEST_FLAGS = new Set(['i', 'm', 's', 'g']);

function hasOnlyRunnerRegexTestFlags(flags: string): boolean {
  return Array.from(flags).every((flag) => RUNNER_REGEX_TEST_FLAGS.has(flag));
}

function hasBareDotWithoutDotAll(pattern: string): boolean {
  const chars = Array.from(pattern);
  let inClass = false;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (!inClass && ch === '.') return true;
  }

  return false;
}

// A lookbehind `(?<=…)` / `(?<!…)` compiles in JS but Python `re` accepts ONLY a
// FIXED-WIDTH body — a variable-width body (`(?<=a+)b`) is a COMPILE error there,
// so the runner (JS) would emit a value matching only the TS leg while the Python
// leg fails to compile (verified divergence). Distinguishing fixed- from
// variable-width requires real body-width analysis; over-abstaining on ALL
// lookbehind is SAFE (the emitters still produce the fixed-width form; the runner
// merely declines to certify a 3rd leg). The NAMED_GROUP_OPENER scan elsewhere
// explicitly excludes `(?<=`/`(?<!`, so this is the only site that fences them.
function hasLookbehind(pattern: string): boolean {
  const chars = Array.from(pattern);
  let inClass = false;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (
      !inClass &&
      ch === '(' &&
      chars[i + 1] === '?' &&
      chars[i + 2] === '<' &&
      (chars[i + 3] === '=' || chars[i + 3] === '!')
    ) {
      return true;
    }
  }

  return false;
}

export function isRegexTestExpression(node: ValueIR): boolean {
  if (node.kind !== 'call') return false;
  // OPTIONAL CHAINING abstain (shared with `.match`): `(/a/)?.test(…)` /
  // `(/a/).test?.(…)` route through optional chaining the emitter's `.test`
  // lowering does not recognize — decline both forms so the runner never routes
  // an optional call the emit legs lower differently.
  if (node.optional) return false; // `test?.(...)`
  if (node.callee.kind !== 'member' || node.callee.property !== 'test') return false;
  if (node.callee.optional) return false; // `?.test`
  const regex = regexLiteralReceiverIR(node.callee.object);
  if (regex === null) return false;
  if (node.args.length !== 1) return false;
  if (!hasOnlyRunnerRegexTestFlags(regex.flags)) return false;
  // Defense-in-depth (review A): the KERN parser accepts DUPLICATE flags
  // (`/x/ii`), which `new RegExp(p, 'ii')` rejects with a SyntaxError. Abstain
  // structurally rather than rely on the constructor throwing at eval.
  if (new Set(regex.flags).size !== regex.flags.length) return false;
  // LOOKBEHIND abstain (shared with `.match`): variable-width lookbehind compiles
  // in JS but is a COMPILE error in Python `re` (fixed-width only) — admitting it
  // would emit a bool matching only the TS leg while the Python leg throws at
  // runtime. Reject ALL lookbehind (safe over-abstain).
  if (hasLookbehind(regex.pattern)) return false;

  // Scan the POST-FOLD pattern — the EXACT string eval builds its RegExp from —
  // so the gate and eval can never disagree on bare-dot / astral (review B:
  // gate == eval by construction, not by coincidence of the current fold).
  // A `/i` Set-B/backref fold FAILS CLOSE here → abstain: the emitters compile-
  // fail-close the same input on both legs, and the runner declines so the emit
  // legs surface the canonical parameterized message rather than the runner
  // risking a divergent one (review D).
  const folded = expandRegexIFold(normalizeRegexClasses(regex.pattern), regex.flags);
  if ('failClose' in folded) return false;
  if (!regex.flags.includes('s') && hasBareDotWithoutDotAll(folded.pattern)) return false;
  if (scanRegexAstral(folded.pattern) !== null) return false;

  return true;
}

export function isRegexMatchExpression(node: ValueIR): boolean {
  if (node.kind !== 'call') return false;
  // OPTIONAL CHAINING abstain: the emitter's `.match` lowering does NOT recognize
  // an optional `?.match`/`match?.()` — it falls through to the NATIVE host method,
  // which yields the ARRAY shape (`["a"]`) on the TS leg, NOT the canonical object
  // (verified 3-leg divergence). The runner must decline both optional forms so it
  // never produces a canonical object the TS leg renders as a native array.
  if (node.optional) return false; // `match?.(...)`
  if (node.callee.kind !== 'member' || node.callee.property !== 'match') return false;
  if (node.callee.optional) return false; // `?.match`
  if (node.args.length !== 1) return false;
  const regex = regexLiteralReceiverIR(node.args[0]);
  if (regex === null) return false;
  if (regex.flags.includes('g')) return false;
  if (!hasOnlyRunnerRegexTestFlags(regex.flags)) return false;
  if (new Set(regex.flags).size !== regex.flags.length) return false;
  // LOOKBEHIND abstain: variable-width lookbehind compiles in JS but is a COMPILE
  // error in Python `re` (fixed-width only) — admitting it would emit a value
  // matching only the TS leg. Reject ALL lookbehind (safe over-abstain).
  if (hasLookbehind(regex.pattern)) return false;

  const folded = expandRegexIFold(normalizeRegexClasses(regex.pattern), regex.flags);
  if ('failClose' in folded) return false;
  if (!regex.flags.includes('s') && hasBareDotWithoutDotAll(folded.pattern)) return false;
  if (scanRegexAstral(folded.pattern) !== null) return false;

  return true;
}

export function evalRegexTestExpression(node: ValueIR, env: SemanticEnv): boolean {
  if (node.kind !== 'call' || node.callee.kind !== 'member') {
    throw new Error('portable-regex: expected regex.test(...) call');
  }
  const regex = regexLiteralReceiverIR(node.callee.object);
  if (regex === null) {
    throw new Error('portable-regex: expected regex literal receiver');
  }
  const { pattern, flags } = regex;
  if (flags.includes('g')) {
    throw new Error(REGEX_TEST_G_FAILCLOSE);
  }

  const arg = evalPortableValue(node.args[0], env);
  if (typeof arg !== 'string') {
    throw new Error('portable-regex: .test argument must evaluate to a string');
  }

  const folded = expandRegexIFold(normalizeRegexClasses(pattern), flags);
  if ('failClose' in folded) {
    throw new Error(regexIFoldFailMessage(folded.char, folded.reason));
  }
  return new RegExp(folded.pattern, flags).test(arg);
}

export function evalRegexMatchExpression(
  node: ValueIR,
  env: SemanticEnv,
): { full: string; groups: (string | null)[]; index: number; named: Record<string, string | null> } | null {
  if (node.kind !== 'call' || node.callee.kind !== 'member') {
    throw new Error('portable-regex: expected string.match(regex) call');
  }
  const regex = regexLiteralReceiverIR(node.args[0]);
  if (regex === null) {
    throw new Error('portable-regex: expected regex literal argument');
  }
  const { pattern, flags } = regex;
  validateRegexNamedGroupsPortable(pattern);

  const subject = evalPortableValue(node.callee.object, env);
  if (typeof subject !== 'string') {
    throw new Error('portable-regex: .match receiver must evaluate to a string');
  }
  // SUBJECT astral/surrogate abstain: JS `.index`/`.group(0)` count UTF-16 code
  // units; Python counts code points — they diverge on an astral subject (verified
  // "💩x".match(/x/) -> 2 vs 1; "💩".match(/./) -> "\ud83d" vs "💩"). Scan CODE
  // UNITS (not `for…of` code points, which skips a LONE surrogate): ANY surrogate
  // unit (astral pair half OR unpaired) declines, so the runner never emits a
  // one-leg-only offset.
  for (let i = 0; i < subject.length; i++) {
    const code = subject.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      throw new Error('portable-regex: .match receiver must not contain astral/surrogate code units');
    }
  }

  const folded = expandRegexIFold(normalizeRegexClasses(pattern), flags);
  if ('failClose' in folded) {
    throw new Error(regexIFoldFailMessage(folded.char, folded.reason));
  }
  const match = subject.match(new RegExp(folded.pattern, flags));
  if (match === null) return null;
  if (match.index === undefined) {
    throw new Error('portable-regex: expected non-global string.match result with index');
  }
  return {
    full: match[0],
    groups: Array.from(match)
      .slice(1)
      .map((group) => (group === undefined ? null : group)),
    index: match.index,
    named: match.groups
      ? Object.fromEntries(Object.entries(match.groups).map(([k, v]) => [k, v === undefined ? null : v]))
      : {},
  };
}

// SLICE-3 — shared subject astral/surrogate scan (parallel to the inline scan in
// `evalRegexMatchExpression`). JS `.index`/match strings count UTF-16 code units;
// Python counts code points — they diverge on an astral subject ("💩".match(/./g) ->
// JS ["\ud83d","\ude29"] vs Python ["💩"]). Scan CODE UNITS (not `for…of` code
// points, which skips a LONE surrogate): ANY surrogate unit (astral pair half OR
// unpaired) declines, so the runner never emits a one-leg-only array.
function assertNoSurrogateSubject(subject: string): void {
  for (let i = 0; i < subject.length; i++) {
    const code = subject.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      throw new Error('portable-regex: receiver must not contain astral/surrogate code units');
    }
  }
}

// SLICE-3 (review) — a top-level (classDepth-0, unescaped) alternation `|` makes
// GLOBAL enumeration diverge whenever ANY branch is NULLABLE: after a zero-width
// match at a position, JS `String.match`/`matchAll` ADVANCE one unit while
// CPython>=3.7 `re.finditer` RETRIES a non-empty match at the SAME position (verified
// on node + python3: `"ab".match(/(?:|a)/g)` -> JS/TS `["","",""]` vs Python
// `["","a","",""]`; same for `(?:^|a)`, `(?:x*|a)`). Non-nullable alternation (`a|b`)
// is portable, but precise nullable-branch analysis is error-prone and a miss would
// be UNSOUND, so abstain on ALL top-level alternation (safe over-abstain — the runner
// only declines to be a 3rd leg, never emits a one-leg value). A `|` inside a
// character class is a literal member, not alternation, and is left alone. Refining
// to admit provably-non-nullable alternation is deferred to a later slice.
function hasUnescapedAlternation(pattern: string): boolean {
  const chars = Array.from(pattern);
  let inClass = false;
  let escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (!inClass && ch === '|') return true;
  }
  return false;
}

// SLICE-3 (review) — under `/m`, JS treats `\r`, U+2028 and U+2029 as line boundaries
// for `^`/`$`, but Python `re` (which the legs emit) treats ONLY `\n`, so a `/m`
// anchor over a subject carrying one of those terminators enumerates a DIFFERENT
// match set (verified: `"a\rb".match(/^/gm)` -> JS/TS `["",""]` vs Python `[""]`).
// Abstain in that case. (Without `/m`, `^`/`$` lower to Python `\A`/`\Z` ABSOLUTE
// anchors on the emit side, so line terminators are irrelevant and there is no
// divergence — see `lowerRegexAnchorsPython`.)
function assertNoMultilineLineTerminatorDivergence(subject: string, flags: string): void {
  if (flags.includes('m') && /[\r\u2028\u2029]/u.test(subject)) {
    throw new Error('portable-regex: /m anchor over a non-\\n line-terminator subject diverges (JS vs Python)');
  }
}

// SLICE-3 — `<str>.match(/pat/g)` (GLOBAL) gate. Clone of `isRegexMatchExpression`
// but REQUIRES `g` (non-/g is slice-2's territory; returning false here lets the
// slice-2 route claim it). Same structural shape + same fences.
export function isRegexGlobalMatchExpression(node: ValueIR): boolean {
  if (node.kind !== 'call') return false;
  // OPTIONAL CHAINING abstain (shared with `.match`): an optional `?.match`/
  // `match?.()` falls through to the NATIVE host method on the emit legs, NOT the
  // canonical array shape — decline both optional forms.
  if (node.optional) return false; // `match?.(...)`
  if (node.callee.kind !== 'member' || node.callee.property !== 'match') return false;
  if (node.callee.optional) return false; // `?.match`
  if (node.args.length !== 1) return false;
  const regex = regexLiteralReceiverIR(node.args[0]);
  if (regex === null) return false;
  if (!regex.flags.includes('g')) return false;
  if (!hasOnlyRunnerRegexTestFlags(regex.flags)) return false;
  if (new Set(regex.flags).size !== regex.flags.length) return false;
  if (hasLookbehind(regex.pattern)) return false;
  // Nullable global alternation diverges (JS advances vs CPython>=3.7 retries) —
  // safe over-abstain on ALL top-level alternation.
  if (hasUnescapedAlternation(regex.pattern)) return false;

  const folded = expandRegexIFold(normalizeRegexClasses(regex.pattern), regex.flags);
  if ('failClose' in folded) return false;
  if (!regex.flags.includes('s') && hasBareDotWithoutDotAll(folded.pattern)) return false;
  if (scanRegexAstral(folded.pattern) !== null) return false;

  return true;
}

// SLICE-3 — `<str>.matchAll(/pat/g)` gate. Clone but property `'matchAll'`. DO NOT
// reject non-/g here — non-/g must still ADMIT so the precondition routes to eval,
// which throws the RE-ADMIT constant REGEX_MATCHALL_NO_G_FAILCLOSE (both emit legs
// compile-fail-close it). Apply all the OTHER fences.
export function isRegexMatchAllExpression(node: ValueIR): boolean {
  if (node.kind !== 'call') return false;
  if (node.optional) return false; // `matchAll?.(...)`
  if (node.callee.kind !== 'member' || node.callee.property !== 'matchAll') return false;
  if (node.callee.optional) return false; // `?.matchAll`
  if (node.args.length !== 1) return false;
  const regex = regexLiteralReceiverIR(node.args[0]);
  if (regex === null) return false;
  if (!hasOnlyRunnerRegexTestFlags(regex.flags)) return false;
  if (new Set(regex.flags).size !== regex.flags.length) return false;
  if (hasLookbehind(regex.pattern)) return false;
  // Nullable global alternation diverges (JS advances vs CPython>=3.7 retries) —
  // safe over-abstain on ALL top-level alternation.
  if (hasUnescapedAlternation(regex.pattern)) return false;

  const folded = expandRegexIFold(normalizeRegexClasses(regex.pattern), regex.flags);
  if ('failClose' in folded) return false;
  if (!regex.flags.includes('s') && hasBareDotWithoutDotAll(folded.pattern)) return false;
  if (scanRegexAstral(folded.pattern) !== null) return false;

  return true;
}

// SLICE-3 — execute `<str>.match(/pat/g)`. Returns the array of FULL-match strings
// (the global-match array elements are ALL full matches — `Array.from(m)`, NOT
// `.slice(1)`, NOT Python findall's group tuples) or `null` on no-match. ZERO-WIDTH
// global matches are CERTIFIED: V8 `String.match` and CPython>=3.7 `re.finditer`
// enumerate empty matches identically (the shipped matchAll emitter already relies
// on CPython>=3.7).
export function evalRegexGlobalMatchExpression(node: ValueIR, env: SemanticEnv): string[] | null {
  if (node.kind !== 'call' || node.callee.kind !== 'member') {
    throw new Error('portable-regex: expected string.match(/pat/g) call');
  }
  const regex = regexLiteralReceiverIR(node.args[0]);
  if (regex === null) {
    throw new Error('portable-regex: expected regex literal argument');
  }
  const { pattern, flags } = regex;
  validateRegexNamedGroupsPortable(pattern);

  const subject = evalPortableValue(node.callee.object, env);
  if (typeof subject !== 'string') {
    throw new Error('portable-regex: .match receiver must evaluate to a string');
  }
  assertNoSurrogateSubject(subject);
  assertNoMultilineLineTerminatorDivergence(subject, flags);

  const folded = expandRegexIFold(normalizeRegexClasses(pattern), flags);
  if ('failClose' in folded) {
    throw new Error(regexIFoldFailMessage(folded.char, folded.reason));
  }
  const match = subject.match(new RegExp(folded.pattern, flags));
  return match === null ? null : Array.from(match);
}

// SLICE-3 — execute `<str>.matchAll(/pat/g)`. Returns `[{full,groups,index}, …]`
// (NO `named` — matchAll drops it on BOTH legs). No-match -> `[]` (the null-vs-empty
// asymmetry vs `/g .match`'s null). Positional `groups` map `undefined -> null`.
export function evalRegexMatchAllExpression(
  node: ValueIR,
  env: SemanticEnv,
): { full: string; groups: (string | null)[]; index: number }[] {
  if (node.kind !== 'call' || node.callee.kind !== 'member') {
    throw new Error('portable-regex: expected string.matchAll(/pat/g) call');
  }
  const regex = regexLiteralReceiverIR(node.args[0]);
  if (regex === null) {
    throw new Error('portable-regex: expected regex literal argument');
  }
  const { pattern, flags } = regex;
  // RE-ADMIT: `.matchAll` without /g is a COMPILE fail-close on both emit legs.
  if (!flags.includes('g')) {
    throw new Error(REGEX_MATCHALL_NO_G_FAILCLOSE);
  }
  validateRegexNamedGroupsPortable(pattern);

  const subject = evalPortableValue(node.callee.object, env);
  if (typeof subject !== 'string') {
    throw new Error('portable-regex: .matchAll receiver must evaluate to a string');
  }
  assertNoSurrogateSubject(subject);
  assertNoMultilineLineTerminatorDivergence(subject, flags);

  const folded = expandRegexIFold(normalizeRegexClasses(pattern), flags);
  if ('failClose' in folded) {
    throw new Error(regexIFoldFailMessage(folded.char, folded.reason));
  }
  return [...subject.matchAll(new RegExp(folded.pattern, flags))].map((m) => {
    // matchAll results always carry `.index`; mirror slice-2's explicit guard rather
    // than a silent `?? 0` fallback so a contract violation surfaces, not a wrong 0.
    if (m.index === undefined) {
      throw new Error('portable-regex: expected matchAll result with a defined index');
    }
    return {
      full: m[0],
      groups: Array.from(m)
        .slice(1)
        .map((group) => (group === undefined ? null : group)),
      index: m.index,
    };
  });
}

export function isRunnerNativeRegexFailClose(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === REGEX_TEST_G_FAILCLOSE ||
      error.message === REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE ||
      error.message === REGEX_MATCHALL_NO_G_FAILCLOSE)
  );
}
