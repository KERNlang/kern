/**
 * Shared regex emission-normalization (Milestone C, Slice 1).
 *
 * KERN transpiles a regex literal `/pattern/flags` to BOTH a TypeScript
 * `RegExp` and a Python `re` pattern, under a guaranteed-parity contract. The
 * shorthand classes `\d \w \s` and the input-anchors `$ ^` do NOT mean the same
 * thing across the two engines out of the box:
 *
 *   - Python str `\d`/`\w` are Unicode-aware (match Arabic-Indic digits, accented
 *     letters); JS `\d`/`\w` (without `/u`) are ASCII. JS `\s` is broader than
 *     ASCII whitespace (matches NBSP).
 *   - Python `$` (no `re.MULTILINE`) matches before a trailing `\n`; JS `$`
 *     (no `/m`) matches end-of-input only.
 *   - Python `\b` is Unicode-aware unless `re.ASCII` is set; JS `\b` (no `/u`)
 *     is ASCII.
 *
 * Slice 1 makes the certified core byte-identical by *construction* rather than
 * by luck:
 *
 *   1. {@link normalizeRegexClasses} rewrites `\d \w \s` to explicit ASCII
 *      classes. This is applied to the emitted pattern on BOTH targets so the
 *      class transform is provably the same string transform on each side.
 *   2. {@link lowerRegexAnchorsPython} lowers `$`→`\Z` / `^`→`\A` on the
 *      non-`/m` path. PYTHON-ONLY: JS `$`/`^` without `/m` already mean
 *      input-end/start (the parity target), so the TS emitter never calls this.
 *   3. `re.ASCII` injection happens in the Python flag emitter (not here) so
 *      Python `\b` and the ASCII classes behave like JS.
 *
 * DELIBERATE SLICE-1 LIMITATION (do NOT "fix" this here — it is the certified
 * contract): the transforms are crude string replacements over the raw pattern.
 * A literal `\\d` (escaped backslash + `d`), a `\d` inside a `[...]` set, or a
 * `$`/`^` inside a char class / escaped as `\$` is rewritten the same crude way.
 * This is parity-SAFE precisely because the SAME function runs on both targets:
 * an identical string transform yields an identical residual pattern, so a crude
 * edge can never *diverge* between TS and Python (even if it is "wrong", it is
 * wrong identically). A tokenizing normalizer is a later hardening, not Slice 1.
 * The certified oracle (`.agon-goals/regex-slice1-oracle/`) does not exercise
 * those edges; matching the oracle's reference transform byte-for-byte IS the
 * spec, so keeping this crude is required for byte-identity.
 */

/**
 * Rewrite the shorthand classes `\d \w \s` to explicit ASCII character classes.
 * Applied to the emitted pattern on BOTH targets so the transform is identical.
 *
 * On TS, `\d`/`\w` normalization is a match no-op (JS shorthand is already
 * ASCII) but is emitted anyway so both emitters read from ONE normalizer; the
 * `\s` normalization on TS is load-bearing (it narrows JS `\s` to drop Unicode
 * whitespace such as NBSP).
 */
export function normalizeRegexClasses(pattern: string): string {
  return pattern.replaceAll('\\d', '[0-9]').replaceAll('\\w', '[A-Za-z0-9_]').replaceAll('\\s', '[ \\t\\n\\r\\f\\v]');
}

/**
 * PYTHON-ONLY anchor lowering. On the non-`/m` path, rewrite `$`→`\Z` and
 * `^`→`\A` so Python anchors match JS's already-correct input-end/start
 * semantics (Python `$`/`^` without `re.MULTILINE` differ at a trailing
 * newline). On the `/m` path, keep `$`/`^` verbatim — `re.MULTILINE` (added by
 * the flag emitter) makes them line-based, identical to JS `/m`.
 *
 * CLASS- AND ESCAPE-AWARE (single forward pass): only a `^`/`$` that is a TRUE
 * anchor is lowered — one that is at `classDepth === 0` AND is NOT escaped (not
 * immediately preceded by an unescaped backslash). A `^`/`$` that is INSIDE a
 * `[...]` character class, or escaped (`\^`/`\$`), is a literal/negation marker —
 * NOT an anchor — and is left VERBATIM. The old crude `replaceAll` rewrote those
 * too, emitting Python that CRASHED at compile (`/[^a]/`→`[\Aa]` and
 * `/[a$]/`→`[a\Z]` both raise `re.error: bad escape`) or silently corrupted an
 * escaped literal (`/a\^b/`→`a\Ab`). This pass uses the same escape/`classDepth`
 * bookkeeping (and the literal-`]`-first-aware {@link scanCharClass}) as
 * {@link expandRegexIFold}, so a class's open/close is honored exactly (`[]]`,
 * `[^]]`, `[]$]` do not close early and an in-class `^`/`$` stays verbatim).
 *
 * Parity: the TS emitter never calls this (JS `$`/`^` without `/m` already mean
 * input-end/start, the parity target), so the TS side keeps `^`/`$` verbatim.
 * Runs AFTER {@link normalizeRegexClasses} + {@link expandRegexIFold}, mirroring
 * the prior call order.
 */
export function lowerRegexAnchorsPython(pattern: string, flags: string): string {
  if (flags.includes('m')) return pattern;

  const chars = Array.from(pattern);
  let out = '';
  // `classDepth` is 0 outside any `[...]`, 1 inside (classes do not nest — an
  // inner `[` is a literal). `classCloseIdx` is the index of the current class's
  // MATCHING `]` (from {@link scanCharClass}); we close ONLY there, so a literal
  // `]`-first member (`[]]`, `[^]]`, `[]$]`) does not close the class early.
  // `escaped` tracks whether the current char follows an unescaped backslash.
  let classDepth = 0;
  let classCloseIdx = -1;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    // The char after a backslash is passed through verbatim — an escaped `\^`/`\$`
    // (or any escaped char) is a literal, never an anchor, and the escape also
    // suppresses class-bracket bookkeeping so `\[`/`\]` are not delimiters.
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    // Unescaped `[` that OPENS a class. Record its matching `]` so the in-class
    // `^`/`$` below are left verbatim and the close is literal-`]`-first-aware.
    if (ch === '[' && classDepth === 0) {
      const scanned = scanCharClass(chars, i);
      classDepth = 1;
      classCloseIdx = scanned.closeIdx;
      out += ch;
      continue;
    }
    // The class's MATCHING `]` (a `]` before it is a literal `]`-first member and
    // falls through to be emitted verbatim).
    if (classDepth > 0 && i === classCloseIdx) {
      classDepth = 0;
      classCloseIdx = -1;
      out += ch;
      continue;
    }

    // TRUE anchor: an unescaped `^`/`$` at classDepth 0. Inside a class it is a
    // negation marker (`[^…]`) or a literal `$`/`^` member — left verbatim.
    if (classDepth === 0) {
      if (ch === '$') {
        out += '\\Z';
        continue;
      }
      if (ch === '^') {
        out += '\\A';
        continue;
      }
    }

    out += ch;
  }

  return out;
}

