/** REGEX Slice 2 — RUNNER-NATIVE differential oracle (THREE legs, STRUCTURED).
 *
 *  KERN's ReferenceRunner is the neutral THIRD leg of regex parity. Slice 1 made
 *  `regexLit.test(str)` native (a SCALAR boolean). Slice 2 makes the FIRST
 *  STRUCTURED result native:
 *
 *      <stringExpr>.match(<regexLit>)   // NON-GLOBAL only
 *        -> canonical { full, groups, index, named } | null
 *
 *  byte-identical to BOTH emitted legs:
 *    - TypeScript : the inline `((__m) => __m === null ? null : { full, groups,
 *                   index, named })(subject.match(re))` adapter (codegen-expression).
 *    - Python     : `_kern_regex_match(pat, subject, flags)` (helpers).
 *
 *  SCOPE (mirrors decimal / regex-slice-1 boundary — deliberately minimal):
 *    - PRODUCER : a string receiver + a regex LITERAL `/pat/flags` as `args[0]`
 *      (note the shape FLIP from slice 1: there the regex was the RECEIVER of
 *      `.test`; here it is the ARGUMENT of `.match`, the receiver is any string).
 *    - CONSUMER : `subject.match(regexLit)` -> a native canonical object | null.
 *      TERMINAL — the bound value is a TAGGED match value the portable reader
 *      cannot see through, so any DOWNSTREAM read (`m.full`, `m["index"]`)
 *      ABSTAINS (decimal's "abstain on downstream read" property). Full
 *      object/member parity for the match value is a LATER slice.
 *    - `/g .match` is the native ARRAY-of-strings shape (a DIFFERENT value), so it
 *      is OUT of this slice -> the gate (non-global only) declines it and it
 *      ABSTAINS. `.matchAll` / `.exec` are likewise out of slice.
 *
 *  PARITY BY CONSTRUCTION: the runner reuses the SAME emit-side pipeline the legs
 *  use — `normalizeRegexClasses` -> `expandRegexIFold` -> `new RegExp(...)` — and
 *  the SAME flag contract + `validateRegexNamedGroupsPortable` name validator. It
 *  does not re-derive regex lore.
 *
 *  THE NEW DIVERGENCE SURFACE (absent from the scalar slice 1):
 *    - SERIALIZATION ORDER. A structured value reintroduces object key order +
 *      non-ASCII escaping as a divergence risk. The oracle therefore PARSES every
 *      leg's value and compares a RECURSIVE SORTED-KEY canonical form — never raw
 *      JSON bytes — and SCHEMA-CHECKS the exact key set.
 *    - undefined -> null. JS yields `undefined` for an unmatched optional group
 *      (positional AND named); Python yields `None`. Both legs + the runner map
 *      every `undefined` to `null` so the shape is identical.
 *    - INDEX/FULL UNICODE OFFSET. JS `.index` counts UTF-16 code units and a BMP
 *      pattern can match a lone surrogate; Python `m.start()` / `m.group(0)` count
 *      CODE POINTS. An ASTRAL char in the SUBJECT therefore diverges BOTH `index`
 *      and `full` with NO normalization (verified: `"💩x".match(/x/)` -> JS
 *      index 2 vs Py index 1; `"💩".match(/./)` -> JS full "\ud83d" vs Py "💩").
 *      Slice-1's astral fence is PATTERN-only; the runner adds a SUBJECT astral
 *      abstain so it never emits a value that matches only one leg.
 *
 *  Every expected object below was verified empirically on BOTH host engines
 *  (node + python3) against the exact canonical shape each leg produces.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitExpressionWithImports,
  makeEnv,
  parseExpression,
  REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE,
  ReferenceRunnerError,
  referenceRun,
  registerExpressionV1Contract,
} from '@kernlang/core';
import { emitPyExpressionWithImports } from '../src/codegen-body-python.js';

registerExpressionV1Contract(); // idempotent — safe at module load.

// ── canonical comparison: parse every leg, then compare a RECURSIVE SORTED-KEY
//    form so object key order / non-ASCII escaping can never create a false
//    divergence (the load-bearing structured-value parity mechanism). Arrays keep
//    their order; only object keys are sorted. ──────────────────────────────────
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return v;
  });
}

// A canonical match value is EITHER null OR exactly {full,groups,index,named} —
// an over-permissive serializer that adds/drops a key must not pass.
function assertMatchSchema(value: unknown): void {
  if (value === null) return;
  expect(value !== null && typeof value === 'object' && !Array.isArray(value)).toBe(true);
  expect(Object.keys(value as Record<string, unknown>).sort()).toEqual(['full', 'groups', 'index', 'named']);
}

/** Drive a KERN `subject.match(regexLit)` through the runner and return the BOUND
 *  value (the canonical object, or `null`). Throws if the runner did not bind a
 *  match value for `m` — i.e. it ABSTAINED (precondition false) or fail-closed —
 *  so the abstain / re-admit suites assert on that throw directly. */
