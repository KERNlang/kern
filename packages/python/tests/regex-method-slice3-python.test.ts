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

import type { IRNode } from '@kernlang/core';
import { emitExpression, emitNativeKernBodyTS, parseExpression } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports, emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

// Body-level emitters (Slice-3b FIX 3 — let-bound regex parity). The expression
// emitters above have no binding table; a `let re = /…/; s.match(re)` only
// exercises the regex-binding resolution at the BODY level.
function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: {}, children } as IRNode;
}
const tsBody = (children: IRNode[]): string => emitNativeKernBodyTS(makeHandler(children));
const pyBody = (children: IRNode[]): string => emitNativeKernBodyPythonWithImports(makeHandler(children)).code;

// The TS-side `.match` (no /g) canonical adapter — asserted in full once, then
// referenced by `.toContain` shape-fragments elsewhere. Mirrors the oracle's
// `canonMatchObj` (run_js.mjs). Slice-3b FIX 2: the `named` map normalizes each
// value `undefined -> null` (an unmatched optional named group is `undefined` on
// the native RegExpMatchArray.groups but `None` on Python's groupdict()), so the
// canonical `named` shape is byte/shape-identical across targets.
const TS_MATCH_ADAPTER_HEAD =
  '((__m) => __m === null ? null : { full: __m[0], groups: Array.from(__m).slice(1).map((g) => g === undefined ? null : g), index: __m.index, named: __m.groups ? Object.fromEntries(Object.entries(__m.groups).map(([__k, __v]) => [__k, __v === undefined ? null : __v])) : {} })';

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

const ZW_SPLIT =
  'Python target does not lower String.split with a zero-width-capable pattern: JS drops empty edge segments while re.split keeps them. Use a pattern that cannot match the empty string.';

describe('Slice 3b FIX 1 — escape-robust zero-width predicate (.split fail-close)', () => {
  // A backref to a NULLABLE group matches EMPTY (`/(a?)\1/` is zero-width-capable)
  // → node `str.split` keeps non-empty edges, `re.split` keeps empty ones → DIVERGE.
  // The escape-robust predicate fail-closes on ANY backref (conservative).
  // REVERT-CHECK vs 7bd5b2dc: the OLD predicate treated `\1` as a 1-char
  // consuming atom and let `/(a?)\1/.split` go IN-CORE (silent divergence).
  test('s.split(/(a?)\\1/) (nullable backref) → symmetric fail-close', () => {
    expect(() => ts('s.split(/(a?)\\1/)')).toThrow(ZW_SPLIT);
    expect(() => py('s.split(/(a?)\\1/)')).toThrow(ZW_SPLIT);
  });

  // A MULTI-CHAR escape is ONE atom: `\x41*` is `(\x41)*`, zero-width-capable.
  // The OLD scanner read `\x` as the atom then `41` as literals, so `*` attached
  // to `1` (`1*`, nullable) BEHIND a non-null prefix → the concat read non-null
  // → `/\x41*/.split` LEAKED in-core. The escape-robust scanner consumes the
  // whole `\x41` so `*` attaches correctly → zero-width → fail-close.
  test('s.split(/\\x41*/) (\\xHH escape + *) → symmetric fail-close (was a LEAK)', () => {
    expect(() => ts('s.split(/\\x41*/)')).toThrow(ZW_SPLIT);
    expect(() => py('s.split(/\\x41*/)')).toThrow(ZW_SPLIT);
  });

  // Same for the 4-hex `\uHHHH` form.
  test('s.split(/\\u0041*/) (\\uHHHH escape + *) → symmetric fail-close (was a LEAK)', () => {
    expect(() => ts('s.split(/\\u0041*/)')).toThrow(ZW_SPLIT);
    expect(() => py('s.split(/\\u0041*/)')).toThrow(ZW_SPLIT);
  });

  // `\cX` control + octal `\0` escapes are multi-char atoms too; `*` makes them
  // zero-width-capable (and python `re` rejects `\c` outright) → fail-close.
  test('s.split(/\\cA*/) and s.split(/\\0*/) → symmetric fail-close', () => {
    expect(() => ts('s.split(/\\cA*/)')).toThrow(ZW_SPLIT);
    expect(() => py('s.split(/\\cA*/)')).toThrow(ZW_SPLIT);
    expect(() => ts('s.split(/\\0*/)')).toThrow(ZW_SPLIT);
    expect(() => py('s.split(/\\0*/)')).toThrow(ZW_SPLIT);
  });

  // REGRESSION: a multi-char escape WITHOUT a zero-rep quantifier still consumes
  // >= 1 char → IN-CORE. `\x41a` (escape then literal) and `\d+` stay portable.
  test('s.split(/\\x41a/) and s.split(/\\d+/) (non-nullable escapes) → IN-CORE', () => {
    expect(py('s.split(/\\x41a/)')).toBe('__k_re.split("\\\\x41a", s, flags=__k_re.ASCII)');
    expect(ts('s.split(/\\x41a/)')).toBe('s.split(/\\x41a/)');
    expect(() => py('s.split(/\\d+/)')).not.toThrow();
  });
});

