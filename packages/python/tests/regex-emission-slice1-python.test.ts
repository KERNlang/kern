/** Milestone C, Slice 1 — regex emission-normalization, DISCRIMINATING tests.
 *
 *  Slice 1 makes a KERN regex literal lower byte-identically on BOTH targets for
 *  the certified core: `\d \w \s` → ASCII classes (shared transform), Python-only
 *  `$`→`\Z`/`^`→`\A` anchor lowering on the non-`/m` path, and `re.ASCII` injected
 *  on every Python flag expression.
 *
 *  These assertions mirror the discriminating oracle in
 *  `.agon-goals/regex-slice1-oracle/` (slice1-fixtures.json). Each killer row
 *  asserts the EXACT emitted TS literal AND the EXACT emitted Python
 *  `re.compile(...)` so it FAILS a plausibly-wrong impl. The oracle names four
 *  wrong-impls; the inline `// kills:` notes record which one(s) each row defeats:
 *    - naive_passthrough : emit pattern verbatim, i/m/s flags only, NO re.ASCII
 *                          (literally pre-Slice-1 behavior)
 *    - no_anchor         : normalize classes + re.ASCII, but forget $→\Z / ^→\A
 *    - no_re_ascii       : normalize classes + anchors, but forget re.ASCII
 *    - raw_anchor_re_m   : keep $/^ verbatim and add re.M (the naive JS→py mapping)
 *
 *  The TS emitter keeps `$`/`^` verbatim (JS `$`/`^` without `/m` already mean
 *  input-end/start — that is the parity target). The shared class transform makes
 *  TS `\d`/`\w` a match no-op but narrows `\s` (drops Unicode whitespace).
 */