function runRefMatch(src: string): unknown {
  const node = { type: 'expression-v1', props: { name: 'm', expr: src } };
  const trace = referenceRun(node, makeEnv());
  const assign = trace.events.find(
    (e): e is Extract<typeof e, { op: 'assign' }> => e.op === 'assign' && e.target === 'm',
  );
  if (!assign) {
    throw new Error(`runRefMatch: no assign for "m", got ${JSON.stringify(trace.events)}`);
  }
  return assign.value;
}

// ── runtime gate: the 3-leg differential needs node + python3 ─────────────────
const haveExecRuntimes = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const execDescribe = haveExecRuntimes ? describe : describe.skip;

// ════════════════════════════════════════════════════════════════════════════
// 1. CERTIFIED — canon(ref) === canon(ts) === canon(py) === canon(expected).
//    Each row also kills a specific plausibly-wrong impl (see inline note).
// ════════════════════════════════════════════════════════════════════════════
execDescribe('Regex Slice 2 — RUNNER-NATIVE differential (ref === ts === py)', () => {
  // [KERN source, expected canonical value]. `\\w` in a TS string is the two-char
  // KERN source `\w`.
  const cases: Array<[string, unknown]> = [
    // shape: two positional groups, search at index 0.
    ['"2024-06-14".match(/([0-9]+)-([0-9]+)/)', { full: '2024-06', groups: ['2024', '06'], index: 0, named: {} }],
    // ensure_ascii KILLER: a BMP non-ASCII char in `full` AND `groups` — Python
    // `json.dumps` default would escape `é` as `é`; a raw-byte comparison
    // would diverge. The parse-then-canon contract neutralizes it.
    ['"café".match(/(é)/)', { full: 'é', groups: ['é'], index: 3, named: {} }],
    // optional POSITIONAL unmatched -> null (NOT dropped). Kills "skip undefined
    // slots" (which would give ["b"] not [null,"b"]).
    ['"b".match(/(a)|(b)/)', { full: 'b', groups: [null, 'b'], index: 0, named: {} }],
    // optional NAMED unmatched -> null (NOT omitted). Kills "named verbatim from
    // .groups" (TS `{x:"a"}`) — Python's groupdict yields `{x:"a",y:null}`.
    ['"a".match(/(?<x>a)?(?<y>b)?/)', { full: 'a', groups: ['a', null], index: 0, named: { x: 'a', y: null } }],
    // no named groups -> named:{} (NOT null, NOT undefined, NOT missing).
    ['"hi".match(/(\\w+)/)', { full: 'hi', groups: ['hi'], index: 0, named: {} }],
    // no match -> null (NOT {}, NOT the string "null").
    ['"abc".match(/xyz/)', null],
    // empty-string full match preserved as "" (NOT collapsed to null), index 0.
    ['"abc".match(/x*/)', { full: '', groups: [], index: 0, named: {} }],
    // search-anywhere -> index 6 (kills an anchored-match bug).
    ['"hello world".match(/world/)', { full: 'world', groups: [], index: 6, named: {} }],
    // two named keys in NON-sorted insertion order (b before a) — pins that the
    // canonical contract sorts keys (a future field reorder cannot silently break
    // parity under the sorted-key canon).
    ['"xy".match(/(?<b>x)(?<a>y)/)', { full: 'xy', groups: ['x', 'y'], index: 0, named: { b: 'x', a: 'y' } }],
    // ── review-driven regression guards (3-leg consistent; each pins a fence) ──
    // /i fold INSIDE a capture group — kills "group numbering shifts when
    // expandRegexIFold rewrites the pattern": `(k)` -> `([kK])` keeps group 1.
    ['"K".match(/(k)/i)', { full: 'K', groups: ['K'], index: 0, named: {} }],
    // MIDDLE optional positional unmatched -> null in the MIDDLE slot (ordering).
    ['"ac".match(/(a)(b)?(c)/)', { full: 'ac', groups: ['a', null, 'c'], index: 0, named: {} }],
    // named BACKREFERENCE — portable only because the Python emitter rewrites
    // `\k<x>` -> `(?P=x)`; the runner runs the JS form. Pins that rewrite.
    ['"aa".match(/(?<x>a)\\k<x>/)', { full: 'aa', groups: ['a'], index: 0, named: { x: 'a' } }],
    // ASCII `\w` on .match — `é` is NOT a word char on either leg (normalizer +
    // re.ASCII). Regression guard that the class normalization holds for .match,
    // not just .test (slice 1).
    ['"café".match(/caf\\w/)', null],
    // variable-width lookAHEAD is portable in BOTH JS and Python (only lookBEHIND
    // is fixed-width-only in Python) — pins that the lookbehind fence does NOT
    // over-reach to lookahead.
    ['"ab".match(/a(?=b+)/)', { full: 'a', groups: [], index: 0, named: {} }],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-regex-slice2-runner-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function runTsMatch(src: string): unknown {
    const r = emitExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import * as __k_${m} from '${m}';`).join('\n');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `${imports}\nconsole.log(JSON.stringify(${r.code}));\n`);
    const out = execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
    return JSON.parse(out);
  }

  function runPyMatch(src: string): unknown {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const helpers = [...r.helpers].join('\n\n');
    const file = join(dir, 'run.py');
    writeFileSync(
      file,
      ['import json', imports, helpers, `print(json.dumps(${r.code}, ensure_ascii=False))`].join('\n'),
    );
    const out = execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
    return JSON.parse(out);
  }

  for (const [src, expected] of cases) {
    test(`${src} -> ${canon(expected)} on ALL THREE legs`, () => {
      const ref = runRefMatch(src);
      const ts = runTsMatch(src);
      const py = runPyMatch(src);
      assertMatchSchema(ref);
      assertMatchSchema(ts);
      assertMatchSchema(py);
      expect(canon(ref)).toBe(canon(expected));
      expect(canon(ts)).toBe(canon(expected));
      expect(canon(py)).toBe(canon(expected));
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2. RUNNER-ONLY discriminating killers (no exec runtimes needed) — each kills a
//    specific plausibly-wrong impl, not merely "unimplemented".
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 2 — discriminating killers (runner)', () => {
  test('optional positional unmatched -> null slot (not dropped)', () => {
    expect(canon(runRefMatch('"b".match(/(a)|(b)/)'))).toBe(
      canon({ full: 'b', groups: [null, 'b'], index: 0, named: {} }),
    );
  });
  test('optional named unmatched -> null value (not omitted)', () => {
    expect(canon(runRefMatch('"a".match(/(?<x>a)?(?<y>b)?/)'))).toBe(
      canon({ full: 'a', groups: ['a', null], index: 0, named: { x: 'a', y: null } }),
    );
  });
  test('no named groups -> named:{} (not null/undefined)', () => {
    expect(canon(runRefMatch('"hi".match(/(\\w+)/)'))).toBe(canon({ full: 'hi', groups: ['hi'], index: 0, named: {} }));
  });
  test('no match -> null (not {})', () => {
    expect(runRefMatch('"abc".match(/xyz/)')).toBeNull();
  });
  test('empty-string full match preserved as "" (not null)', () => {
    expect(canon(runRefMatch('"abc".match(/x*/)'))).toBe(canon({ full: '', groups: [], index: 0, named: {} }));
  });
  test('search-anywhere -> index 6 (not anchored)', () => {
    expect(canon(runRefMatch('"hello world".match(/world/)'))).toBe(
      canon({ full: 'world', groups: [], index: 6, named: {} }),
    );
  });
  test('bound match value is TERMINAL — a downstream read abstains', () => {
    // Two statements: bind `m`, then read `m.full`. The read must ABSTAIN (the
    // bound value is a tagged match value the portable reader cannot see through),
    // mirroring decimal's downstream-read boundary. Slice-2 owns the match value;
    // member parity for it is a later slice.
    const env = makeEnv();
    referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"ab".match(/a/)' } }, env);
    expect(() => referenceRun({ type: 'expression-v1', props: { name: 'f', expr: 'm.full' } }, env)).toThrow(
      ReferenceRunnerError,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. RE-ADMIT — a non-portable named group (`(?<café>…)`) is a SHARED compile
//    fail-close on BOTH emitted legs (constant `REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE`);
//    the runner RE-ADMITS the exact message (proving it KNOWS this is a hard
//    fail-close, not merely unsupported — like /g on .test in slice 1).
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 2 — bad named group re-admits the shared compile fail-close', () => {
  test('BOTH emit legs throw the shared constant at compile (proves it is shared)', () => {
    expect(() => emitExpressionWithImports(parseExpression('"x".match(/(?<café>x)/)'))).toThrow(
      REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE,
    );
    expect(() => emitPyExpressionWithImports(parseExpression('"x".match(/(?<café>x)/)'))).toThrow(
      REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE,
    );
  });
  test('runner RE-ADMITS the exact shared message (not a silent abstain)', () => {
    expect(() => runRefMatch('"x".match(/(?<café>x)/)')).toThrow(REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. ABSTAIN guards — out of the certified subset the runner DECLINES to route
//    native (no divergent value). These are GREEN at base (everything abstains
//    pre-build) and MUST stay green: they pin that the build does not OVER-admit.
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 2 — abstains (no native route) on out-of-slice inputs', () => {
  test('astral SUBJECT abstains — UTF-16 vs code-point index/full divergence', () => {
    // The #1 silent killer: JS `.index` (UTF-16 units) and `m.group(0)` diverge
    // from Python (code points) when an astral char precedes/enters the match.
    // The runner must DECLINE rather than emit a one-leg-only value.
    expect(() => runRefMatch('"💩x".match(/x/)')).toThrow();
  });
  // NOTE: `/g .match` and `.matchAll` moved to slice-3 as CERTIFIED native ops
  // (regex-runner-native-slice3.test.ts) — they no longer abstain here.
  test('.exec abstains — fail-closed on both emit legs (stateful lastIndex)', () => {
    expect(() => runRefMatch('/x/.exec("x")')).toThrow();
  });
  test('astral PATTERN abstains (inherited slice-1 scanRegexAstral gate)', () => {
    expect(() => runRefMatch('"x".match(/𝕏/)')).toThrow();
  });
  test('LONE SURROGATE subject abstains — code-unit scan fences unpaired surrogates', () => {
    // for…of (code points) skips a lone surrogate; the code-UNIT scan catches it.
    expect(() => runRefMatch('"\\ud800x".match(/x/)')).toThrow();
  });
  test('variable-width LOOKBEHIND abstains — Python re is fixed-width-only (compile error)', () => {
    // BLOCKER closed: runner+TS execute `(?<=a+)b`, Python `re` throws at compile
    // ("look-behind requires fixed-width pattern") -> the runner must decline.
    expect(() => runRefMatch('"aab".match(/(?<=a+)b/)')).toThrow();
  });
  test('negative variable-width lookbehind abstains', () => {
    expect(() => runRefMatch('"xb".match(/(?<!a+)b/)')).toThrow();
  });
  test('FIXED-width lookbehind also abstains (safe over-abstain — width analysis is error-prone)', () => {
    // `(?<=a)b` IS portable, but the gate rejects ALL lookbehind rather than risk a
    // width-analysis bug; over-abstaining never diverges.
    expect(() => runRefMatch('"ab".match(/(?<=a)b/)')).toThrow();
  });
  test('OPTIONAL CHAINING `?.match` abstains — emitter falls through to native ARRAY shape', () => {
    // BLOCKER closed: `"a"?.match(/a/)` -> runner object, but the TS leg emits the
    // native `["a"]` array (the `.match` lowering ignores `?.`) -> 3-leg divergence.
    expect(() => runRefMatch('"a"?.match(/a/)')).toThrow();
  });
  test('bare unescaped `.` without /s abstains (inherited JS<->Python `\\r` divergence)', () => {
    expect(() => runRefMatch('"axb".match(/a.b/)')).toThrow();
  });
  test('/i Set-B fold (ß) abstains (inherited parameterized compile fail-close)', () => {
    expect(() => runRefMatch('"ss".match(/ß/i)')).toThrow();
  });
  test('duplicate flags (/x/ii) abstain (inherited uniqueness guard)', () => {
    expect(() => runRefMatch('"x".match(/x/ii)')).toThrow();
  });
  test('/u flag is uncertified (inherited)', () => {
    expect(() => runRefMatch('"x".match(/x/u)')).toThrow();
  });
  test('non-string subject (number) abstains — JS coerces, Python raises', () => {
    expect(() => runRefMatch('(123 as any).match(/x/)')).toThrow();
  });
  test('non-literal regex arg abstains — the gate requires a regex LITERAL in args[0]', () => {
    // `re` is an identifier, not a `/…/` literal, so the structural gate declines
    // `subject.match(re)` (it cannot certify the flag contract of a value it does
    // not see). Bind `re` to a plain string so the binding itself succeeds and the
    // abstain is attributable to the non-literal ARG, not an unbound name.
    const env = makeEnv();
    referenceRun({ type: 'expression-v1', props: { name: 're', expr: '"x"' } }, env);
    expect(() => referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"x".match(re)' } }, env)).toThrow(
      ReferenceRunnerError,
    );
  });
  test('shadowed `RegExp` binding falls through to portable eval', () => {
    const env = makeEnv();
    env.bindings.set('RegExp', 'shadowed');
    expect(() => referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"a".match(/a/)' } }, env)).toThrow(
      ReferenceRunnerError,
    );
  });
});
