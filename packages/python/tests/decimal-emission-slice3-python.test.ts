/** DECIMAL Slice 3 — PYTHON leg emission + DIFFERENTIAL EXECUTION for the
 *  arithmetic+comparison completion surface (`div`/`mod`/`pow` + the comparators
 *  `eq`/`ne`/`lt`/`lte`/`gt`/`gte`/`cmp`).
 *
 *  This is the slice's ORACLE. It compiles each KERN expression to BOTH legs, runs
 *  node+decimal.js AND python3+stdlib-decimal under the pinned prec-28 /
 *  ROUND_HALF_EVEN context, renders the Decimal result through the canonical
 *  stringifier (`_kern_decimal_str`), and BYTE-COMPARES. A wrong impl FAILS it.
 *
 *  The pinned uncertain-parity cases the spec demands (run through BOTH runtimes
 *  before the ship-vs-fail-close decision):
 *    - div NON-TERMINATING quotients (1/3, 10/3, 2/7, 100/3, 22/7) — SHIPPED:
 *      empirically byte-identical under the pinned context.
 *    - mod NEGATIVE-operand SIGN (-5.5%2, 5.5%-2, -5.5%-2, -7%3, 7%-3) — SHIPPED:
 *      decimal.js `.mod` (truncated) and Python `%` agree on sign for all.
 *    - pow 0**0=1 (Python `**` RAISES under default context — the helper's
 *      `0**0 → Decimal(1)` special-case is what makes both legs agree), positive,
 *      negative int (2**-1), large (10**28 → `1e+28`).
 *  And the fail-close cases: div/mod by zero throw the byte-identical KERN string on
 *  BOTH legs; 0**-1 throws the byte-identical zero-error on both legs; non-integer /
 *  negative-base / non-literal pow exponents fail closed at COMPILE time symmetrically. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DECIMAL_DIV_ZERO_FAILCLOSE,
  DECIMAL_MOD_ZERO_FAILCLOSE,
  DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE,
  DECIMAL_POW_NEGATIVE_BASE_FAILCLOSE,
  DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
  DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE,
  DECIMAL_UNARY_OPERAND_FAILCLOSE,
  decimalImportLineTS,
  decimalOpsHelpersTS,
  emitExpression,
  emitExpressionWithImports,
  KERN_DECIMAL_OPS_HELPER_PY,
  parseExpression,
} from '@kernlang/core';
import { emitPyExpression, emitPyExpressionWithImports } from '../src/codegen-body-python.js';
import { KERN_DECIMAL_STR_HELPER_PY } from '../src/core/expr/index.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

/** The generated decimal preamble is TYPESCRIPT (the `__k_decimal_*` helpers carry
 *  `a: Decimal` annotations, as they must in a real `.ts` artifact compiled by the
 *  user's tsc). The differential EXECUTION test, however, runs the emitted code
 *  through plain `node` (`.mjs`), which cannot parse TS type annotations. We strip
 *  the (simple, known) param/return type annotations to produce a JS-runnable
 *  twin — execution-only erasure, identical to what `tsc` does at emit time. The
 *  RUNTIME LOGIC (the guards, the `new Decimal(1)`) is untouched, so the byte-exact
 *  parity the test proves is the real lowering's, not a test-specific variant. */
function decimalOpsHelpersJS(): string {
  // The ONLY `: Decimal` occurrences in the helper text are the param/return TYPE
  // annotations (the bodies reference `new Decimal(1)` / `a.div(b)` — never `:
  // Decimal`), so erasing `: Decimal` globally is the exact TS→JS type erasure.
  return decimalOpsHelpersTS().replace(/: Decimal/g, '');
}

function tsDecimalPreamble(): string {
  return [decimalImportLineTS(), decimalOpsHelpersJS()].join('\n').replace("'decimal.js'", `'${decimalJsPath}'`);
}

