/** Milestone C, Slice 5 — astral (non-BMP) fail-close, DISCRIMINATING tests.
 *
 *  KERN's certified portable regex subset is BMP only (U+0000..U+FFFF). Any regex
 *  whose PATTERN SOURCE contains a non-BMP (astral, codepoint >= U+10000) construct
 *  fails-close with a SYMMETRIC, byte-identical diagnostic on BOTH targets — because
 *  JS `RegExp` indexes the subject by UTF-16 code UNIT while Python `re` indexes by
 *  CODEPOINT, so an astral codepoint (a surrogate PAIR in JS, 1 codepoint in Python)
 *  diverges by surrogate width on width-sensitive operators (`.`-count, `/^.$/`,
 *  `.index`/`.length`, `.split` boundaries). The boundary is EXACT `>= 0x10000`:
 *  U+FFFF (last BMP) stays IN-CORE (1 UTF-16 unit AND 1 codepoint — widths agree).
 *  The gate is /i-INDEPENDENT (a literal astral char never folds on either engine).
 *
 *  These assertions mirror the discriminating oracle in
 *  `.agon-goals/regex-slice5/oracle/check.py`. The five detection rules form a
 *  COMPLETE partition of "astral in the pattern source" (6-engine tribunal-validated:
 *  no over-reach, no missing construct):
 *    1. raw astral codepoint literal (any source codepoint >= 0x10000), in or out of `[...]`
 *    2. `\u{HHHHH}` escape whose decoded value >= 0x10000
 *    3. astral character-class RANGE `[x-y]` (either endpoint >= 0x10000) — subsumed by 1+2
 *    4. surrogate-PAIR escape `\uD800-\uDBFF` + `\uDC00-\uDFFF` (recombines to astral)
 *    5. lone surrogate escape `\uD800-\uDFFF` not forming a pair
 *
 *  CRITICAL FALSE-POSITIVE GUARD (the tribunal's highest-risk pitfall): the scanner
 *  is escape-aware, so a LITERAL backslash-u-D800 (`/\\uD800/`, pattern source
 *  `\\uD800` = escaped backslash then plain `uD800`) is NOT a lone surrogate and
 *  stays IN-CORE — a naive `String.match(/\\uD[89AB].../)` over raw text would
 *  false-positive on it.
 */

