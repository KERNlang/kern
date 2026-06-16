/** DECIMAL Slice 3 — RUNNER-NATIVE producer/write path + guard-in-seam oracle (THIRD leg).
 *
 *  Slice 1 made the ReferenceRunner bind a Decimal as a tagged value (`Decimal.of/add/mul`).
 *  Slice 2 gave it the READ PATH (comparators + variable operands). Slice 3 closes the
 *  PRODUCER / WRITE PATH so Decimal is END-TO-END runner-native:
 *    - plain producers `sub` / `neg` / `abs` (mirroring add/mul), and
 *    - the GUARDED producers `div` / `mod` / `pow`, whose divergent seams are cut by the
 *      SAME guards the two emitted legs use (single-sourced in the pure kernel
 *      `decimal/contract.ts`: `kDecimalDiv`/`kDecimalMod`/`kDecimalPowInt` + the compile
 *      gates `assertNonZeroDecimalDivisor` / `assertPortableDecimalPow`).
 *
 *  This is the "guard-in-seam" infrastructure: the runner must compute a producer's
 *  Decimal value byte-identically to both emitted legs AND REFUSE EXACTLY what the
 *  emitters refuse. Slice 2 gave the runner variable operands, so a NAIVE slice-3 could
 *  RESOLVE a variable exponent and compute `Decimal.pow(Decimal.of("2"), d)` — but the
 *  emitters REFUSE a non-literal exponent at compile time, so the runner must replicate
 *  the pow gate and refuse too, never diverge. The pow-gate cases below are the sharpest
 *  discriminators in the slice: they pass ONLY if the runner gates BEFORE it evaluates.
 *
 *  ORACLE SHAPE (three regimes, mirroring slice 1/2):
 *    - runtime_3leg: a valid producer expression — `runRef` === `runTs` === `runPy`,
 *      byte-exact. The TS leg renders the Decimal via decimal.js `String(...)`, Python via
 *      the canonical `_kern_decimal_str`, the runner via the kernel `kernDecimalStr` — all
 *      three the same canonical string (the emission slice-3 differential already proves
 *      TS==Py; this adds the runner as the third leg).
 *    - re-admit fail-close: a div/mod-by-zero or a refused pow throws the BYTE-IDENTICAL
 *      kernel message THROUGH `referenceRun` (the precondition re-admits the canonical
 *      decimal fail-closes to effects, exactly like slice 1's `Decimal.of("1.10")`), so the
 *      runner is a true third leg for FAILURES too — the emitters' byte-identical refusal is
 *      locked by the emission slice-3 test; here the runner throws the same constant.
 *    - abstain: a genuinely unjudgeable operand (non-Decimal / unbound) makes the runner
 *      raise the normal "Preconditions failed …" — refuse, never guess.
 *
 *  RED-AT-BASE: today `Decimal.sub/neg/abs/div/mod/pow` are NOT in the runner's producer
 *  set, so every case here FAILS at base (the runner abstains → `runRef` throws
 *  "Preconditions failed" instead of the value/message) and only goes green once the runner
 *  executes the producers + replicates the guards. The expected values are COMPUTED under
 *  the pinned prec-28 / ROUND_HALF_EVEN / modulo-ROUND_DOWN context (not guessed):
 *    div(1,3)=28 threes (kills host-float), div(2,3)=…667 (kills ROUND_DOWN),
 *    mod(5.5,2)=1.5 (kills int-truncation), mod(-5.5,2)=-1.5 & mod(5.5,-2)=1.5
 *    (sign-of-dividend — kills floored-mod), pow(2,-1)=0.5 (kills reject-all-negatives),
 *    pow(0,0)=1 (kills naive pow). */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DECIMAL_DIV_ZERO_FAILCLOSE,
  DECIMAL_MOD_ZERO_FAILCLOSE,
  DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
  DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE,
  decimalImportLineTS,
  decimalOpsHelpersTS,
  emitExpressionWithImports,
  makeEnv,
  parseExpression,
  ReferenceRunnerError,
  referenceRun,
  registerExpressionV1Contract,
} from '@kernlang/core';
import { emitPyExpressionWithImports } from '../src/codegen-body-python.js';
import { KERN_DECIMAL_STR_HELPER_PY } from '../src/core/expr/index.js';