/* ----------------------------------------------------------------------------
 * Slice-/i — portable case-insensitive regex lowering.
 *
 * Under `/i`, JS and Python disagree on how non-ASCII letters case-fold:
 *   - JS `/é/i` folds `é↔É` (its own non-`/u` /i fold DB, Unicode 16.0 on node).
 *   - Python `re.IGNORECASE | re.ASCII` (the flags Slice 1 always emits) SUPPRESSES
 *     the non-ASCII fold, so a raw `é` MISSES `É` — a real cross-engine divergence.
 *
 * Fix (decided empirically in `.agon-goals/regex-divergence-probe`): at lowering
 * time, rewrite each non-ASCII Set(A) letter under /i into an EXPLICIT character
 * class of its whole fold-equivalence class (`é` → `[Éé]`). An explicit class is
 * matched by pure codepoint membership on BOTH engines — it never invokes either
 * host's fold DB at match time, so it is byte-identical regardless of the host's
 * Unicode version. `/i` is KEPT (not dropped) so the ASCII letters in a mixed
 * pattern keep folding; `re.ASCII` (Slice 1) suppresses any Python re-fold of the
 * explicit non-ASCII class members, which is exactly why KEEP-i is parity-safe.
 *
 * The frozen {@link SET_A_MEMBERS}/{@link SET_B} table (`regex-fold-table.ts`) is
 * the single source of truth; the accept/expand/reject decision is PURELY LEXICAL
 * (scan the pattern string against the frozen table — NEVER call a host fold), so
 * both build hosts make the identical decision.
 *
 * Set(B) letters (length-changing/declined folds: ß→SS, ligatures, titlecase) have
 * NO single-codepoint partner and cannot be expressed as a class, so KERN
 * FAIL-CLOSES /i over them rather than silently emit a regex whose intended fold
 * neither engine reproduces. The fail-close surfaces as a thrown compile error
 * with the SAME message on both targets.
 *
 * Both emitters call {@link expandRegexIFold} on the SAME (already class-normalized)
 * pattern so the expansion is byte-identical across targets by construction.
 * ------------------------------------------------------------------------- */

import type { ValueIR } from '../value-ir.js';
import { SET_A_MEMBERS, SET_B } from './regex-fold-table.js';

/**
 * Discriminates WHY {@link expandRegexIFold} fail-closed, so the shared message
 * builder emits the right (target-symmetric) diagnostic:
 *   - `'setB'`          : a length-changing / declined fold (ß, ligatures,
 *                         titlecase) — no single-codepoint partner, can't be a class.
 *   - `'backref'`       : `/i` + a backreference + a non-ASCII Set(A) letter. JS `/i`
 *                         folds the backreference too, but the emitted explicit-class
 *                         expansion under `re.ASCII` does NOT fold the `\N` backref's
 *                         non-ASCII referent — a SILENT cross-engine divergence.
 *   - `'complexClass'`  : a Set(A) letter appears inside a `[...]` class whose body
 *                         is COMPLEX — it contains a backslash escape OR a `-` in a
 *                         range position. Expanding a member in place would corrupt
 *                         a range bound (`[a-é]` → `[a-Éé]` drops U+00CA..U+00E8) or
 *                         mis-handle an escape chain (`[\\-é]` is a REAL range `\`..`é`,
 *                         not an escaped hyphen) — both SILENT divergences. We refuse
 *                         the whole class rather than guess, so the fragile per-`-`
 *                         escape-adjacency heuristic (which mis-read those chains)
 *                         is gone. (SIMPLE classes — no `\`, no range `-` — still expand.)
 */
export type RegexIFoldFailReason = 'setB' | 'backref' | 'complexClass';

/** Result of {@link expandRegexIFold}: an expanded pattern, or a fail-close. */
export type RegexIFoldResult = { pattern: string } | { failClose: true; char: string; reason: RegexIFoldFailReason };

const isAsciiCodePoint = (cp: number): boolean => cp < 0x80;

const codePointHex = (char: string): string =>
  `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Build the (target-agnostic) compile-error message for a `/i` fail-close. Both
 * emitters throw this identical text (selected by {@link RegexIFoldFailReason}) so
 * the refusal is observably symmetric across TS and Python.
 *
 * `reason` defaults to `'setB'` for backward compatibility with the original
 * single-`char` signature.
 */
export function regexIFoldFailMessage(char: string, reason: RegexIFoldFailReason = 'setB'): string {
  const hex = codePointHex(char);
  if (reason === 'backref') {
    return (
      `Regex /i with a backreference and a non-ASCII letter ('${char}' ${hex}) cannot be ` +
      `lowered portably: JS /i case-folds the backreference's referent but the portable ` +
      `explicit-class lowering cannot reproduce that fold for a backreference. ` +
      `Remove /i, the backreference, or the non-ASCII letter.`
    );
  }
  if (reason === 'complexClass') {
    return (
      `Regex /i with the non-ASCII letter '${char}' (${hex}) inside a character class that ` +
      `uses a range or an escape cannot be lowered portably — use the bare letter or list ` +
      `explicit class members.`
    );
  }
  return (
    `Regex /i over '${char}' (${hex}) cannot be lowered portably: its case-fold is ` +
    `length-changing/declined and has no single-codepoint partner, so it cannot be ` +
    `expressed as a character class. Remove /i or rewrite the letter explicitly.`
  );
}

/**
 * Test whether the char `c` is a digit `1`–`9` (the body of a `\1`–`\9` numeric
 * backreference; `\0` is a NUL escape, never a backreference).
 */
const isBackrefDigit = (c: string | undefined): boolean => c !== undefined && c >= '1' && c <= '9';

/**
 * Scan a `[...]` character class starting at the opening `[` (`chars[openIdx] === '['`)
 * to its MATCHING unescaped `]`, escape-aware. Returns the class BODY (the chars
 * between the open and the close, excluding a leading `^` negation) and the index
 * of the closing `]`.
 *
 * Engine quirk handled: a `]` that is the FIRST body character (immediately after
 * `[` or `[^`) is a LITERAL `]`, NOT the class terminator (`[]]`, `[^]]`). So the
 * scan only treats a `]` as the close once at least one body char has been seen.
 *
 * If the class is unterminated (no matching `]`), `closeIdx` is `-1` and `body`
 * runs to the end of the input — the caller still classifies it (conservatively
 * COMPLEX-or-not by content), and the malformed pattern surfaces at emit anyway.
 */
function scanCharClass(chars: string[], openIdx: number): { body: string[]; closeIdx: number } {
  let i = openIdx + 1;
  if (chars[i] === '^') i++; // skip negation; it is not part of the body
  const bodyStart = i;
  let first = true; // a `]` while `first` is still true is a literal `]`
  let escaped = false;
  for (; i < chars.length; i++) {
    const c = chars[i];
    if (escaped) {
      escaped = false;
      first = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      first = false;
      continue;
    }
    if (c === ']' && !first) {
      return { body: chars.slice(bodyStart, i), closeIdx: i };
    }
    first = false;
  }
  return { body: chars.slice(bodyStart), closeIdx: -1 };
}

/**
 * Classify a `[...]` class BODY (the array from {@link scanCharClass}) as COMPLEX
 * or SIMPLE — a WHOLE-class decision with NO per-neighbour escape heuristic, so the
 * escape-chain edge bugs the old adjacency check had cannot occur.
 *
 * COMPLEX iff the body contains:
 *   - ANY backslash `\` (an escape — e.g. `[\\-é]` is a REAL `\`..`é` range, `[\1é]`,
 *     `[\d é]`), OR
 *   - a `-` in a RANGE position: a `-` that is neither the first nor the last body
 *     char and is not itself escaped (`[a-é]`, `[é-z]`, `[[-é` from `[[-é]-z]`).
 * Otherwise SIMPLE (a `-` that is the first or last body char is a literal hyphen:
 * `[-é]`, `[é-]`). A Set(A) letter in a SIMPLE class expands; in a COMPLEX class it
 * fail-closes (`'complexClass'`).
 */