// ── Emission locks (Python leg) ──────────────────────────────────────────────
describe('Decimal Slice 3 — Python div/mod/pow/comparison emission', () => {
  test('Decimal.div → guarded helper call', () => {
    expect(py('Decimal.div(Decimal.of("1"), Decimal.of("3"))')).toBe(
      '__k_decimal_div(__k_decimal.Decimal("1"), __k_decimal.Decimal("3"))',
    );
  });
  test('Decimal.mod → guarded helper call', () => {
    expect(py('Decimal.mod(Decimal.of("-5.5"), Decimal.of("2"))')).toBe(
      '__k_decimal_mod(__k_decimal.Decimal("-5.5"), __k_decimal.Decimal("2"))',
    );
  });
  test('Decimal.pow → integer-pow guarded helper call', () => {
    expect(py('Decimal.pow(Decimal.of("2"), Decimal.of("3"))')).toBe(
      '__k_decimal_pow_int(__k_decimal.Decimal("2"), __k_decimal.Decimal("3"))',
    );
  });
  test('comparators → native operators, cmp → int(compare())', () => {
    expect(py('Decimal.eq(Decimal.of("1"), Decimal.of("1"))')).toBe(
      '(__k_decimal.Decimal("1") == __k_decimal.Decimal("1"))',
    );
    expect(py('Decimal.ne(Decimal.of("1"), Decimal.of("2"))')).toBe(
      '(__k_decimal.Decimal("1") != __k_decimal.Decimal("2"))',
    );
    expect(py('Decimal.lt(Decimal.of("1"), Decimal.of("2"))')).toBe(
      '(__k_decimal.Decimal("1") < __k_decimal.Decimal("2"))',
    );
    expect(py('Decimal.lte(Decimal.of("2"), Decimal.of("2"))')).toBe(
      '(__k_decimal.Decimal("2") <= __k_decimal.Decimal("2"))',
    );
    expect(py('Decimal.gt(Decimal.of("3"), Decimal.of("2"))')).toBe(
      '(__k_decimal.Decimal("3") > __k_decimal.Decimal("2"))',
    );
    expect(py('Decimal.gte(Decimal.of("3"), Decimal.of("3"))')).toBe(
      '(__k_decimal.Decimal("3") >= __k_decimal.Decimal("3"))',
    );
    expect(py('Decimal.cmp(Decimal.of("1"), Decimal.of("2"))')).toBe(
      'int(__k_decimal.Decimal("1").compare(__k_decimal.Decimal("2")))',
    );
  });
  test('div/mod/pow register the decimal import AND the guarded-ops helper', () => {
    const r = emitPyExpressionWithImports(parseExpression('Decimal.div(Decimal.of("1"), Decimal.of("3"))'));
    expect([...r.imports]).toEqual(['decimal']);
    expect([...r.helpers].some((h) => h.includes('def __k_decimal_div'))).toBe(true);
  });
});

// ── Symmetric COMPILE-TIME fail-close: pow non-integer / negative-base / non-literal
/** Assert BOTH legs refuse `src` with a byte-identical message containing
 *  `expectedSubstring`. The optional `mustNotContain` discriminates the two
 *  prefix-sharing operand fail-closes (`DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE` and
 *  `DECIMAL_UNARY_OPERAND_FAILCLOSE` share the same PREFIX): a signed host literal
 *  (`-0.1`) must point at `Decimal.of("...")` and must NOT mention `Decimal.neg`,
 *  while a unary-on-a-producer (`-Decimal.of("0")`) is the reverse. Returns the
 *  verified-symmetric message. */
function assertSymmetricThrow(src: string, expectedSubstring: string, mustNotContain?: string): string {
  let tsMsg = '';
  let pyMsg = '';
  try {
    ts(src);
    throw new Error(`TS did not throw for ${src}`);
  } catch (e) {
    tsMsg = (e as Error).message;
  }
  try {
    py(src);
    throw new Error(`Python did not throw for ${src}`);
  } catch (e) {
    pyMsg = (e as Error).message;
  }
  expect(tsMsg).toContain(expectedSubstring);
  if (mustNotContain !== undefined) expect(tsMsg).not.toContain(mustNotContain);
  expect(tsMsg).toBe(pyMsg); // byte-identical refusal across targets
  return tsMsg;
}

