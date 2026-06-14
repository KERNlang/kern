/** Milestone C, Slice 3 — portable regex MATCH-SET method semantics, DISCRIMINATING tests.
 *
 *  Slice 1 + `/i` made the regex PATTERN byte-identical across targets. Slice 3
 *  certifies the regex METHOD RESULT/ITERATION shapes are portable: where JS
 *  `RegExp` methods and Python `re` genuinely differ in SHAPE/COUNT (not pattern),
 *  KERN lowers each native result into ONE canonical cross-target shape, and
 *  FAIL-CLOSES (symmetrically, byte-identical message both targets) the shapes
 *  that have no portable analog.
 *
 *  These assertions mirror the discriminating oracle in
 *  `.agon-goals/regex-slice3/oracle/` (slice3-fixtures.json, run via check.py).
 *  Each killer row asserts the EXACT emitted TS AND the EXACT emitted Python so it
 *  FAILS a plausibly-wrong impl. The oracle names five wrong-impls; the inline
 *  `// kills:` notes record which one(s) each row defeats:
 *    - naive_match_object  : `.match` (no /g) lowers to a bare `re.search` Match
 *                            OBJECT (TODAY's bug) instead of the canonical
 *                            `{full,groups,index,named}` array-equiv shape.
 *    - naive_match_findall : `.match` (/g) lowers to `re.findall` → TUPLES when
 *                            >1 group, instead of `finditer.group(0)` full matches.
 *    - naive_sub_all       : `.replace` (no /g) lowers WITHOUT `count=1` → replaces
 *                            ALL (the JS first-only vs `re.sub` all divergence).
 *    - naive_test_g        : `.test` (/g) lowers statelessly instead of fail-close.
 *    - naive_split_raw     : `.split` lowers a zero-width-capable pattern instead
 *                            of fail-close (empty-edge divergence).
 *
 *  Behavioral parity (emitted TS executed by node vs emitted Python by python3 →
 *  byte-identical canonical shapes) is proven by the oracle's check.py; these
 *  tests lock the EMISSION so a regression is caught without running both hosts.
 */

