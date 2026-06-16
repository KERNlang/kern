/** DECIMAL Slice 1 — RUNNER-NATIVE differential oracle (THREE legs).
 *
 *  The ReferenceRunner (packages/core `ir/semantics/`) executes the `Decimal`
 *  primitive NATIVELY for the Slice-1 surface (`Decimal.of` / `Decimal.add` /
 *  `Decimal.mul`) — a third "leg" alongside the two EMITTED legs (decimal.js on
 *  TS, stdlib `decimal` on Python). This is that leg's ORACLE: for each KERN
 *  expression it
 *    - runs the RUNNER  (`runRef`) — parse → native Decimal eval → canonical string,
 *    - runs the TS leg  (`runTs`) — emit → node + decimal.js → canonical string,
 *    - runs the Py leg  (`runPy`) — emit → python3 + stdlib decimal → canonical string,
 *  and asserts `refOut === expected` AND `refOut === tsOut === pyOut`, i.e. the
 *  runner is BYTE-IDENTICAL to BOTH emitted legs.
 *
 *  Principle: own the meaning (KERN's canonical stringifier / pinned context /
 *  fail-close), borrow the calculator (decimal.js). The transpile paths are
 *  UNTOUCHED — `runTs`/`runPy` here reproduce the EXACT preamble the real emitters
 *  inject (mirrored from `decimal-emission-slice3-python.test.ts`), so the parity
 *  this proves is the real lowering's, not a test-only variant.
 *
 *  DISCRIMINATING fixtures (each FAILS a plausibly-wrong impl):
 *    - the precision-28 KILLER: a 28-significant-digit `mul` that DIVERGES under
 *      decimal.js's DEFAULT precision-20 context — proves the runner's local clone
 *      actually pins precision 28 (a default-context impl renders the wrong value),
 *    - the float-trap `0.1 + 0.2 → "0.3"`,
 *    - trailing-zero normalization `1.5 + 0.5 → "2"`,
 *    - a zero result `→ "0"` (never `-0`),
 *    - a FAIL-CLOSE: a non-canonical `Decimal.of` literal throws the EXACT shared
 *      canonical scale fail-close on the runner. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DECIMAL_SCALE_FAILCLOSE,
  decimalImportLineTS,
  decimalScaleFailMessage,
  emitExpressionWithImports,
  isDecimalExpression,
  makeEnv,
  parseExpression,
  ReferenceRunnerError,
  referenceRun,
  registerExpressionV1Contract,
} from '@kernlang/core';
import { emitPyExpressionWithImports } from '../src/codegen-body-python.js';
import { KERN_DECIMAL_STR_HELPER_PY } from '../src/core/expr/index.js';

// ── The RUNNER leg (PRODUCTION PATH) ─────────────────────────────────────────
// Slice 1 proves the *production* runner, not a test-only evaluator: every case
// goes through `referenceRun` → the registered `expression-v1` contract →
// (precondition structural-admit) → effects → native Decimal eval. So this leg
// exercises EXACTLY the dispatch a real KERN body-statement binding takes.
registerExpressionV1Contract(); // idempotent — safe to call once at module load.

/** Run a KERN expression through the PRODUCTION runner: build an `expression-v1`
 *  IR node binding the expression to `r`, dispatch via `referenceRun`, and read
 *  the bound value back from the trace's `assign` event. This is the runner's
 *  observable Decimal value — the KERN-canonical rendered string. */
function runRef(src: string): string {
  const node = { type: 'expression-v1', props: { name: 'r', expr: src } };
  const trace = referenceRun(node, makeEnv());
  const assign = trace.events.find(
    (e): e is Extract<typeof e, { op: 'assign' }> => e.op === 'assign' && e.target === 'r',
  );
  if (!assign || typeof assign.value !== 'string') {
    throw new Error(`runRef: expected a string assign for "r" from referenceRun, got ${JSON.stringify(trace.events)}`);
  }
  return assign.value;
}

// ── decimal.js resolution + runtime gate (mirrors the slice-3 oracle) ─────────
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