import { emitExpression, parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

describe('Slice 1 regex emission — \\d \\w \\s class normalization (both targets)', () => {
  // kills: naive_passthrough — a verbatim `\d` matches Unicode digits in Python
  // (Arabic-Indic, fullwidth); `[0-9]` is ASCII-only on both targets.
  test('/\\d+/ → ASCII digit class on both targets', () => {
    expect(ts('/\\d+/')).toBe('/[0-9]+/');
    expect(py('/\\d+/')).toBe('__k_re.compile("[0-9]+", __k_re.ASCII)');
  });

  // kills: naive_passthrough — Python `\w` includes accented letters (é); the
  // certified `[A-Za-z0-9_]` does not.
  test('/\\w+/ → ASCII word class on both targets', () => {
    expect(ts('/\\w+/')).toBe('/[A-Za-z0-9_]+/');
    expect(py('/\\w+/')).toBe('__k_re.compile("[A-Za-z0-9_]+", __k_re.ASCII)');
  });

  // kills: naive_passthrough — raw `\s` matches NBSP on BOTH hosts (identical by
  // luck); the certified ASCII set `[ \t\n\r\f\v]` narrows it. This is the one
  // row where the TS class normalization is match-LOAD-BEARING (not a no-op).
  test('/a\\sb/ → ASCII whitespace class on both targets', () => {
    expect(ts('/a\\sb/')).toBe('/a[ \\t\\n\\r\\f\\v]b/');
    expect(py('/a\\sb/')).toBe('__k_re.compile("a[ \\\\t\\\\n\\\\r\\\\f\\\\v]b", __k_re.ASCII)');
  });
});

describe('Slice 1 regex emission — Python-only anchor lowering ($→\\Z, ^→\\A) on non-/m', () => {
  // kills: naive_passthrough, no_anchor, raw_anchor_re_m — Python `$` (no re.M)
  // matches before a trailing `\n`; JS `/a$/` does not. `\Z` aligns Python to JS.
  // TS keeps `$` verbatim (already input-anchored in JS without /m).
  test('/a$/ → Python $→\\Z, TS keeps $', () => {
    expect(ts('/a$/')).toBe('/a$/');
    expect(py('/a$/')).toBe('__k_re.compile("a\\\\Z", __k_re.ASCII)');
  });

  // kills: raw_anchor_re_m — a naive "JS ^/$ == Python re.M" mapping makes `^b`
  // match a mid-string line start; certified `\A` (no re.M) matches input start
  // only, like JS `/^b/`. TS keeps `^` verbatim.
  test('/^b/ → Python ^→\\A, TS keeps ^', () => {
    expect(ts('/^b/')).toBe('/^b/');
    expect(py('/^b/')).toBe('__k_re.compile("\\\\Ab", __k_re.ASCII)');
  });

  // kills: naive_passthrough, no_anchor, raw_anchor_re_m — stacks the `\d` class
  // rule and the `$` anchor rule; a lowering that gets only one right still fails.
  test('/\\d+$/ → ASCII class AND $→\\Z on Python (combo)', () => {
    expect(ts('/\\d+$/')).toBe('/[0-9]+$/');
    expect(py('/\\d+$/')).toBe('__k_re.compile("[0-9]+\\\\Z", __k_re.ASCII)');
  });
});

describe('Slice 1 regex emission — anchor lowering is CLASS- and ESCAPE-AWARE (negated-class crash fix)', () => {
  // The PRE-FIX `lowerRegexAnchorsPython` did a blind
  //   pattern.replaceAll('$','\\Z').replaceAll('^','\\A')
  // which rewrote EVERY `^`/`$` — including ones inside a `[...]` class or escaped.
  // That emitted Python that CRASHES at re.compile (`re.error: bad escape`) or
  // silently corrupts an escaped literal. These rows pin the class/escape-aware
  // predicate: lower ONLY a true anchor (classDepth 0, unescaped); keep an
  // in-class or escaped `^`/`$` VERBATIM. Each asserts the EXACT Python emission,
  // so the old blind impl FAILS them (revert-check: `/[^a]/` row emits `[\Aa]`).
  // The TS side keeps `^`/`$` verbatim (JS input-anchors without /m).

  // TRUE anchors at classDepth 0 are still lowered (no regression).
  test('/^a$/ → both anchors lowered \\Aa\\Z on Python', () => {
    expect(ts('/^a$/')).toBe('/^a$/');
    expect(py('/^a$/')).toBe('__k_re.compile("\\\\Aa\\\\Z", __k_re.ASCII)');
  });

  // Anchors lowered, but the IN-CLASS `^` (negation marker) is PRESERVED.
  test('/^[^a]$/ → \\A[^a]\\Z (anchors lowered, in-class ^ kept)', () => {
    expect(ts('/^[^a]$/')).toBe('/^[^a]$/');
    expect(py('/^[^a]$/')).toBe('__k_re.compile("\\\\A[^a]\\\\Z", __k_re.ASCII)');
  });

  // A `^` mid-pattern at classDepth 0 IS an anchor — still lowered to `\A`.
  test('/a^b/ → a\\Ab (caret mid-pattern is an anchor)', () => {
    expect(ts('/a^b/')).toBe('/a^b/');
    expect(py('/a^b/')).toBe('__k_re.compile("a\\\\Ab", __k_re.ASCII)');
  });

  // CRASH FIX — negated class. Old impl emitted `[\Aa]` → re.error: bad escape \A.
  // REVERT-CHECK ROW: this fails against 48163a4c (blind replaceAll).
  test('/[^a]/ → [^a] VERBATIM (was [\\Aa] crash)', () => {
    expect(ts('/[^a]/')).toBe('/[^a]/');
    expect(py('/[^a]/')).toBe('__k_re.compile("[^a]", __k_re.ASCII)');
  });

  // CRASH FIX — literal `$` in class. Old impl emitted `[a\Z]` → re.error.
  test('/[a$]/ → [a$] VERBATIM (was [a\\Z] crash)', () => {
    expect(ts('/[a$]/')).toBe('/[a$]/');
    expect(py('/[a$]/')).toBe('__k_re.compile("[a$]", __k_re.ASCII)');
  });

  // Literal `^` (not first) in class stays a literal caret member.
  test('/[a^]/ → [a^] VERBATIM (was [a\\A] crash)', () => {
    expect(ts('/[a^]/')).toBe('/[a^]/');
    expect(py('/[a^]/')).toBe('__k_re.compile("[a^]", __k_re.ASCII)');
  });

  // Escaped caret is a literal `^`, NOT an anchor — kept as `a\^b`.
  test('/a\\^b/ → a\\^b (escaped caret kept, was a\\Ab corruption)', () => {
    expect(ts('/a\\^b/')).toBe('/a\\^b/');
    expect(py('/a\\^b/')).toBe('__k_re.compile("a\\\\^b", __k_re.ASCII)');
  });

  // Escaped dollar is a literal `$`, NOT an anchor — kept as `a\$b`.
  test('/a\\$b/ → a\\$b (escaped dollar kept, was a\\Zb corruption)', () => {
    expect(ts('/a\\$b/')).toBe('/a\\$b/');
    expect(py('/a\\$b/')).toBe('__k_re.compile("a\\\\$b", __k_re.ASCII)');
  });

  // Combo: negated class + class-normalized `\d`→[0-9], no anchor mangling.
  test('/[^a]+\\d/ → [^a]+[0-9] (negated class + shorthand, no anchor touch)', () => {
    expect(ts('/[^a]+\\d/')).toBe('/[^a]+[0-9]/');
    expect(py('/[^a]+\\d/')).toBe('__k_re.compile("[^a]+[0-9]", __k_re.ASCII)');
  });

  // Class with an ESCAPED `]` member then a TRUE trailing anchor `$`. Proves the
  // escape-aware scan closes the class at the right `]` and only the post-class
  // `$` lowers to `\Z` (the in-class `$` would stay literal if present).
  test('/[\\]a]$/ → [\\]a]\\Z (escaped-] class closes correctly, trailing $ lowers)', () => {
    expect(ts('/[\\]a]$/')).toBe('/[\\]a]$/');
    expect(py('/[\\]a]$/')).toBe('__k_re.compile("[\\\\]a]\\\\Z", __k_re.ASCII)');
  });
});

describe('Slice 1 regex emission — re.ASCII injection (load-bearing for \\b)', () => {
  // kills: naive_passthrough, no_re_ascii — without re.ASCII, Python `\b` is
  // Unicode-aware and the boundary spans `café`; JS (no /u) → no match. re.ASCII
  // makes Python treat é as a non-word char, matching JS. The literal é is kept
  // verbatim on both targets (Slice 1 does not touch literals).
  test('/\\bcafé\\b/ → re.ASCII present, literal é kept', () => {
    expect(ts('/\\bcafé\\b/')).toBe('/\\bcafé\\b/');
    expect(py('/\\bcafé\\b/')).toBe('__k_re.compile("\\\\bcafé\\\\b", __k_re.ASCII)');
  });

  // re.ASCII is appended even when other flags are present (e.g. /i).
  test('/abc/i → IGNORECASE | ASCII', () => {
    expect(ts('/abc/i')).toBe('/abc/i');
    expect(py('/abc/i')).toBe('__k_re.compile("abc", __k_re.IGNORECASE | __k_re.ASCII)');
  });
});

describe('Slice 1 regex emission — /m path PRESERVES anchors with re.M (no over-correction)', () => {
  // Control: proves the lowering does NOT apply `\A`/`\Z` on the /m path — doing
  // so would break line-based matching. On /m, `^`/`$` are kept and re.MULTILINE
  // is added (line-based, identical to JS /m). re.ASCII is still injected.
  test('/^x/m → ^ kept + MULTILINE | ASCII', () => {
    expect(ts('/^x/m')).toBe('/^x/m');
    expect(py('/^x/m')).toBe('__k_re.compile("^x", __k_re.MULTILINE | __k_re.ASCII)');
  });

  test('/x$/m → $ kept + MULTILINE | ASCII', () => {
    expect(ts('/x$/m')).toBe('/x$/m');
    expect(py('/x$/m')).toBe('__k_re.compile("x$", __k_re.MULTILINE | __k_re.ASCII)');
  });

  // /m path is wholly unchanged even with a negated class + anchors present:
  // anchors stay `^`/`$` (re.M makes them line-based) and the in-class `^` is
  // untouched — the class/escape-aware pass only runs on the non-/m branch.
  test('/^[^a]$/m → ^[^a]$ kept verbatim + MULTILINE | ASCII', () => {
    expect(ts('/^[^a]$/m')).toBe('/^[^a]$/m');
    expect(py('/^[^a]$/m')).toBe('__k_re.compile("^[^a]$", __k_re.MULTILINE | __k_re.ASCII)');
  });
});

describe('Slice 1 regex emission — no over-reach on untouched constructs', () => {
  // `.` is not touched by Slice 1 (no /s handling change); re.ASCII still added.
  test('/a.b/ → dot kept, re.ASCII added', () => {
    expect(ts('/a.b/')).toBe('/a.b/');
    expect(py('/a.b/')).toBe('__k_re.compile("a.b", __k_re.ASCII)');
  });
});

describe('Slice 1 regex emission — method paths inherit normalization', () => {
  // `.test`/`.match`/`.replace` route through pyRegexPattern/pyRegexFlags, so they
  // inherit the class normalization + anchor lowering + re.ASCII automatically.
  test('String.match(/\\w+/) inherits ASCII class + re.ASCII on Python', () => {
    const out = py('"café".match(/\\w+/)');
    expect(out).toContain('"[A-Za-z0-9_]+"');
    expect(out).toContain('__k_re.ASCII');
  });

  test('regex.test(input) inherits $→\\Z + re.ASCII on Python', () => {
    const out = py('/a$/.test("a\\n")');
    expect(out).toContain('"a\\\\Z"');
    expect(out).toContain('__k_re.ASCII');
  });

  test('String.replace(/\\d+$/, "#") inherits class + anchor + re.ASCII on Python', () => {
    const out = py('"x123\\n".replace(/\\d+$/, "#")');
    expect(out).toContain('"[0-9]+\\\\Z"');
    expect(out).toContain('__k_re.ASCII');
  });
});
