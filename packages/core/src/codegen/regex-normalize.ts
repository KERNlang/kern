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
 * Note: `String.prototype.replaceAll` is used (not `.replace`) to match
 * Python's `str.replace`, which replaces ALL occurrences — keeping the two
 * targets' residual patterns byte-identical when an anchor appears more than
 * once.
 */
export function lowerRegexAnchorsPython(pattern: string, flags: string): string {
  if (flags.includes('m')) return pattern;
  return pattern.replaceAll('$', '\\Z').replaceAll('^', '\\A');
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

/** Result of {@link expandRegexIFold}: an expanded pattern, or a fail-close. */
export type RegexIFoldResult = { pattern: string } | { failClose: true; char: string };

const isAsciiCodePoint = (cp: number): boolean => cp < 0x80;

/**
 * Build the (target-agnostic) compile-error message for a Set(B) `/i` fail-close.
 * Both emitters throw this identical text so the refusal is observably symmetric.
 */
export function regexIFoldFailMessage(char: string): string {
  const cp = char.codePointAt(0) ?? 0;
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  return (
    `Regex /i over '${char}' (${hex}) cannot be lowered portably: its case-fold is ` +
    `length-changing/declined and has no single-codepoint partner, so it cannot be ` +
    `expressed as a character class. Remove /i or rewrite the letter explicitly.`
  );
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
 */
export function expandRegexIFold(pattern: string, flags: string): RegexIFoldResult {
  if (!flags.includes('i')) return { pattern };

  let out = '';
  let classDepth = 0;
  let escaped = false;

  for (const ch of pattern) {
    const cp = ch.codePointAt(0) ?? 0;

    // Pass through the character after a backslash verbatim (an escaped letter is
    // not a valid fold escape in either engine; this also avoids treating an
    // escaped `\[`/`\]` as a class delimiter). Mirrors the oracle's char-walk:
    // the escape only suppresses the bracket-depth bookkeeping, never expansion of
    // a *bare* (unescaped) Set(A) letter.
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

    // Bracket-depth bookkeeping (unescaped only).
    if (ch === '[') {
      classDepth++;
      out += ch;
      continue;
    }
    if (ch === ']') {
      if (classDepth > 0) classDepth--;
      out += ch;
      continue;
    }

    if (isAsciiCodePoint(cp)) {
      out += ch; // ASCII letters rely on the kept /i fold.
      continue;
    }

    if (SET_B.has(ch)) {
      return { failClose: true, char: ch };
    }

    const members = SET_A_MEMBERS.get(ch);
    if (members !== undefined) {
      // Inside an existing `[...]` set, emit bare members (a nested class would be
      // invalid on JS and a literal `[` on Python); otherwise wrap in a new class.
      out += classDepth > 0 ? members : `[${members}]`;
      continue;
    }

    // Non-ASCII, non-folding letter (or non-letter): pass through verbatim.
    out += ch;
  }

  return { pattern: out };
}
