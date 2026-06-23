/** DECIMAL Slice 2 — RUNNER-NATIVE comparator + variable-operand oracle (THIRD leg).
 *
 *  Slice 1 made the ReferenceRunner execute the Decimal PRODUCERS natively
 *  (`Decimal.of/add/mul`) as a third "leg" alongside the two emitted legs. Slice 2
 *  extends the runner across the READ PATH — the only Decimal surface that yields a
 *  PORTABLE scalar:
 *    - the COMPARATORS `eq/ne/lt/lte/gt/gte` (→ portable boolean) and `cmp`
 *      (→ portable int -1|0|1), and
 *    - VARIABLE OPERANDS: an `ident` bound to a runner Decimal value is resolved and
 *      compared (the env-threaded composition `let d = …; Decimal.eq(d, e)`).
 *  A comparator's result flows BACK into the portable evaluator (used in `+`, `? :`,
 *  template, …), so this is where a branded Decimal value participates in evaluator
 *  semantics — the tribunal's "read path".
 *
 *  ORACLE SHAPE. The slice-3 emission test already proves the comparators are
 *  byte-identical across the TWO EMITTED legs (decimal.js `.eq()`/`.cmp()` on TS vs
 *  Python `==`/`int(compare())`), rendering a bool as the lowercase token
 *  "true"/"false" and `cmp` as "-1"/"0"/"1". This oracle adds the RUNNER (`runRef`)
 *  as the THIRD leg and asserts refOut === tsOut === pyOut for every literal-rooted
 *  case (operands stay within the runner's Slice-1 producer surface of/add/mul, so
 *  no Slice-3 producer is presumed). Variable-operand and abstain cases are
 *  runner-only (the single-expression emit harness can't bind `let`s).
 *
 *  RED-AT-BASE (the discriminating signal). Today `Decimal.eq(...)` is a member-call
 *  the runner's portable evaluator does not know — it throws → the `expression-v1`
 *  precondition catches it → `referenceRun` ABSTAINS. So every comparator case here
 *  FAILS at base (runRef throws instead of yielding the token) and only goes green
 *  once the runner evaluates comparators + resolves variable operands. The
 *  composability cases (`Decimal.cmp(...) + 1`, `Decimal.eq(...) ? "Y" : "N"`) are
 *  the sharpest: they pass ONLY if the comparator result is a genuine portable
 *  scalar the evaluator can carry downstream, not a special-cased terminal.
 *
 *  DISCRIMINATORS a plausibly-wrong impl fails:
 *    - float-trap eq `0.1 + 0.2 == 0.3 → true` (a host-float compare diverges),
 *    - computed signed-zero `mul(-1,0) == 0 → true` (round-trip of a computed -0),
 *    - precision-28 boundary cmp,
 *    - the int/bool COMPOSABILITY cases (read-path actually feeds the evaluator),
 *    - runtime ABSTAIN on a non-Decimal binding (`Decimal.eq(d, s)` where `s` is a
 *      string) — the runner must REFUSE rather than pick decimal.js's coercion
 *      ("true") or Python's ("false"); the emitters silently diverge there. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decimalImportLineTS,
  emitExpressionWithImports,
  makeEnv,
  parseExpression,
  ReferenceRunnerError,
  referenceRun,
  registerExpressionV1Contract,
} from '@kernlang/core';
import { emitPyExpressionWithImports } from '../src/codegen-body-python.js';

// The runner leg is the PRODUCTION path (referenceRun → expression-v1 contract).
registerExpressionV1Contract(); // idempotent.

/** Canonical rendering shared by all three legs: a boolean → lowercase token,
 *  everything else → its plain string (an int -1|0|1 stringifies identically on JS
 *  and Python). Mirrors the slice-3 oracle's TS `String(...)` / Python `_show`. */
function showValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Run a single KERN expression through the production runner, returning the raw
 *  bound value of `r` (boolean | number | string). */
function runRefRaw(src: string): unknown {
  const node = { type: 'expression-v1', props: { name: 'r', expr: src } };
  const trace = referenceRun(node, makeEnv());
  const assign = trace.events.find(
    (e): e is Extract<typeof e, { op: 'assign' }> => e.op === 'assign' && e.target === 'r',
  );
  if (!assign) {
    throw new Error(`runRefRaw: no assign for "r" from referenceRun, got ${JSON.stringify(trace.events)}`);
  }
  return assign.value;
}

/** The runner leg, rendered to the canonical token. */
function runRef(src: string): string {
  return showValue(runRefRaw(src));
}