function isComplexClassBody(body: string[]): boolean {
  let escaped = false;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') return true; // any escape ⇒ COMPLEX
    if (c === '-' && j !== 0 && j !== body.length - 1) return true; // range `-` ⇒ COMPLEX
  }
  return false;
}

/**
 * Expand non-ASCII Set(A) letters under `/i` into explicit fold-class characters,
 * or fail-close on a Set(B) letter. No-op when `flags` does not include `i`.
 *
 * Scans by CODE POINT (so surrogate pairs are handled as one unit; this also
 * leaves a clean seam for a later astral-fail-close slice to add a `cp > 0xFFFF`
 * branch — NOT added here). Tracks `[...]` class depth so a Set(A) letter ALREADY
 * inside a class is expanded to its BARE members (no brackets) — `/[xé]/i` →
 * `[xÉé]`, not the invalid nested `[x[Éé]]` (§2.4).
 *
 * ASCII characters are left untouched: ASCII-letter `/i` folding is handled by the
 * kept flag (`/i` on TS, `re.IGNORECASE | re.ASCII` on Python, Slice 1). Non-ASCII
 * characters that are neither Set(A) nor Set(B) are emitted verbatim — those are
 * letters that do not fold to any other single codepoint under non-`/u` /i (they
 * match only themselves on both engines), so keeping them raw is parity-safe.
 *
 * Two further fail-closes guard SILENT cross-engine divergences the class
 * expansion alone cannot make portable (verified empirically, node v22.22.0 /
 * python3 3.12.7):
 *
 *   - BACKREF (`/(é)\1/i`): JS `/i` case-folds the backreference's referent too, so
 *     `/(é)\1/i` matches `"Éé"`; but the emitted `([Éé])\1` under `re.ASCII`
 *     suppresses the non-ASCII fold of the `\1` referent → MISS on Python. Detected
 *     LEXICALLY and CONSERVATIVELY: a backreference token (`\1`–`\9`, or a named
 *     `\k<name>`) seen AT `classDepth === 0` (a `\1`/`\k<` INSIDE a `[...]` class is
 *     NOT a backreference in either engine — it is a literal/octal — so it never sets
 *     the flag), combined with ANY non-ASCII Set(A) letter present, fail-closes.
 *     Over-rejecting a backref that happens to target an ASCII-only group is
 *     intentional and parity-safe; precise group→backref analysis is out of scope.
 *   - COMPLEX CLASS (`/[a-é]/i`, `/[\\-é]/i`): a Set(A) letter inside a `[...]` class
 *     expands ONLY IF its enclosing class is SIMPLE — no backslash escape and no `-`
 *     in a range position. Otherwise the whole class fail-closes (`'complexClass'`).
 *     This replaces the old per-`-` escape-adjacency heuristic (which mis-read escape
 *     chains: it treated `[\\-é]`'s real `\`..`é` range as an escaped hyphen and
 *     expanded `é`, silently corrupting the range). Classifying the WHOLE class ONCE
 *     ({@link scanCharClass} + {@link isComplexClassBody}) removes that edge class
 *     entirely. SIMPLE members (`/[xé]/i`→`[xÉé]`, `/[-é]/i`, `/[é-]/i`) still expand.
 *
 * Both new fail-closes throw the SAME message on TS and Python (the emitters share
 * this function), so the refusal is observably symmetric.
 */
export function expandRegexIFold(pattern: string, flags: string): RegexIFoldResult {
  if (!flags.includes('i')) return { pattern };

  // Code-point array (so surrogate pairs are one unit) — also lets the class scanner
  // slice out a `[...]` body for whole-class SIMPLE/COMPLEX classification.
  const chars = Array.from(pattern);

  // HOLE 1 (backref) is decided over the WHOLE pattern: a backref token and a
  // non-ASCII Set(A) letter may appear in either order, so we record both during
  // the single pass and fail-close at the end if both were seen.
  let sawBackref = false;
  let firstSetALetter: string | undefined;

  let out = '';
  // `classDepth` is 0 outside any class, 1 inside (JS/Python char classes do not
  // nest — an inner `[` is a literal). `inComplexClass` records whether the class we
  // are CURRENTLY inside was classified COMPLEX by {@link isComplexClassBody}; it is
  // set when we open a class and cleared at its close. `classCloseIdx` is the index
  // of the current class's MATCHING `]` (from {@link scanCharClass}); we close ONLY
  // there, so a literal `]`-first member (`[]]`, `[]é]`) does not close early.
  let classDepth = 0;
  let inComplexClass = false;
  let classCloseIdx = -1;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0) ?? 0;

    // Pass through the character after a backslash verbatim (an escaped letter is
    // not a valid fold escape in either engine; this also avoids treating an
    // escaped `\[`/`\]` as a class delimiter). The escape only suppresses the
    // bracket-depth bookkeeping, never expansion of a *bare* (unescaped) Set(A)
    // letter. While here we also detect a backref — `\1`–`\9` (numeric) or
    // `\k<...>` (named) — but ONLY at classDepth 0: a `\1`/`\k<` INSIDE a `[...]`
    // class is NOT a backreference in either engine (it is a literal/octal escape),
    // so it must not set the flag.
    if (escaped) {
      if (classDepth === 0 && (isBackrefDigit(ch) || (ch === 'k' && chars[i + 1] === '<'))) sawBackref = true;
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    // Unescaped `[` that OPENS a class (classes do not nest, so an inner `[` is a
    // literal handled by the ASCII branch below). Classify the WHOLE class once —
    // SIMPLE vs COMPLEX — and record its matching `]` so the in-class Set(A) handling
    // needs no per-neighbour heuristic and the close is escape-/literal-`]`-aware.
    if (ch === '[' && classDepth === 0) {
      const scanned = scanCharClass(chars, i);
      classDepth = 1;
      inComplexClass = isComplexClassBody(scanned.body);
      classCloseIdx = scanned.closeIdx;
      out += ch;
      continue;
    }
    // The class's MATCHING `]` (a `]` before it — e.g. a literal `]`-first member in
    // `[]]`/`[]é]` — falls through to the ASCII branch and is emitted verbatim).
    if (classDepth > 0 && i === classCloseIdx) {
      classDepth = 0;
      inComplexClass = false;
      classCloseIdx = -1;
      out += ch;
      continue;
    }

    if (isAsciiCodePoint(cp)) {
      out += ch; // ASCII letters rely on the kept /i fold (incl. a literal `[`/`]` inside a class).
      continue;
    }

    if (SET_B.has(ch)) {
      return { failClose: true, char: ch, reason: 'setB' };
    }

    const members = SET_A_MEMBERS.get(ch);
    if (members !== undefined) {
      if (firstSetALetter === undefined) firstSetALetter = ch;

      // Inside a COMPLEX class (any `\` escape or a range `-`), expanding a member in
      // place could corrupt a range bound or mishandle an escape chain — fail-close
      // the whole class rather than guess. SIMPLE classes (and the no-class case)
      // expand normally.
      if (classDepth > 0 && inComplexClass) {
        return { failClose: true, char: ch, reason: 'complexClass' };
      }

      // Inside an existing `[...]` set, emit bare members (a nested class would be
      // invalid on JS and a literal `[` on Python); otherwise wrap in a new class.
      out += classDepth > 0 ? members : `[${members}]`;
      continue;
    }

    // Non-ASCII, non-folding letter (or non-letter): pass through verbatim.
    out += ch;
  }

  // HOLE 1: a backref + any non-ASCII Set(A) letter cannot be lowered portably.
  if (sawBackref && firstSetALetter !== undefined) {
    return { failClose: true, char: firstSetALetter, reason: 'backref' };
  }

  return { pattern: out };
}

