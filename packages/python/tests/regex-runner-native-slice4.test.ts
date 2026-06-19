/**
 * MILESTONE C — Regex runner-native SLICE-4 differential oracle.
 *
 * Certifies the ReferenceRunner as the neutral 3rd leg (ref === ts === py === expected)
 * for the two string-/array-RESULT regex ops the dual emitters ALREADY support:
 *   1. `<str>.split(/re/)`                 -> string[]   (non-zero-width, no-limit)
 *   2. `<str>.replace(/re/, "lit")`        -> string     (no /g: first; /g: all)
 *      `<str>.replaceAll(/re/g, "lit")`    -> string     (/g required)
 *
 * EVERY expected below was verified EMPIRICALLY on the REAL pipeline (V8 `node` +
 * CPython3.11 `python3`, emitted through the shipped TS+PY emitters) on 2026-06-19 —
 * the slice-3 discipline: never trust a hand-model of a JS-vs-Python regex divergence;
 * replay it through the real emitters. The `execDescribe` block re-validates the TS and
 * PY legs at CI time, so a future engine drift turns a row RED rather than silently
 * passing.
 *
 * RUNNER === TS-LEG BY CONSTRUCTION: the runner calls host V8 `String.split`/`.replace`
 * on the SAME folded pattern the TS emitter emits, so the only open question each row
 * answers is "does the Python leg agree?". When it does -> certify; when it can diverge
 * -> the runner FENCES (abstains) so it never emits a one-leg value.
 *
 * Slice boundary: the split ARRAY binding is terminal-tagged (downstream reads abstain,
 * a later slice gives array value semantics); the replace STRING binding is a plain
 * readable scalar. `.exec`/`.lastIndex` stay compile-fail-closed (NOT this slice).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitExpressionWithImports,
  makeEnv,
  parseExpression,
  referenceRun,
  registerExpressionV1Contract,
} from '@kernlang/core';
import { emitPyExpressionWithImports } from '../src/codegen-body-python.js';

registerExpressionV1Contract(); // idempotent — safe at module load.

// `$`-surface chars that are awkward to embed in TS string literals — build by code.
const DOLLAR = '$';
const BT = String.fromCharCode(96); // `
const SQ = String.fromCharCode(39); // '

// recursive sorted-key canonical form (object keys sorted, arrays keep order).
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

// split value: an array whose elements are EACH a string or null (non-participating
// capture). An impl that drops captures, leaks `undefined`, or returns a non-array fails.
function assertSplitSchema(value: unknown): void {
  expect(Array.isArray(value)).toBe(true);
  for (const el of value as unknown[]) expect(el === null || typeof el === 'string').toBe(true);
}

// replace/replaceAll value: a plain string scalar.
function assertStringSchema(value: unknown): void {
  expect(typeof value).toBe('string');
}

/** Drive a KERN regex expression through the runner; return the BOUND trace value for
 *  `m`. Throws if the runner did not bind `m` (it ABSTAINED / fail-closed) — the
 *  abstain & re-admit suites assert on that throw directly. */
function runRef(src: string): unknown {
  const node = { type: 'expression-v1', props: { name: 'm', expr: src } };
  const trace = referenceRun(node, makeEnv());
  const assign = trace.events.find(
    (e): e is Extract<typeof e, { op: 'assign' }> => e.op === 'assign' && e.target === 'm',
  );
  if (!assign) throw new Error(`runRef: no assign for "m", got ${JSON.stringify(trace.events)}`);
  return assign.value;
}

const haveExec = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const execDescribe = haveExec ? describe : describe.skip;