describe('Decimal Slice 3 — symmetric compile-time pow fail-close', () => {
  test('non-integer exponent fails closed symmetrically', () => {
    assertSymmetricThrow('Decimal.pow(Decimal.of("2"), Decimal.of("0.5"))', DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
  test('negative base fails closed symmetrically', () => {
    assertSymmetricThrow('Decimal.pow(Decimal.of("-2"), Decimal.of("3"))', DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
  test('non-literal (dynamic) exponent fails closed symmetrically — the soundness-critical case', () => {
    assertSymmetricThrow('Decimal.pow(Decimal.of("2"), x)', DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
    assertSymmetricThrow(
      'Decimal.pow(Decimal.of("2"), Decimal.add(Decimal.of("1"), Decimal.of("1")))',
      DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE,
    );
  });
  test('integer exponent on non-negative base does NOT fail closed', () => {
    expect(() => ts('Decimal.pow(Decimal.of("2"), Decimal.of("3"))')).not.toThrow();
    expect(() => py('Decimal.pow(Decimal.of("2"), Decimal.of("-1"))')).not.toThrow();
    expect(() => ts('Decimal.pow(Decimal.of("0"), Decimal.of("0"))')).not.toThrow();
  });
});

// ── FIX 2 (remediation) — literal-zero div/mod divisor: SYMMETRIC compile-time refusal
describe('Decimal Slice 3 (remediation) — literal-zero divisor fails closed symmetrically', () => {
  test('Decimal.div(x, Decimal.of("0")) — byte-identical refusal across legs', () => {
    assertSymmetricThrow('Decimal.div(Decimal.of("1"), Decimal.of("0"))', DECIMAL_DIV_ZERO_FAILCLOSE);
  });
  test('Decimal.mod(x, Decimal.of("0")) — byte-identical refusal across legs', () => {
    assertSymmetricThrow('Decimal.mod(Decimal.of("1"), Decimal.of("0"))', DECIMAL_MOD_ZERO_FAILCLOSE);
  });
  test('a non-zero / dynamic divisor still ships on both legs', () => {
    expect(() => ts('Decimal.div(Decimal.of("1"), Decimal.of("3"))')).not.toThrow();
    expect(() => py('Decimal.div(Decimal.of("1"), Decimal.of("3"))')).not.toThrow();
    expect(() => ts('Decimal.div(Decimal.of("1"), d)')).not.toThrow();
    expect(() => py('Decimal.div(Decimal.of("1"), d)')).not.toThrow();
  });
});

// ── FIX 3 (remediation) — non-Decimal LITERAL operand: SYMMETRIC compile-time refusal.
//    This is the slice's load-bearing parity guard: WITHOUT it, the two legs would
//    SILENTLY diverge (no exception either side) on `Decimal.eq(Decimal.of("1"), 0.1)`.
describe('Decimal Slice 3 (remediation) — non-Decimal operand fails closed symmetrically', () => {
  test('number-literal operand — comparator / arithmetic / div / mod / unary', () => {
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), 0.1)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.add(Decimal.of("1"), 0.1)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.div(Decimal.of("1"), 0.1)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.mod(Decimal.of("1"), 0.1)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.neg(0.1)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('number literal as FIRST operand — symmetric', () => {
    assertSymmetricThrow('Decimal.eq(0.1, Decimal.of("1"))', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('UNARY-signed number literal (-0.1) — symmetric (parses as unary(numLit))', () => {
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), -0.1)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.add(Decimal.of("1"), -5)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('bool / string literal operand — symmetric', () => {
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), true)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.lt(Decimal.of("1"), "x")', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('LEGITIMATE Decimal operands still ship on both legs (no false-fire on var / nested producer)', () => {
    expect(() => ts('Decimal.eq(d, e)')).not.toThrow();
    expect(() => py('Decimal.eq(d, e)')).not.toThrow();
    expect(() => ts('Decimal.add(d, Decimal.of("2"))')).not.toThrow();
    expect(() => py('Decimal.add(d, Decimal.of("2"))')).not.toThrow();
  });
});

// ── FIX 3b (confirmation-review BLOCKER) — a UNARY-PREFIXED operand unwrapping to a
//    `call` (`-Decimal.of("0")`) used to slip the operand guard and EMIT asymmetric
//    code: `__k_decimal_div(new Decimal("1"), (-new Decimal("0")))` on TS (decimal.js
//    `.valueOf()` coerces the Decimal → host `-0`, helper throws a bare `TypeError`)
//    vs `__k_decimal_div(__k_decimal.Decimal("1"), (-__k_decimal.Decimal("0")))` on
//    Python (real Decimal, raises the intended KERN division-by-zero). The fix
//    fail-closes ANY unary operand byte-identically on BOTH legs — proven here.
describe('Decimal Slice 3 (remediation) — unary-prefixed operand fails closed symmetrically', () => {
  test('THE REPRO: Decimal.div(Decimal.of("1"), -Decimal.of("0")) — byte-identical refusal points at Decimal.neg(x), NOT Decimal.of("...")', () => {
    // A unary on a PRODUCER (a `call`): the portable fix IS `Decimal.neg(x)`, so the
    // symmetric message must say so and must NOT misdirect to `Decimal.of("...")`.
    assertSymmetricThrow('Decimal.div(Decimal.of("1"), -Decimal.of("0"))', 'Decimal.neg(x)', 'Decimal.of("...")');
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), -Decimal.of("1"))', 'Decimal.neg(x)', 'Decimal.of("...")');
  });
  test('-Decimal.of("1") on div and on a comparator — symmetric', () => {
    assertSymmetricThrow('Decimal.div(-Decimal.of("1"), Decimal.of("2"))', DECIMAL_UNARY_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.eq(-Decimal.of("1"), Decimal.of("1"))', DECIMAL_UNARY_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.add(Decimal.of("1"), -Decimal.of("1"))', DECIMAL_UNARY_OPERAND_FAILCLOSE);
  });
  test('other unary operators (~, !) on a Decimal producer — symmetric', () => {
    assertSymmetricThrow('Decimal.add(Decimal.of("1"), ~Decimal.of("1"))', DECIMAL_UNARY_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), !Decimal.of("1"))', DECIMAL_UNARY_OPERAND_FAILCLOSE);
  });
  test('REGRESSION: unary-signed non-Decimal literal (-0.1, -5) fails closed symmetrically with Decimal.of("...") advice (NOT Decimal.neg)', () => {
    // `-0.1` / `-5` are `unary(numLit)` — a SIGNED HOST LITERAL. The routing inspects
    // the unary's `.argument` and gives the `Decimal.of("...")` fix on BOTH legs, never
    // the misleading `Decimal.neg` advice. (Discriminates the two prefix-sharing
    // fail-closes; the old prefix-only assertion could not tell them apart.)
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), -0.1)', 'Decimal.of("...")', 'Decimal.neg');
    assertSymmetricThrow('Decimal.add(Decimal.of("1"), -5)', 'Decimal.of("...")', 'Decimal.neg');
  });
  test('SOUND: METHOD negation Decimal.neg(...) still emits on BOTH legs (it is a call, not a unary)', () => {
    expect(() => ts('Decimal.neg(Decimal.of("1"))')).not.toThrow();
    expect(() => py('Decimal.neg(Decimal.of("1"))')).not.toThrow();
    expect(() => ts('Decimal.add(Decimal.of("1"), Decimal.neg(Decimal.of("2")))')).not.toThrow();
    expect(() => py('Decimal.add(Decimal.of("1"), Decimal.neg(Decimal.of("2")))')).not.toThrow();
  });
});

// ── FIX 3c (transparent-wrapper bypass) — the operand checks inspected only the TOP-LEVEL
//    IR kind, so the transparent wrappers `typeAssert` (`x as T`) and `nonNull` (`x!`) hid a
//    wrapped unary or non-Decimal literal and let it bypass. A cast-wrapped literal
//    (`(0.1 as any)`) would EMIT `.eq(0.1)` on TS (decimal.js coerces the clean string) vs
//    `== Decimal("0.1")` mismatch on Python — silent boolean divergence; a nonNull-wrapped
//    unary (`(-Decimal.of("0"))!`) would emit the degrading `-new Decimal("0")` on TS
//    (`.valueOf()` → host -0 → bare TypeError) vs a real Decimal on Python — asymmetric. The
//    fix recursively unwraps the wrappers before both checks, so every wrapper shape is
//    refused byte-identically on BOTH legs (proven here via assertSymmetricThrow).
describe('Decimal Slice 3 (remediation) — transparent-wrapper (as / !) operand bypass, symmetric', () => {
  test('cast-wrapped non-Decimal literal (0.1 as any) — byte-identical refusal on both legs', () => {
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), (0.1 as any))', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.add(Decimal.of("1"), (0.1 as any))', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.div(Decimal.of("1"), (true as any))', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('nonNull-wrapped degrading unary (-Decimal.of("0"))! — byte-identical refusal', () => {
    assertSymmetricThrow('Decimal.div(Decimal.of("1"), (-Decimal.of("0"))!)', DECIMAL_UNARY_OPERAND_FAILCLOSE);
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), (~Decimal.of("1"))!)', DECIMAL_UNARY_OPERAND_FAILCLOSE);
  });
  test('nonNull-wrapped non-Decimal literal — byte-identical refusal', () => {
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), (0.1 as any)!)', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
  });
  test('nested / combined wrappers (cast of cast, cast + nonNull) — symmetric', () => {
    assertSymmetricThrow('Decimal.eq(Decimal.of("1"), ((0.1 as any) as any))', DECIMAL_NON_DECIMAL_OPERAND_FAILCLOSE);
    assertSymmetricThrow(
      'Decimal.div(Decimal.of("1"), ((-Decimal.of("0") as Decimal))!)',
      DECIMAL_UNARY_OPERAND_FAILCLOSE,
    );
  });
  test('the flagship repro (-Decimal.of("0") as Decimal) — byte-identical refusal (top-level unary by precedence)', () => {
    assertSymmetricThrow(
      'Decimal.div(Decimal.of("1"), (-Decimal.of("0") as Decimal))',
      DECIMAL_UNARY_OPERAND_FAILCLOSE,
    );
  });
  test('SOUND: a cast of a REAL Decimal producer still emits on BOTH legs (no false-fire)', () => {
    expect(() => ts('Decimal.div(Decimal.of("1"), (Decimal.of("2") as Decimal))')).not.toThrow();
    expect(() => py('Decimal.div(Decimal.of("1"), (Decimal.of("2") as Decimal))')).not.toThrow();
    expect(() => ts('Decimal.eq((Decimal.of("1"))!, Decimal.of("2"))')).not.toThrow();
    expect(() => py('Decimal.eq((Decimal.of("1"))!, Decimal.of("2"))')).not.toThrow();
  });
});

