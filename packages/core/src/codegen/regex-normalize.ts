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
