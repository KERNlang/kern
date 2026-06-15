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
 * CLASS-/ESCAPE-AWARE NORMALIZERS (hardening over the original Slice-1 crude
 * `replaceAll`): both {@link normalizeRegexClasses} and {@link lowerRegexAnchorsPython}
 * now walk the pattern with `classDepth` + escape bookkeeping (the shared
 * {@link scanCharClass} helper) instead of blind string replacement, so:
 *   - `\d`/`\w`/`\s` INSIDE a `[...]` set expand to the BARE body (`[\d_]`→`[0-9_]`),
 *     not the INVALID nested class `[[0-9]_]` the old `replaceAll` produced;
 *   - a LITERAL `\\d` (escaped backslash + `d`) and an escaped `\$`/`\^` are left
 *     VERBATIM (only an ACTIVE, unescaped shorthand/anchor is transformed).
 * Parity is still by *construction*: the SAME function runs on both targets, so a
 * given input yields a byte-identical residual pattern on each side. Both emitters
 * feed the same (modulo the Python `\/`→`/` un-escape, which touches only `/`)
 * input, so the shorthand expansion is identical across TS and Python.
 */

/**
 * The ASCII character-class CONTENTS that the shorthand classes `\d \w \s` expand
 * to (the BARE range body, with NO surrounding `[...]`). Out of a class these are
 * wrapped in fresh brackets (`[0-9]`); inside an existing `[...]` they are emitted
 * BARE (`0-9`) so the class is not invalidly nested. The exact content is the
 * certified Slice-1 contract (the `\s` set is a deliberate parity NARROWING that
 * drops Unicode whitespace such as NBSP) — do NOT change what these expand to.
 */
const SHORTHAND_CLASS_BODY: Record<string, string> = {
  d: '0-9',
  w: 'A-Za-z0-9_',
  s: ' \\t\\n\\r\\f\\v',
};

/**
 * Rewrite the shorthand classes `\d \w \s` to explicit ASCII character classes.
 * Applied to the emitted pattern on BOTH targets so the transform is identical.
 *
 * On TS, `\d`/`\w` normalization is a match no-op (JS shorthand is already
 * ASCII) but is emitted anyway so both emitters read from ONE normalizer; the
 * `\s` normalization on TS is load-bearing (it narrows JS `\s` to drop Unicode
 * whitespace such as NBSP).
 *
 * CLASS- AND ESCAPE-AWARE (single forward pass). The expansion FORM depends on
 * whether the shorthand sits inside a `[...]` character class:
 *   - OUT of a class (classDepth 0): `\d`→`[0-9]`, `\w`→`[A-Za-z0-9_]`,
 *     `\s`→`[ \t\n\r\f\v]` (a fresh bracketed class).
 *   - INSIDE a class (classDepth > 0): `\d`→`0-9`, `\w`→`A-Za-z0-9_`,
 *     `\s`→` \t\n\r\f\v` — the BARE body, NO brackets. The old blind `replaceAll`
 *     turned `/[\d_]/` into the INVALID nested class `[[0-9]_]`; the bare form
 *     keeps it the valid `[0-9_]`.
 * A `\d`/`\w`/`\s` is only expanded when its `\` is an ACTIVE shorthand backslash
 * (an UNescaped `\`). A `\\d` (escaped backslash, then a LITERAL `d`) leaves the
 * `d` untouched — the old `replaceAll('\\d', …)` wrongly rewrote it. The matching
 * `]` of each class is found via the literal-`]`-first-aware {@link scanCharClass}.
 * An unterminated `[` is UNREACHABLE for a parsed `regexLit` — the regex scanner
 * (`consumeRegex` in parser-expression.ts) only ends a literal on a `/` seen at
 * `!inClass`, so every parsed pattern has balanced `[...]` (an unbalanced `[`
 * throws "Unclosed regex literal" at parse time). The `closeIdx === -1` branch is
 * therefore belt-and-suspenders: the `[` is emitted as-is and scanning continues
 * at depth 0, so a LATER shorthand still expands bracketed (NOT a verbatim
 * pass-through of the rest) — fine, because such input can never reach here.
 *
 * ORDERING INVARIANT (codified): this pass runs FIRST in the regex pipeline —
 * before {@link expandRegexIFold} and {@link lowerRegexAnchorsPython} on both
 * targets (TS: codegen-expression.ts; Python: codegen-body-python.ts). It is the
 * ONLY pass that EMITS `[`/`]` from shorthand expansion; every downstream pass
 * re-scans char classes with {@link scanCharClass}, so the brackets it introduces
 * are honored exactly. Do NOT reorder the pipeline and do NOT add a second
 * `[`/`]`-emitting normalizer.
 */
