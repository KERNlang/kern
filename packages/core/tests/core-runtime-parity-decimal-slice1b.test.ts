/**
 * Slice 1b — core-runtime ↔ ReferenceRunner DECIMAL parity gate.
 *
 * Slice 0 cross-checked the two disjoint TS interpreters on a pure-scalar corpus.
 * This slice brings DECIMAL into the product core-runtime and proves it stays
 * BYTE-IDENTICAL to the proven oracle. The governing discipline: core REUSES the
 * reference's EXACT exported decimal evaluators (`evalDecimalExpression` for value
 * methods, `evalRunnerNativeDecimalScalarCall` for comparators) — it reimplements
 * NO decimal logic — so parity is STRUCTURAL (same functions, same decimal.js
 * context), not tested-into-existence.
 *
 * Two observable boundaries:
 *   - VALUE methods (`of/add/sub/mul/div/mod/pow/neg/abs`) → a `decimal` KernValue;
 *     `kernValueToCoreFixtureValue` serializes it to its BARE CANONICAL STRING,
 *     exactly the reference's `trace.events[0].value`.
 *   - COMPARATORS (`eq/ne/lt/lte/gt/gte/cmp`) → a boolean / number scalar.
 *
 * Categories:
 *   A) AGREE              — both ACCEPT (or both `ok:false`); core obs deepEquals
 *                           reference obs deepEquals the pinned canonical value.
 *   C1) BOTH-REJECT (ok:false) — both engines surface the refusal as `ok:false`.
 *   C2) BOTH-REJECT (canonical fail-close) — a VALUE-producer fail-close. The
 *       reference RE-ADMITS the shared canonical message to effects (so it surfaces
 *       on the production path) — `observeReference` therefore THROWS that exact
 *       message rather than returning `ok:false`. Core throws the IDENTICAL shared
 *       message and `observeCore` maps it to `ok:false`. So both engines reject with
 *       the byte-identical canonical message; the assertion pins BOTH (the probe
 *       asymmetry is in how the refusal surfaces, NOT in the language semantics).
 *
 * The ↯ (precision-dependent) canonical strings (F2, F11) are CAPTURED from the
 * running reference and pinned exactly — never guessed.
 *
 * No-reimplement discipline: a guardrail test greps the core-runtime source for any
 * stray `new Decimal` / `.clone(` / `.toFixed` / decimal `.toString()` — there must
 * be NONE (all decimal compute/render is routed through the reference's functions).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { kernValueToCoreFixtureValue } from '../src/core-runtime/contract-adapter.js';
import { createCoreRuntimeEnv, evalCoreExpression } from '../src/core-runtime/index.js';
import { DECIMAL_DIV_ZERO_FAILCLOSE, DECIMAL_SCALE_FAILCLOSE } from '../src/index.js';
import { _resetExpressionV1ContractForTest, registerExpressionV1Contract } from '../src/ir/semantics/expression-v1.js';
import { CONTRACT_REGISTRY, deepEqual } from '../src/ir/semantics/index.js';
import { type Observed, observeCore, observeReference } from '../src/ir/semantics/parity-probe.js';
import { makeDecimalValue } from '../src/ir/semantics/portable-scalar.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';
import { referenceRun } from '../src/ir/semantics/reference-runner.js';

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetExpressionV1ContractForTest();
  _resetPrimitivesForTest();
  registerPrimitives();
  registerExpressionV1Contract();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetExpressionV1ContractForTest();
  _resetPrimitivesForTest();
});

interface AgreeFixture {
  name: string;
  expr: string;
  expected: unknown;
}
interface RejectFixture {
  name: string;
  expr: string;
}
interface FailCloseFixture {
  name: string;
  expr: string;
  // The shared canonical message prefix BOTH engines emit on this fail-close.
  message: string;
}

// ── A) AGREE — both ACCEPT (or both ok:false); core obs deepEquals reference obs ──
// ↯ entries (F2, F11) are CAPTURED full-precision strings from the running reference.
const AGREE: readonly AgreeFixture[] = [
  // value methods
  { name: 'F1_add', expr: 'Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))', expected: '0.3' },
  { name: 'F3_mul', expr: 'Decimal.mul(Decimal.of("0.1"), Decimal.of("0.1"))', expected: '0.01' },
  { name: 'F4_sub', expr: 'Decimal.sub(Decimal.of("0.3"), Decimal.of("0.1"))', expected: '0.2' },
  { name: 'F5_pow', expr: 'Decimal.pow(Decimal.of("2"), Decimal.of("64"))', expected: '18446744073709551616' },
  { name: 'F6_mod', expr: 'Decimal.mod(Decimal.of("5.5"), Decimal.of("2"))', expected: '1.5' },
  { name: 'F7_neg_zero', expr: 'Decimal.neg(Decimal.of("0"))', expected: '0' }, // catches "-0"
  { name: 'F8_abs_neg', expr: 'Decimal.abs(Decimal.neg(Decimal.of("7")))', expected: '7' },
  { name: 'F9_div_exact', expr: 'Decimal.div(Decimal.of("1"), Decimal.of("8"))', expected: '0.125' },
  // ↯ CAPTURED full-precision (precision 28, ROUND_HALF_EVEN) — NOT guessed.
  {
    name: 'F2_div_third',
    expr: 'Decimal.div(Decimal.of("1"), Decimal.of("3"))',
    expected: '0.3333333333333333333333333333',
  },
  {
    name: 'F11_div_seventh',
    expr: 'Decimal.div(Decimal.of("1"), Decimal.of("7"))',
    expected: '0.1428571428571428571428571429',
  },
  // comparators (scalar results)
  { name: 'F16_lt', expr: 'Decimal.lt(Decimal.of("2"), Decimal.of("10"))', expected: true }, // catches lexicographic
  { name: 'F17_cmp_eq', expr: 'Decimal.cmp(Decimal.of("3"), Decimal.of("3"))', expected: 0 },
  {
    name: 'F18_eq_nested',
    expr: 'Decimal.eq(Decimal.add(Decimal.of("0.1"), Decimal.of("0.2")), Decimal.of("0.3"))',
    expected: true,
  },
];

// ── C1) BOTH-REJECT (ok:false on BOTH engines) ──
const BOTH_REJECT_OK_FALSE: readonly RejectFixture[] = [
  // F15 — comparator with a non-canonical literal operand ("0.10"): the operand
  // fails closed. Comparators are NOT re-admitted by the reference's value-only
  // native route, so the reference surfaces ok:false (precondition portable trial
  // throws). Core's comparator route validates the operand → throws → ok:false.
  { name: 'F15_eq_noncanon_operand', expr: 'Decimal.eq(Decimal.of("0.1"), Decimal.of("0.10"))' },
  // E2 — raw-number operand (Decimal.add(d, 2)): not a Decimal operand → both reject.
  { name: 'E2_raw_number_operand', expr: 'Decimal.add(Decimal.of("1"), 2)' },
  // E1 — dynamic (non-string-literal) of() arg: not a string literal → both reject.
  { name: 'E1_dynamic_of_arg', expr: 'Decimal.of("1" + "2")' },
  // E1b — bare construction `new Decimal("1")`: not the namespace-call shape the gate
  // inspects → both reject (deferred to a typed-IR slice on both legs).
  { name: 'E1b_bare_construction', expr: 'new Decimal("1")' },
];

// ── C2) BOTH-REJECT (canonical fail-close) — VALUE-producer; reference RE-ADMITS
// the shared canonical message to effects so observeReference THROWS it; core throws
// the byte-identical message → ok:false. Both reject with the SAME canonical message. ──
const BOTH_REJECT_FAILCLOSE: readonly FailCloseFixture[] = [
  { name: 'F12_trailing_zero', expr: 'Decimal.of("1.50")', message: DECIMAL_SCALE_FAILCLOSE },
  { name: 'F13_exp_neg', expr: 'Decimal.of("1e-7")', message: DECIMAL_SCALE_FAILCLOSE },
  { name: 'F14_exp_pos', expr: 'Decimal.of("1e+30")', message: DECIMAL_SCALE_FAILCLOSE },
  {
    name: 'F10_big_trailing_zero',
    expr: 'Decimal.add(Decimal.of("12345678901234567890.12345678901234567890"), Decimal.of("0.00000000000000000001"))',
    message: DECIMAL_SCALE_FAILCLOSE,
  },
  { name: 'E3_noncanonical_literal', expr: 'Decimal.of("1.2.3")', message: DECIMAL_SCALE_FAILCLOSE },
  {
    name: 'E4_div_by_zero',
    expr: 'Decimal.div(Decimal.of("1"), Decimal.of("0"))',
    message: DECIMAL_DIV_ZERO_FAILCLOSE,
  },
];

describe('core ↔ reference DECIMAL parity — A) AGREE (observable equal, value pinned)', () => {
  it.each(AGREE.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const core = observeCore(fixture.expr);
    const reference = observeReference(fixture.expr);
    const pinned: Observed = { ok: true, value: fixture.expected };
    expect(deepEqual(core, pinned)).toBe(true);
    expect(deepEqual(reference, pinned)).toBe(true);
    expect(deepEqual(core, reference)).toBe(true);
  });
});

describe('core ↔ reference DECIMAL parity — C1) BOTH-REJECT (ok:false on both)', () => {
  it.each(BOTH_REJECT_OK_FALSE.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    expect(observeCore(fixture.expr).ok).toBe(false);
    expect(observeReference(fixture.expr).ok).toBe(false);
  });
});

describe('core ↔ reference DECIMAL parity — C2) BOTH-REJECT (identical canonical fail-close)', () => {
  it.each(BOTH_REJECT_FAILCLOSE.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    // Core surfaces the refusal as ok:false (observeCore catches the throw)…
    expect(observeCore(fixture.expr).ok).toBe(false);
    // …and the RAW core throw carries the SHARED canonical message (byte-parity).
    expect(() => evalCoreExpression(fixture.expr, createCoreRuntimeEnv())).toThrow(fixture.message);
    // The reference RE-ADMITS the same canonical message to effects, so it propagates
    // as a throw out of observeReference — pinned to the IDENTICAL shared message.
    expect(() => observeReference(fixture.expr)).toThrow(fixture.message);
  });
});

describe('core ↔ reference DECIMAL parity — bound operands + shadow gate (direct, beyond the single-expression probe)', () => {
  it('BOUND-OPERAND: a bound decimal value is a reusable operand, at parity with the reference', () => {
    // The single-expression probe cannot bind a name, so exercise this directly.
    // Core: bind `d = Decimal.of("1")`, then reuse it: Decimal.add(d, Decimal.of("2")).
    const coreEnv = createCoreRuntimeEnv();
    coreEnv.define('d', evalCoreExpression('Decimal.of("1")', coreEnv));
    const coreOut = kernValueToCoreFixtureValue(evalCoreExpression('Decimal.add(d, Decimal.of("2"))', coreEnv));
    // Reference: the same expression with `d` pre-bound as a tagged Decimal value.
    // Pass a SemanticEnv literal directly — `makeEnv` deep-clones bindings and that
    // clone drops the DecimalValue's Symbol tag (real reference sequences THREAD the
    // env without cloning, so this faithfully mirrors a `let d = …; Decimal.add(d, …)`).
    const refTrace = referenceRun(
      { type: 'expression-v1', props: { name: 'r0', expr: 'Decimal.add(d, Decimal.of("2"))' } },
      { bindings: new Map<string, unknown>([['d', makeDecimalValue('1')]]), seed: 0, now: 0 },
    );
    const refOut = refTrace.events[0]?.op === 'assign' ? refTrace.events[0].value : undefined;
    expect(coreOut).toBe('3');
    expect(refOut).toBe('3');
    expect(coreOut).toBe(refOut);
  });

  it('SHADOW-GATE: a user binding named `Decimal` is NOT routed to the builtin evaluator', () => {
    // Load-bearing for parity: shadowing must suppress the native Decimal route so the
    // user value is resolved instead (mirrors the reference's `!has('Decimal')`).
    const shadowed = createCoreRuntimeEnv();
    shadowed.define('Decimal', evalCoreExpression('5', shadowed)); // Decimal := number 5
    // `.of` on a number is not a member call the runtime supports → it throws the
    // generic member error, NOT the native canonical decimal "1". The key invariant:
    // the native Decimal path was NOT taken.
    expect(() => evalCoreExpression('Decimal.of("1")', shadowed)).toThrow();
    expect(observeCore('Decimal.of("1")').value).toBe('1'); // unshadowed control: native route works
  });
});

describe('DECIMAL parity guardrails', () => {
  it('DISTRIBUTION: ≥1 value method, ≥1 comparator, ≥1 fail-close present', () => {
    const valueMethods = AGREE.filter((f) => /Decimal\.(of|add|sub|mul|div|mod|pow|neg|abs)\(/.test(f.expr)).length;
    const comparators = AGREE.filter((f) => /Decimal\.(eq|ne|lt|lte|gt|gte|cmp)\(/.test(f.expr)).length;
    expect(valueMethods).toBeGreaterThanOrEqual(1);
    expect(comparators).toBeGreaterThanOrEqual(1);
    expect(BOTH_REJECT_OK_FALSE.length + BOTH_REJECT_FAILCLOSE.length).toBeGreaterThanOrEqual(1);
  });

  it('POISON: a constant mock observer mismatches a strong majority of AGREE fixtures', () => {
    const poison = (): Observed => ({ ok: true, value: 0 });
    let mismatches = 0;
    for (const fixture of AGREE) {
      if (!deepEqual(poison(), { ok: true, value: fixture.expected } satisfies Observed)) mismatches += 1;
    }
    expect(mismatches).toBeGreaterThanOrEqual(Math.ceil(AGREE.length / 2));
  });

  it('CANONICAL-NOT-PASSTHROUGH: a trailing-zero literal ("1.50") is rejected, not echoed as "1.5"', () => {
    // Guards against a "literal passthrough" cheat that would just emit the input
    // string. The canonical subset rejects "1.50" outright on BOTH engines.
    expect(observeCore('Decimal.of("1.50")').ok).toBe(false);
    expect(() => observeReference('Decimal.of("1.50")')).toThrow(DECIMAL_SCALE_FAILCLOSE);
  });

  it('NO-REIMPLEMENT: core-runtime contains no stray decimal construction/render', () => {
    // The discipline: core must route ALL decimal compute/render through the
    // reference's exported functions — never construct/clone/render a decimal itself.
    const files = ['../src/core-runtime/index.ts', '../src/core-runtime/contract-adapter.ts'];
    for (const rel of files) {
      const path = fileURLToPath(new URL(rel, import.meta.url));
      const src = readFileSync(path, 'utf8');
      expect(src).not.toMatch(/\bnew Decimal\b/);
      expect(src).not.toMatch(/\.clone\(/);
      expect(src).not.toMatch(/\.toFixed\b/);
      // No raw `kernDecimalStr`/`makeKDecimal` import either — those are the
      // reference's INTERNAL render/construct kernel; core only calls the high-level
      // `evalDecimalExpression` / `evalRunnerNativeDecimalScalarCall` evaluators.
      expect(src).not.toMatch(/\bmakeKDecimal\b/);
      expect(src).not.toMatch(/\bkernDecimalStr\b/);
    }
  });
});