execDescribe('Decimal Slice 1 — RUNNER-NATIVE differential (ref === ts === py, byte-exact)', () => {
  // [KERN source, expected canonical rendered value on ALL THREE legs].
  const cases: Array<[string, string]> = [
    // NON-NEGOTIABLE KILLER: 28 significant digits. decimal.js DEFAULTS to
    // precision 20; only a precision-28-pinned context renders the 28-digit result.
    // A default-context (precision-20) impl yields '1.234567890123456789' and DIVERGES.
    [
      'Decimal.mul(Decimal.of("1.234567890123456789012345678"), Decimal.of("1.000000000000000000000000001"))',
      '1.234567890123456789012345679',
    ],
    // The float-trap: 0.1 + 0.2 is exactly 0.3 under decimal arithmetic.
    ['Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))', '0.3'],
    // Trailing-zero normalization: 1.5 + 0.5 = 2.0 renders as the canonical '2'.
    ['Decimal.add(Decimal.of("1.5"), Decimal.of("0.5"))', '2'],
    // Zero result renders as unsigned '0' (never '-0').
    ['Decimal.mul(Decimal.of("-5"), Decimal.of("0"))', '0'],
    ['Decimal.add(Decimal.of("1.5"), Decimal.of("-1.5"))', '0'],
    // Nested composition: add(of, mul(...)) — recursive operand eval.
    ['Decimal.add(Decimal.of("1"), Decimal.mul(Decimal.of("2"), Decimal.of("3")))', '7'],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-decimal-slice1-runner-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // The generated decimal preamble is TYPESCRIPT (helper annotations); strip the
  // `: Decimal` type annotations to a JS-runnable twin (execution-only erasure,
  // identical to what tsc does). Slice 1 (of/add/mul) does not actually use the
  // div/mod/pow helpers, but reproducing the FULL real preamble keeps the TS leg
  // here byte-identical to what the emitter injects.
  function tsDecimalPreamble(): string {
    return decimalImportLineTS().replace("'decimal.js'", `'${decimalJsPath}'`);
  }

  function runTs(src: string): string {
    const r = emitExpressionWithImports(parseExpression(src));
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
    test(`${src} → ${expected} on ALL THREE legs (byte-exact)`, () => {
      const refOut = runRef(src);
      const tsOut = runTs(src);
      const pyOut = runPy(src);
      // The runner matches the contracted value...
      expect(refOut).toBe(expected);
      // ...AND is byte-identical to BOTH emitted legs.
      expect(tsOut).toBe(expected);
      expect(pyOut).toBe(expected);
      expect(refOut).toBe(tsOut);
      expect(refOut).toBe(pyOut);
    });
  }
});

// ── The precision-28 KILLER, isolated: prove it FAILS a default-context impl ──
describe('Decimal Slice 1 — runner pins precision 28 (killer discriminates)', () => {
  const killer =
    'Decimal.mul(Decimal.of("1.234567890123456789012345678"), Decimal.of("1.000000000000000000000000001"))';

  test('runner renders the 28-digit result under the pinned precision-28 context', () => {
    expect(runRef(killer)).toBe('1.234567890123456789012345679');
  });

  test('a DEFAULT-context (precision-20) impl would diverge — fixture discriminates', () => {
    // Independent witness: the SAME computation under decimal.js's DEFAULT precision
    // (20) yields a different (rounded) string, so any impl that forgot to pin
    // precision 28 fails the killer above. This documents WHY the killer is RED
    // against a wrong impl (it does not exercise the runner — it proves the fixture).
    const req2 = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Decimal = req2('decimal.js');
    const D20 = Decimal.clone({ precision: 20 });
    const wrong = new D20('1.234567890123456789012345678').times(new D20('1.000000000000000000000000001')).toString();
    expect(wrong).not.toBe('1.234567890123456789012345679');
    expect(wrong).toBe('1.234567890123456789');
  });
});

// ── FAIL-CLOSE through the PRODUCTION runner path ────────────────────────────
// The structural-admit precondition lets a non-canonical `Decimal.of` literal
// PASS the `expression-v1` precondition (structurally valid) and reach effects,
// which throws the EXACT shared canonical-scale fail-close. `referenceRun`
// propagates that throw verbatim — so the byte-identical refusal message surfaces
// on the real dispatch, NOT collapsed into a generic "Preconditions failed".
describe('Decimal Slice 1 — runner fail-close on non-canonical literal (production path)', () => {
  test('referenceRun(Decimal.of("1.10")) throws the byte-identical canonical scale fail-close', () => {
    expect(() => runRef('Decimal.of("1.10")')).toThrow(decimalScaleFailMessage('1.10'));
  });

  test('referenceRun(Decimal.of("1E+2")) throws the byte-identical canonical scale fail-close', () => {
    expect(() => runRef('Decimal.of("1E+2")')).toThrow(decimalScaleFailMessage('1E+2'));
  });

  test('the fail-close message carries the shared DECIMAL_SCALE_FAILCLOSE prefix', () => {
    expect(() => runRef('Decimal.of("1.10")')).toThrow(DECIMAL_SCALE_FAILCLOSE);
  });

  test('a non-canonical literal nested inside add fails closed through referenceRun', () => {
    expect(() => runRef('Decimal.add(Decimal.of("1.10"), Decimal.of("2"))')).toThrow(decimalScaleFailMessage('1.10'));
  });
});

// ── isDecimalExpression — RECURSIVE structural admission predicate ────────────
// The invariant (codex finding): `isDecimalExpression(node) === true` ⟺ the
// runner can evaluate `node` WITHOUT a structural error — it either succeeds or
// throws ONLY a canonical `Decimal.of` fail-close. So the predicate must accept
// the WHOLE operand tree, not just the top-level method name.
describe('Decimal Slice 1 — isDecimalExpression recursive structural predicate', () => {
  test('accepts structurally-valid Slice-1 shapes (incl. nested + non-canonical literal)', () => {
    expect(isDecimalExpression(parseExpression('Decimal.of("1.5")'))).toBe(true);
    // Non-canonical literal is STILL structurally valid — effects fail-closes, not the predicate.
    expect(isDecimalExpression(parseExpression('Decimal.of("1.10")'))).toBe(true);
    expect(isDecimalExpression(parseExpression('Decimal.add(Decimal.of("1"), Decimal.of("2"))'))).toBe(true);
    expect(isDecimalExpression(parseExpression('Decimal.mul(Decimal.of("1"), Decimal.of("2"))'))).toBe(true);
    // Arbitrarily nested.
    expect(
      isDecimalExpression(
        parseExpression('Decimal.add(Decimal.of("1"), Decimal.mul(Decimal.of("2"), Decimal.of("3")))'),
      ),
    ).toBe(true);
  });

  test('rejects non-evaluable shapes the OLD top-level-only predicate wrongly accepted', () => {
    // add/mul with NON-Decimal operands — the over-accept codex found.
    expect(isDecimalExpression(parseExpression('Decimal.add(1, 2)'))).toBe(false);
    // `of` with a non-string-literal (ident) operand — Slice-2, not Slice-1.
    expect(isDecimalExpression(parseExpression('Decimal.of(x)'))).toBe(false);
    // Arity violations.
    expect(isDecimalExpression(parseExpression('Decimal.of("1", "2")'))).toBe(false);
    expect(isDecimalExpression(parseExpression('Decimal.add(Decimal.of("1"))'))).toBe(false);
    // Out-of-slice method.
    expect(isDecimalExpression(parseExpression('Decimal.div(Decimal.of("1"), Decimal.of("2"))'))).toBe(false);
    // Not a Decimal namespace call at all.
    expect(isDecimalExpression(parseExpression('String(n)'))).toBe(false);
    expect(isDecimalExpression(parseExpression('1 + 2'))).toBe(false);
    // One bad operand inside an otherwise-valid add poisons the whole tree.
    expect(isDecimalExpression(parseExpression('Decimal.add(Decimal.of("1"), Decimal.add(1, 2))'))).toBe(false);
  });
});

// ── DOWNSTREAM Decimal use — the runner ABSTAINS (does NOT diverge) ───────────
// A bound Decimal is NOT a portable scalar in the runner: `let d = Decimal.of("1")`
// binds a TAGGED Decimal value (not the bare string "1"). So a later `d === "1"`
// can't be judged as `string === string` (which would yield TRUE and diverge from
// BOTH emitters, which emit `new Decimal("1") === "1"` → FALSE). Instead the
// downstream portable read of the tagged value throws through `assertPortableScalar`
// → the `expression-v1` precondition catches it → `referenceRun` raises the normal
// "Preconditions failed …". The runner REFUSES rather than producing a wrong value.
//
// Full downstream Decimal value semantics (matching the emitters' `false` / "1") is
// SLICE-2; SLICE-1 only requires the runner to stop producing a divergent value.
describe('Decimal Slice 1 — runner ABSTAINS on downstream decimal use (no divergence)', () => {
  test('a __block of `let d = Decimal.of("1")` then `d === "1"` makes referenceRun ABSTAIN', () => {
    const child1 = { type: 'expression-v1', props: { name: 'd', expr: 'Decimal.of("1")' } };
    const child2 = { type: 'expression-v1', props: { name: 'e', expr: 'd === "1"' } };
    const block = { type: '__block', children: [child1, child2] };
    // The runner refuses the downstream decimal comparison instead of binding `e = true`.
    expect(() => referenceRun(block, makeEnv())).toThrow(ReferenceRunnerError);
    expect(() => referenceRun(block, makeEnv())).toThrow('Preconditions failed');
  });

  test('the emitter emits a REAL comparison for `Decimal.of("1") === "1"` (runner abstain is the honest boundary)', () => {
    // GROUND TRUTH: the emitters compile `Decimal.of("1") === "1"` to a real
    // `new Decimal("1") === "1"` comparison (which is FALSE at runtime, NOT
    // fail-close). The runner's abstain is therefore the honest SLICE-1 boundary —
    // it refuses to compute a value rather than computing one that diverges from
    // this. Matching the emitters' `false` is slice-2.
    const code = emitExpressionWithImports(parseExpression('Decimal.of("1") === "1"')).code;
    expect(code).toContain('=== "1"');
    expect(code).toContain('Decimal');
  });
});

// ── FINDING 2 — a MALFORMED expr returns a CLEAN precondition failure ─────────
// `parseExpression` now runs INSIDE the precondition's try/catch, so a malformed
// `expr` returns false (→ the normal "Preconditions failed …") instead of throwing
// a raw parser error out of `preconditions`.
describe('Decimal Slice 1 — malformed expr fails the precondition cleanly (no raw parser error)', () => {
  test('referenceRun on a malformed `expr` throws the clean ReferenceRunnerError, NOT a parser error', () => {
    const node = { type: 'expression-v1', props: { name: 'r', expr: '1 +' } };
    expect(() => referenceRun(node, makeEnv())).toThrow(ReferenceRunnerError);
    expect(() => referenceRun(node, makeEnv())).toThrow('Preconditions failed');
  });
});