/* ----------------------------------------------------------------------------
 * Milestone C, Slice 3 — SHARED regex-method fail-close diagnostics.
 *
 * Where a JS `RegExp` method shape has NO portable Python `re` analog, KERN
 * fail-closes at lowering time. The refusal text MUST be byte-identical across
 * the TS emitter (core) and the Python emitter (@kernlang/python), so both import
 * these single-source constants and throw the exact same string. (The Python
 * target re-exports them; see codegen-body-python.ts.)
 * ------------------------------------------------------------------------- */
export const REGEX_TEST_G_FAILCLOSE =
  "Python target does not lower RegExp.test with the 'g' flag: JS mutates lastIndex across calls while re.search is stateless. Use .matchAll (global) for stateful iteration.";
export const REGEX_EXEC_FAILCLOSE =
  'Python target does not lower RegExp.exec: it relies on JS’s stateful lastIndex, which has no portable re analog. Use .matchAll (global) for iteration.';
export const REGEX_MATCHALL_NO_G_FAILCLOSE =
  "matchAll requires the 'g' flag (a non-global matchAll throws TypeError in JS).";
export const REGEX_REPLACEALL_NO_G_FAILCLOSE =
  "replaceAll requires the 'g' flag (a non-global replaceAll throws TypeError in JS).";
export const REGEX_SPLIT_ZEROWIDTH_FAILCLOSE =
  'Python target does not lower String.split with a zero-width-capable pattern: JS drops empty edge segments while re.split keeps them. Use a pattern that cannot match the empty string.';
export const REGEX_SPLIT_LIMIT_FAILCLOSE =
  'Python target does not lower String.split with a limit argument: JS truncates the result while Python maxsplit keeps the unsplit remainder.';
export const REGEX_NONLITERAL_FAILCLOSE =
  'Portable regex methods (.match/.matchAll/.replace/.replaceAll/.split/.test/.exec) require a DIRECT regex literal (`/…/`) in the regex position; a variable bound to a regex is not portable across targets — inline the literal at the call site.';

/* ----------------------------------------------------------------------------
 * Milestone C, Slice 3c — let-bound regex DETECTOR (drop the fragile
 * resolve-to-literal).
 *
 * The Slice-3 regex lowering only knows how to lower a DIRECT regex literal in
 * the regex position. A regex bound to a variable (`let re = /…/; s.match(re)`)
 * was previously RESOLVED back to its literal (TS via a node-clone substitution,
 * Python via `resolveRegexExpr` following the ident) so it would lower
 * canonically — but that substitution emits a STALE pattern when the binding is
 * later reassigned and is fragile to track. We instead DETECT the case and
 * fail-close SYMMETRICALLY on both targets.
 *
 * {@link regexMethodRegexArgIdent} returns the NAME of the identifier sitting in
 * the regex POSITION of a regex-method call — but ONLY when that position holds
 * a bare ident (not a literal, not an arbitrary expression). The caller then
 * asks ITS OWN binding table whether that name is a known regex binding:
 *   - known regex binding  -> throw `REGEX_NONLITERAL_FAILCLOSE` (symmetric).
 *   - string/unknown ident -> stays a plain host method (the `s.match(needle)`
 *     string-method case the resolve-to-literal approach must NOT break).
 * A direct regex literal never reaches this helper (returns null), so the
 * canonical Slice-3 lowering is unaffected.
 *
 * Arity/position conditions MIRROR the lowering shapes EXACTLY (so the detector
 * never fires on a shape the lowering would have left as a plain host call),
 * EXCEPT `exec` which fail-closes at ANY arity (it has no portable Python analog
 * at all — `re.Pattern` has no `.exec` — so even a non-canonical `re.exec(s, x)`
 * must refuse rather than leak to a Python-crashing plain host call):
 *   - receiver position: `re.test(s)` (1 arg), `re.exec(…)` (ANY arity)
 *   - first-arg position: `s.match(re)` / `s.matchAll(re)` (1 arg),
 *     `s.split(re)` (>=1 arg), `s.replace(re,r)` / `s.replaceAll(re,r)` (2 args)
 * ------------------------------------------------------------------------- */
const REGEX_RECEIVER_METHODS = new Set(['test', 'exec']);

/** If `call` is a regex-method shape whose regex position is a bare IDENT,
 *  return that ident's name; otherwise null. Pure structural peek — no binding
 *  table, no resolution. Shared by both targets so the fail-close decision is
 *  made from the SAME shape analysis on each side. */
export function regexMethodRegexArgIdent(call: Extract<ValueIR, { kind: 'call' }>): string | null {
  const callee = call.callee;
  if (callee.kind !== 'member') return null;
  if (callee.optional) return null; // `?.match(…)` — left to plain emit
  const property = callee.property;

  // Receiver-positioned regex: `re.test(s)` (1 arg), `re.exec(s)` (ANY arity).
  // `test` has a portable Python analog (`re.search`) that takes exactly one
  // argument, so its arity guard mirrors the canonical 1-arg lowering shape on
  // BOTH targets (a non-canonical `re.test(s, x)` is left a plain host call).
  // `exec` has NO portable analog at all: `re.Pattern` in Python has no `.exec`
  // method, so a 2-arg `re.exec(s, 5)` (which TS silently ignores) would CRASH
  // Python if left plain. `exec` therefore FAILS-CLOSE at ANY arity (Slice-3
  // redirects it to `.matchAll`), so the detector must fire regardless of
  // `call.args.length`.
  if (REGEX_RECEIVER_METHODS.has(property)) {
    if (property === 'test' && call.args.length !== 1) return null;
    if (callee.object.kind === 'ident') return callee.object.name;
    return null;
  }

  // First-arg-positioned regex: arg[0] is the regex.
  const arg0 = call.args[0];
  if (arg0 === undefined || arg0.kind !== 'ident') return null;
  if ((property === 'match' || property === 'matchAll') && call.args.length === 1) return arg0.name;
  if (property === 'split') return arg0.name;
  if ((property === 'replace' || property === 'replaceAll') && call.args.length === 2) return arg0.name;
  return null;
}

