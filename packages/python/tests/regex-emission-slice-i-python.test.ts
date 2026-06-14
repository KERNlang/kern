/** Milestone C, Slice-/i — portable case-insensitive regex emission, DISCRIMINATING tests.
 *
 *  Slice-/i closes the non-ASCII `/i` gap Slice 1 left: a non-ASCII Set(A) letter
 *  under `/i` (e.g. `/é/i`) was emitted raw, which on Python (`re.IGNORECASE |
 *  re.ASCII`, Slice 1) MISSES its fold partner `É` while node `/é/i` matches it.
 *  This slice rewrites each Set(A) letter into an EXPLICIT fold-class (`é` →
 *  `[Éé]`) on BOTH targets so the match is pure codepoint membership — byte
 *  identical regardless of the host Unicode version — and FAIL-CLOSES the Set(B)
 *  length-changing residue (ß, ligatures, titlecase) identically on both targets.
 *
 *  These assertions mirror the discriminating oracle in
 *  `.agon-goals/regex-slice-i/oracle/` (slice-i-fixtures.json, run via check.py).
 *  Each killer row asserts the EXACT emitted TS literal AND the EXACT emitted
 *  Python `re.compile(...)`, so it FAILS a plausibly-wrong impl. The class member
 *  order is the table's deterministic CODEPOINT-ASCENDING order (`[Éé]`, `[µΜμ]`,
 *  `[Σςσ]`) — member order inside a `[...]` class is match-irrelevant (the oracle
 *  proves parity for any order), so the spec's illustrative `[éÉ]`/`[µμΜ]`/`[σςΣ]`
 *  and these are behaviorally identical; we assert the frozen-table order to lock
 *  the emitter against accidental member/order drift.
 *
 *  The oracle names eight wrong-impls; the inline `// kills:` notes record which
 *  this row defeats:
 *    - ascii_only_slice1    : raw non-ASCII letter + re.IGNORECASE|re.ASCII
 *                             (Slice-1 behavior) — misses the fold on Python
 *    - raw_keep_i           : raw letter + re.IGNORECASE WITHOUT re.ASCII
 *                             (re-introduces host-fold-DB version divergence)
 *    - single_pair_only     : expand only the simple-case pair, dropping a
 *                             cross-block 3rd member (µ~μ~Μ, σ~ς~Σ)
 *    - drop_i_break_ascii   : expand é but DROP /i — the ASCII letters stop folding
 *    - overfold_strip_accent: NFD-strip é→e — over-matches bare 'e'
 *    - silent_keep_i        : on Set(B) emit raw letter + /i (no fail-close)
 *    - expand_lengthchanging: try to class-expand a Set(B) letter (cannot)
 *    - overfold_host_i      : keep raw letter + host /i instead of a class
 */