// ════════════════════════════════════════════════════════════════════════════
// 1. CERTIFIED — canon(ref) === canon(ts) === canon(py) === canon(expected).
// ════════════════════════════════════════════════════════════════════════════
execDescribe('Regex Slice 4 — RUNNER-NATIVE split/replace differential (ref === ts === py)', () => {
  // [KERN source, expected, kind]. `\\d` in a TS string is KERN source `\d`.
  const cases: Array<[string, unknown, 'split' | 'string']> = [
    // ── SPLIT -> string[] ──
    // CAPTURE-INTERLEAVE killer: a drop-captures impl yields ["a","b",""] -> RED.
    ['"a1b2".split(/(\\d)/)', ['a', '1', 'b', '2', ''], 'split'],
    ['"a1b2c3".split(/(\\d)/)', ['a', '1', 'b', '2', 'c', '3', ''], 'split'],
    // NON-PARTICIPATING optional capture -> null on BOTH legs (JS undefined / Py None,
    // both fold to null). A no-fold impl leaks `undefined` -> RED. Also proves split
    // certifies top-level alternation (the dangerous nullable case is zero-width-gated).
    ['"a-b_c".split(/(-)|(_)/)', ['a', '-', null, 'b', null, '_', 'c'], 'split'],
    // consecutive empties with a capture on every boundary.
    ['"--a--b".split(/(.)/)', ['', '-', '', '-', '', 'a', '', '-', '', '-', '', 'b', ''], 'split'],
    // non-zero-width top-level alternation — AGREE (no split alternation fence needed).
    ['"axbxc".split(/a|x/)', ['', '', 'b', 'c'], 'split'],
    ['"a,b,".split(/,/)', ['a', 'b', ''], 'split'], // trailing empty
    ['",a".split(/,/)', ['', 'a'], 'split'], // leading empty
    ['"a,,b".split(/,/)', ['a', '', 'b'], 'split'], // consecutive delimiters
    ['"hello world".split(/\\s/)', ['hello', 'world'], 'split'], // \s ASCII
    ['"aXbYc".split(/[XY]/)', ['a', 'b', 'c'], 'split'], // char class
    ['"".split(/,/)', [''], 'split'], // empty subject
    ['"a".split(/a/)', ['', ''], 'split'], // full match -> two empties
    ['"abc".split(/,/)', ['abc'], 'split'], // no match -> whole string
    ['"café".split(/\\w/)', ['', '', '', 'é'], 'split'], // \w ASCII fence (é not \w)
    ['"a.b.c".split(/\\./)', ['a', 'b', 'c'], 'split'], // escaped dot

    // ── REPLACE / REPLACEALL -> string ──
    ['"abc".replace(/b/,"[$&]")', 'a[b]c', 'string'], // $& whole match
    ['"ab".replace(/(a)(b)/,"$2$1")', 'ba', 'string'], // numbered reorder
    ['"a".replace(/a/,"$$")', '$', 'string'], // $$ -> literal $
    ['"aaa".replace(/a/g,"x")', 'xxx', 'string'], // /g all
    ['"aaa".replace(/a/,"x")', 'xaa', 'string'], // no /g -> first only
    ['"abc".replace(/(?<x>b)/,"[$<x>]")', 'a[b]c', 'string'], // named ref
    ['"a1b2".replace(/(\\d)/g,"[$1]")', 'a[1]b[2]', 'string'], // numbered ref /g
    ['"foo bar".replace(/(\\w+) (\\w+)/,"$2 $1")', 'bar foo', 'string'], // swap words
    // $0 is LITERAL "$0" (NOT whole match) on both legs — scanner killer.
    ['"abc".replace(/b/g,"$0")', 'a$0c', 'string'],
    // trailing-digit disambiguation: $10 with 1 group -> $1 + literal "0".
    ['"x".replace(/(x)/,"$10")', 'x0', 'string'],
    // leading-zero numbered ref: $01 -> group 1.
    ['"x".replace(/(x)/,"$01")', 'x', 'string'],
    // ZERO-WIDTH replace /g — AGREE (no zero-width fence for replace; only alternation).
    ['"abc".replace(/(?:)/g,"-")', '-a-b-c-', 'string'],
    ['"abc".replace(/x*/g,"-")', '-a-b-c-', 'string'],
    ['"aaa".replace(/a*/g,"-")', '--', 'string'],
    ['"abc".replace(/(?=b)/g,"-")', 'a-bc', 'string'], // zero-width lookahead
    ['"a b".replace(/\\b/g,"|")', '|a| |b|', 'string'], // word-boundary zero-width
    ['"aabb".replace(/(.)\\1/g,"X")', 'XX', 'string'], // backref in PATTERN (replace certifies)
    ['"abbb".replace(/b+/g,"X")', 'aX', 'string'], // subject ending in a match
    ['"abc\\nxyz".replace(/$/gm,"|")', 'abc|\nxyz|', 'string'], // $ under /m + \n (only non-\n diverges)
    ['"x".replace(/x/g,"$&$&")', 'xx', 'string'], // $& doubled
    ['"abc".replace(/B/i,"X")', 'aXc', 'string'], // /i replace
    ['"café".replace(/\\w/g,"X")', 'XXXé', 'string'], // \w ASCII fence replace
    // ── REPLACEALL ──
    ['"hello".replaceAll(/l/g,"L")', 'heLLo', 'string'],
    ['"a.b.c".replaceAll(/\\./g,"-")', 'a-b-c', 'string'],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'slice4-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function runTs(src: string): unknown {
    const r = emitExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import * as __k_${m} from '${m}';`).join('\n');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `${imports}\nconsole.log(JSON.stringify(${r.code}));\n`);
    return JSON.parse(execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim());
  }

  function runPy(src: string): unknown {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const helpers = [...r.helpers].join('\n\n');
    const file = join(dir, 'run.py');
    writeFileSync(file, ['import json', imports, helpers, `print(json.dumps(${r.code}, ensure_ascii=False))`].join('\n'));
    return JSON.parse(execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim());
  }

  for (const [src, expected, kind] of cases) {
    test(`${src} -> ${canon(expected)} on ALL THREE legs`, () => {
      const ref = runRef(src);
      const ts = runTs(src);
      const py = runPy(src);
      const assertSchema = kind === 'split' ? assertSplitSchema : assertStringSchema;
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
// 2. RUNNER-ONLY killers — assert the runner's bound value directly (no exec legs).
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 4 — runner-native value killers', () => {
  test('split interleaves capture groups (NOT a drop-captures array)', () => {
    expect(canon(runRef('"a1b2".split(/(\\d)/)'))).toBe(canon(['a', '1', 'b', '2', '']));
  });
  test('split folds a NON-PARTICIPATING capture to null (not undefined)', () => {
    expect(canon(runRef('"a-b_c".split(/(-)|(_)/)'))).toBe(canon(['a', '-', null, 'b', null, '_', 'c']));
  });
  test('replace treats $0 as LITERAL "$0" (not the whole match)', () => {
    expect(runRef('"abc".replace(/b/g,"$0")')).toBe('a$0c');
  });
  test('replace disambiguates $10 -> group $1 + literal "0"', () => {
    expect(runRef('"x".replace(/(x)/,"$10")')).toBe('x0');
  });
  test('replace without /g replaces only the FIRST match', () => {
    expect(runRef('"aaa".replace(/a/,"x")')).toBe('xaa');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. RE-ADMIT fail-close — the runner ABSTAINS on the EXACT inputs both emit legs
//    compile-fail-close (parity asserted: the TS+PY emitters also throw).
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 4 — re-admit fail-close (runner abstains; both legs compile-fail-close)', () => {
  const failCloseRows: Array<[string, string]> = [
    ['split with a LIMIT (2nd arg) is non-portable', '"a,b,c".split(/,/, 2)'],
    ['split on a ZERO-WIDTH-capable pattern is non-portable', '"abc".split(/x*/)'],
    ['split on a backref pattern (zero-width-capable) is non-portable', '"aabb".split(/(.)\\1/)'],
    ['replaceAll without /g throws TypeError in JS', '"hello".replaceAll(/l/,"L")'],
    ['replace with a NON-LITERAL replacement cannot be statically translated', '"ab".replace(/a/,"X"+"Y")'],
    ['replace OOR numbered ref ($2 with one group)', '"ab".replace(/(a)/,"$2")'],
  ];
  for (const [why, src] of failCloseRows) {
    test(`ABSTAIN+FAILCLOSE: ${why}`, () => {
      expect(() => runRef(src)).toThrow();
      expect(() => emitExpressionWithImports(parseExpression(src))).toThrow();
      expect(() => emitPyExpressionWithImports(parseExpression(src))).toThrow();
    });
  }
  // `$`-prefix/suffix have no Python analog — built by code (awkward TS literals).
  test('ABSTAIN+FAILCLOSE: replace $-prefix (no Python analog)', () => {
    const src = `"abc".replace(/b/g,"${DOLLAR}${BT}")`;
    expect(() => runRef(src)).toThrow();
    expect(() => emitExpressionWithImports(parseExpression(src))).toThrow();
    expect(() => emitPyExpressionWithImports(parseExpression(src))).toThrow();
  });
  test('ABSTAIN+FAILCLOSE: replace $-suffix (no Python analog)', () => {
    const src = `"abc".replace(/b/g,"${DOLLAR}${SQ}")`;
    expect(() => runRef(src)).toThrow();
    expect(() => emitExpressionWithImports(parseExpression(src))).toThrow();
    expect(() => emitPyExpressionWithImports(parseExpression(src))).toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. RUNNER-ONLY abstain — the two emit legs DIVERGE (or the subject is non-portable),
//    so the runner must DECLINE to be a 3rd leg. These do NOT compile-fail-close.
// ════════════════════════════════════════════════════════════════════════════
const execDescribe2 = haveExec ? describe : describe.skip;
execDescribe2('Regex Slice 4 — runner-only abstain (emit legs diverge; runner declines)', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'slice4d-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  function tsVal(src: string): unknown {
    const r = emitExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import * as __k_${m} from '${m}';`).join('\n');
    const file = join(dir, 'd.mjs');
    writeFileSync(file, `${imports}\nconsole.log(JSON.stringify(${r.code}));\n`);
    return JSON.parse(execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim());
  }
  function pyVal(src: string): unknown {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const helpers = [...r.helpers].join('\n\n');
    const file = join(dir, 'd.py');
    writeFileSync(file, ['import json', imports, helpers, `print(json.dumps(${r.code}, ensure_ascii=False))`].join('\n'));
    return JSON.parse(execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim());
  }

  // nullable global alternation: JS advances after a zero-width match, CPython>=3.7
  // re.sub retries a non-empty match at the same position -> the two legs DIVERGE.
  test('replace /g nullable alternation diverges -> runner abstains', () => {
    const src = '"ab".replace(/(?:|a)/g,"-")';
    expect(() => runRef(src)).toThrow();
    expect(canon(tsVal(src))).not.toBe(canon(pyVal(src))); // documents the divergence the fence guards
  });
  test('replaceAll nullable alternation diverges -> runner abstains', () => {
    expect(() => runRef('"ab".replaceAll(/(?:|a)/g,"-")')).toThrow();
  });
  // SOUND over-abstain: top-level alternation is fenced for replace/replaceAll even
  // when THIS subject happens to agree (precise nullable analysis deferred).
  test('replace /g non-nullable alternation is over-abstained (sound)', () => {
    expect(() => runRef('"foo".replace(/o|f/g,"-")')).toThrow();
  });
  // /m + a non-\n line terminator: JS treats \r as a line boundary for ^/$, Python re
  // /m only \n -> divergent match set.
  test('replace /m + \\r anchor diverges -> runner abstains', () => {
    const src = '"a\\rb".replace(/^/gm,"X")';
    expect(() => runRef(src)).toThrow();
    expect(canon(tsVal(src))).not.toBe(canon(pyVal(src)));
  });
  test('split /m + \\r anchor diverges -> runner abstains', () => {
    const src = '"a\\rb".split(/.$/m)';
    expect(() => runRef(src)).toThrow();
    expect(canon(tsVal(src))).not.toBe(canon(pyVal(src)));
  });
  // bare `.` over a \r subject WITHOUT /m: JS `.` excludes \r/LS/PS, Python `.` (no
  // DOTALL) excludes only \n -> divergent match set. This is a SUBJECT concern, NOT a
  // /m concern, so a sound impl needs a dedicated bare-dot subject fence — an impl that
  // only checks /m emits a divergent value here (verified node+python3:
  // TS ["","a","\r","b",""] vs PY ["","a","","\r","","b",""]).
  test('split bare-dot over \\r subject (no /m) diverges -> runner abstains', () => {
    const src = '"a\\rb".split(/(.)/)';
    expect(() => runRef(src)).toThrow();
    expect(canon(tsVal(src))).not.toBe(canon(pyVal(src)));
  });
  test('replace bare-dot over \\r subject (no /m) diverges -> runner abstains', () => {
    const src = '"a\\rb".replace(/(.)/g,"X")';
    expect(() => runRef(src)).toThrow();
    expect(canon(tsVal(src))).not.toBe(canon(pyVal(src)));
  });
  // a subject carrying a UTF-16 surrogate splits by code UNIT in JS, code POINT in
  // Python -> the result strings/indices diverge. Runner-only abstain (legs don't
  // fail-close an astral SUBJECT — only an astral PATTERN).
  test('split over a surrogate subject abstains', () => {
    expect(() => runRef('"a\\uD83D\\uDCA9b".split(/x/)')).toThrow();
  });
  test('replace over a surrogate subject abstains', () => {
    expect(() => runRef('"a\\uD83D\\uDCA9b".replace(/a/,"Z")')).toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. TERMINAL TAG — the split ARRAY binding is opaque downstream (a later slice gives
//    it value semantics); a read of the bound name ABSTAINS. The replace STRING binding
//    is a plain scalar and reads normally.
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 4 — terminal-tag boundary', () => {
  test('split binding is terminal-tagged: a downstream index read abstains', () => {
    const env = makeEnv();
    referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"a1b2".split(/(\\d)/)' } }, env);
    expect(() =>
      referenceRun({ type: 'expression-v1', props: { name: 'x', expr: 'm[0]' } }, env),
    ).toThrow();
    expect(() =>
      referenceRun({ type: 'expression-v1', props: { name: 'n', expr: 'm.length' } }, env),
    ).toThrow();
  });
  test('replace binding is a plain readable string scalar', () => {
    const env = makeEnv();
    referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"aaa".replace(/a/g,"x")' } }, env);
    const t = referenceRun({ type: 'expression-v1', props: { name: 'x', expr: 'm === "xxx"' } }, env);
    const a = t.events.find((e): e is Extract<typeof e, { op: 'assign' }> => e.op === 'assign' && e.target === 'x');
    expect(a?.value).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. USER-SHADOWED RegExp — a bound `RegExp` ident means the program is not using the
//    host constructor; the runner must NOT claim the call (routesToNative checks this).
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 4 — shadowed RegExp is not runner-native', () => {
  test('split with a user-bound RegExp abstains', () => {
    const env = makeEnv();
    referenceRun({ type: 'expression-v1', props: { name: 'RegExp', expr: '"x"' } }, env);
    expect(() =>
      referenceRun({ type: 'expression-v1', props: { name: 'm', expr: '"a,b".split(/,/)' } }, env),
    ).toThrow();
  });
});