import { emitExpression, parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

// The TS-side `.match` (no /g) canonical adapter — asserted in full once, then
// referenced by `.toContain` shape-fragments elsewhere. Mirrors the oracle's
// `canonMatchObj` (run_js.mjs).
const TS_MATCH_ADAPTER_HEAD =
  '((__m) => __m === null ? null : { full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), index: __m.index, named: __m.groups ? { ...__m.groups } : {} })';

describe('Slice 3 — .match WITHOUT /g lowers to the canonical {full,groups,index,named} shape', () => {
  // kills: naive_match_object — Python today emits a bare `re.search` Match OBJECT
  // (m[0] raises, no .index attr); JS `.match` returns an array carrying .index +
  // .groups. The canonical helper/adapter converges both. THE load-bearing fix.
  // REVERT-CHECK: an impl that emits `__k_re.search(...)` (bare object) FAILS the
  // Python assertion; an impl that emits `s.match(/.../)` raw FAILS the TS one.
  test('s.match(/(g1)-(g2)/) → canonical adapter (TS) + _kern_regex_match helper (Python)', () => {
    expect(ts('s.match(/([0-9]+)-([0-9]+)/)')).toBe(`${TS_MATCH_ADAPTER_HEAD}(s.match(/([0-9]+)-([0-9]+)/))`);
    expect(py('s.match(/([0-9]+)-([0-9]+)/)')).toBe('_kern_regex_match("([0-9]+)-([0-9]+)", s, __k_re.ASCII)');
  });

  // The Python emission must NOT be the old bare `re.search` Match-object shape.
  test('Python .match no /g does NOT emit a bare re.search Match object (the OLD shape)', () => {
    const out = py('s.match(/([0-9]+)-([0-9]+)/)');
    expect(out).toContain('_kern_regex_match(');
    expect(out).not.toMatch(/^__k_re\.search\(/); // the pre-Slice-3 bare-object lowering
  });

  // no-match: both targets yield the JS-null. TS adapter is `null`-safe; the
  // Python helper returns None when re.search is None.
  test('s.match(/(g)/) no match → null-safe on both targets', () => {
    expect(ts('s.match(/([0-9])/)')).toBe(`${TS_MATCH_ADAPTER_HEAD}(s.match(/([0-9])/))`);
    expect(py('s.match(/([0-9])/)')).toBe('_kern_regex_match("([0-9])", s, __k_re.ASCII)');
  });
});

describe('Slice 3 — .match WITH /g lowers to full matches (finditer.group(0)), NEVER re.findall', () => {
  // kills: naive_match_findall — `re.findall` with >1 group returns TUPLES
  // [('a','1'),…]; JS `.match(/…/g)` returns FULL match strings ['a1',…]. The
  // certified lowering is `[m.group(0) for m in finditer] or None`.
  // REVERT-CHECK: an impl emitting `__k_re.findall(` FAILS this assertion.
  test('s.match(/(g1)(g2)/g) → finditer.group(0) list-or-None (Python), native array (TS)', () => {
    expect(py('s.match(/([A-Za-z0-9_])([0-9])/g)')).toBe(
      '([__k_m.group(0) for __k_m in __k_re.finditer("([A-Za-z0-9_])([0-9])", s, __k_re.ASCII)] or None)',
    );
    expect(py('s.match(/([A-Za-z0-9_])([0-9])/g)')).not.toContain('findall');
    // TS: native String.match(/…/g) already yields the full-match array | null.
    expect(ts('s.match(/([A-Za-z0-9_])([0-9])/g)')).toBe('s.match(/([A-Za-z0-9_])([0-9])/g)');
  });

  // no match with /g: JS null; the `… or None` makes the empty finditer list None.
  test('s.match(/(g)/g) no match → None (the `or None` empty-case)', () => {
    expect(py('s.match(/([0-9])/g)')).toBe(
      '([__k_m.group(0) for __k_m in __k_re.finditer("([0-9])", s, __k_re.ASCII)] or None)',
    );
  });
});

describe('Slice 3 — .matchAll (/g required) shapes finditer into [{full,groups,index}, …]', () => {
  // kills: (coverage) — the matchAll shape must carry full+groups+index per match.
  test('s.matchAll(/(g1)(g2)/g) → _kern_regex_matchall helper (Python), shaped map (TS)', () => {
    expect(py('s.matchAll(/([A-Za-z0-9_])([0-9])/g)')).toBe(
      '_kern_regex_matchall("([A-Za-z0-9_])([0-9])", s, __k_re.ASCII)',
    );
    expect(ts('s.matchAll(/([A-Za-z0-9_])([0-9])/g)')).toBe(
      '[...s.matchAll(/([A-Za-z0-9_])([0-9])/g)].map((__m) => ({ full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), index: __m.index }))',
    );
  });

  // FAIL-CLOSE: a non-global matchAll throws TypeError in JS; mirror as a
  // compile-time reject with the SAME message on both targets.
  test('s.matchAll(/x/) without /g → symmetric fail-close (both targets, identical message)', () => {
    const expected = "matchAll requires the 'g' flag (a non-global matchAll throws TypeError in JS).";
    expect(() => ts('s.matchAll(/x/)')).toThrow(expected);
    expect(() => py('s.matchAll(/x/)')).toThrow(expected);
  });
});

describe('Slice 3 — .replace count: FIRST (no /g, count=1) vs ALL (/g or replaceAll, count=0)', () => {
  // kills: naive_sub_all — JS `.replace` without /g replaces the FIRST match only;
  // `re.sub` defaults to ALL. The certified lowering injects `count=1`.
  // REVERT-CHECK: an impl emitting `count=0` (or omitting count) FAILS this.
  test('s.replace(/a/, "X") → count=1 (Python), native first-only (TS)', () => {
    expect(py('s.replace(/a/, "X")')).toBe('__k_re.sub("a", "X", s, count=1, flags=__k_re.ASCII)');
    expect(py('s.replace(/a/, "X")')).toContain('count=1');
    expect(ts('s.replace(/a/, "X")')).toBe('s.replace(/a/, "X")');
  });

  test('s.replace(/a/g, "X") → count=0 (all) on Python', () => {
    expect(py('s.replace(/a/g, "X")')).toBe('__k_re.sub("a", "X", s, count=0, flags=__k_re.ASCII)');
  });

  // .replaceAll (/g) reuses the count=0 (all) path.
  test('s.replaceAll(/a/g, "X") → count=0 (all) on Python, native on TS', () => {
    expect(py('s.replaceAll(/a/g, "X")')).toBe('__k_re.sub("a", "X", s, count=0, flags=__k_re.ASCII)');
    expect(ts('s.replaceAll(/a/g, "X")')).toBe('s.replaceAll(/a/g, "X")');
  });

  // FAIL-CLOSE: non-global replaceAll throws TypeError in JS; mirror it.
  test('s.replaceAll(/a/, "X") without /g → symmetric fail-close', () => {
    const expected = "replaceAll requires the 'g' flag (a non-global replaceAll throws TypeError in JS).";
    expect(() => ts('s.replaceAll(/a/, "X")')).toThrow(expected);
    expect(() => py('s.replaceAll(/a/, "X")')).toThrow(expected);
  });
});

describe('Slice 3 — .split: capture-group inclusion is IN-CORE (portable)', () => {
  // kills: (coverage) — captured groups interleave identically on node + python3
  // (contradicts the "split groups always diverge" lore). An impl that drops the
  // captured group would diverge; the emission must be a straight re.split.
  test('s.split(/(g)/) → re.split with the capture (Python), native (TS)', () => {
    expect(py('s.split(/([0-9])/)')).toBe('__k_re.split("([0-9])", s, flags=__k_re.ASCII)');
    expect(ts('s.split(/([0-9])/)')).toBe('s.split(/([0-9])/)');
  });

  test('s.split(/[0-9]/) (no group) → re.split (Python)', () => {
    expect(py('s.split(/[0-9]/)')).toBe('__k_re.split("[0-9]", s, flags=__k_re.ASCII)');
  });
});

describe('Slice 3 — .split FAIL-CLOSE: zero-width-capable pattern OR a limit arg', () => {
  const ZW =
    'Python target does not lower String.split with a zero-width-capable pattern: JS drops empty edge segments while re.split keeps them. Use a pattern that cannot match the empty string.';
  const LIMIT =
    'Python target does not lower String.split with a limit argument: JS truncates the result while Python maxsplit keeps the unsplit remainder.';

  // kills: naive_split_raw — a zero-width-capable pattern (`x*`) diverges on empty
  // edges (JS drops them, re.split keeps them). The SYNTACTIC predicate (red-teamed
  // against node vs python3: 0 leaks / 0 over-rejection on a 60-pattern battery)
  // fail-closes it identically on both targets.
  test('s.split(/x*/) (zero-width star) → symmetric fail-close', () => {
    expect(() => ts('s.split(/x*/)')).toThrow(ZW);
    expect(() => py('s.split(/x*/)')).toThrow(ZW);
  });

  // optional capture is also zero-width-capable → massive divergence → fail-close.
  test('s.split(/(g)?/) (optional capture) → symmetric fail-close', () => {
    expect(() => ts('s.split(/([0-9])?/)')).toThrow(ZW);
    expect(() => py('s.split(/([0-9])?/)')).toThrow(ZW);
  });

  // a limit/2nd arg: JS truncates, Python maxsplit keeps the remainder → fail-close.
  test('s.split(/,/, 2) (limit arg) → symmetric fail-close', () => {
    expect(() => ts('s.split(/,/, 2)')).toThrow(LIMIT);
    expect(() => py('s.split(/,/, 2)')).toThrow(LIMIT);
  });

  // the predicate must NOT over-reject an always-non-empty pattern that merely
  // CONTAINS a `*` (e.g. `x*a` consumes >= 1 char). It stays IN-CORE.
  test('s.split(/x*a/) (contains * but always consumes) → IN-CORE (not fail-closed)', () => {
    expect(() => py('s.split(/x*a/)')).not.toThrow();
    expect(py('s.split(/x*a/)')).toBe('__k_re.split("x*a", s, flags=__k_re.ASCII)');
  });
});

describe('Slice 3 — .test(/g) and .exec FAIL-CLOSE (stateful lastIndex has no portable analog)', () => {
  // kills: naive_test_g — `/a/g.test(s)` repeated advances+wraps lastIndex in JS
  // ([T,T,T,F]); `bool(re.search)` is stateless ([T,T,T,T]). No portable cursor →
  // fail-close with the SAME message on both targets.
  test('/a/g.test(s) → symmetric fail-close (stateful lastIndex)', () => {
    const expected =
      "Python target does not lower RegExp.test with the 'g' flag: JS mutates lastIndex across calls while re.search is stateless. Use .matchAll (global) for stateful iteration.";
    expect(() => ts('/a/g.test(s)')).toThrow(expected);
    expect(() => py('/a/g.test(s)')).toThrow(expected);
  });

  // non-global .test stays IN-CORE on both targets (no regression).
  test('/[0-9]+/.test(s) (no /g) → IN-CORE both targets', () => {
    expect(ts('/[0-9]+/.test(s)')).toBe('/[0-9]+/.test(s)');
    expect(py('/[0-9]+/.test(s)')).toBe('(__k_re.search("[0-9]+", s, __k_re.ASCII) is not None)');
  });

  // .exec drives a JS-only stateful while-loop; fail-close + redirect to .matchAll
  // (D4 — do NOT silently rewrite a loop whose body may mutate lastIndex).
  test('/a/g.exec(s) → symmetric fail-close redirecting to .matchAll', () => {
    const expected =
      'Python target does not lower RegExp.exec: it relies on JS’s stateful lastIndex, which has no portable re analog. Use .matchAll (global) for iteration.';
    expect(() => ts('/a/g.exec(s)')).toThrow(expected);
    expect(() => py('/a/g.exec(s)')).toThrow(expected);
    // the redirect names the portable alternative.
    expect(() => ts('/a/.exec(s)')).toThrow('Use .matchAll');
  });
});