import { emitExpression, parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

describe('Slice-/i regex emission — non-ASCII Set(A) class-expansion under /i (both targets)', () => {
  // kills: ascii_only_slice1, raw_keep_i, overfold_host_i — raw `é` + re.ASCII
  // MISSES 'É' on Python; raw `é` + re.IGNORECASE (no ASCII) matches but
  // re-introduces the node-U16/py-U15 fold-DB divergence. The explicit class
  // `[Éé]` matches by membership on both. (oracle: kill_eacute_ascii_insufficient)
  test('/é/i → explicit fold class [Éé], /i kept, re.ASCII kept', () => {
    expect(ts('/é/i')).toBe('/[Éé]/i');
    expect(py('/é/i')).toBe('__k_re.compile("[Éé]", __k_re.IGNORECASE | __k_re.ASCII)');
  });

  // kills: single_pair_only — the micro sign µ (U+00B5) folds across blocks to
  // greek small mu μ (U+03BC) AND greek capital mu Μ (U+039C): a size-3 class.
  // An impl that only emits the simple-case pair drops the cross-block 3rd member.
  // (oracle: kill_micro_to_greek / kill_micro_to_smallmu)
  test('/µ/i → size-3 cross-block fold class [µΜμ]', () => {
    expect(ts('/µ/i')).toBe('/[µΜμ]/i');
    expect(py('/µ/i')).toBe('__k_re.compile("[µΜμ]", __k_re.IGNORECASE | __k_re.ASCII)');
  });

  // kills: single_pair_only — small sigma σ ~ FINAL sigma ς ~ capital Σ (size-3);
  // the simple-case pair omits the final-sigma member. (oracle: kill_sigma_final)
  test('/σ/i → size-3 sigma fold class [Σςσ]', () => {
    expect(ts('/σ/i')).toBe('/[Σςσ]/i');
    expect(py('/σ/i')).toBe('__k_re.compile("[Σςσ]", __k_re.IGNORECASE | __k_re.ASCII)');
  });

  // kills: ascii_only_slice1, drop_i_break_ascii — MIXED ASCII+non-ASCII: the
  // ASCII 'a' must keep folding (so /i is KEPT) AND é is class-expanded. Dropping
  // /i after expansion would stop 'a' folding to 'A'. (oracle: kill_mixed_*)
  test('/aé/i → a[Éé] with /i and re.IGNORECASE|re.ASCII kept (KEEP-i)', () => {
    expect(ts('/aé/i')).toBe('/a[Éé]/i');
    expect(py('/aé/i')).toBe('__k_re.compile("a[Éé]", __k_re.IGNORECASE | __k_re.ASCII)');
  });

  // §2.4 — a Set(A) letter ALREADY inside a `[...]` class expands to its BARE
  // members (no brackets): `[xé]` → `[xÉé]`, NOT the invalid nested `[x[Éé]]`.
  // kills: ascii_only_slice1 (would leave raw é, missing É on Python).
  test('/[xé]/i → [xÉé] (bare members merged into the existing class, no nesting)', () => {
    expect(ts('/[xé]/i')).toBe('/[xÉé]/i');
    expect(py('/[xé]/i')).toBe('__k_re.compile("[xÉé]", __k_re.IGNORECASE | __k_re.ASCII)');
  });
});

describe('Slice-/i regex emission — Set(B) length-changing fail-close (identical on both targets)', () => {
  const FAIL_SS = /Regex \/i over 'ß' \(U\+00DF\) cannot be lowered portably/;

  // kills: silent_keep_i, expand_lengthchanging — ß (U+00DF) folds length-changing
  // (ß→SS) with no single-codepoint partner, so it cannot be a class. KERN
  // refuses rather than silently drop the ß~ss fold. The message is byte-identical
  // on both targets. (oracle: kill_eszett_failclose_ss / _capital)
  test('/ß/i → fail-close throw with identical message on TS and Python', () => {
    expect(() => ts('/ß/i')).toThrow(FAIL_SS);
    expect(() => py('/ß/i')).toThrow(FAIL_SS);
    // identical message text on both targets
    let tsMsg = '';
    let pyMsg = '';
    try {
      ts('/ß/i');
    } catch (e) {
      tsMsg = (e as Error).message;
    }
    try {
      py('/ß/i');
    } catch (e) {
      pyMsg = (e as Error).message;
    }
    expect(tsMsg).toBe(pyMsg);
    expect(tsMsg).not.toBe('');
  });

  // A Set(B) letter mid-word fail-closes the WHOLE pattern (not just that letter).
  test('/straße/i → fail-close on both targets (Set(B) letter anywhere)', () => {
    expect(() => ts('/straße/i')).toThrow(FAIL_SS);
    expect(() => py('/straße/i')).toThrow(FAIL_SS);
  });
});

describe('Slice-/i regex emission — HARDENING fail-closes (non-ASCII backref + range endpoint)', () => {
  // HOLE 1 — non-ASCII backreference under /i. JS /(é)\1/i case-folds the
  // backreference's referent, so it matches "Éé"; but the emitted explicit-class
  // form `([Éé])\1` under re.ASCII does NOT fold the \1 referent → MISS on Python.
  // This SILENTLY DIVERGES, so the portable contract requires a fail-close. The
  // predicate is conservative+lexical: any backref token + any non-ASCII Set(A)
  // letter under /i. The message is byte-identical on TS and Python.
  const FAIL_BACKREF =
    /Regex \/i with a backreference and a non-ASCII letter \('é' U\+00E9\) cannot be lowered portably/;
  test('/(é)\\1/i → fail-close with identical message on TS and Python', () => {
    expect(() => ts('/(é)\\1/i')).toThrow(FAIL_BACKREF);
    expect(() => py('/(é)\\1/i')).toThrow(FAIL_BACKREF);
    let tsMsg = '';
    let pyMsg = '';
    try {
      ts('/(é)\\1/i');
    } catch (e) {
      tsMsg = (e as Error).message;
    }
    try {
      py('/(é)\\1/i');
    } catch (e) {
      pyMsg = (e as Error).message;
    }
    expect(tsMsg).toBe(pyMsg);
    expect(tsMsg).not.toBe('');
  });

  // A named backreference (\k<name>) with a non-ASCII Set(A) letter fail-closes too.
  test('/(?<g>é)\\k<g>/i → fail-close on both targets (named backref form)', () => {
    expect(() => ts('/(?<g>é)\\k<g>/i')).toThrow(FAIL_BACKREF);
    expect(() => py('/(?<g>é)\\k<g>/i')).toThrow(FAIL_BACKREF);
  });

  // POSITIVE CONTROL (HOLE 1): an ASCII backreference must STILL emit + work — the
  // backref fail-close fires ONLY when a non-ASCII Set(A) letter is also present.
  // /(a)\1/i matches "aA" on both engines (ASCII /i folds the referent natively).
  test('/(a)\\1/i → ASCII backref still emits (no fail-close)', () => {
    expect(ts('/(a)\\1/i')).toBe('/(a)\\1/i');
    expect(py('/(a)\\1/i')).toBe('__k_re.compile("(a)\\\\1", __k_re.IGNORECASE | __k_re.ASCII)');
  });

  // POSITIVE CONTROL (HOLE 1): a backref with NO non-ASCII Set(A) letter is fine.
  test('/(ab)\\1/i → backref over an ASCII group still emits (no fail-close)', () => {
    expect(ts('/(ab)\\1/i')).toBe('/(ab)\\1/i');
    expect(py('/(ab)\\1/i')).toBe('__k_re.compile("(ab)\\\\1", __k_re.IGNORECASE | __k_re.ASCII)');
  });

  // HOLE 2 — Set(A) letter as a [...] RANGE ENDPOINT under /i. /[a-é]/i would expand
  // to [a-Éé], silently changing the range a-é (U+0061..U+00E9) to a-É
  // (U+0061..U+00C9) + literal é, dropping U+00CA..U+00E8 → divergence vs JS. KERN
  // fail-closes instead of corrupting the range. Identical message on both targets.
  const FAIL_RANGE =
    /Regex \/i with the non-ASCII letter 'é' \(U\+00E9\) as a character-class range endpoint cannot be lowered portably/;
  test('/[a-é]/i → fail-close (range endpoint) with identical message on TS and Python', () => {
    expect(() => ts('/[a-é]/i')).toThrow(FAIL_RANGE);
    expect(() => py('/[a-é]/i')).toThrow(FAIL_RANGE);
    let tsMsg = '';
    let pyMsg = '';
    try {
      ts('/[a-é]/i');
    } catch (e) {
      tsMsg = (e as Error).message;
    }
    try {
      py('/[a-é]/i');
    } catch (e) {
      pyMsg = (e as Error).message;
    }
    expect(tsMsg).toBe(pyMsg);
    expect(tsMsg).not.toBe('');
  });

  // /[é-z]/i is a JS syntax error at runtime (range out of order), but our LEXICAL
  // endpoint check fires at EMIT time on the other endpoint orientation (é-X) — it
  // must fail-close cleanly, not crash. (Guards the é-X branch + no-crash.)
  test('/[é-z]/i → fail-close (range endpoint, low-side) without crashing', () => {
    expect(() => ts('/[é-z]/i')).toThrow(FAIL_RANGE);
    expect(() => py('/[é-z]/i')).toThrow(FAIL_RANGE);
  });

  // POSITIVE CONTROL (HOLE 2): a Set(A) letter that is a plain class MEMBER (not a
  // range endpoint) must STILL expand — /[xé]/i → [xÉé] is NOT a regression.
  test('/[xé]/i → plain-member expansion still works (not a range endpoint)', () => {
    expect(ts('/[xé]/i')).toBe('/[xÉé]/i');
    expect(py('/[xé]/i')).toBe('__k_re.compile("[xÉé]", __k_re.IGNORECASE | __k_re.ASCII)');
  });
});

describe('Slice-/i regex emission — Slice-1 regressions / scope boundaries (untouched)', () => {
  // Pure-ASCII /i is Slice-1 territory and must NOT be touched (no fail-close, no
  // class rewrite). (oracle: ctrl_ascii_i_unchanged)
  test('/abc/i → unchanged (ASCII /i handled by re.IGNORECASE|re.ASCII)', () => {
    expect(ts('/abc/i')).toBe('/abc/i');
    expect(py('/abc/i')).toBe('__k_re.compile("abc", __k_re.IGNORECASE | __k_re.ASCII)');
  });

  // ASCII char class under /i still folds and is untouched. (ctrl_ascii_class_with_i)
  test('/[a-c]/i → unchanged ASCII class', () => {
    expect(ts('/[a-c]/i')).toBe('/[a-c]/i');
    expect(py('/[a-c]/i')).toBe('__k_re.compile("[a-c]", __k_re.IGNORECASE | __k_re.ASCII)');
  });

  // WITHOUT /i, a non-ASCII letter is a no-op (no fold requested → no expansion).
  test('/é/ (no /i) → é unchanged, no class expansion', () => {
    expect(ts('/é/')).toBe('/é/');
    expect(py('/é/')).toBe('__k_re.compile("é", __k_re.ASCII)');
  });
});