/** Run a __block of `let`-bindings followed by a final `r = finalExpr`, returning
 *  the canonical rendering of `r`. This is the ONLY way to exercise variable
 *  operands (`Decimal.eq(d, e)`) — the single-expression emit legs cannot bind. */
function runRefBlock(lets: ReadonlyArray<[string, string]>, finalExpr: string): string {
  const children = [
    ...lets.map(([name, expr]) => ({ type: 'expression-v1', props: { name, expr } })),
    { type: 'expression-v1', props: { name: 'r', expr: finalExpr } },
  ];
  const trace = referenceRun({ type: '__block', children }, makeEnv());
  const assign = [...trace.events]
    .reverse()
    .find((e): e is Extract<typeof e, { op: 'assign' }> => e.op === 'assign' && e.target === 'r');
  if (!assign) {
    throw new Error(`runRefBlock: no assign for "r", got ${JSON.stringify(trace.events)}`);
  }
  return showValue(assign.value);
}

// ── emitted-leg execution harness (mirrors the slice-3 comparator oracle) ─────
const req = createRequire(import.meta.url);
let decimalJsPath: string | null = null;
try {
  decimalJsPath = req.resolve('decimal.js');
} catch {
  decimalJsPath = null;
}

const haveExecRuntimes = (() => {
  if (decimalJsPath === null) return false;
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const execDescribe = haveExecRuntimes ? describe : describe.skip;

// ── 3-LEG: literal-rooted comparators (ref === ts === py, byte-exact) ─────────
// Operands use ONLY the runner's Slice-1 producer surface (of/add/mul) so no
// Slice-3 producer is presumed. Each token must match on all three legs.
execDescribe('Decimal Slice 2 — RUNNER-NATIVE comparators (ref === ts === py)', () => {
  const cases: Array<[string, string]> = [
    ['Decimal.eq(Decimal.of("1"), Decimal.of("1"))', 'true'],
    ['Decimal.eq(Decimal.of("1"), Decimal.of("2"))', 'false'],
    ['Decimal.ne(Decimal.of("1"), Decimal.of("2"))', 'true'],
    ['Decimal.ne(Decimal.of("1"), Decimal.of("1"))', 'false'],
    ['Decimal.lt(Decimal.of("1"), Decimal.of("2"))', 'true'],
    ['Decimal.lt(Decimal.of("2"), Decimal.of("1"))', 'false'],
    ['Decimal.lte(Decimal.of("2"), Decimal.of("2"))', 'true'],
    ['Decimal.gt(Decimal.of("-1"), Decimal.of("-2"))', 'true'],
    ['Decimal.gte(Decimal.of("3"), Decimal.of("3"))', 'true'],
    // float-trap: 0.1 + 0.2 is EXACTLY 0.3 under decimal arithmetic on all legs.
    ['Decimal.eq(Decimal.add(Decimal.of("0.1"), Decimal.of("0.2")), Decimal.of("0.3"))', 'true'],
    // computed signed zero: mul(-1, 0) yields a -0/+0 that must compare equal to a
    // literal 0 (the runner round-trips the canonical "0", never "-0").
    ['Decimal.eq(Decimal.mul(Decimal.of("-1"), Decimal.of("0")), Decimal.of("0"))', 'true'],
    // computed-scale equality: 0.5 + 0.5 == 1 (the sum's internal scale differs).
    ['Decimal.eq(Decimal.add(Decimal.of("0.5"), Decimal.of("0.5")), Decimal.of("1"))', 'true'],
    // nested producers on BOTH sides of the comparator: 2*3 == 5+1.
    [
      'Decimal.eq(Decimal.mul(Decimal.of("2"), Decimal.of("3")), Decimal.add(Decimal.of("5"), Decimal.of("1")))',
      'true',
    ],
    // cmp → plain int token.
    ['Decimal.cmp(Decimal.of("1"), Decimal.of("2"))', '-1'],
    ['Decimal.cmp(Decimal.of("1"), Decimal.of("1"))', '0'],
    ['Decimal.cmp(Decimal.of("2"), Decimal.of("1"))', '1'],
    // precision-28 boundary: 28 nines vs 1 — distinct under the pinned context.
    ['Decimal.cmp(Decimal.of("0.9999999999999999999999999999"), Decimal.of("1"))', '-1'],
    // COMPOSABILITY — the comparator result is a REAL portable scalar the evaluator
    // carries downstream. These pass ONLY if the read path feeds the evaluator.
    ['Decimal.cmp(Decimal.of("2"), Decimal.of("1")) + 1', '2'],
    ['Decimal.eq(Decimal.of("1"), Decimal.of("1")) ? "Y" : "N"', 'Y'],
    ['Decimal.lt(Decimal.of("2"), Decimal.of("1")) ? "Y" : "N"', 'N'],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice2-runner-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tsDecimalPreamble(): string {
    return decimalImportLineTS().replace("'decimal.js'", `'${decimalJsPath}'`);
  }

  function runTs(src: string): string {
    const r = emitExpressionWithImports(parseExpression(src));
    const file = join(dir, 'cmp.mjs');
    writeFileSync(file, `${r.imports.has('decimal.js') ? tsDecimalPreamble() : ''}\nconsole.log(String(${r.code}));\n`);
    return execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  // Python prints True/False; normalize a bool to the JS-lowercase token so the
  // byte-compare is apples-to-apples (ints already stringify identically).
  function renderPyShow(): string {
    return [
      'def _show(__k_v):',
      '    if isinstance(__k_v, bool):',
      "        return 'true' if __k_v else 'false'",
      '    return str(__k_v)',
    ].join('\n');
  }

  function runPy(src: string): string {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const helpers = [...r.helpers].join('\n\n');
    const file = join(dir, 'cmp.py');
    writeFileSync(
      file,
      [
        'from decimal import getcontext, ROUND_HALF_EVEN',
        imports,
        helpers,
        renderPyShow(),
        'getcontext().prec = 28',
        'getcontext().rounding = ROUND_HALF_EVEN',
        `print(_show(${r.code}))`,
      ].join('\n'),
    );
    return execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  for (const [src, expected] of cases) {
    test(`${src} → ${expected} on ALL THREE legs (byte-exact)`, () => {
      const refOut = runRef(src);
      const tsOut = runTs(src);
      const pyOut = runPy(src);
      expect(refOut).toBe(expected);
      expect(tsOut).toBe(expected);
      expect(pyOut).toBe(expected);
      expect(refOut).toBe(tsOut);
      expect(refOut).toBe(pyOut);
    });
  }
});

// ── VARIABLE OPERANDS — env-threaded ident resolution (runner-only) ───────────
// A bound runner Decimal value resolved as a comparator operand. The single-
// expression emit legs can't bind `let`s, so the 3-leg parity for the COMPARATOR
// is proven above; here we prove the runner resolves an ident (and a COMPUTED
// binding) back to the identical value.
describe('Decimal Slice 2 — runner resolves variable Decimal operands', () => {
  test('two bound literals compare equal', () => {
    expect(
      runRefBlock(
        [
          ['d', 'Decimal.of("1.5")'],
          ['e', 'Decimal.of("1.5")'],
        ],
        'Decimal.eq(d, e)',
      ),
    ).toBe('true');
  });
  test('two bound literals order via cmp', () => {
    expect(
      runRefBlock(
        [
          ['d', 'Decimal.of("1")'],
          ['e', 'Decimal.of("2")'],
        ],
        'Decimal.cmp(d, e)',
      ),
    ).toBe('-1');
  });
  test('a COMPUTED binding round-trips: (0.1 + 0.2) == 0.3', () => {
    expect(
      runRefBlock([['d', 'Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))']], 'Decimal.eq(d, Decimal.of("0.3"))'),
    ).toBe('true');
  });
  test('a bound operand mixed with a nested producer operand', () => {
    expect(
      runRefBlock([['d', 'Decimal.of("6")']], 'Decimal.eq(d, Decimal.mul(Decimal.of("2"), Decimal.of("3")))'),
    ).toBe('true');
  });
  test('comparator result of variable operands is usable downstream', () => {
    expect(
      runRefBlock(
        [
          ['d', 'Decimal.of("2")'],
          ['e', 'Decimal.of("1")'],
        ],
        'Decimal.gt(d, e) ? "Y" : "N"',
      ),
    ).toBe('Y');
  });

  // Review #2 — a COMPUTED signed zero, BOUND then resolved, compares equal to a
  // literal 0. The runner stores canonical "0" (never "-0"); the emitters keep a live
  // -0 instance, but -0 ≡ 0 in VALUE comparison on both legs, so all three agree.
  test('a bound computed signed zero compares equal to literal 0 (eq + cmp)', () => {
    const z = 'Decimal.mul(Decimal.of("-1"), Decimal.of("0"))';
    expect(runRefBlock([['z', z]], 'Decimal.eq(z, Decimal.of("0"))')).toBe('true');
    expect(runRefBlock([['z', z]], 'Decimal.cmp(z, Decimal.of("0"))')).toBe('0');
  });

  // Review #2 — a 28-significant-digit value, BOUND then resolved, round-trips through
  // its canonical string EXACTLY (precision-28 rendering is lossless), so cmp against
  // the identical literal is 0. Proves variable round-trip fidelity at the boundary.
  test('a bound precision-28 value round-trips exactly (cmp == 0)', () => {
    const big = 'Decimal.mul(Decimal.of("1.234567890123456789012345678"), Decimal.of("1.000000000000000000000000001"))';
    expect(runRefBlock([['d', big]], 'Decimal.cmp(d, Decimal.of("1.234567890123456789012345679"))')).toBe('0');
  });

  // Review #9 — a bound operand resolves identically in EITHER argument position.
  test('a bound operand resolves in either argument position (symmetry)', () => {
    expect(runRefBlock([['d', 'Decimal.of("1")']], 'Decimal.eq(d, Decimal.of("1"))')).toBe('true');
    expect(runRefBlock([['d', 'Decimal.of("1")']], 'Decimal.eq(Decimal.of("1"), d)')).toBe('true');
    expect(runRefBlock([['d', 'Decimal.of("1")']], 'Decimal.lt(Decimal.of("0"), d)')).toBe('true');
  });
});

// ── RUNTIME ABSTAIN — the runner REFUSES a divergent / unprovable operand ──────
// `Decimal.eq(d, s)` where `s` is a STRING binding COMPILES (idents pass the
// emitter's non-Decimal check — no typed IR), but the two emitted legs would
// DIVERGE at runtime (decimal.js coerces "1.5" → true; Python `==` str → false).
// The runner must ABSTAIN (refuse to pick a side), NOT compute a value.
describe('Decimal Slice 2 — runner ABSTAINS on a non-Decimal binding (no divergence)', () => {
  test('Decimal.eq(d, s) with s a string binding makes referenceRun ABSTAIN', () => {
    const lets: Array<[string, string]> = [
      ['d', 'Decimal.of("1.5")'],
      ['s', '"1.5"'],
    ];
    expect(() => runRefBlock(lets, 'Decimal.eq(d, s)')).toThrow(ReferenceRunnerError);
    expect(() => runRefBlock(lets, 'Decimal.eq(d, s)')).toThrow('Preconditions failed');
  });

  test('Decimal.cmp(d, n) with n a number binding makes referenceRun ABSTAIN', () => {
    const lets: Array<[string, string]> = [
      ['d', 'Decimal.of("1")'],
      ['n', '2'],
    ];
    expect(() => runRefBlock(lets, 'Decimal.cmp(d, n)')).toThrow('Preconditions failed');
  });

  // An UNBOUND operand is likewise unresolvable → abstain (never a guess).
  test('Decimal.eq(d, missing) with an unbound operand ABSTAINS', () => {
    expect(() => runRefBlock([['d', 'Decimal.of("1")']], 'Decimal.eq(d, missing)')).toThrow('Preconditions failed');
  });
});

// ── DEFENSIVE — the runner also abstains on the emitter's COMPILE fail-close
// shapes (a provably-non-Decimal LITERAL operand). The byte-identical compile
// fail-close itself is proven symmetric across the EMITTED legs by the slice-3
// emission test; here we only assert the runner does not fabricate a value.
describe('Decimal Slice 2 — runner abstains on a non-Decimal literal operand', () => {
  test('Decimal.eq(Decimal.of("1"), 0.1) — runner abstains (does not compute)', () => {
    expect(() => runRefRaw('Decimal.eq(Decimal.of("1"), 0.1)')).toThrow('Preconditions failed');
  });
  test('Decimal.eq(0.1, Decimal.of("1")) — operand-order, runner abstains', () => {
    expect(() => runRefRaw('Decimal.eq(0.1, Decimal.of("1"))')).toThrow('Preconditions failed');
  });

  // Review #9 — a comparator result is a portable scalar (int/bool), NOT a Decimal.
  // Feeding a `cmp` result as a Decimal operand must ABSTAIN — the runner never
  // re-uses the -1/0/1 as a Decimal (the emitters would emit divergent code here).
  test('a cmp result fed as a Decimal operand ABSTAINS (not mis-used as a Decimal)', () => {
    expect(() => runRefRaw('Decimal.add(Decimal.cmp(Decimal.of("1"), Decimal.of("2")), Decimal.of("1"))')).toThrow(
      'Preconditions failed',
    );
  });
});