/* ----------------------------------------------------------------------------
 * Milestone C, Slice 3 — SYNTACTIC zero-width-capable predicate.
 *
 * `String.split(re)` is portable across JS `str.split` and Python `re.split`
 * EXCEPT when the splitter pattern can match the EMPTY string at some position:
 * there JS drops empty edge segments while Python `re.split` keeps them
 * (`"abc".split(/x` + `*` + `/)` -> JS `["a","b","c"]` vs Python
 * `["","a","b","c",""]`; an optional capture diverges far more). KERN
 * FAIL-CLOSES `.split` on a
 * zero-width-capable pattern (and emits the SAME refusal on both targets), so the
 * decision must be made by a SYNTACTIC scan of the pattern — NEVER by running a
 * host engine, which would make the result Unicode-DB/host-version dependent (the
 * frozen-fold-table lesson). A host probe would also differ TS-vs-Python and break
 * the byte-identical-refusal contract.
 *
 * The predicate is CONSERVATIVE: any pattern it cannot confidently prove is
 * always-non-empty is treated as zero-width-capable (-> fail-close, the SAFE
 * direction — over-rejection strands an exotic pattern but never ships a silent
 * divergence). RED-TEAMED against node v22 `str.split` vs python3.12 `re.split`
 * over a 60-pattern battery (`.agon-goals/regex-slice3` red-team): every diverging
 * pattern fail-closes (0 leaks) and every always-non-empty pattern stays in-core
 * (0 over-rejection), including the adversarial `\b`/lookaround/`x*a`/`(ab)*c`/
 * `(foo)|(bar)?` cases.
 *
 * Definition: a pattern is zero-width-capable iff its top-level ALTERNATION is
 * NULLABLE (some alternative can match empty). An alternative (a concatenation)
 * is nullable iff EVERY atom is nullable. An atom is nullable iff it is
 *   - a quantifier allowing zero reps (`*`, `?`, `{0,…}`, `{0}`, lazy variants), OR
 *   - a zero-width assertion (`^`, `$`, `\b`, `\B`, any lookaround `(?=…)`/`(?!…)`/
 *     `(?<=…)`/`(?<!…)`), OR
 *   - a group whose body alternation is itself nullable, OR
 *   - the empty subexpression (`a|` has an empty 2nd branch).
 * A literal, `.`, a `\d`/`\w`/… escape, or a `[...]` class WITHOUT a zero-rep
 * quantifier consumes >= 1 char and is NON-nullable.
 *
 * Runs on the RAW (pre-normalization) pattern: the Slice-1/`/i` transforms
 * (`\d`->`[0-9]`, `\Z`/`\A` anchors, fold-class expansion) preserve
 * zero-width-capability for every construct above (a non-null class stays
 * non-null; an anchor stays zero-width), so the decision is order-stable.
 */
export function isZeroWidthCapableRegex(pattern: string): boolean {
  try {
    // Conservative fail-close on any `.split`-UNSAFE escape, regardless of
    // structural nullability. `.split` diverges whenever node's `str.split`
    // and python3's `re.split` disagree, and escapes are the dominant source:
    //   (a) a BACKREFERENCE — `\1`..`\9`, `\k<…>`. Two divergence modes: a
    //       NULLABLE referenced group makes it zero-width-capable (`/(a?)\1/` —
    //       node keeps empty edges, `re.split` doesn't), AND a reference to a
    //       NON-EXISTENT group (`/a\1/`, `/\8/`) makes `re.split` THROW while JS
    //       treats it as octal/literal and succeeds. We do NOT do group
    //       nullability/existence analysis (over-rejecting a valid never-empty
    //       backref's `.split` is SAFE; a silent divergence is not).
    //   (b) an escape PYTHON `re` REJECTS but JS accepts — `\c`X control, `\u{…}`
    //       braced, `\p`/`\P` property, and the JS identity-escape letters
    //       (`\e \g \h …`). `re.split` errors, `str.split` succeeds.
    //   (c) an escape with DIFFERENT MEANING across engines — `\A`/`\Z` (python
    //       anchors vs JS identity `A`/`Z`), `\a` (python BEL vs JS identity).
    // So we allowlist only the escapes both engines accept with the SAME meaning
    // (see `isSplitSafeEscape`) and fail-close on every other escape.
    if (containsSplitUnsafeEscape(pattern)) return true;
    return parseZwAlternation(pattern, 0, pattern.length).nullable;
  } catch {
    // Un-parseable by this scanner -> conservative fail-close.
    return true;
  }
}

/** Escape characters that node `RegExp` and python `re` BOTH accept with the
 *  SAME meaning, so a `.split` over them is portable: shorthand classes,
 *  boundary assertions (handled as zero-width elsewhere), the C-style control
 *  literals, and `\xHH`/`\uHHHH`/octal numeric escapes (validated separately).
 *  Punctuation/symbol identity-escapes (`\.`, `\\`, `\/`, `\*`, …) are portable
 *  too and handled by the `nxt is non-alphanumeric` branch. */
const SPLIT_SAFE_ESCAPE_LETTERS = new Set([
  // shorthand classes (portable; the Slice-1 transform maps these identically)
  'd',
  'D',
  'w',
  'W',
  's',
  'S',
  // boundary assertions
  'b',
  'B',
  // C-style control literals (same code point in both engines)
  'n',
  'r',
  't',
  'f',
  'v',
]);

/** True iff the pattern contains any `.split`-UNSAFE escape (see the allowlist
 *  above). Scans raw, honoring `[...]` classes (an escape inside a class is a
 *  class member; backrefs and anchors don't apply there, but a Python-rejected
 *  escape like `[\c]` still diverges, so we apply the same allowlist there) and
 *  consuming every escape as a unit via `scanZwEscape` so a multi-char escape's
 *  trailing bytes are never re-scanned as a stray escape. */
function containsSplitUnsafeEscape(pattern: string): boolean {
  let p = 0;
  const end = pattern.length;
  let inClass = false;
  while (p < end) {
    const ch = pattern[p];
    if (ch === '\\') {
      const nxt = pattern[p + 1];
      if (nxt === undefined) return false; // trailing lone backslash — handled upstream
      // Backreferences (only outside a class; inside `[…]` `\1` is a literal,
      // but `\1` as a literal still parses on both, so don't flag there).
      if (!inClass && nxt >= '1' && nxt <= '9') return true;
      if (!inClass && nxt === 'k' && pattern[p + 2] === '<') return true;
      // `\xHH` / `\uHHHH` / `\u{…}` / `\cX` / octal `\0…`: classify by form.
      if (nxt === 'x' || nxt === 'u' || nxt === 'c' || nxt === '0') {
        if (!isMultiCharEscapeSplitSafe(pattern, p)) return true;
        p = scanZwEscape(pattern, p, end).next;
        continue;
      }
      // Letter escapes: only the allowlisted ones are portable. Everything else
      // (`\A \Z \a \e \g … \p \P`) errors or means something different in `re`.
      if (/[A-Za-z]/.test(nxt)) {
        if (!SPLIT_SAFE_ESCAPE_LETTERS.has(nxt)) return true;
        p += 2;
        continue;
      }
      // Non-alphanumeric escape (`\.`, `\\`, `\/`, `\*`, `\$`, …): portable
      // identity escape on both engines.
      p += 2;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      p++;
      continue;
    }
    if (ch === '[') inClass = true;
    p++;
  }
  return false;
}

/** `\xHH` / `\uHHHH` / octal `\0…` are portable; `\u{…}` braced and `\cX`
 *  control are NOT (python `re` rejects both). Malformed `\x`/`\u` (too few hex
 *  digits) are also rejected by python, so they're unsafe too. */
function isMultiCharEscapeSplitSafe(src: string, p: number): boolean {
  const nxt = src[p + 1];
  if (nxt === 'c') return false; // `\cX` — python `re` has no control escape
  if (nxt === '0') return true; // octal `\0…` — portable
  if (nxt === 'x') {
    return HEX_RE.test(src[p + 2] ?? '') && HEX_RE.test(src[p + 3] ?? '');
  }
  if (nxt === 'u') {
    if (src[p + 2] === '{') return false; // braced `\u{…}` — python `re` rejects
    return (
      HEX_RE.test(src[p + 2] ?? '') &&
      HEX_RE.test(src[p + 3] ?? '') &&
      HEX_RE.test(src[p + 4] ?? '') &&
      HEX_RE.test(src[p + 5] ?? '')
    );
  }
  return false;
}