describe('Slice 3b FIX 2 — .match named-group `undefined -> null` normalization', () => {
  // An UNMATCHED optional named group is `undefined` on `m.groups` (TS) but
  // `None` (KERN null) on Python's groupdict(). The TS adapter normalizes each
  // named value `undefined -> null` so the canonical `named` map is shape-
  // identical across targets. Behavioral proof: running the emitted TS adapter
  // for `/(?<a>x)(?<b>y)?/` on "x" yields `named:{a:"x", b:null}`.
  // REVERT-CHECK vs 7bd5b2dc: the OLD adapter copied `{ ...__m.groups }` verbatim
  // → `b` stayed `undefined` while Python had `None` (a silent shape divergence).
  test('TS adapter normalizes named values (no raw spread of m.groups)', () => {
    const out = ts('s.match(/(?<a>x)(?<b>y)?/)');
    expect(out).toContain('Object.fromEntries(Object.entries(__m.groups)');
    expect(out).toContain('__v === undefined ? null : __v');
    expect(out).not.toContain('{ ...__m.groups }'); // the old verbatim-copy shape
  });

  test('emitted TS adapter run on "x" yields named:{a:"x", b:null}', () => {
    const emitted = ts('s.match(/(?<a>x)(?<b>y)?/)');
    // Run the EXACT emitted adapter with `s = "x"` as a function param (avoids a
    // bare `eval`); evaluating the emitted string IS the behavioral parity column.
    const run = new Function('s', `return ${emitted};`) as (s: string) => { named: Record<string, string | null> };
    const result = run('x');
    expect(result.named).toEqual({ a: 'x', b: null });
    expect(result.named.b).toBeNull();
  });
});