// ── FIX 4 (remediation) — arity precedes the positional pow read on the PYTHON leg too
describe('Decimal Slice 3 (remediation) — pow arity ordering on the Python leg', () => {
  test('Decimal.pow with one arg yields the arity error, not the pow-integer message', () => {
    expect(() => py('Decimal.pow(Decimal.of("2"))')).toThrow("Decimal.pow' takes 2 args, got 1");
    expect(() => py('Decimal.pow(Decimal.of("2"))')).not.toThrow(DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE);
  });
});

// ── Differential execution: emit → run BOTH legs → diff byte-exact output ─────
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

execDescribe('Decimal Slice 3 — DIFFERENTIAL EXECUTION (byte-exact runtime parity)', () => {
  // [KERN source, expected canonical rendered value on BOTH legs]. PINS the
  // uncertain parities (div non-terminating, mod sign) that were run through BOTH
  // runtimes before deciding to ship them.
  const cases: Array<[string, string]> = [
    // div: terminating
    ['Decimal.div(Decimal.of("1"), Decimal.of("8"))', '0.125'],
    ['Decimal.div(Decimal.of("6"), Decimal.of("2"))', '3'],
    ['Decimal.div(Decimal.of("0.3"), Decimal.of("0.6"))', '0.5'],
    // div: NON-TERMINATING (the PINNED-uncertain set — byte-identical under prec 28)
    ['Decimal.div(Decimal.of("1"), Decimal.of("3"))', '0.3333333333333333333333333333'],
    ['Decimal.div(Decimal.of("10"), Decimal.of("3"))', '3.333333333333333333333333333'],
    ['Decimal.div(Decimal.of("2"), Decimal.of("7"))', '0.2857142857142857142857142857'],
    ['Decimal.div(Decimal.of("100"), Decimal.of("3"))', '33.33333333333333333333333333'],
    ['Decimal.div(Decimal.of("22"), Decimal.of("7"))', '3.142857142857142857142857143'],
    ['Decimal.div(Decimal.of("-1"), Decimal.of("3"))', '-0.3333333333333333333333333333'],
    // mod: NEGATIVE-operand SIGN (the PINNED-uncertain set — signs agree on both legs)
    ['Decimal.mod(Decimal.of("-5.5"), Decimal.of("2"))', '-1.5'],
    ['Decimal.mod(Decimal.of("5.5"), Decimal.of("-2"))', '1.5'],
    ['Decimal.mod(Decimal.of("-5.5"), Decimal.of("-2"))', '-1.5'],
    ['Decimal.mod(Decimal.of("-7"), Decimal.of("3"))', '-1'],
    ['Decimal.mod(Decimal.of("7"), Decimal.of("-3"))', '1'],
    ['Decimal.mod(Decimal.of("5.5"), Decimal.of("2"))', '1.5'],
    ['Decimal.mod(Decimal.of("7"), Decimal.of("3"))', '1'],
    // pow: integer exponent (0**0 special-cased, positive, negative, large)
    ['Decimal.pow(Decimal.of("0"), Decimal.of("0"))', '1'],
    ['Decimal.pow(Decimal.of("2"), Decimal.of("3"))', '8'],
    ['Decimal.pow(Decimal.of("2"), Decimal.of("-1"))', '0.5'],
    ['Decimal.pow(Decimal.of("10"), Decimal.of("28"))', '1e+28'],
    ['Decimal.pow(Decimal.of("5"), Decimal.of("-2"))', '0.04'],
    ['Decimal.pow(Decimal.of("3"), Decimal.of("-3"))', '0.03703703703703703703703703704'],
    // composition: a div result fed into mod, a pow into div
    ['Decimal.mod(Decimal.div(Decimal.of("10"), Decimal.of("4")), Decimal.of("1"))', '0.5'],
    ['Decimal.div(Decimal.pow(Decimal.of("2"), Decimal.of("3")), Decimal.of("2"))', '4'],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice3-exec-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function runTs(src: string): string {
    const r = emitExpressionWithImports(parseExpression(src));
    // Reproduce the file-level decimal preamble: import + canonical context + the
    // guarded ops helpers (the exact text `kernStdlibPreamble` injects).
    const preamble = tsDecimalPreamble();
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `${r.imports.has('decimal.js') ? preamble : ''}\nconsole.log(String(${r.code}));\n`);
    return execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  function runPy(src: string): string {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const helpers = [...r.helpers].join('\n\n');
    const file = join(dir, 'run.py');
    writeFileSync(
      file,
      [
        'from decimal import getcontext, ROUND_HALF_EVEN',
        imports,
        KERN_DECIMAL_STR_HELPER_PY,
        helpers,
        'getcontext().prec = 28',
        'getcontext().rounding = ROUND_HALF_EVEN',
        `print(_kern_decimal_str(${r.code}))`,
      ].join('\n'),
    );
    return execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  for (const [src, expected] of cases) {
    test(`${src} → ${expected} on BOTH legs (byte-exact)`, () => {
      const tsOut = runTs(src);
      const pyOut = runPy(src);
      expect(tsOut).toBe(expected);
      expect(pyOut).toBe(expected);
      expect(tsOut).toBe(pyOut);
    });
  }
});

// ── Differential execution: COMPARATORS (bool / int) ─────────────────────────
execDescribe('Decimal Slice 3 — DIFFERENTIAL comparison (byte-exact bool/int parity)', () => {
  // [KERN source, expected canonical rendering of the bool/int result on BOTH legs].
  // Comparators are NOT routed through _kern_decimal_str — they are bool/int. We
  // render TS `String(expr)` ("true"/"false"/-1/0/1) against Python's lowercased
  // bool / int so the byte-compare is apples-to-apples.
  const cases: Array<[string, string]> = [
    ['Decimal.eq(Decimal.of("1"), Decimal.of("1"))', 'true'],
    ['Decimal.eq(Decimal.of("1"), Decimal.of("2"))', 'false'],
    ['Decimal.ne(Decimal.of("1"), Decimal.of("2"))', 'true'],
    ['Decimal.lt(Decimal.of("1"), Decimal.of("2"))', 'true'],
    ['Decimal.lte(Decimal.of("2"), Decimal.of("2"))', 'true'],
    ['Decimal.gt(Decimal.of("-1"), Decimal.of("-2"))', 'true'],
    ['Decimal.gte(Decimal.of("3"), Decimal.of("3"))', 'true'],
    // runtime-equal-via-arithmetic: 0.1 + 0.2 == 0.3 on both legs (decimal exactness)
    ['Decimal.eq(Decimal.add(Decimal.of("0.1"), Decimal.of("0.2")), Decimal.of("0.3"))', 'true'],
    // ordering across signs
    ['Decimal.cmp(Decimal.of("1"), Decimal.of("2"))', '-1'],
    ['Decimal.cmp(Decimal.of("2"), Decimal.of("1"))', '1'],
    ['Decimal.cmp(Decimal.of("-5"), Decimal.of("3"))', '-1'],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice3-cmp-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function renderPyBool(): string {
    // Python prints True/False/0/-1; normalize bool to JS lowercase for the compare.
    return [
      'def _show(__k_v):',
      '    if isinstance(__k_v, bool):',
      "        return 'true' if __k_v else 'false'",
      '    return str(__k_v)',
    ].join('\n');
  }

  function runTs(src: string): string {
    const r = emitExpressionWithImports(parseExpression(src));
    const preamble = tsDecimalPreamble();
    const file = join(dir, 'cmp.mjs');
    writeFileSync(file, `${r.imports.has('decimal.js') ? preamble : ''}\nconsole.log(String(${r.code}));\n`);
    return execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
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
        renderPyBool(),
        'getcontext().prec = 28',
        'getcontext().rounding = ROUND_HALF_EVEN',
        `print(_show(${r.code}))`,
      ].join('\n'),
    );
    return execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  for (const [src, expected] of cases) {
    test(`${src} → ${expected} on BOTH legs (byte-exact)`, () => {
      const tsOut = runTs(src);
      const pyOut = runPy(src);
      expect(tsOut).toBe(expected);
      expect(pyOut).toBe(expected);
      expect(tsOut).toBe(pyOut);
    });
  }

  // -0 ≡ 0 on both legs (decimal.js drops the sign of zero in compare; Python's
  // Decimal("-0") == Decimal("0") is True). NOTE: Decimal.of("-0") is fail-closed
  // by the literal contract, so we reach a signed zero only via arithmetic
  // (sub(x,x) on a non-zero x yields +0; neg of a zero result). We assert the
  // canonical equality holds for the zero produced by arithmetic.
  test('-0 ≡ 0 — a zero from arithmetic compares equal to a literal 0 on both legs', () => {
    const src = 'Decimal.eq(Decimal.sub(Decimal.of("5"), Decimal.of("5")), Decimal.of("0"))';
    const tsOut = runTs(src);
    const pyOut = runPy(src);
    expect(tsOut).toBe('true');
    expect(pyOut).toBe('true');
  });
});

// ── Differential execution: FAIL-CLOSE parity — div/mod by zero + 0**neg throw the
//    byte-identical KERN string on BOTH legs (neither engine's native error leaks).
execDescribe('Decimal Slice 3 — DIFFERENTIAL fail-close (byte-identical runtime diagnostic)', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice3-fc-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function runTsErr(src: string): string {
    const r = emitExpressionWithImports(parseExpression(src));
    const preamble = tsDecimalPreamble();
    const file = join(dir, 'fc.mjs');
    writeFileSync(
      file,
      `${preamble}\ntry { String(${r.code}); console.log("NO_THROW"); } catch (e) { console.log(e.message); }\n`,
    );
    return execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  function runPyErr(src: string): string {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const helpers = [...r.helpers].join('\n\n');
    const file = join(dir, 'fc.py');
    writeFileSync(
      file,
      [
        'from decimal import getcontext, ROUND_HALF_EVEN',
        imports,
        helpers,
        'getcontext().prec = 28',
        'getcontext().rounding = ROUND_HALF_EVEN',
        'try:',
        `    _kern_v = ${r.code}`,
        '    print("NO_THROW")',
        'except Exception as e:',
        '    print(str(e))',
      ].join('\n'),
    );
    return execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
  }

  // [KERN source, the exact KERN diagnostic both legs must raise]
  //
  // FIX 2 (remediation) note: a SYNTACTICALLY-ZERO `Decimal.of("0")` divisor is now
  // fail-closed at COMPILE time (see the symmetric compile-time suite above), so it
  // can no longer reach the RUNTIME helper. To keep proving the RUNTIME guard — whose
  // job is exactly the DYNAMIC zero the compile-time check cannot see — we feed it a
  // computed zero `Decimal.sub(Decimal.of("1"), Decimal.of("1"))` (a `call` node, not a
  // `Decimal.of` literal, so it passes the compile-time check) that evaluates to 0 on
  // BOTH legs and trips the helper's `b.isZero()` guard at runtime. `0**-1` likewise
  // exercises the runtime `0**neg` guard (base/exp are valid literals; no compile gate).
  const dynZero = 'Decimal.sub(Decimal.of("1"), Decimal.of("1"))';
  const cases: Array<[string, string]> = [
    [`Decimal.div(Decimal.of("1"), ${dynZero})`, DECIMAL_DIV_ZERO_FAILCLOSE],
    [`Decimal.mod(Decimal.of("7"), ${dynZero})`, DECIMAL_MOD_ZERO_FAILCLOSE],
    ['Decimal.pow(Decimal.of("0"), Decimal.of("-1"))', DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE],
    ['Decimal.pow(Decimal.neg(Decimal.of("2")), Decimal.of("2"))', DECIMAL_POW_NEGATIVE_BASE_FAILCLOSE],
  ];

  for (const [src, expected] of cases) {
    test(`${src} throws "${expected}" on BOTH legs (byte-identical)`, () => {
      const tsOut = runTsErr(src);
      const pyOut = runPyErr(src);
      expect(tsOut).toBe(expected);
      expect(pyOut).toBe(expected);
      expect(tsOut).toBe(pyOut);
    });
  }

  // SANITY: confirm the RUNTIME guard actually pre-empts the engine's native behaviour —
  // without the helper, decimal.js would yield Infinity (not throw) for x/0, and
  // Python would raise its OWN DivisionByZero. Our KERN string proves the guard ran.
  // (Uses the DYNAMIC zero so it reaches the runtime helper, post-FIX-2.)
  test('the guarded helper, not the engine, produces the diagnostic (sanity)', () => {
    expect(runTsErr(`Decimal.div(Decimal.of("1"), ${dynZero})`)).toBe(DECIMAL_DIV_ZERO_FAILCLOSE);
    expect(runTsErr(`Decimal.div(Decimal.of("1"), ${dynZero})`)).not.toContain('Infinity');
  });

  test('computed signed zero remains an admissible non-negative pow base', () => {
    const signedZero = 'Decimal.neg(Decimal.sub(Decimal.of("1"), Decimal.of("1")))';
    const src = `Decimal.pow(${signedZero}, Decimal.of("2"))`;
    expect(runTsErr(src)).toBe('NO_THROW');
    expect(runPyErr(src)).toBe('NO_THROW');
  });
});

// The contract module's static helpers are single-sourced; assert the Python ops
// helper block is internally consistent (defines all three guarded functions).
describe('Decimal Slice 3 — ops helper block shape', () => {
  test('KERN_DECIMAL_OPS_HELPER_PY defines div/mod/pow_int', () => {
    expect(KERN_DECIMAL_OPS_HELPER_PY).toContain('def __k_decimal_div');
    expect(KERN_DECIMAL_OPS_HELPER_PY).toContain('def __k_decimal_mod');
    expect(KERN_DECIMAL_OPS_HELPER_PY).toContain('def __k_decimal_pow_int');
    expect(KERN_DECIMAL_OPS_HELPER_PY).toContain('from decimal import Decimal as _KernDecimal');
  });
});