/** Nullable iff ANY top-level alternative (split on depth-0, non-class `|`) is nullable. */
function parseZwAlternation(src: string, i: number, end: number): { nullable: boolean } {
  const alts: Array<[number, number]> = [];
  let start = i;
  let depth = 0;
  let inClass = false;
  for (let p = i; p < end; p++) {
    const ch = src[p];
    if (ch === '\\') {
      p++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '|' && depth === 0) {
      alts.push([start, p]);
      start = p + 1;
    }
  }
  alts.push([start, end]);
  let nullable = false;
  for (const [a, b] of alts) {
    if (parseZwConcat(src, a, b).nullable) nullable = true;
  }
  return { nullable };
}

/** Nullable iff EVERY atom is nullable (an empty concatenation is nullable). */
function parseZwConcat(src: string, i: number, end: number): { nullable: boolean } {
  let p = i;
  let allNullable = true;
  let sawAtom = false;
  while (p < end) {
    const atom = parseZwAtom(src, p, end);
    sawAtom = true;
    if (!atom.nullable) allNullable = false;
    p = atom.next;
  }
  if (!sawAtom) return { nullable: true };
  return { nullable: allNullable };
}

/** Parse one atom (base + optional quantifier). Returns its nullability and next index. */
function parseZwAtom(src: string, p: number, end: number): { nullable: boolean; next: number } {
  const ch = src[p];
  let baseNullable: boolean;
  let q: number;

  if (ch === '\\') {
    // Escape-robust scan. A NAIVE `q = p + 2` mis-attributes a following
    // quantifier for any MULTI-char escape (`\xHH`, `\uHHHH`, `\u{…}`, `\cX`,
    // octal `\0…`): e.g. `\x41*` would parse as `\x` `4` `1*`, leaving `1*`
    // (nullable) as the last atom and a non-null prefix — so the concat reads
    // NON-null and `.split` LEAKS (the engines actually diverge on the empty
    // edges of `\x41*`). We consume the WHOLE escape as one atom so the
    // quantifier attaches to the right base.
    const esc = scanZwEscape(src, p, end);
    baseNullable = esc.nullable;
    q = esc.next;
  } else if (ch === '^' || ch === '$') {
    baseNullable = true; // anchor: zero-width
    q = p + 1;
  } else if (ch === '[') {
    // Character class: consumes >= 1 char -> non-nullable. Skip to the matching `]`
    // (a leading `]` after `[` or `[^` is a literal member, not the terminator).
    let r = p + 1;
    if (src[r] === '^') r++;
    if (src[r] === ']') r++;
    while (r < end && src[r] !== ']') {
      if (src[r] === '\\') r++;
      r++;
    }
    if (r >= end) throw new Error('unterminated class');
    baseNullable = false;
    q = r + 1;
  } else if (ch === '(') {
    // Group: distinguish a lookaround (zero-width) from a capturing/non-capturing
    // group (nullable iff its body alternation is nullable).
    let r = p + 1;
    let isLookaround = false;
    if (src[r] === '?') {
      const k = src[r + 1];
      if (k === '=' || k === '!') {
        isLookaround = true;
        r += 2;
      } else if (k === '<' && (src[r + 2] === '=' || src[r + 2] === '!')) {
        isLookaround = true;
        r += 3;
      } else if (k === ':') {
        r += 2;
      } else if (k === '<') {
        // named capture (?<name>...): skip to the closing `>`.
        r += 2;
        while (r < end && src[r] !== '>') r++;
        r++;
      } else {
        r += 1;
      }
    }
    let depth = 1;
    let inClass = false;
    const bodyStart = r;
    let bodyEnd = -1;
    while (r < end) {
      const c = src[r];
      if (c === '\\') {
        r += 2;
        continue;
      }
      if (inClass) {
        if (c === ']') inClass = false;
        r++;
        continue;
      }
      if (c === '[') {
        inClass = true;
        r++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          bodyEnd = r;
          break;
        }
      }
      r++;
    }
    if (bodyEnd < 0) throw new Error('unterminated group');
    baseNullable = isLookaround ? true : parseZwAlternation(src, bodyStart, bodyEnd).nullable;
    q = bodyEnd + 1;
  } else {
    // Literal char (incl. `.`): consumes 1.
    baseNullable = false;
    q = p + 1;
  }

  const quant = parseZwQuantifier(src, q, end);
  if (quant) {
    return { nullable: baseNullable || quant.min === 0, next: quant.next };
  }
  return { nullable: baseNullable, next: q };
}

const HEX_RE = /[0-9a-fA-F]/;

/**
 * Consume ONE backslash escape starting at `src[p] === '\\'` and report its
 * zero-width nullability + the index just past it. Recognizing MULTI-char
 * escapes as single atoms is what makes the predicate escape-robust: a naive
 * "consume 1 char after the backslash" mis-attributes a following quantifier
 * (the `\x41*` / `\uHHHH*` / `\cA*` / `\0*` LEAK class).
 *
 * Nullability rules:
 *   - `\b` / `\B`            -> zero-width boundary assertion  -> NULLABLE.
 *   - any BACKREFERENCE      -> CONSERVATIVELY NULLABLE (fail-close `.split`).
 *       `\1`..`\9` (+ trailing digits) and `\k<name>`: a backref matches EMPTY
 *       when its referenced group matched empty (`/(a?)\1/`), so the whole
 *       pattern can be zero-width-capable. We do NOT attempt group-nullability
 *       analysis — over-rejecting a never-empty backref's `.split` is SAFE; a
 *       silent divergence is not. (`\1` also outright ERRORS under `re.split`
 *       in some shapes, another reason to fail-close.)
 *   - `\xHH` / `\uHHHH` / `\u{…}` / `\cX` / octal `\0…` / any single-char class
 *     escape (`\d \w \s …`) or literal escape -> consumes >= 1 char -> NON-null.
 *
 * Always advances past the FULL escape so the caller's quantifier scan attaches
 * to the correct base atom.
 */