describe('Slice 3c — let-bound regex method DETECT-and-fail-close (drop the fragile resolve-to-literal)', () => {
  // BODY-level CONTRACT (Slice-3c, replaces the Slice-3b "resolve-to-literal" FIX 3):
  // a regex method on a variable KNOWN to hold a regex (`let re = /…/; s.match(re)`)
  // is NOT portable, so BOTH targets DETECT the case (via the shared
  // `regexMethodRegexArgIdent` shape detector + each target's binding table) and
  // throw the SAME `REGEX_NONLITERAL_FAILCLOSE` — symmetric, no substitution, no
  // stale-literal emission. A DIRECT literal still lowers canonically; a
  // string-/unknown-bound ident stays a PLAIN host method (NOT fail-closed).
  // WHY the change: the old resolve-to-literal substitution emitted a STALE pattern
  // after a reassignment (`let re=/a/; re=/b/; s.match(re)` wrongly lowered `/a/`)
  // and risked fail-closing common string methods.
  const NONLIT =
    'Portable regex methods (.match/.matchAll/.replace/.replaceAll/.split/.test/.exec) require a DIRECT regex literal (`/…/`) in the regex position; a variable bound to a regex is not portable across targets — inline the literal at the call site.';

  // kills: naive_bound_resolve — an impl that RESOLVES the let-bound ident to its
  // literal (the old FIX 3) and lowers canonically instead of fail-closing.
  test('let re = /(g1)-(g2)/; s.match(re) → symmetric fail-close (both targets)', () => {
    const children = [
      { type: 'let', props: { name: 're', kind: 'const', value: '/([0-9]+)-([0-9]+)/' } } as IRNode,
      { type: 'do', props: { value: 's.match(re)' } } as IRNode,
    ];
    expect(() => tsBody(children)).toThrow(NONLIT);
    expect(() => pyBody(children)).toThrow(NONLIT);
  });

  // A DIRECT regex literal in the same body still lowers canonically (unchanged).
  test('s.match(/(g1)-(g2)/) direct literal → canonical lowering, NOT fail-close (both targets)', () => {
    const tsOut = tsBody([{ type: 'do', props: { value: 's.match(/([0-9]+)-([0-9]+)/)' } } as IRNode]);
    expect(tsOut).toContain(ts('s.match(/([0-9]+)-([0-9]+)/)'));
    const pyOut = pyBody([{ type: 'do', props: { value: 's.match(/([0-9]+)-([0-9]+)/)' } } as IRNode]);
    expect(pyOut).toContain('_kern_regex_match("([0-9]+)-([0-9]+)", s, __k_re.ASCII)');
  });

  // THE REGRESSION the prior agent caught: a STRING/UNKNOWN-bound ident in the
  // regex position is NOT a regex method — it stays a PLAIN host method on BOTH
  // targets. `let needle = getX(); s.match(needle)` must NOT fail-close and must
  // NOT be canonical-lowered.
  test('let needle = getX(); s.match(needle) (unknown binding) → stays PLAIN s.match(needle) (both targets)', () => {
    const children = [
      { type: 'let', props: { name: 'needle', kind: 'const', value: 'getX()' } } as IRNode,
      { type: 'do', props: { value: 's.match(needle)' } } as IRNode,
    ];
    // No throw on either target.
    const tsOut = tsBody(children);
    const pyOut = pyBody(children);
    // Plain host method, ident passed through verbatim — NOT the canonical adapter.
    expect(tsOut).toContain('s.match(needle);');
    expect(tsOut).not.toContain('__m');
    expect(pyOut).toContain('s.match(needle)');
    expect(pyOut).not.toContain('_kern_regex_match');
  });

  // A STRING-literal-bound ident is likewise a plain string method (not regex).
  test('let needle = "ab"; s.match(needle) (string binding) → stays PLAIN (both targets)', () => {
    const children = [
      { type: 'let', props: { name: 'needle', kind: 'const', value: '"ab"' } } as IRNode,
      { type: 'do', props: { value: 's.match(needle)' } } as IRNode,
    ];
    expect(tsBody(children)).toContain('s.match(needle);');
    expect(pyBody(children)).toContain('s.match(needle)');
    expect(pyBody(children)).not.toContain('_kern_regex_match');
  });

  // REASSIGN-INVALIDATION: `let re=/a/; re=/b/; s.match(re)` keeps `re` a regex
  // binding (reassigned to another literal), so it STILL fail-closes — and never
  // emits the stale `/a/` literal the old resolve-to-literal approach would have.
  test('let re=/a/; re=/b/; s.match(re) → STILL fail-close, no stale literal (both targets)', () => {
    const children = [
      { type: 'let', props: { name: 're', kind: 'let', value: '/a/' } } as IRNode,
      { type: 'assign', props: { target: 're', value: '/b/' } } as IRNode,
      { type: 'do', props: { value: 's.match(re)' } } as IRNode,
    ];
    expect(() => tsBody(children)).toThrow(NONLIT);
    expect(() => pyBody(children)).toThrow(NONLIT);
  });

  // REASSIGN to a NON-regex UNMARKS the binding: `let re=/a/; re=getX(); s.match(re)`
  // is no longer a known regex → stays a PLAIN host method (no fail-close, no stale).
  test('let re=/a/; re=getX(); s.match(re) → reassign to non-regex UNMARKS → stays PLAIN (both targets)', () => {
    const children = [
      { type: 'let', props: { name: 're', kind: 'let', value: '/a/' } } as IRNode,
      { type: 'assign', props: { target: 're', value: 'getX()' } } as IRNode,
      { type: 'do', props: { value: 's.match(re)' } } as IRNode,
    ];
    expect(tsBody(children)).toContain('s.match(re);');
    expect(pyBody(children)).toContain('s.match(re)');
    expect(pyBody(children)).not.toContain('_kern_regex_match');
  });

  // Receiver-positioned regex method on a bound regex ident also fail-closes.
  test('let rg = /a/; rg.test(s) → symmetric fail-close (both targets)', () => {
    const children = [
      { type: 'let', props: { name: 'rg', kind: 'const', value: '/a/' } } as IRNode,
      { type: 'do', props: { value: 'rg.test(s)' } } as IRNode,
    ];
    expect(() => tsBody(children)).toThrow(NONLIT);
    expect(() => pyBody(children)).toThrow(NONLIT);
  });

  // Nested-position fail-close: a regex method on a bound regex ident nested inside
  // a larger expression is still detected (the recursive walk reaches it).
  test('let re = /a/; let m = f(s.match(re)) → fail-close (nested, both targets)', () => {
    const children = [
      { type: 'let', props: { name: 're', kind: 'const', value: '/a/' } } as IRNode,
      { type: 'let', props: { name: 'm', kind: 'const', value: 'f(s.match(re))' } } as IRNode,
    ];
    expect(() => tsBody(children)).toThrow(NONLIT);
    expect(() => pyBody(children)).toThrow(NONLIT);
  });

  // Slice-3d (TS/Python PARITY): a bound-regex method INSIDE a block-bodied arrow
  // (`x => { return s.match(re); }`) must fail-close on BOTH targets. Python
  // re-parses every block-closure expression through the full expression path
  // (`emitPyExprCtx(parseExpr(raw), ctx)` → `lowerRegexCallPython`) and already
  // fail-closed it; TS re-emits the raw block verbatim, so it USED to slip
  // through and emit `s.match(re)` RAW — a silent cross-target divergence. The TS
  // walk now descends into `bodyBlock` via the shared `parseClosureBlockAst`
  // closure-AST path and applies the SAME detector, so both fail-close.
  // REVERT-CHECK vs 149f9638: without the block descent, `tsBody` returns OK (raw
  // `s.match(re)`) while `pyBody` throws — the divergence this row guards.
  test('let re = /a/; arr.map(x => { return s.match(re); }) → fail-close inside BLOCK body (both targets)', () => {
    const children = [
      { type: 'let', props: { name: 're', kind: 'const', value: '/([0-9]+)/' } } as IRNode,
      { type: 'do', props: { value: 'arr.map(x => { return s.match(re); })' } } as IRNode,
    ];
    expect(() => tsBody(children)).toThrow(NONLIT);
    expect(() => pyBody(children)).toThrow(NONLIT);
  });

  // The STRING-bound counterpart inside the SAME block shape stays a PLAIN host
  // method on BOTH targets — the block descent must NOT over-reject a non-regex
  // ident in the regex position (the `s.match(strVar)` common case).
  test('let strVar = "ab"; arr.map(x => { return s.match(strVar); }) → stays PLAIN inside block (both targets)', () => {
    const children = [
      { type: 'let', props: { name: 'strVar', kind: 'const', value: '"ab"' } } as IRNode,
      { type: 'do', props: { value: 'arr.map(x => { return s.match(strVar); })' } } as IRNode,
    ];
    const tsOut = tsBody(children);
    const pyOut = pyBody(children);
    expect(tsOut).toContain('s.match(strVar)');
    expect(tsOut).not.toContain('__m'); // not the canonical regex adapter
    expect(pyOut).toContain('s.match(strVar)');
    expect(pyOut).not.toContain('_kern_regex_match'); // not the regex helper
  });

  // A DIRECT regex literal inside the block still lowers canonically on both
  // targets (the block descent only fail-closes BOUND-ident regex positions).
  test('let re = /a/; arr.map(x => { return s.match(/lit/); }) → canonical inside block, NOT fail-close (both)', () => {
    const children = [
      { type: 'let', props: { name: 're', kind: 'const', value: '/([0-9]+)/' } } as IRNode,
      { type: 'do', props: { value: 'arr.map(x => { return s.match(/lit/); })' } } as IRNode,
    ];
    expect(() => tsBody(children)).not.toThrow();
    const pyOut = pyBody(children);
    expect(pyOut).toContain('_kern_regex_match("lit"');
  });

  // exec FAILS-CLOSE at ANY arity: unlike `test` (whose portable Python analog
  // `re.search` takes exactly one arg, so `test` arity-guards to its canonical
  // 1-arg shape), `exec` has NO portable analog — `re.Pattern` in Python has no
  // `.exec` method at all. A non-canonical 2-arg `rg.exec(s, 5)` is silently
  // ignored by JS (TS runs fine) but would CRASH Python at runtime if left a
  // plain host call (`AttributeError: 're.Pattern' object has no attribute
  // 'exec'`). So the shared `regexMethodRegexArgIdent` detector fires for `exec`
  // regardless of `call.args.length` — Slice-3 redirects every `.exec` to the
  // portable `.matchAll`. A bound-regex `rg.exec(s)`, `rg.exec(s, 5)`, and
  // `rg.exec()` ALL fail-close symmetrically on both targets.
  // REGRESSION-GUARD: the prior `exec` arity guard (`property === 'exec' &&
  // call.args.length !== 1` returning null) let the 2-arg/0-arg forms LEAK to a
  // plain host call → TS-runs/Python-crashes divergence.
  test('let rg = /a/; rg.exec(s)/rg.exec(s, 5)/rg.exec() → fail-close at ANY arity (both targets)', () => {
    const oneArg = [
      { type: 'let', props: { name: 'rg', kind: 'const', value: '/a/' } } as IRNode,
      { type: 'do', props: { value: 'rg.exec(s)' } } as IRNode,
    ];
    expect(() => tsBody(oneArg)).toThrow(NONLIT);
    expect(() => pyBody(oneArg)).toThrow(NONLIT);

    const twoArg = [
      { type: 'let', props: { name: 'rg', kind: 'const', value: '/a/' } } as IRNode,
      { type: 'do', props: { value: 'rg.exec(s, 5)' } } as IRNode,
    ];
    expect(() => tsBody(twoArg)).toThrow(NONLIT);
    expect(() => pyBody(twoArg)).toThrow(NONLIT);

    const zeroArg = [
      { type: 'let', props: { name: 'rg', kind: 'const', value: '/a/' } } as IRNode,
      { type: 'do', props: { value: 'rg.exec()' } } as IRNode,
    ];
    expect(() => tsBody(zeroArg)).toThrow(NONLIT);
    expect(() => pyBody(zeroArg)).toThrow(NONLIT);
  });
});

describe('Slice 3b FIX 4 — Math.match(/a/g) fails closed (stdlib member rejection precedes regex lowering)', () => {
  // A regex method called on a KERN-stdlib namespace is NOT a string method.
  // `applyStdlibLoweringTS`/`...Python` runs BEFORE the regex-call lowering and
  // rejects `Math.match` as an unknown stdlib member — so the regex path never
  // mis-claims it. (This restores, on the Slice-3 branch, the validation that
  // Milestone B's single-pass refactor will also cover IR-wide.)
  test('Math.match(/a/g) → throws unknown-stdlib-member (both targets)', () => {
    expect(() => ts('Math.match(/a/g)')).toThrow(/Math\.match/);
    expect(() => py('Math.match(/a/g)')).toThrow(/Math\.match/);
  });

  // a non-namespace receiver (`s.match`) is unaffected — still the regex method.
  test('s.match(/a/g) (string receiver) → native /g array shape (TS), NOT rejected', () => {
    expect(ts('s.match(/a/g)')).toBe('s.match(/a/g)');
  });
});
