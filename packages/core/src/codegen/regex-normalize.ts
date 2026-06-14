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