function scanZwEscape(src: string, p: number, end: number): { nullable: boolean; next: number } {
  const nxt = src[p + 1];
  if (nxt === undefined) {
    // Trailing lone backslash — treat as a 1-char non-null atom (and don't run
    // off the end); the upstream emitters reject this separately.
    return { nullable: false, next: p + 1 };
  }
  // Zero-width boundary assertions.
  if (nxt === 'b' || nxt === 'B') return { nullable: true, next: p + 2 };
  // Numeric backreference `\1`..`\9` (consume the full run of digits) — conservative NULLABLE.
  if (nxt >= '1' && nxt <= '9') {
    let r = p + 2;
    while (r < end && src[r] >= '0' && src[r] <= '9') r++;
    return { nullable: true, next: r };
  }
  // Named backreference `\k<name>` — conservative NULLABLE.
  if (nxt === 'k' && src[p + 2] === '<') {
    let r = p + 3;
    while (r < end && src[r] !== '>') r++;
    return { nullable: true, next: r < end ? r + 1 : r };
  }
  // `\xHH` — two hex digits (fall back to consuming `\x` if malformed).
  if (nxt === 'x') {
    if (HEX_RE.test(src[p + 2] ?? '') && HEX_RE.test(src[p + 3] ?? '')) {
      return { nullable: false, next: p + 4 };
    }
    return { nullable: false, next: p + 2 };
  }
  // `\uHHHH` or `\u{H..H}`.
  if (nxt === 'u') {
    if (src[p + 2] === '{') {
      let r = p + 3;
      while (r < end && src[r] !== '}') r++;
      return { nullable: false, next: r < end ? r + 1 : r };
    }
    if (
      HEX_RE.test(src[p + 2] ?? '') &&
      HEX_RE.test(src[p + 3] ?? '') &&
      HEX_RE.test(src[p + 4] ?? '') &&
      HEX_RE.test(src[p + 5] ?? '')
    ) {
      return { nullable: false, next: p + 6 };
    }
    return { nullable: false, next: p + 2 };
  }
  // `\cX` control escape — one letter after `\c`.
  if (nxt === 'c' && /[A-Za-z]/.test(src[p + 2] ?? '')) {
    return { nullable: false, next: p + 3 };
  }
  // Octal `\0` (+ up to 2 more octal digits). `\0` alone is NUL; `\012` is octal.
  if (nxt === '0') {
    let r = p + 2;
    let count = 0;
    while (r < end && count < 2 && src[r] >= '0' && src[r] <= '7') {
      r++;
      count++;
    }
    return { nullable: false, next: r };
  }
  // Every other escape (`\d \w \s \. \\ \/ …`) consumes 1 char -> non-null.
  return { nullable: false, next: p + 2 };
}

/** Parse `*` `+` `?` `{n}` `{n,}` `{n,m}` (+ lazy `?`). Returns `{ min, next }` or null. */
function parseZwQuantifier(src: string, p: number, end: number): { min: number; next: number } | null {
  const ch = src[p];
  if (ch === '*') return { min: 0, next: skipZwLazy(src, p + 1) };
  if (ch === '+') return { min: 1, next: skipZwLazy(src, p + 1) };
  if (ch === '?') return { min: 0, next: skipZwLazy(src, p + 1) };
  if (ch === '{') {
    let r = p + 1;
    let num = '';
    while (r < end && src[r] >= '0' && src[r] <= '9') {
      num += src[r];
      r++;
    }
    if (num === '' && src[r] !== ',') return null; // literal `{`
    const min = num === '' ? 0 : Number.parseInt(num, 10);
    if (src[r] === ',') {
      r++;
      while (r < end && src[r] >= '0' && src[r] <= '9') r++;
    }
    if (src[r] !== '}') return null; // literal `{`
    return { min, next: skipZwLazy(src, r + 1) };
  }
  return null;
}

function skipZwLazy(src: string, p: number): number {
  return src[p] === '?' ? p + 1 : p;
}

/* ============================================================================
 * Milestone C, Slice 4 — replacement-STRING translation (.replace / .replaceAll)
 *
 * Slice 3 made the pattern and the method count/shape byte-identical but emitted
 * the JS `$`-surface replacement string VERBATIM on both targets. That is a
 * latent parity bug: a JS repl like `"$1"`, `"$&"`, `"$$"`, or one containing a
 * literal `\` does NOT mean the same thing to Python `re.sub`.
 *
 * Slice 4 translates the KERN/JS `$`-surface to each target's native repl syntax:
 *   - TS  : IDENTITY (the surface IS JS-native) — only the SHARED fail-close
 *           validator runs ({@link validateReplStringForTS}), so both targets
 *           reject the SAME inputs. No byte rewrite.
 *   - PY  : single-pass `$`→`\g`-syntax rewrite ({@link translateReplStringToPython}),
 *           returning the RUNTIME repl VALUE `re.sub` consumes (e.g. `\g<1>`, with
 *           literal `\` doubled to `\\`). The caller serializes that value to `.py`
 *           SOURCE via the ordinary string-literal escaper (gap 6 — do NOT conflate
 *           the translation layer with the serialization layer).
 *
 * The single-pass design is tribunal-validated: always-braced `\g<n>` +
 * unconditional `\`-doubling make every emitted token self-delimiting in Python's
 * re.sub repl grammar, so no token's parse boundary depends on what follows.
 *
 * Numbered-ref resolution mirrors JS EXACTLY (empirically pinned against node):
 *   - Read up to 2 digits after `$`.
 *   - 2-digit value in 1..groupCount  -> that group (consume 2). `$05` on 5 groups
 *     -> group 5 (zero-padded 2-digit DOES resolve).
 *   - else single-digit value in 1..groupCount -> that group (consume 1), the
 *     trailing digit is a LITERAL. `$12` on 1 group -> `\g<1>` + literal `2`.
 *   - else if the single digit is `0` (a leading-zero token that resolves to group
 *     0, which never exists) -> LITERAL `$` + all digits read. `$0`/`$00`/`$09`
 *     are literal `"$0"`/`"$00"`/`"$09"` — NEVER whole-match (gap 1).
 *   - else (single digit >= 1 but > groupCount, a genuine out-of-range typo) ->
 *     FAIL-CLOSE (gap 4 — kept conservative; JS would emit literal but it is almost
 *     certainly a user bug, consistent with the Slice-3 fail-close discipline).
 * ============================================================================ */

export const REGEX_REPLACE_NONLITERAL_REPL_FAILCLOSE =
  'Portable .replace/.replaceAll with a regex literal requires a STRING-LITERAL replacement (the JS `$`-surface can only be lowered to the Python re.sub syntax when known at compile time); a computed/variable replacement is not portable across targets — inline a string literal at the call site.';

export const REGEX_REPLACE_BEFORE_AFTER_FAILCLOSE =
  "Python re.sub has no analog for the `$\\`` (text before match) / `$'` (text after match) replacement tokens; KERN fail-closes them on BOTH targets.";

export const REGEX_REPLACE_OOR_REF_FAILCLOSE =
  'Out-of-range numbered group reference in a .replace/.replaceAll replacement string: JS would emit the literal text while Python re.sub raises re.error — KERN fail-closes this likely-typo on BOTH targets. (A literal `$0` is allowed; groups start at 1.)';

export const REGEX_REPLACE_BAD_NAME_FAILCLOSE =
  'Reference to an unknown or Python-illegal named group in a .replace/.replaceAll replacement string. KERN fail-closes on BOTH targets (the named group must exist in the pattern and be a legal Python identifier `[A-Za-z_]\\w*`).';

/** Thrown internally by the scanner; the public entry points convert it to one of
 *  the exported fail-close messages so TS and Python raise the SAME error. */
class ReplFailClose extends Error {}

/** Python-legal named-group identifier: `[A-Za-z_]\w*` (ASCII `\w` here — the
 *  fail-close domain, gap 3). JS named groups admit Unicode ID-start chars that
 *  Python `\g<name>` rejects, so the name domain is validated before emit. */
const PY_LEGAL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A `$<name>` token at the scan head: capture the name chars up to `>`. The name
 *  is the broadest run so an ILLEGAL name (e.g. with a `-` or Unicode) is still
 *  captured and then rejected by {@link PY_LEGAL_NAME_RE} (gap 3) rather than
 *  silently falling through to a lone-`$` literal. */
const REPL_NAME_TOKEN_RE = /^\$<([^>]*)>/;

export interface RegexCaptureMeta {
  readonly count: number;
  readonly names: ReadonlySet<string>;
}