// The runner leg is the PRODUCTION path (referenceRun → expression-v1 contract).
registerExpressionV1Contract(); // idempotent.

/** Canonical rendering shared by all three legs: a boolean → lowercase token (defensive
 *  — producers never yield bools), everything else → its plain string. A producer's
 *  observable is already the canonical Decimal STRING. */
function showValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Run a single KERN expression through the production runner, returning the raw bound
 *  value of `r` (for a producer this is the canonical rendered Decimal string). */
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

/** The runner leg, rendered to the canonical token/string. */
function runRef(src: string): string {
  return showValue(runRefRaw(src));
}

/** Run a __block of `let`-bindings then a final `r = finalExpr`, returning the canonical
 *  rendering of `r`. The ONLY way to exercise variable operands (`Decimal.sub(d, e)`,
 *  `Decimal.pow(Decimal.of("2"), d)`) — the single-expression emit legs cannot bind. */
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

// ── emitted-leg execution harness (mirrors the slice-3 emission differential) ──────────
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

// ── runtime_3leg: producer VALUES (ref === ts === py, byte-exact) ──────────────────────
execDescribe('Decimal Slice 3 — RUNNER-NATIVE producers (ref === ts === py)', () => {
  // [KERN source, expected canonical value on ALL THREE legs]. Computed under the pinned
  // prec-28 / ROUND_HALF_EVEN / modulo-ROUND_DOWN context — never guessed.
  const cases: Array<[string, string]> = [
    // sub — non-associative, sign-bearing.
    ['Decimal.sub(Decimal.of("5"), Decimal.of("3"))', '2'],
    ['Decimal.sub(Decimal.of("1"), Decimal.of("3"))', '-2'],
    ['Decimal.sub(Decimal.of("0.3"), Decimal.of("0.1"))', '0.2'],
    // computed zero renders unsigned "0" on all three legs (no -0 leak).
    ['Decimal.sub(Decimal.of("3"), Decimal.of("3"))', '0'],
    // neg / abs (arity 1) — incl. double-negation and abs of a computed negative.
    ['Decimal.neg(Decimal.neg(Decimal.of("5")))', '5'],
    ['Decimal.neg(Decimal.of("0"))', '0'],
    ['Decimal.abs(Decimal.of("5"))', '5'],
    ['Decimal.abs(Decimal.neg(Decimal.of("5")))', '5'],
    ['Decimal.abs(Decimal.sub(Decimal.of("1"), Decimal.of("3")))', '2'],
    // -0 RESIDUE: mul/abs/neg can yield a SIGN-BEARING zero (decimal.js .s=-1; Python
    // str(Decimal("0")*Decimal("-1")) == "-0"). All three render paths must clamp it to
    // unsigned "0" — decimal.js native .toString, the runner's kernDecimalStr isZero-clamp,
    // and Python's _kern_decimal_str is_zero-clamp. mul(0,-1) is the KILLER: Python's RAW
    // str() leaks "-0", so this fixture proves the Python clamp is load-bearing (a regression
    // that dropped it would diverge the Py leg while TS+runner stay "0").
    ['Decimal.mul(Decimal.of("0"), Decimal.of("-1"))', '0'],
    ['Decimal.abs(Decimal.neg(Decimal.of("0")))', '0'],
    // div — the precision/rounding discriminators.
    ['Decimal.div(Decimal.of("6"), Decimal.of("3"))', '2'],
    ['Decimal.div(Decimal.of("10"), Decimal.of("4"))', '2.5'],
    // non-terminating: 28 threes under prec-28 (a host-float impl diverges).
    ['Decimal.div(Decimal.of("1"), Decimal.of("3"))', '0.3333333333333333333333333333'],
    // ROUND_HALF_EVEN at the 28th digit rounds UP (a ROUND_DOWN impl diverges).
    ['Decimal.div(Decimal.of("2"), Decimal.of("3"))', '0.6666666666666666666666666667'],
    // mod — truncated remainder, sign-of-dividend (ROUND_DOWN modulo).
    ['Decimal.mod(Decimal.of("10"), Decimal.of("3"))', '1'],
    ['Decimal.mod(Decimal.of("5.5"), Decimal.of("2"))', '1.5'], // kills int-truncation (→1)
    ['Decimal.mod(Decimal.neg(Decimal.of("5.5")), Decimal.of("2"))', '-1.5'], // sign-of-dividend
    ['Decimal.mod(Decimal.of("5.5"), Decimal.neg(Decimal.of("2")))', '1.5'], // sign follows dividend, not divisor
    ['Decimal.mod(Decimal.neg(Decimal.of("4")), Decimal.of("2"))', '0'], // exact multiple → clamped "0", never "-0"
    // pow — integer exponent on non-negative base.
    ['Decimal.pow(Decimal.of("2"), Decimal.of("3"))', '8'],
    ['Decimal.pow(Decimal.of("2"), Decimal.of("0"))', '1'],
    ['Decimal.pow(Decimal.of("2"), Decimal.of("-1"))', '0.5'], // negative integer exp ALLOWED
    ['Decimal.pow(Decimal.of("0"), Decimal.of("0"))', '1'], // 0**0 special-case (naive pow diverges)
    ['Decimal.pow(Decimal.of("10"), Decimal.of("3"))', '1000'],
    // nesting across producers — the read+write loop composes.
    ['Decimal.add(Decimal.div(Decimal.of("1"), Decimal.of("4")), Decimal.of("0.75"))', '1'],
    ['Decimal.mul(Decimal.sub(Decimal.of("5"), Decimal.of("3")), Decimal.of("4"))', '8'],
    ['Decimal.div(Decimal.pow(Decimal.of("2"), Decimal.of("3")), Decimal.of("2"))', '4'],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice3-runner-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // TS preamble: the decimal import + the guarded-ops helpers, type-erased for plain
  // `node` (.mjs) execution — identical erasure to what tsc does at emit (runtime logic
  // untouched), mirroring the emission slice-3 differential harness.
  function decimalOpsHelpersJS(): string {
    return decimalOpsHelpersTS().replace(/: Decimal/g, '');
  }
  function tsDecimalPreamble(): string {
    return [decimalImportLineTS(), decimalOpsHelpersJS()].join('\n').replace("'decimal.js'", `'${decimalJsPath}'`);
  }

  function runTs(src: string): string {
    const r = emitExpressionWithImports(parseExpression(src));
    const file = join(dir, 'prod.mjs');
    writeFileSync(file, `${r.imports.has('decimal.js') ? tsDecimalPreamble() : ''}\nconsole.log(String(${r.code}));\n`);
    return execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  function runPy(src: string): string {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const helpers = [...r.helpers].join('\n\n');
    const file = join(dir, 'prod.py');
    writeFileSync(
      file,
      [
        'from decimal import getcontext, ROUND_HALF_EVEN, ROUND_DOWN',
        imports,
        helpers,
        KERN_DECIMAL_STR_HELPER_PY,
        'getcontext().prec = 28',
        'getcontext().rounding = ROUND_HALF_EVEN',
        `print(_kern_decimal_str(${r.code}))`,
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

// ── VARIABLE OPERANDS — env-threaded ident resolution into producers (runner-only) ─────
// A bound runner Decimal value flowing INTO a producer. The single-expression emit legs
// can't bind `let`s; the 3-leg value parity is proven above, here we prove the runner
// resolves an ident operand (incl. a COMPUTED binding) back to the identical value.
describe('Decimal Slice 3 — runner resolves variable operands into producers', () => {
  test('bound operands subtract', () => {
    expect(
      runRefBlock(
        [
          ['d', 'Decimal.of("5")'],
          ['e', 'Decimal.of("3")'],
        ],
        'Decimal.sub(d, e)',
      ),
    ).toBe('2');
  });
  test('a bound operand divided by a nested producer', () => {
    expect(
      runRefBlock([['d', 'Decimal.of("8")']], 'Decimal.div(d, Decimal.add(Decimal.of("2"), Decimal.of("2")))'),
    ).toBe('2');
  });
  test('neg/abs resolve a bound operand', () => {
    expect(runRefBlock([['d', 'Decimal.of("7")']], 'Decimal.neg(d)')).toBe('-7');
    expect(runRefBlock([['d', 'Decimal.neg(Decimal.of("7"))']], 'Decimal.abs(d)')).toBe('7');
  });
  test('a COMPUTED binding feeds a producer: (1/3)*3 stays 0.999…9 (NO host-float / unity collapse)', () => {
    // (1/3)*3 under prec-28 is 0.9999999999999999999999999999 (28 nines) — NOT 1.
    // 1/3 rounds to 28 threes, ×3 is exactly 28 nines (already 28 sig-figs, no further
    // rounding). decimal.js, Python `decimal`, and the kernel all agree. This kills both
    // a host-float impl (JS (1/3)*3 === 1) AND any "saturated-unity" normalization that
    // forces the runner to 1 and diverges it from the two emitted legs.
    expect(
      runRefBlock([['third', 'Decimal.div(Decimal.of("1"), Decimal.of("3"))']], 'Decimal.mul(third, Decimal.of("3"))'),
    ).toBe('0.9999999999999999999999999999');
  });
  test('a bound result feeds a comparator (write path joins read path)', () => {
    expect(
      runRefBlock([['d', 'Decimal.sub(Decimal.of("5"), Decimal.of("3"))']], 'Decimal.eq(d, Decimal.of("2"))'),
    ).toBe('true');
  });
  test('a producer with a LITERAL integer pow exponent + bound base is fine', () => {
    expect(runRefBlock([['b', 'Decimal.of("2")']], 'Decimal.pow(b, Decimal.of("10"))')).toBe('1024');
  });
});

// ── re-admit fail-close — the runner is a THIRD leg for FAILURES (byte-identical msg) ───
// Each throws the SAME kernel constant the two emitted legs throw (their byte-identical
// refusal is locked by decimal-emission-slice3-python.test.ts). The precondition re-admits
// these canonical decimal fail-closes to effects, so `referenceRun` surfaces the RAW
// message (NOT collapsed into "Preconditions failed"), exactly like slice 1's `of("1.10")`.
describe('Decimal Slice 3 — runner re-admits div/mod-by-zero (byte-identical kernel message)', () => {
  test('literal-zero divisor → DECIMAL_DIV_ZERO_FAILCLOSE through referenceRun', () => {
    expect(() => runRefRaw('Decimal.div(Decimal.of("1"), Decimal.of("0"))')).toThrow(DECIMAL_DIV_ZERO_FAILCLOSE);
  });
  test('literal-zero modulus → DECIMAL_MOD_ZERO_FAILCLOSE through referenceRun', () => {
    expect(() => runRefRaw('Decimal.mod(Decimal.of("1"), Decimal.of("0"))')).toThrow(DECIMAL_MOD_ZERO_FAILCLOSE);
  });
  test('a DYNAMIC (computed, variable-bound) zero divisor also fails closed — runtime guard', () => {
    // The zero is not provable syntactically; the runtime guard (kDecimalDiv) must fire.
    expect(() =>
      runRefBlock([['z', 'Decimal.sub(Decimal.of("1"), Decimal.of("1"))']], 'Decimal.div(Decimal.of("9"), z)'),
    ).toThrow(DECIMAL_DIV_ZERO_FAILCLOSE);
  });
  test('a nested div-by-zero inside another producer fails closed', () => {
    expect(() => runRefRaw('Decimal.add(Decimal.div(Decimal.of("1"), Decimal.of("0")), Decimal.of("1"))')).toThrow(
      DECIMAL_DIV_ZERO_FAILCLOSE,
    );
  });

  // EVAL-ORDER: the literal-zero divisor is a SYNTACTIC compile-gate that must fire BEFORE
  // any operand is evaluated — so a literal-zero divisor refuses with DIV/MOD_ZERO even when
  // the FIRST operand would itself abstain (here `missing` is unbound). A runtime-guard-only
  // impl evaluates `missing` first and ABSTAINS ("Preconditions failed"), diverging from the
  // emitters' compile-time refusal — this fixture forces the gate into the pre-eval phase.
  test('literal-zero divisor refuses BEFORE an abstaining first operand evaluates (div)', () => {
    expect(() => runRefRaw('Decimal.div(missing, Decimal.of("0"))')).toThrow(DECIMAL_DIV_ZERO_FAILCLOSE);
  });
  test('literal-zero modulus refuses BEFORE an abstaining first operand evaluates (mod)', () => {
    expect(() => runRefRaw('Decimal.mod(missing, Decimal.of("0"))')).toThrow(DECIMAL_MOD_ZERO_FAILCLOSE);
  });
});

describe('Decimal Slice 3 — runner replicates the pow compile-gate (refuse what emitters refuse)', () => {
  // THE soundness-critical guard-in-seam case: slice-2 gave the runner variable operands,
  // so a naive pow wiring would RESOLVE `d` and compute 2**3 = 8. The emitters refuse a
  // non-literal exponent at COMPILE time, so the runner must gate BEFORE evaluating and
  // throw the byte-identical pow fail-close — never compute a value.
  test('non-literal (variable) exponent is REFUSED even when it would resolve to an integer', () => {
    expect(() => runRefBlock([['d', 'Decimal.of("3")']], 'Decimal.pow(Decimal.of("2"), d)')).toThrow(
      DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
    );
  });
  test('a computed (add-result) exponent is REFUSED (not proven integer at compile time)', () => {
    expect(() => runRefRaw('Decimal.pow(Decimal.of("2"), Decimal.add(Decimal.of("1"), Decimal.of("1")))')).toThrow(
      DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
    );
  });
  test('a NON-INTEGER literal exponent is REFUSED', () => {
    expect(() => runRefRaw('Decimal.pow(Decimal.of("2"), Decimal.of("0.5"))')).toThrow(
      DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
    );
  });
  test('a syntactically-NEGATIVE base literal is REFUSED', () => {
    expect(() => runRefRaw('Decimal.pow(Decimal.of("-2"), Decimal.of("3"))')).toThrow(
      DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
    );
  });
  // TRANSPARENT WRAPPER (`as T` / `!`) on the exponent does NOT make it a provable integer
  // literal: the emitters read the raw arg node and refuse a wrapped exponent (verified —
  // emit throws POW_NON_INTEGER), so the runner's gate, reading the SAME raw node, must
  // refuse identically rather than unwrap-and-accept. Guards the recurring transparent-
  // wrapper operand-bypass class (cf. the slice-3 emission wrapper-bypass fixes).
  test('a TRANSPARENT-WRAPPED exponent (`as Decimal`) is REFUSED, matching the emitters', () => {
    expect(() => runRefRaw('Decimal.pow(Decimal.of("2"), Decimal.of("3") as Decimal)')).toThrow(
      DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
    );
  });
  // 0**neg passes the compile gate (base "0" non-negative, exp "-1" integer literal) and
  // is caught by the RUNTIME guard (kDecimalPowInt) → zero-divide error, byte-identical.
  test('0 ** negative is caught by the runtime pow guard (zero-divide)', () => {
    expect(() => runRefRaw('Decimal.pow(Decimal.of("0"), Decimal.of("-1"))')).toThrow(
      DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE,
    );
  });
});

// ── abstain — the runner REFUSES a genuinely unjudgeable producer operand ──────────────
// A non-Decimal / unbound operand COMPILES (idents pass the emitter's non-Decimal check —
// no typed IR) but the runner cannot execute it byte-identically, so it ABSTAINS with the
// normal "Preconditions failed …" — refuse, never fabricate a value.
describe('Decimal Slice 3 — runner ABSTAINS on a non-Decimal / unbound producer operand', () => {
  test('Decimal.sub(d, s) with s a string binding ABSTAINS', () => {
    const lets: Array<[string, string]> = [
      ['d', 'Decimal.of("5")'],
      ['s', '"3"'],
    ];
    expect(() => runRefBlock(lets, 'Decimal.sub(d, s)')).toThrow(ReferenceRunnerError);
    expect(() => runRefBlock(lets, 'Decimal.sub(d, s)')).toThrow('Preconditions failed');
  });
  test('Decimal.div(d, n) with n a number binding ABSTAINS', () => {
    const lets: Array<[string, string]> = [
      ['d', 'Decimal.of("6")'],
      ['n', '3'],
    ];
    expect(() => runRefBlock(lets, 'Decimal.div(d, n)')).toThrow('Preconditions failed');
  });
  test('Decimal.neg(missing) with an unbound operand ABSTAINS', () => {
    expect(() => runRefRaw('Decimal.neg(missing)')).toThrow('Preconditions failed');
  });
  test('a non-Decimal LITERAL producer operand ABSTAINS (does not compute)', () => {
    expect(() => runRefRaw('Decimal.sub(Decimal.of("5"), 3)')).toThrow('Preconditions failed');
    expect(() => runRefRaw('Decimal.div(3, Decimal.of("1"))')).toThrow('Preconditions failed');
  });
});