export function normalizeRegexClasses(pattern: string): string {
  const chars = Array.from(pattern);
  let out = '';
  // `classDepth` is 0 outside any `[...]`, 1 inside (classes do not nest — an
  // inner `[` is a literal). `classCloseIdx` is the index of the current class's
  // MATCHING `]` (from {@link scanCharClass}); we close ONLY there, so a literal
  // `]`-first member (`[]]`, `[^]]`, `[]d]`) does not close the class early.
  // `escaped` tracks whether the current char follows an unescaped backslash.
  let classDepth = 0;
  let classCloseIdx = -1;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    // The char after a backslash. A shorthand `\d`/`\w`/`\s` is expanded HERE (the
    // `\` was an ACTIVE, unescaped backslash). Any other escaped char — including a
    // LITERAL `d`/`w`/`s` after an ESCAPED backslash (`\\d`) — is emitted verbatim,
    // so `\\d` is never rewritten. The escape also suppressed `[`/`]` bookkeeping
    // (handled by the `ch === '\\'` branch toggling `escaped`), so `\[`/`\]` are
    // not class delimiters.
    if (escaped) {
      const body = SHORTHAND_CLASS_BODY[ch];
      if (body !== undefined) {
        out = out.slice(0, -1); // drop the active `\` we already emitted
        out += classDepth > 0 ? body : `[${body}]`;
      } else {
        out += ch;
      }
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    // Unescaped `[` that OPENS a class. Record its matching `]` so the shorthand
    // expansion above emits the BARE body while inside, and the close is
    // literal-`]`-first-aware. DEFENSIVE: an UNTERMINATED class (`closeIdx === -1`)
    // is NOT entered — we emit the `[` verbatim and keep scanning at depth 0 so the
    // malformed pattern passes through (and surfaces at emit) rather than silently
    // switching every following shorthand to the bare in-class form.
    if (ch === '[' && classDepth === 0) {
      const scanned = scanCharClass(chars, i);
      if (scanned.closeIdx !== -1) {
        classDepth = 1;
        classCloseIdx = scanned.closeIdx;
      }
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

    out += ch;
  }

  return out;
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
 * Milestone C, Slice 2 — host-`RegExp` fail-close (the FINAL regex parity slice).
 *
 * Milestone B left `RegExp` usable as a host escape hatch (it was carried in
 * `HOST_NAMESPACE_EXEMPT_ROOTS`, so `isHostNamespaceRoot('RegExp')` returned
 * false). Slice 2 CLOSES that exemption: the host `RegExp` constructor/global is
 * NOT a portable cross-target surface, so any reference to it fails-close.
 *
 * WHY host `RegExp` cannot lower portably (over-rejection is correct here):
 *   - CONSTRUCTION takes a STRING pattern, so KERN's literal-only escape pipeline
 *     never runs — `new RegExp("\\d")` already collapsed `"\\d"` → `\d` at the JS
 *     string layer, where the Python target would have lowered a `/\d/` LITERAL
 *     through the certified class-normalizer. The two paths diverge before KERN
 *     ever sees the pattern, even for a CONSTANT string.
 *   - The runtime SyntaxError model for a bad dynamic pattern differs (JS throws
 *     a `SyntaxError`, Python `re` an `re.error`), and flag handling (`g`/`y`
 *     statefulness, `u` width) has no portable analog.
 *   - Legacy statics (`RegExp.$1`, `RegExp.prototype`) and value-position uses
 *     (passing `RegExp` as a value, `x instanceof RegExp`) are host-only.
 * So the certified portable regex surface is the LITERAL `/…/` form (owned by
 * Slices 1/3/4/5); host `RegExp` in EVERY position is fail-closed.
 *
 * The diagnostic MUST be byte-identical across the TS emitter (core) and the
 * Python emitter (@kernlang/python). Both import this single-source constant and
 * throw the exact same string — the same shared-const discipline every prior
 * regex slice uses (the Python target re-exports it; see codegen-body-python.ts).
 *
 * SCOPE NOTE (residual, NOT introduced by this slice): the fail-close fires on a
 * DIRECT host-`RegExp` reference resolved through the #432 scope-aware resolver
 * (so `const R = RegExp` is rejected at the initializer — `new R(...)` can never
 * silently diverge). A user-renamed re-export under a foreign name is already a
 * non-portable host reference handled by the broader host-namespace contract; it
 * is not a regex-specific concern and is out of Slice 2's scope. */
export const REGEX_HOST_REGEXP_FAILCLOSE =
  "Host 'RegExp' is not portable across targets and is fail-closed: construction (`new RegExp(p)` / `RegExp(p, f)`) takes a STRING pattern, so KERN's certified literal escape/class pipeline never runs (`new RegExp(\"\\\\d\")` already collapsed to `\\d` at the string layer, diverging from a `/\\d/` literal), and the runtime SyntaxError/flag model differs across JS and Python. Legacy statics (`RegExp.$1`, `RegExp.prototype`), value-position uses, and `.source`/`.flags` on a literal (which launders the pattern back to a string) have no portable analog either. Use a DIRECT regex literal (`/…/`) and the portable methods (.test/.exec/.match/.matchAll/.replace/.replaceAll/.split).";

/** The property allowlist for a REGEX LITERAL (`/…/`) member READ. The portable
 *  match-set METHODS (.test/.exec/.match/.matchAll/.replace/.replaceAll/.split)
 *  are routed by the CALL path (Slices 3/4) and never reach a bare property read.
 *  A bare property READ on a literal — `/x/.source`, `/x/.flags`, `/x/.global`,
 *  `RegExp`-prototype Symbol accessors — launders the pattern/flags back into a
 *  STRING (or exposes a host-only accessor), which is exactly the non-portable
 *  surface this slice closes. The allowlist is EMPTY: every bare property read on
 *  a regex literal is fail-closed. (Kept as a named predicate so a future portable
 *  read — if one is ever certified cross-target — has one obvious seam to widen.) */
export function isPortableRegexLiteralProperty(_property: string): boolean {
  return false;
}

/** SHARED, target-agnostic classifier for a property/element access whose
 *  receiver is a REGEX LITERAL (`/x/.<prop>`, `/x/["<prop>"]`, optionally the
 *  callee of a call `/x/.<prop>(…)`). This is the SINGLE source of truth for the
 *  "is this regex-literal access portable, and if not, which message?" decision,
 *  consulted by BOTH the value-emit/IR-validate paths' intent AND the
 *  block-bodied-arrow TS-AST walk (`collectClosureBlockRegexHostViolations`),
 *  so the two legs agree BY CONSTRUCTION instead of by parallel heuristics.
 *
 *  It MIRRORS `lowerRegexCallTS`' regex-LITERAL-RECEIVER branches exactly. NOTE
 *  `lowerRegexCallTS` only lowers a DOTTED method call (`callee.kind ===
 *  'member'`), so ONLY the dotted form is ever portable — a BRACKET-form call
 *  (`/x/["test"](s)`) is NOT lowered and falls through to the index fail-close,
 *  exactly like a bare bracket read. Hence the `isDottedCallee` parameter (the
 *  access is a `/x/.<prop>` PROPERTY access AND the callee of a call):
 *   - `isDottedCallee` + `.test` → portable, EXCEPT a `/g` literal throws
 *     `REGEX_TEST_G_FAILCLOSE` (JS mutates lastIndex; Python `re.search` is
 *     stateless).
 *   - `isDottedCallee` + `.exec` → `REGEX_EXEC_FAILCLOSE` (stateful lastIndex).
 *   - EVERYTHING else — any other property, OR `.test`/`.exec` NOT a dotted
 *     callee (a bare read `/x/.test`/`/x/["test"]`, or a BRACKET call
 *     `/x/["test"](s)`), OR any non-portable read (`/x/.source`, `/x/["source"]`),
 *     OR a receiver-call to a non-portable method (`/x/.match(…)`,
 *     `/x/.compile(…)`) — launders the pattern/flags back to a host-only surface
 *     and fails-close with the shared `REGEX_HOST_REGEXP_FAILCLOSE`.
 *
 *  Returns `null` when the access is PORTABLE (emit verbatim), or the exact
 *  fail-close MESSAGE otherwise. `property` is null for a COMPUTED element index
 *  (`/x/[k]`) — unknowable, so it fails-close. */
export function classifyRegexLiteralAccessFailClose(
  property: string | null,
  isDottedCallee: boolean,
  flags: string,
): string | null {
  if (isDottedCallee && property === 'test') {
    return flags.includes('g') ? REGEX_TEST_G_FAILCLOSE : null;
  }
  if (isDottedCallee && property === 'exec') {
    return REGEX_EXEC_FAILCLOSE;
  }
  return REGEX_HOST_REGEXP_FAILCLOSE;
}

/* ----------------------------------------------------------------------------
 * Milestone C, Slice 5 — astral (non-BMP) fail-close.
 *
 * KERN's certified portable regex subset is BMP only (U+0000..U+FFFF). A non-BMP
 * (astral, codepoint >= U+10000) construct in the PATTERN SOURCE is NOT portable
 * and fail-closes with a symmetric, byte-identical diagnostic on BOTH targets.
 *
 * ROOT divergence (surrogate width, empirically probed node v22 vs python3 3.12):
 * JS `RegExp` indexes the subject by UTF-16 code UNIT; Python `re` by CODEPOINT.
 * An astral char is a surrogate PAIR (2 units) in JS but 1 codepoint in Python, so
 * width-sensitive operators diverge on astral PATTERN data:
 *   - `.`-count over `"a😀b"`: JS 4 (units) vs Python 3 (codepoints).
 *   - `/^.$/` over `"😀"`:     JS false (2u) vs Python true (1cp).
 * `/u` would align JS `.` to codepoints but conflicts with the frozen non-`/u`
 * `/i` fold-class expansion, so "always add /u" is rejected — BMP-subset + astral
 * fail-close is the council-chosen path.
 *
 * The boundary is EXACT `>= 0x10000`: U+FFFF (last BMP) stays IN-CORE — it is one
 * UTF-16 unit AND one codepoint, so the two width models agree. The gate is
 * /i-INDEPENDENT (fires regardless of flags): a literal astral char never folds on
 * either engine, so this is a pure surrogate-width gate, not a fold concern.
 * ------------------------------------------------------------------------- */
export const REGEX_ASTRAL_FAILCLOSE_PREFIX = 'Regex with a non-BMP (astral) construct';

/** Build the (target-agnostic) compile-error message for a Slice-5 astral
 *  fail-close. Both emitters throw this identical text — selected only by the
 *  offending astral codepoint (named via {@link codePointHex}) — so the refusal
 *  is observably symmetric across TS and Python. */
export function regexAstralFailMessage(char: string): string {
  const hex = codePointHex(char);
  return (
    `${REGEX_ASTRAL_FAILCLOSE_PREFIX} (${hex}) cannot be lowered portably: KERN's certified ` +
    `regex subset is BMP only (U+0000..U+FFFF). JS RegExp indexes the subject by UTF-16 code ` +
    `unit while Python re indexes by codepoint, so an astral codepoint (>= U+10000) diverges ` +
    `by surrogate width across targets. Remove the astral construct or restrict the pattern to BMP.`
  );
}

/**
 * Slice-5 astral scanner. Walk the regex PATTERN SOURCE by CODE POINT (reusing the
 * SAME class-aware, escape-aware codepoint loop as {@link expandRegexIFold} and the
 * literal-`]`-first-aware {@link scanCharClass}) and return the FIRST offending
 * non-BMP codepoint as `{ char }`, or `null` if the pattern is fully BMP.
 *
 * CODEPOINT-AWARE, NOT UNIT-BLIND: the loop iterates `Array.from(pattern)`, which
 * splits the source by Unicode codepoint — a raw astral char (a surrogate PAIR in
 * the UTF-16 source) becomes ONE array element whose `codePointAt(0)` is its FULL
 * codepoint (`/a😀b/` → the `😀` element decodes to U+1F600 >= 0x10000, fired by
 * rule 1 BECAUSE the codepoint is astral, not incidentally), and the index advances
 * past the whole pair in one step. A naive `String.match(/\\uD[89AB].../)` over the
 * raw text would FALSE-POSITIVE on a literal backslash-u-D800 (`\\uD800` is `\` `u`
 * `D` `8` `0` `0`, NOT a lone surrogate) — we avoid that by being escape-aware:
 * a `\u`/`\u{}` astral is detected via the escape branch, never via raw text match.
 *
 * The FIVE rules form a COMPLETE partition of "astral in the pattern source"
 * (validated by a 6-engine tribunal: no over-reach, no missing construct):
 *   1. Raw astral codepoint literal: any source codepoint >= 0x10000, anywhere
 *      INCLUDING inside `[...]` (class-awareness does NOT suppress the scan; it is
 *      only carried for diagnostic context — every position is checked).
 *   2. `\u{HHHHH}` escape whose decoded value >= 0x10000.
 *   3. Astral character-class RANGE `[x-y]` where EITHER endpoint decodes to
 *      >= 0x10000 — subsumed by rules 1+2, which fire on the offending endpoint
 *      regardless of class/range position. (This does NOT subsume `[\uD800-\uDFFF]`:
 *      pure surrogates are < 0x10000 and are caught by rule 5, below.)
 *   4. Surrogate-PAIR escape: `\uD800-\uDBFF` IMMEDIATELY followed by
 *      `\uDC00-\uDFFF` recombines to an astral codepoint (>= 0x10000). Context: in a
 *      SEQUENCE it is an astral pair; inside a class or when SPLIT the two are lone
 *      surrogates caught by rule 5 — every branch fails-close (safety is
 *      unconditional; the pair-recombination is only for DIAGNOSTIC accuracy, so the
 *      named codepoint is the recombined astral char, not a bare surrogate).
 *   5. Lone surrogate escape `\uD800-\uDFFF` not forming a pair — non-portable
 *      (a lone surrogate is rejected/treated differently across engines).
 *
 * Runs on the RAW pattern BEFORE class-/fold-/anchor-normalization (like
 * {@link isZeroWidthCapableRegex}) on BOTH the TS and Python paths, so the same
 * decision and the same `{ char }` are produced from the same input on each side.
 */
export function scanRegexAstral(pattern: string): { char: string } | null {
  const chars = Array.from(pattern);
  const n = chars.length;
  let escaped = false;
  // `classDepth` mirrors the {@link expandRegexIFold} bookkeeping (0 outside any
  // `[...]`, 1 inside) and `classCloseIdx` the matching `]` from {@link scanCharClass}
  // so the loop tracks class context the same way — though astral detection itself
  // applies at EVERY position (rule 1/2 are not class-suppressed); the context is
  // only carried for parity with the shared scanner shape.
  let classDepth = 0;
  let classCloseIdx = -1;

  for (let i = 0; i < n; i++) {
    const ch = chars[i];

    if (escaped) {
      // The char after a backslash. A `\u…` escape is decoded HERE (rules 2/4/5);
      // any other escaped char is a literal and only its raw codepoint matters
      // (rule 1 — an escaped astral char `\😀` is still an astral codepoint).
      escaped = false;
      if (ch === 'u') {
        // `\u{HHHHH}` (rule 2) — decode the brace body.
        if (chars[i + 1] === '{') {
          let j = i + 2;
          let hex = '';
          while (j < n && chars[j] !== '}') {
            hex += chars[j];
            j++;
          }
          if (j < n && chars[j] === '}') {
            const v = Number.parseInt(hex, 16);
            if (Number.isFinite(v) && v >= 0x10000) {
              // Clamp to the max valid codepoint (U+10FFFF) for the diagnostic char:
              // a `\u{HHHHH}` body above U+10FFFF is malformed and still fails-close,
              // but `String.fromCodePoint` throws on an out-of-range value, so we name
              // the max astral codepoint rather than crash. (Both targets share this
              // function, so even the malformed case fails symmetrically.)
              return { char: String.fromCodePoint(Math.min(v, 0x10ffff)) };
            }
            i = j; // skip past the closing `}`
            continue;
          }
          // Malformed `\u{` with no close — fall through; surfaces at emit anyway.
          continue;
        }
        // `\uHHHH` — decode the four hex digits.
        const hex = chars.slice(i + 1, i + 5).join('');
        if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
          const v1 = Number.parseInt(hex, 16);
          // Rule 4: high surrogate IMMEDIATELY followed by a `\uLLLL` low surrogate
          // recombines to an astral codepoint. Detect the pair BEFORE rule 5 so the
          // diagnostic names the recombined astral char, not a bare surrogate.
          if (v1 >= 0xd800 && v1 <= 0xdbff && chars[i + 5] === '\\' && chars[i + 6] === 'u') {
            const hex2 = chars.slice(i + 7, i + 11).join('');
            if (hex2.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex2)) {
              const v2 = Number.parseInt(hex2, 16);
              if (v2 >= 0xdc00 && v2 <= 0xdfff) {
                const cp = (v1 - 0xd800) * 0x400 + (v2 - 0xdc00) + 0x10000;
                return { char: String.fromCodePoint(cp) };
              }
            }
          }
          // Rule 5: lone surrogate `\uD800-\uDFFF` (high or low) not forming a pair.
          if (v1 >= 0xd800 && v1 <= 0xdfff) {
            // Report a surrogate codepoint directly so the message names U+D800-U+DFFF.
            return { char: String.fromCharCode(v1) };
          }
          i += 4; // skip the four hex digits (the `u` was consumed by the escape)
          continue;
        }
      }
      // Any other escaped char: only a RAW astral codepoint matters (rule 1).
      if ((ch.codePointAt(0) ?? 0) >= 0x10000) return { char: ch };
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    // Rule 1: a raw astral codepoint literal anywhere (including inside `[...]`).
    // `Array.from` already split a surrogate pair into ONE element decoding to its
    // full codepoint, so this is a codepoint test, never a code-unit test.
    if ((ch.codePointAt(0) ?? 0) >= 0x10000) return { char: ch };

    // Class bookkeeping (parity with the shared scanner; detection is not gated by it).
    if (ch === '[' && classDepth === 0) {
      const scanned = scanCharClass(chars, i);
      classDepth = 1;
      classCloseIdx = scanned.closeIdx;
      continue;
    }
    if (classDepth > 0 && i === classCloseIdx) {
      classDepth = 0;
      classCloseIdx = -1;
    }
  }

  return null;
}

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

/**
 * FIX 2 — a named group in the PATTERN (`(?<name>…)`) whose NAME is OUTSIDE KERN's
 * certified-portable ASCII identifier subset `[A-Za-z_][A-Za-z0-9_]*`. JS admits
 * Unicode ID-start chars in group names and Python `re` accepts a different
 * Unicode-identifier set (CPython uses `str.isidentifier`), so a non-ASCII name
 * like `(?<café>…)` is a SILENT cross-target divergence risk — and the legacy
 * Python lowering emitted the JS form `(?<café>…)` verbatim, which Python `re`
 * REJECTS at compile (`unknown extension ?<c`). KERN fail-closes such a name on
 * BOTH targets (symmetric refusal) rather than emit invalid/divergent codegen.
 * Over-rejection of a non-ASCII name is SAFE; silent divergence is FORBIDDEN.
 */
export const REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE =
  'Non-portable named group in the regex PATTERN. KERN fail-closes on BOTH targets: a named group `(?<name>…)` must use the portable ASCII identifier subset `[A-Za-z_][A-Za-z0-9_]*` (a Unicode or otherwise-illegal name is not portable across the TS and Python targets).';

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
 * Match a named-group OPENER `(?<NAME>` where NAME is ANY run up to the closing
 * `>` that is NOT a lookbehind (`(?<=` / `(?<!`). The name is captured as the
 * broadest run (`[^>]*`) so a JS-valid Unicode group name (`(?<café>`) — or an
 * empty / `$x` illegal name — is RECOGNIZED here, COUNTED as a capture, and its
 * name COLLECTED. The Python-legality of the name is a SEPARATE concern, decided
 * by {@link validateRegexNamedGroupsPortable} (fail-close), NOT by recognition:
 * if recognition were ASCII-only, a Unicode-named group would be MIS-counted as
 * ZERO captures and silently break `$n`/groupCount resolution for the WHOLE
 * pattern (gap: FIX 1).
 *
 * The negative-lookahead `(?![=!])` rejects ONLY `(?<=`/`(?<!`; every other char
 * after `(?<` starts a named group. `[^>]*` then reads to the first `>`.
 */
const NAMED_GROUP_OPENER_RE = /^\(\?<(?![=!])([^>]*)>/;

/**
 * Count positional capture groups + collect named-group names over the KERN/JS
 * pattern surface (the `(?<name>)` form, BEFORE the R6 `(?P<name>)` rewrite).
 * Skips `(?:`, lookarounds, escapes, and char classes. Mirrors the oracle's
 * `capture_meta` so the lowering site resolves refs identically.
 *
 * MUST be called on the UN-LOWERED JS pattern (pre-{@link lowerRegexNamedGroupsPython}):
 * it recognizes ONLY the JS opener `(?<name>`, NOT the already-lowered Python form
 * `(?P<name>)`. Calling it after the lowering would silently count ZERO named
 * groups. (The TS/Python emitters both pass the raw `node.pattern`, which is correct.)
 *
 * FIX 1: named-group RECOGNITION matches ALL JS-valid names (Unicode included),
 * so `(?<café>x)(b)` is COUNTED as 2 groups (and `$2` resolves to `(b)`) instead
 * of mis-counting the Unicode-named group as zero. Name PORTABILITY is enforced
 * separately by {@link validateRegexNamedGroupsPortable}.
 *
 * CLASS-BOUNDARY UNIFICATION (Slice-4 re-review blocker): char classes are scanned
 * by the CANONICAL {@link scanCharClass} (literal-`]`-first-aware, code-point array),
 * the SAME scanner {@link validateRegexNamedGroupsPortable} and
 * {@link lowerRegexNamedGroupsPython} use. The previous inline scan closed at the
 * FIRST `]`, which disagreed with the rewriter on a literal-`]`-first class
 * (`/[](?<x>)]/`, `/[^]](?<x>)/`): the COUNTER read `(?<x>)` as a real group while
 * the REWRITER kept it INSIDE the class, so count/validate/rewrite operated on
 * different class structures — a silent parity divergence. All three now agree
 * byte-for-byte on where every class ends.
 */
export function regexCaptureMeta(pattern: string): RegexCaptureMeta {
  let count = 0;
  const names = new Set<string>();
  const chars = Array.from(pattern);
  const n = chars.length;
  let i = 0;
  while (i < n) {
    const ch = chars[i];
    if (ch === '\\') {
      // Skip the escape pair so an escaped `\(` / `\[` is not read as a delimiter.
      i += 2;
      continue;
    }
    if (ch === '[') {
      // Canonical class scan: close at the MATCHING `]` (a literal `]`-first member
      // like `[]…]` / `[^]…]` does NOT terminate the class), matching the rewriter.
      const { closeIdx } = scanCharClass(chars, i);
      i = closeIdx < 0 ? n : closeIdx + 1; // unterminated class -> consume to end
      continue;
    }
    if (ch === '(') {
      if (i + 1 < n && chars[i + 1] === '?') {
        const m = NAMED_GROUP_OPENER_RE.exec(chars.slice(i).join(''));
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
 * FIX 2 — fail-close any named group in the PATTERN whose NAME is OUTSIDE KERN's
 * portable ASCII identifier subset `[A-Za-z_][A-Za-z0-9_]*` (Unicode like `café`,
 * an empty name `(?<>…)`, or a `$`-prefixed name `(?<$x>…)`). Shared by BOTH
 * targets so the refusal is observably symmetric: it is called at the TS regex-
 * literal emit chokepoints AND in the Python `pyRegexPattern` lowering, so EVERY
 * regex method (match/matchAll/split/test/replace/…) — not just `.replace` — and
 * a bare regex literal all refuse a non-portable name identically.
 *
 * CLASS- AND ESCAPE-AWARE (single forward pass, sharing the CANONICAL
 * {@link scanCharClass} with {@link regexCaptureMeta} and
 * {@link lowerRegexNamedGroupsPython}): a `(?<` that is INSIDE a `[...]` char
 * class, or whose `(` is escaped (`\(?<`), is a literal — NOT a group opener — and
 * is skipped. The class scan is literal-`]`-first-aware (`[]…]` / `[^]…]` does NOT
 * close at the leading `]`), so the validator agrees byte-for-byte with the counter
 * and the rewriter on where every class ends — a previous inline close-at-first-`]`
 * scan disagreed on a literal-`]`-first class (`/[](?<x>)]/`), validating a group the
 * rewriter treated as in-class (or vice versa), a silent parity divergence.
 * Lookbehind `(?<=` / `(?<!` is excluded by {@link NAMED_GROUP_OPENER_RE}.
 *
 * Throws {@link REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE} on the first illegal name.
 */
export function validateRegexNamedGroupsPortable(pattern: string): void {
  const chars = Array.from(pattern);
  const n = chars.length;
  let i = 0;
  while (i < n) {
    const ch = chars[i];
    if (ch === '\\') {
      // Skip the escape pair so an escaped `\(` / `\[` is not read as a delimiter.
      i += 2;
      continue;
    }
    if (ch === '[') {
      // A `(?<` inside a char class is a literal, not a group opener — skip past the
      // class via the canonical (literal-`]`-first-aware) scan, matching the rewriter.
      const { closeIdx } = scanCharClass(chars, i);
      i = closeIdx < 0 ? n : closeIdx + 1; // unterminated class -> consume to end
      continue;
    }
    if (ch === '(' && i + 1 < n && chars[i + 1] === '?') {
      const m = NAMED_GROUP_OPENER_RE.exec(chars.slice(i).join(''));
      if (m && !PY_LEGAL_NAME_RE.test(m[1])) {
        throw new Error(REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE);
      }
    }
    i += 1;
  }
}

/**
 * R6 — KERN/JS named-group PATTERN syntax -> Python `re` syntax, so a `$<name>`
 * repl ref (and any in-pattern backreference) resolves on the Python side:
 *   `(?<name>...)` -> `(?P<name>...)` ; `\k<name>` -> `(?P=name)`.
 * Python rejects the JS `(?<name>)` / `\k<name>` forms outright, so this rewrite
 * is load-bearing for ANY named-group pattern on the Python target — it had no
 * prior lowering (the Slice-3 `.match` path never exercised a named PATTERN on
 * Python). PYTHON-ONLY: the TS target keeps the JS form verbatim.
 *
 * FIX 3 — CLASS- AND ESCAPE-AWARE (single forward pass, NOT a blind global
 * `String.replace`). A literal `\k<g>` that appears INSIDE a `[...]` char class
 * (`/[\k<g>]/`) or whose backslash is itself escaped (`\\k<g>` = a literal `\` +
 * `k<g>`) is NOT a backreference and must NOT be rewritten — the old blind
 * `replace(/\\k<…>/g, …)` rewrote those too, corrupting the pattern. We track
 * `[...]` class depth (literal-`]`-first-aware, via the same {@link scanCharClass}
 * the other normalizers use) and the escape state, and rewrite ONLY a TRUE
 * `(?<name>` group opener at classDepth 0 and a TRUE `\k<name>` backref at
 * classDepth 0 whose backslash is unescaped. Names are restricted to the portable
 * ASCII subset (any non-portable name has already been refused upstream by
 * {@link validateRegexNamedGroupsPortable}, so a non-matching `(?<…>`/`\k<…>` here
 * is a non-backref / in-class literal and is left verbatim).
 */
export function lowerRegexNamedGroupsPython(pattern: string): string {
  const chars = Array.from(pattern);
  let out = '';
  let classDepth = 0;
  let classCloseIdx = -1;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (escaped) {
      // `\k<name>` backref: ONLY at classDepth 0 and only for a portable ASCII
      // name. Inside a class a `\k<…>` is a literal, not a backref (left verbatim).
      // We are AT the `k`; the `\` was already emitted (last char of `out`).
      if (classDepth === 0 && ch === 'k' && chars[i + 1] === '<') {
        const name = matchAsciiGroupName(chars, i + 2);
        if (name !== null) {
          out = `${out.slice(0, -1)}(?P=${name.value})`;
          i = name.endIdx; // advance to the closing `>` (loop's i++ steps past it)
          escaped = false;
          continue;
        }
      }
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    // Open a char class — record its matching `]` (literal-`]`-first-aware).
    if (ch === '[' && classDepth === 0) {
      const scanned = scanCharClass(chars, i);
      classDepth = 1;
      classCloseIdx = scanned.closeIdx;
      out += ch;
      continue;
    }
    if (classDepth > 0 && i === classCloseIdx) {
      classDepth = 0;
      classCloseIdx = -1;
      out += ch;
      continue;
    }

    // `(?<name>` group opener: ONLY at classDepth 0 and only for a portable ASCII
    // name. A `(?<` inside a class is a literal sequence (left verbatim).
    if (ch === '(' && classDepth === 0 && chars[i + 1] === '?' && chars[i + 2] === '<') {
      const name = matchAsciiGroupName(chars, i + 3);
      if (name !== null) {
        out += `(?P<${name.value}>`;
        i = name.endIdx; // advance to the closing `>` (loop's i++ steps past it)
        continue;
      }
    }

    out += ch;
  }

  return out;
}

/**
 * Read a portable ASCII group name `[A-Za-z_][A-Za-z0-9_]*` from `chars` starting
 * at `start`, requiring a closing `>`. Returns the name VALUE and the index of the
 * closing `>` (so the caller's loop `i++` resumes after it), or null if the run at
 * `start` is not a legal ASCII name followed by `>`. Operates purely on the
 * code-point `chars` array (no `string.slice` / UTF-16-index mixing) so a non-ASCII
 * literal earlier in the pattern body cannot misalign the scan.
 */
function matchAsciiGroupName(chars: string[], start: number): { value: string; endIdx: number } | null {
  let j = start;
  const isStart = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z_]$/.test(c);
  const isPart = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z0-9_]$/.test(c);
  if (!isStart(chars[j])) return null;
  let value = chars[j];
  j += 1;
  while (isPart(chars[j])) {
    value += chars[j];
    j += 1;
  }
  if (chars[j] !== '>') return null;
  return { value, endIdx: j };
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