import { emitExpression, parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

// Built from char codes so the LITERAL pattern source reaches the emitter without
// TS/JSON source-escape ambiguity (a single backslash = String.fromCharCode(92)).
const BS = String.fromCharCode(92);
const EMOJI = String.fromCodePoint(0x1f600); // raw astral char U+1F600 (a surrogate pair in the source)
const LASTBMP = String.fromCodePoint(0xffff); // last BMP codepoint — IN-CORE boundary

/** Assert BOTH targets throw the SAME message matching `re`, and return that message. */
function assertSymmetricThrow(src: string, re: RegExp): void {
  expect(() => ts(src)).toThrow(re);
  expect(() => py(src)).toThrow(re);
  let tsMsg = '';
  let pyMsg = '';
  try {
    ts(src);
  } catch (e) {
    tsMsg = (e as Error).message;
  }
  try {
    py(src);
  } catch (e) {
    pyMsg = (e as Error).message;
  }
  expect(tsMsg).toBe(pyMsg); // byte-identical refusal across targets
  expect(tsMsg).not.toBe('');
}

describe('Slice 5 astral fail-close — the five rules (symmetric on both targets)', () => {
  const FAIL_1F600 = /Regex with a non-BMP \(astral\) construct \(U\+1F600\) cannot be lowered portably/;

  // Rule 1 — a RAW astral codepoint literal /😀/. The detector must compare DECODED
  // CODEPOINT values (not code units): `Array.from` splits the source surrogate pair
  // into ONE element whose codePointAt(0) === 0x1F600 >= 0x10000. (oracle: raw_astral_literal,
  // kills the escape-only wrong-impl)
  test('Rule 1: /😀/ (raw astral) → fail-close U+1F600 on both targets', () => {
    assertSymmetricThrow(`/${EMOJI}/`, FAIL_1F600);
  });

  // CODEPOINT-vs-UNIT AUDIT fixture: /a😀b/ must fail-close BECAUSE the 😀 codepoint
  // is >= 0x10000 — proving the scanner is codepoint-aware, not unit-blind (a
  // unit-blind raw-index scan would never see a codepoint >= 0x10000).
  test('Rule 1 (codepoint-audit): /a😀b/ → fail-close U+1F600 (proves codepoint-aware)', () => {
    assertSymmetricThrow(`/a${EMOJI}b/`, FAIL_1F600);
  });

  // Rule 2 — `\u{1F600}` escape decoding to >= 0x10000. (oracle: astral_escape_braced,
  // kills the raw-only wrong-impl)
  test('Rule 2: /\\u{1F600}/ → fail-close U+1F600 on both targets', () => {
    assertSymmetricThrow(`/${BS}u{1F600}/`, FAIL_1F600);
  });

  // Rule 1 inside a class — /[😀a]/. (oracle: astral_in_class, kills the top-level-only wrong-impl)
  test('Rule 1 in class: /[😀a]/ → fail-close U+1F600 on both targets', () => {
    assertSymmetricThrow(`/[${EMOJI}a]/`, FAIL_1F600);
  });

  // Rule 3 — astral character-class RANGE: either endpoint >= 0x10000 fires (subsumed
  // by rules 1+2 on the offending endpoint, regardless of range position).
  // (oracle: astral_range, kills the scan-chars-not-ranges wrong-impl)
  test('Rule 3: /[\\u{1F600}-\\u{1F64F}]/ → fail-close U+1F600 on both targets', () => {
    assertSymmetricThrow(`/[${BS}u{1F600}-${BS}u{1F64F}]/`, FAIL_1F600);
  });

  // Rule 4 — surrogate-PAIR escape 😀 recombines to U+1F600. The diagnostic
  // names the RECOMBINED astral char, not a bare surrogate. (oracle: surrogate_escape_pair —
  // THE killer: kills the codepoint-only impl that ignores \uHHHH surrogate pairs)
  test('Rule 4: /\\uD83D\\uDE00/ (surrogate pair) → fail-close U+1F600 on both targets', () => {
    assertSymmetricThrow(`/${BS}uD83D${BS}uDE00/`, FAIL_1F600);
  });

  // Rule 5 — lone (unpaired) surrogate escape \uD83D → non-portable; the diagnostic
  // names the surrogate codepoint itself (U+D83D). (oracle: lone_surrogate)
  test('Rule 5: /\\uD83D/ (lone surrogate) → fail-close U+D83D on both targets', () => {
    const FAIL_D83D = /Regex with a non-BMP \(astral\) construct \(U\+D83D\) cannot be lowered portably/;
    assertSymmetricThrow(`/${BS}uD83D/`, FAIL_D83D);
  });

  // Rule 5 (range, NOT subsumed by rule 3): a PURE surrogate range [\uD800-\uDFFF] has
  // both endpoints < 0x10000, so rule 3 does NOT fire — rule 5 catches each lone
  // surrogate escape. Documents the spec's "does NOT subsume [\uD800-\uDFFF]" note.
  test('Rule 5 (surrogate range): /[\\uD800-\\uDFFF]/ → fail-close on both targets', () => {
    const FAIL_SURR = /Regex with a non-BMP \(astral\) construct \(U\+D800\) cannot be lowered portably/;
    assertSymmetricThrow(`/[${BS}uD800-${BS}uDFFF]/`, FAIL_SURR);
  });
});

describe('Slice 5 — IN-CORE boundary (NOT fail-close): BMP stays portable', () => {
  // /￿/ U+FFFF — last BMP codepoint, EXACTLY below the >= 0x10000 boundary. Kills an
  // off-by-one impl that fail-closes >= 0xFFFF. (oracle: bmp_boundary_keep)
  test('/￿/ (U+FFFF, last BMP) → IN-CORE on both targets (boundary is >= 0x10000, exact)', () => {
    expect(ts(`/${LASTBMP}/`)).toBe(`/${LASTBMP}/`);
    expect(py(`/${LASTBMP}/`)).toBe(`__k_re.compile("${LASTBMP}", __k_re.ASCII)`);
  });

  // /[￿]/ U+FFFF inside a class — still IN-CORE.
  test('/[￿]/ (U+FFFF in class) → IN-CORE on both targets', () => {
    expect(ts(`/[${LASTBMP}]/`)).toBe(`/[${LASTBMP}]/`);
    expect(py(`/[${LASTBMP}]/`)).toBe(`__k_re.compile("[${LASTBMP}]", __k_re.ASCII)`);
  });

  // /￿/ BMP ESCAPE — last BMP via escape, still IN-CORE (no astral construct).
  test('/\\uFFFF/ (BMP escape) → IN-CORE on both targets', () => {
    expect(ts(`/${BS}uFFFF/`)).toBe(`/${BS}uFFFF/`);
    expect(py(`/${BS}uFFFF/`)).toBe(`__k_re.compile("${BS}${BS}uFFFF", __k_re.ASCII)`);
  });

  // /^.$/ — a BMP-only pattern. The astral-INPUT divergence of `.` is a documented
  // RUNTIME limitation (see the witness-probe test below), NOT a compile-time gate.
  // Kills an over-eager impl that fail-closes all `.`. (oracle: bmp_dot_keep)
  test('/^.$/ → IN-CORE on both targets (BMP pattern; astral-input divergence not gated here)', () => {
    expect(ts('/^.$/')).toBe('/^.$/');
    expect(py('/^.$/')).toBe('__k_re.compile("\\\\A.\\\\Z", __k_re.ASCII)');
  });

  // CRITICAL FALSE-POSITIVE GUARD — /\\uD800/ is a LITERAL backslash (escaped, source
  // `\\uD800`) followed by plain `uD800` text, NOT a lone surrogate escape. The
  // escape-aware scanner consumes the `\\` pair and never decodes a surrogate, so this
  // stays IN-CORE. A naive raw-text surrogate match would false-positive here.
  test('/\\\\uD800/ (literal backslash, NOT a surrogate escape) → IN-CORE on both targets', () => {
    const src = `/${BS}${BS}uD800/`;
    expect(() => ts(src)).not.toThrow();
    expect(() => py(src)).not.toThrow();
  });
});

describe('Slice 5 — /i-independence (astral fires regardless of flags)', () => {
  const FAIL_1F600 = /Regex with a non-BMP \(astral\) construct \(U\+1F600\) cannot be lowered portably/;
  // The astral gate is a surrogate-width concern, not a fold concern: it must fire
  // with AND without /i. (A literal astral char never case-folds on either engine.)
  test('/😀/i → fail-close (astral fires under /i too)', () => {
    assertSymmetricThrow(`/${EMOJI}/i`, FAIL_1F600);
  });
  test('/😀/ (no flags) and /😀/gimsu both fail-close identically', () => {
    assertSymmetricThrow(`/${EMOJI}/`, FAIL_1F600);
    // g/i/m/s flags do not change the astral decision (the scan is pre-flag).
    assertSymmetricThrow(`/${EMOJI}/gims`, FAIL_1F600);
  });
});

describe('Slice 5 — OUT-OF-SCOPE runtime limitation (documented, NOT gated)', () => {
  // A BMP-only pattern run against ASTRAL INPUT still diverges by surrogate width at
  // RUNTIME — KERN cannot see runtime input at compile time, so this is NOT a Slice-5
  // compile fail-close (it is a documented "host-defined for astral input; portable
  // subset is BMP input" limitation, future Slice 5b). This witness-probe ASSERTS the
  // known divergence so the limitation is recorded in the suite, not silently lost.
  //
  // `.`-count over "a😀b": JS counts 4 (UTF-16 code units) vs Python 3 (codepoints);
  // `/^.$/` over "😀":     JS false (2 units) vs Python true (1 codepoint).
  test('witness: BMP /./ over astral input diverges by surrogate width (node UTF-16-unit semantics)', () => {
    const astralInput = `a${EMOJI}b`;
    // node v22 RegExp (no /u) counts by UTF-16 code unit: a, hi-surrogate, lo-surrogate, b = 4.
    const jsDotCount = astralInput.match(/./g)?.length ?? 0;
    expect(jsDotCount).toBe(4); // documents the UNIT semantics (Python re would give 3 codepoints)

    // /^.$/ over a lone astral char: JS `.` (no /u) matches ONE UTF-16 unit, so the
    // 2-unit "😀" is NOT a single-dot match → false. (Python `re.fullmatch('.', '😀')` is True.)
    const jsAnchored = /^.$/.test(EMOJI);
    expect(jsAnchored).toBe(false); // documents the divergence: Python would be True

    // The PATTERNS themselves (/./, /^.$/) are BMP-only → Slice 5 leaves them IN-CORE.
    expect(ts('/./')).toBe('/./');
    expect(ts('/^.$/')).toBe('/^.$/');
  });
});