/**
 * Count positional capture groups + collect named-group names over the KERN/JS
 * pattern surface (the `(?<name>)` form, BEFORE the R6 `(?P<name>)` rewrite).
 * Skips `(?:`, lookarounds, escapes, and char classes. Mirrors the oracle's
 * `capture_meta` byte-for-byte so the lowering site resolves refs identically.
 */
export function regexCaptureMeta(pattern: string): RegexCaptureMeta {
  let count = 0;
  const names = new Set<string>();
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      i += 1;
      while (i < n && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '(') {
      if (i + 1 < n && pattern[i + 1] === '?') {
        const m = /^\(\?<([A-Za-z_][A-Za-z0-9_]*)>/.exec(pattern.slice(i));
        if (m) {
          count += 1;
          names.add(m[1]);
        }
        // (?: (?= (?! (?<= (?<! -> non-capturing
      } else {
        count += 1;
      }
    }
    i += 1;
  }
  return { count, names };
}

/**
 * R6 — KERN/JS named-group PATTERN syntax -> Python `re` syntax, so a `$<name>`
 * repl ref (and any in-pattern backreference) resolves on the Python side:
 *   `(?<name>...)` -> `(?P<name>...)` ; `\k<name>` -> `(?P=name)`.
 * Python rejects the JS `(?<name>)` / `\k<name>` forms outright, so this rewrite
 * is load-bearing for ANY named-group pattern on the Python target — it had no
 * prior lowering (the Slice-3 `.match` path never exercised a named PATTERN on
 * Python). PYTHON-ONLY: the TS target keeps the JS form verbatim.
 */
export function lowerRegexNamedGroupsPython(pattern: string): string {
  return pattern
    .replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, '(?P<$1>')
    .replace(/\\k<([A-Za-z_][A-Za-z0-9_]*)>/g, '(?P=$1)');
}

/** JS greedy-2-then-1 numbered-ref resolution (gaps 1/2/4). Returns:
 *   { kind: 'group', n, consumed }     — resolved to group `n` (1..count)
 *   { kind: 'literal' }                — leading-zero token (`$0`/`$00`/`$09`): the
 *                                        whole `$`+digits is literal text
 *   { kind: 'oor' }                    — single digit >= 1 but > count: fail-close
 */
type NumberedRefResolution = { kind: 'group'; n: number; consumed: number } | { kind: 'literal' } | { kind: 'oor' };

function resolveNumberedRef(digits: string, count: number): NumberedRefResolution {
  if (digits.length === 2) {
    const two = Number.parseInt(digits, 10);
    if (two >= 1 && two <= count) return { kind: 'group', n: two, consumed: 2 };
    // else fall through to the single-digit attempt
  }
  const one = Number.parseInt(digits[0], 10);
  if (one >= 1 && one <= count) return { kind: 'group', n: one, consumed: 1 };
  // Leading-zero token (resolves to group 0, which never exists) -> literal `$0…`
  // (gap 1). A non-zero single digit that exceeds groupCount is a likely typo
  // -> out-of-range fail-close (gap 4).
  if (one === 0) return { kind: 'literal' };
  return { kind: 'oor' };
}

/**
 * Single-pass KERN `$`-surface -> Python `re.sub` repl VALUE (gaps 1-6).
 *
 * Returns the RUNTIME string `re.sub` consumes (e.g. `\g<1>` with a single
 * backslash; a literal `\` in the input doubled to `\\`). The CALLER serializes
 * this to `.py` source via the ordinary string-literal escaper — keeping the
 * translation layer and the serialization layer separate (gap 6).
 *
 * Throws on a non-portable token; the public wrappers convert to the shared
 * fail-close messages so TS and Python reject the SAME inputs.
 */
function scanReplToPython(repl: string, meta: RegexCaptureMeta): string {
  const out: string[] = [];
  let i = 0;
  const n = repl.length;
  while (i < n) {
    const ch = repl[i];
    if (ch === '$') {
      const nxt = i + 1 < n ? repl[i + 1] : '';

      // $$ -> literal $ (consumed as ONE token, not re-scanned).
      if (nxt === '$') {
        out.push('$');
        i += 2;
        continue;
      }
      // $& -> whole match -> \g<0> (gap: NOT $0, which is literal).
      if (nxt === '&') {
        out.push('\\g<0>');
        i += 2;
        continue;
      }
      // $` / $' -> no Python analog -> FAIL-CLOSE.
      if (nxt === '`' || nxt === "'") {
        throw new ReplFailClose(REGEX_REPLACE_BEFORE_AFTER_FAILCLOSE);
      }
      // $<name> -> \g<name>. Validate the name domain (gap 3) + existence.
      if (nxt === '<') {
        const m = REPL_NAME_TOKEN_RE.exec(repl.slice(i));
        if (m) {
          const name = m[1];
          if (!PY_LEGAL_NAME_RE.test(name) || !meta.names.has(name)) {
            throw new ReplFailClose(REGEX_REPLACE_BAD_NAME_FAILCLOSE);
          }
          out.push(`\\g<${name}>`);
          i += m[0].length;
          continue;
        }
        // `$<` not closing a legal name token -> lone `$` literal (fall through).
      }
      // $n / $nn numbered ref (greedy-2-then-1).
      const dm = /^\$([0-9]{1,2})/.exec(repl.slice(i));
      if (dm) {
        const digits = dm[1];
        const r = resolveNumberedRef(digits, meta.count);
        if (r.kind === 'oor') {
          throw new ReplFailClose(REGEX_REPLACE_OOR_REF_FAILCLOSE);
        }
        if (r.kind === 'literal') {
          // `$0`/`$00`/`$09` -> literal `$` + every digit read (gap 1).
          out.push('$');
          out.push(digits);
          i += 1 + digits.length;
          continue;
        }
        out.push(`\\g<${r.n}>`);
        // any un-consumed trailing digit is a literal (the JS rule).
        out.push(digits.slice(r.consumed));
        i += 1 + digits.length;
        continue;
      }
      // lone / unknown `$` -> literal `$` (gap 5: `$`-at-EOF, `$x` non-special).
      out.push('$');
      i += 1;
      continue;
    }
    if (ch === '\\') {
      // literal backslash -> ESCAPE for Python's special-`\` repl syntax (gap 6
      // translation layer: a bare `\b` would be a BACKSPACE to re.sub). `\` is NOT
      // an escape in JS replacements, so it is handled independently of `$`.
      out.push('\\\\');
      i += 1;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

/**
 * Translate a JS `$`-surface replacement STRING to the Python `re.sub` repl VALUE.
 * `meta` is the capture metadata of the (un-lowered KERN/JS) pattern. Throws one
 * of the `REGEX_REPLACE_*` fail-close messages on a non-portable token.
 */
export function translateReplStringToPython(repl: string, meta: RegexCaptureMeta): string {
  try {
    return scanReplToPython(repl, meta);
  } catch (e) {
    if (e instanceof ReplFailClose) throw new Error(e.message);
    throw e;
  }
}

/**
 * TS-side validator: the JS `$`-surface is already native, so the TS target emits
 * the repl string VERBATIM — but it must reject the SAME non-portable tokens the
 * Python translator rejects, so both targets fail-close symmetrically (the
 * ts-python-parity lockstep). Runs the identical scan and discards the output.
 */
export function validateReplStringForTS(repl: string, meta: RegexCaptureMeta): void {
  translateReplStringToPython(repl, meta);
}
