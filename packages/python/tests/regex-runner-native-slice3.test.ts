/** REGEX Slice 3 — RUNNER-NATIVE differential oracle (THREE legs, GLOBAL/ARRAY).
 *
 *  KERN's ReferenceRunner is the neutral THIRD leg of regex parity. Slice 1 made
 *  `regexLit.test(str)` native (scalar bool). Slice 2 made the first STRUCTURED
 *  result native (`str.match(regexLit)` non-global -> {full,groups,index,named}|null).
 *  Slice 3 makes the two STATELESS GLOBAL array results native:
 *
 *      <stringExpr>.match(/pat/g)      -> string[] | null
 *      <stringExpr>.matchAll(/pat/g)   -> [{ full, groups, index }, …]   (NO `named`)
 *
 *  byte-identical to BOTH emitted legs:
 *    - `/g .match`  TS: native `subject.match(/p/g)`; PY: `[m.group(0) for m in
 *                   re.finditer(p,s,flags)] or None`  (finditer.group(0), NEVER
 *                   re.findall — which returns group tuples when >1 group).
 *    - `.matchAll`  TS: `[...s.matchAll(/p/g)].map(m=>({full,groups,index}))`;
 *                   PY: `_kern_regex_matchall` (finditer -> the same objects).
 *
 *  WHY NO STATEFUL HEAP (the architectural crux): `.exec`/`.lastIndex` are
 *  compile-time fail-closed on BOTH legs (REGEX_EXEC_FAILCLOSE) — NOT lowered — so
 *  there is no observable regex cursor in the portable subset. `String.match(/g)` and
 *  `matchAll` construct a FRESH `new RegExp` per call and never persist `lastIndex`,
 *  so the runner's per-call double-eval (preconditions trial + effects re-run) stays
 *  PURE. No mutable RegExpValue/lastIndex model is needed.
 *
 *  THE NEW DIVERGENCE SURFACES (over slice 2's single match):
 *    - finditer-NOT-findall: a /g .match with a CAPTURING group must yield the FULL
 *      matches (`"a1b2".match(/(\w)(\d)/g) -> ["a1","b2"]`), not Python findall's
 *      group tuples. The killer dies under a findall impl.
 *    - null-vs-EMPTY asymmetry: `/g .match` no-match -> null; `.matchAll` no-match -> [].
 *    - matchAll DROPS `named` on both legs (only full/groups/index). No groupdict leak.
 *    - ZERO-WIDTH GLOBAL: V8 `String.match`/`matchAll` and CPython>=3.7 `re.finditer`
 *      enumerate empty matches identically (a star-quantified global over "baa"
 *      yields ["","aa",""]). This
 *      is CERTIFIED (the shipped matchAll emitter already relies on CPython>=3.7); the
 *      3-leg test re-validates it at CI time against the live python3.
 *    - SUBJECT astral/surrogate: applies to BOTH array ops — `"💩".match(/./g)` splits
 *      surrogate halves in JS (`["\ud83d","\ude29"]`) vs code points in Python
 *      (`["💩"]`); the runner ABSTAINS (code-unit surrogate scan), never one-leg-only.
 *
 *  Every expected below was verified empirically on node + python3 (2026-06-19)
 *  against the exact canonical shape each leg produces.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitExpressionWithImports,
  makeEnv,
  parseExpression,
  REGEX_MATCHALL_NO_G_FAILCLOSE,
  REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE,
  ReferenceRunnerError,
  referenceRun,
  registerExpressionV1Contract,
} from '@kernlang/core';
import { emitPyExpressionWithImports } from '../src/codegen-body-python.js';

registerExpressionV1Contract(); // idempotent — safe at module load.

// recursive sorted-key canonical form: object keys sorted, arrays keep order — so
// object key order / non-ASCII escaping can never create a false divergence.
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

// `/g .match` value is EITHER null OR a string[] — an impl that leaks objects/tuples
// (e.g. findall) or wrong element types must not pass.
function assertGlobalMatchSchema(value: unknown): void {
  if (value === null) return;
  expect(Array.isArray(value)).toBe(true);
  for (const el of value as unknown[]) expect(typeof el).toBe('string');
}

// `.matchAll` value is an array (possibly empty) of EXACTLY {full,groups,index} — a
// `named` leak (groupdict/spread) or a missing/extra key must not pass.
function assertMatchAllSchema(value: unknown): void {
  expect(Array.isArray(value)).toBe(true);
  for (const el of value as unknown[]) {
    expect(el !== null && typeof el === 'object' && !Array.isArray(el)).toBe(true);
    expect(Object.keys(el as Record<string, unknown>).sort()).toEqual(['full', 'groups', 'index']);
  }
}

/** Drive a KERN global-regex expression through the runner and return the BOUND
 *  trace value (plain array, or null). Throws if the runner did not bind a value for
 *  `m` — i.e. it ABSTAINED or fail-closed — so the abstain / re-admit suites assert
 *  on that throw directly. */
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
// ════════════════════════════════════════════════════════════════════════════
execDescribe('Regex Slice 3 — RUNNER-NATIVE global differential (ref === ts === py)', () => {
  // [KERN source, expected, schema kind]. `\\w` in a TS string is KERN source `\w`.
  const cases: Array<[string, unknown, 'gmatch' | 'matchall']> = [
    // ── /g .match -> string[] | null ──
    ['"aXbXc".match(/X/g)', ['X', 'X'], 'gmatch'],
    // FINDITER-NOT-FINDALL killer: capturing groups, FULL matches (findall would give
    // group-1 strings / tuples -> RED).
    ['"a1b2".match(/(\\w)(\\d)/g)', ['a1', 'b2'], 'gmatch'],
    // no match -> null (NOT [], NOT "null").
    ['"abc".match(/z/g)', null, 'gmatch'],
    // ZERO-WIDTH: empty matches at every position (4 over "abc").
    ['"abc".match(/x*/g)', ['', '', '', ''], 'gmatch'],
    // ZERO-WIDTH leading + trailing empty around a real match.
    ['"baa".match(/a*/g)', ['', 'aa', ''], 'gmatch'],
    // ZERO-WIDTH interleaved with content.
    ['"a1b2".match(/\\d*/g)', ['', '1', '', '2', ''], 'gmatch'],
    // lookahead-only zero-width -> one empty match.
    ['"abc".match(/(?=a)/g)', [''], 'gmatch'],
    // /gi flag combo.
    ['"aAbA".match(/a/gi)', ['a', 'A', 'A'], 'gmatch'],
    // \w ASCII fence on the GLOBAL path — `é` is not a word char on either leg.
    ['"café".match(/\\w/g)', ['c', 'a', 'f'], 'gmatch'],
    // plain repeated single-char.
    ['"aaa".match(/a/g)', ['a', 'a', 'a'], 'gmatch'],

    // ── .matchAll -> [{full,groups,index}] ──
    [
      '"a1b2".matchAll(/(\\d)/g)',
      [
        { full: '1', groups: ['1'], index: 1 },
        { full: '2', groups: ['2'], index: 3 },
      ],
      'matchall',
    ],
    // no match -> [] (the null-vs-empty ASYMMETRY vs /g .match's null).
    ['"abc".matchAll(/z/g)', [], 'matchall'],
    // ZERO-WIDTH: 4 empty matches at index 0..3.
    [
      '"abc".matchAll(/x*/g)',
      [
        { full: '', groups: [], index: 0 },
        { full: '', groups: [], index: 1 },
        { full: '', groups: [], index: 2 },
        { full: '', groups: [], index: 3 },
      ],
      'matchall',
    ],
    // NAMED-DROP killer: named groups present, but the shape has NO `named` key —
    // only positional `groups`. A groupdict/spread leak adds a key -> RED.
    ['"ab".matchAll(/(?<g>a)(?<h>b)/g)', [{ full: 'ab', groups: ['a', 'b'], index: 0 }], 'matchall'],
    // undefined/None unmatched optional group -> null in positional groups.
    ['"a".matchAll(/(a)(b)?/g)', [{ full: 'a', groups: ['a', null], index: 0 }], 'matchall'],
    // index advances across multiple matches.
    [
      '"aXbXc".matchAll(/X/g)',
      [
        { full: 'X', groups: [], index: 1 },
        { full: 'X', groups: [], index: 3 },
      ],
      'matchall',
    ],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-regex-slice3-runner-'));
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

  for (const [src, expected, kind] of cases) {
    test(`${src} -> ${canon(expected)} on ALL THREE legs`, () => {
      const ref = runRefMatch(src);
      const ts = runTsMatch(src);
      const py = runPyMatch(src);
      const assertSchema = kind === 'gmatch' ? assertGlobalMatchSchema : assertMatchAllSchema;
      assertSchema(ref);
      assertSchema(ts);
      assertSchema(py);
      expect(canon(ref)).toBe(canon(expected));
      expect(canon(ts)).toBe(canon(expected));
      expect(canon(py)).toBe(canon(expected));
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2. RUNNER-ONLY discriminating killers (no exec runtimes needed).
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 3 — discriminating killers (runner)', () => {
  test('finditer-NOT-findall: /g .match with a capturing group yields FULL matches', () => {
    expect(canon(runRefMatch('"a1b2".match(/(\\w)(\\d)/g)'))).toBe(canon(['a1', 'b2']));
  });
  test('null-vs-EMPTY asymmetry: /g .match no-match -> null; .matchAll no-match -> []', () => {
    expect(runRefMatch('"abc".match(/z/g)')).toBeNull();
    expect(canon(runRefMatch('"abc".matchAll(/z/g)'))).toBe(canon([]));
  });
  test('matchAll DROPS named — only full/groups/index keys', () => {
    const v = runRefMatch('"ab".matchAll(/(?<g>a)(?<h>b)/g)') as Array<Record<string, unknown>>;
    expect(v).toHaveLength(1);
    expect(Object.keys(v[0]).sort()).toEqual(['full', 'groups', 'index']);
    expect(canon(v)).toBe(canon([{ full: 'ab', groups: ['a', 'b'], index: 0 }]));
  });
  test('undefined unmatched optional group -> null in matchAll positional groups', () => {
    expect(canon(runRefMatch('"a".matchAll(/(a)(b)?/g)'))).toBe(canon([{ full: 'a', groups: ['a', null], index: 0 }]));
  });
  test('zero-width global preserved: "baa".match(/a*/g) -> ["","aa",""]', () => {
    expect(canon(runRefMatch('"baa".match(/a*/g)'))).toBe(canon(['', 'aa', '']));
  });
  test('bound /g .match array is TERMINAL — a downstream index/length read abstains', () => {
    const env = makeEnv();
    referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"aa".match(/a/g)' } }, env);
    expect(() => referenceRun({ type: 'expression-v1', props: { name: 'x', expr: 'm[0]' } }, env)).toThrow(
      ReferenceRunnerError,
    );
    expect(() => referenceRun({ type: 'expression-v1', props: { name: 'n', expr: 'm.length' } }, env)).toThrow(
      ReferenceRunnerError,
    );
  });
  test('bound .matchAll array is TERMINAL — a downstream read abstains', () => {
    const env = makeEnv();
    referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"aa".matchAll(/a/g)' } }, env);
    expect(() => referenceRun({ type: 'expression-v1', props: { name: 'x', expr: 'm[0]' } }, env)).toThrow(
      ReferenceRunnerError,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. RE-ADMIT — shared compile fail-closes on BOTH emit legs; the runner RE-ADMITS
//    the exact message (proving it KNOWS the hard fail-close, not a silent abstain).
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 3 — re-admits shared compile fail-closes', () => {
  test('.matchAll WITHOUT /g — both emit legs throw REGEX_MATCHALL_NO_G_FAILCLOSE', () => {
    expect(() => emitExpressionWithImports(parseExpression('"a".matchAll(/a/)'))).toThrow(
      REGEX_MATCHALL_NO_G_FAILCLOSE,
    );
    expect(() => emitPyExpressionWithImports(parseExpression('"a".matchAll(/a/)'))).toThrow(
      REGEX_MATCHALL_NO_G_FAILCLOSE,
    );
  });
  test('runner RE-ADMITS the non-/g matchAll fail-close (not a silent abstain)', () => {
    expect(() => runRefMatch('"a".matchAll(/a/)')).toThrow(REGEX_MATCHALL_NO_G_FAILCLOSE);
  });
  test('bad named group (café) re-admits on /g .match and .matchAll', () => {
    expect(() => runRefMatch('"x".match(/(?<café>x)/g)')).toThrow(REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE);
    expect(() => runRefMatch('"x".matchAll(/(?<café>x)/g)')).toThrow(REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. ABSTAIN guards — out of the certified subset the runner DECLINES (no divergent
//    value). GREEN at base AND after build — pins that the build does not OVER-admit.
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 3 — abstains (no native route) on out-of-slice inputs', () => {
  test('astral SUBJECT abstains on /g .match — JS surrogate-split vs Python code-points', () => {
    // "💩x".match(/./g): JS ["\ud83d","\ude29","x"] vs Python ["💩","x"] (here /x/ avoids
    // the bare-dot gate so the abstain is attributable to the SUBJECT astral scan).
    expect(() => runRefMatch('"💩x".match(/x/g)')).toThrow();
  });
  test('astral SUBJECT abstains on .matchAll — UTF-16 vs code-point index/full divergence', () => {
    expect(() => runRefMatch('"💩x".matchAll(/x/g)')).toThrow();
  });
  test('LONE SURROGATE subject abstains (code-unit scan)', () => {
    expect(() => runRefMatch('"\\ud800x".match(/x/g)')).toThrow();
  });
  test('bare unescaped `.` without /s abstains on /g .match (inherited \\r divergence)', () => {
    expect(() => runRefMatch('"axb".match(/a.b/g)')).toThrow();
  });
  test('variable-width LOOKBEHIND abstains on both global ops (Python fixed-width-only)', () => {
    expect(() => runRefMatch('"aab".match(/(?<=a+)b/g)')).toThrow();
    expect(() => runRefMatch('"aab".matchAll(/(?<=a+)b/g)')).toThrow();
  });
  test('astral PATTERN abstains (inherited scanRegexAstral gate)', () => {
    expect(() => runRefMatch('"x".match(/𝕏/g)')).toThrow();
  });
  test('duplicate flags (/x/gg) abstain (inherited uniqueness guard)', () => {
    expect(() => runRefMatch('"x".match(/x/gg)')).toThrow();
  });
  test('/u flag is uncertified (inherited)', () => {
    expect(() => runRefMatch('"x".match(/x/gu)')).toThrow();
  });
  test('OPTIONAL CHAINING `?.match` / `?.matchAll` abstain (emitter native-shape fallthrough)', () => {
    expect(() => runRefMatch('"a"?.match(/a/g)')).toThrow();
    expect(() => runRefMatch('"a"?.matchAll(/a/g)')).toThrow();
  });
  test('non-literal regex arg abstains — the gate requires a regex LITERAL in args[0]', () => {
    const env = makeEnv();
    referenceRun({ type: 'expression-v1', props: { name: 're', expr: '"x"' } }, env);
    expect(() => referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"x".matchAll(re)' } }, env)).toThrow(
      ReferenceRunnerError,
    );
  });
  test('shadowed `RegExp` binding falls through to portable eval (abstain)', () => {
    const env = makeEnv();
    env.bindings.set('RegExp', 'shadowed');
    expect(() => referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"a".match(/a/g)' } }, env)).toThrow(
      ReferenceRunnerError,
    );
  });
});
