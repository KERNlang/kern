/**
 * Slice 0 — core-runtime ↔ ReferenceRunner adapter PROBE (the thinnest parity gate).
 *
 * packages/core ships TWO disjoint TS interpreters that have never been
 * cross-checked:
 *   - core-runtime (product):  `evalCoreExpression`.
 *   - ReferenceRunner (oracle): `referenceRun` via `CONTRACT_REGISTRY`.
 *
 * This file compares their SERIALIZED OBSERVABLE OUTPUT on a pure-scalar corpus,
 * reducing BOTH legs to the same raw-JS-scalar comparison type through the
 * EXISTING serializers (`kernValueToCoreFixtureValue` on core; the raw assign
 * value on reference). Equality is the project's existing `deepEqual`
 * (Object.is semantics → distinguishes -0 from 0, NaN from NaN).
 *
 * Four categories:
 *   A) AGREE          — both ACCEPT; core obs deepEquals reference obs deepEquals pinned.
 *   B) DIVERGENCE     — core ACCEPTS with a value, reference REJECTS (the punch-list).
 *   C) BOTH-REJECT    — both refuse.
 *   D) REVERSE-DIVERGENCE — reference ACCEPTS with a value, core REJECTS.
 *
 * The first-ever cross-check of these two engines surfaced a BIDIRECTIONAL drift.
 * RECONCILED so far:
 *   - STRICT cross-type (in)equality (`1 === "1"`, `true === 1`, `null === 0`, …)
 *     is now AGREE — D1a relaxed the reference to COMPUTE kind-sensitive `===`/`!==`
 *     (was a divergence where the reference abstained), matching core + both emitted
 *     legs.
 * STILL DIVERGENT (the remaining punch-list):
 *   - core ⊋ reference on bitwise (`5 | 0`, `~5`) and on LOOSE cross-type equality
 *     (`1 == "1"`, `true == 1`) — the latter DEFERRED to D1b, where the TS leg (which
 *     currently JS-coerces) gets a `__kern_loose_eq` helper before the reference loose
 *     branch is relaxed in lockstep.
 *   - reference ⊋ core on truthiness-based unary `!` over non-booleans
 *     (`!""` → reference `true`; core's `!` is boolean-only and REJECTS a string).
 * Each such fixture is a real reconciliation item, not a test defect.
 *
 * Reject reasons are NEVER compared (deliberate Slice-0 scope cut) — only the
 * `ok` boolean and, on accept, the serialized value.
 */

import { _resetExpressionV1ContractForTest, registerExpressionV1Contract } from '../src/ir/semantics/expression-v1.js';
import { CONTRACT_REGISTRY, deepEqual } from '../src/ir/semantics/index.js';
import { type Observed, observeCore, observeReference } from '../src/ir/semantics/parity-probe.js';
import { _resetPrimitivesForTest, registerPrimitives } from '../src/ir/semantics/primitives.js';

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
interface DivergenceFixture {
  name: string;
  expr: string;
  // Slice-0 finding: reference over-strict / lacks <X> vs the emitted legs; tracked for reconciliation.
  coreValue: unknown;
}
interface RejectFixture {
  name: string;
  expr: string;
}
interface ReverseDivergenceFixture {
  name: string;
  expr: string;
  // Slice-0 finding: reference accepts (truthiness-based `!`), core REJECTS (`!` is boolean-only); tracked for reconciliation.
  referenceValue: unknown;
}

// ── A) AGREE — both engines ACCEPT; core obs deepEquals reference obs deepEquals pinned ──
const AGREE: readonly AgreeFixture[] = [
  { name: 'n_int', expr: '42', expected: 42 },
  { name: 's_lit', expr: '"hello"', expected: 'hello' },
  { name: 'b_lit', expr: 'true', expected: true },
  { name: 'null_lit', expr: 'null', expected: null },
  { name: 'add', expr: '1 + 1', expected: 2 },
  { name: 'sub', expr: '10 - 3', expected: 7 },
  { name: 'mul', expr: '6 * 7', expected: 42 },
  { name: 'div_float', expr: '1 / 2', expected: 0.5 }, // catches int-truncation
  { name: 'mod_pos', expr: '7 % 3', expected: 1 },
  { name: 'mod_neg', expr: '-5 % 3', expected: -2 }, // JS remainder sign; catches Python modulo=1
  { name: 'neg_zero', expr: '0 * -1', expected: -0 }, // Object.is; catches -0→0 normalization
  { name: 'concat', expr: '"a" + "b"', expected: 'ab' },
  { name: 'lt_num_false', expr: '5 < 3', expected: false },
  { name: 'lt_str_true', expr: '"a" < "b"', expected: true },
  { name: 'lte_eq', expr: '3 <= 3', expected: true },
  { name: 'strict_eq_true', expr: '1 === 1', expected: true },
  { name: 'strict_ne_true', expr: '1 !== 2', expected: true },
  { name: 'and_value', expr: 'true && 5', expected: 5 }, // short-circuit returns operand
  { name: 'or_value', expr: '0 || 7', expected: 7 },
  { name: 'coalesce', expr: 'null ?? 9', expected: 9 },
  { name: 'not_bool', expr: '!true', expected: false }, // `!` AGREES on a boolean operand (both engines)
  { name: 'tmpl_num', expr: '`v=${100}`', expected: 'v=100' },
  { name: 'tmpl_bool', expr: '`f=${false}`', expected: 'f=false' },
  { name: 'tmpl_null', expr: '`z=${null}`', expected: 'z=null' },
  // AGREE-CANDIDATE: String() coercion — surfaces as DIVERGENCE if the legs differ.
  { name: 'str_num', expr: 'String(100)', expected: '100' },
  { name: 'str_null', expr: 'String(null)', expected: 'null' },
  { name: 'str_false', expr: 'String(false)', expected: 'false' },
  // D1a — STRICT cross-type equality reconciled: the reference now COMPUTES
  // kind-sensitive `===`/`!==` (was DIVERGENCE/abstain), matching core + both
  // emitted legs (TS `===` strict, Python `_kern_strict_equal`). Pin MULTIPLE
  // mixed-kind classes (not just number↔string) so a future "special-case only
  // string/number" regression of the relaxed rule fails loudly here.
  { name: 'xtype_strict_eq_num_str', expr: '1 === "1"', expected: false },
  { name: 'xtype_strict_ne_num_str', expr: '1 !== "1"', expected: true },
  { name: 'xtype_strict_eq_bool_num', expr: 'true === 1', expected: false },
  { name: 'xtype_strict_ne_bool_num', expr: 'true !== 1', expected: true },
  { name: 'xtype_strict_eq_null_num', expr: 'null === 0', expected: false },
  { name: 'xtype_strict_ne_null_num', expr: 'null !== 0', expected: true },
  // D1b — LOOSE cross-type equality reconciled: the reference now COMPUTES
  // kind-sensitive `==`/`!=` (was DIVERGENCE/abstain). KERN's loose `==` is NOT JS
  // `==` — it adds ONLY the null/undefined crossing on top of strict, so `1 == "1"`
  // and `true == 1` are FALSE on all three producers (core `kernLooseEqual`, the TS
  // `__kern_loose_eq` helper, Python `_kern_loose_equal`). These two were the last
  // entries in the DIVERGENCE block; moving them here proves the legs now AGREE.
  { name: 'xtype_loose_eq', expr: '1 == "1"', expected: false },
  { name: 'xtype_bool_num_eq', expr: 'true == 1', expected: false },
];

// ── B) DIVERGENCE — core ACCEPTS with a value, reference REJECTS ──
const DIVERGENCE: readonly DivergenceFixture[] = [
  // D1b reconciled the loose `==`/`!=` cross-type entries that lived here (moved to
  // the AGREE block — the reference now COMPUTES `1 == "1"` / `true == 1` as false,
  // matching core + both legs). What REMAINS divergent is BITWISE: the reference's
  // portable scalar subset has no `|`/`~`/ToInt32, so core accepts a value the
  // reference refuses. Separately tracked for a later bitwise-into-portable slice.
  // Slice-0 finding: reference over-strict / lacks bitwise in the portable subset vs the emitted legs; tracked for reconciliation.
  { name: 'bitwise_or', expr: '5 | 0', coreValue: 5 },
  // Slice-0 finding: reference over-strict / lacks bitwise (ToInt32 wrap) vs the emitted legs; tracked for reconciliation.
  { name: 'bitwise_int32', expr: '2147483648 | 0', coreValue: -2147483648 },
  // Slice-0 finding: core supports unary `~` (slice-6 ToInt32); reference's portable subset lacks bitwise; tracked for reconciliation.
  { name: 'unary_bnot', expr: '~5', coreValue: -6 },
];

// ── C) BOTH-REJECT — both engines refuse ──
const BOTH_REJECT: readonly RejectFixture[] = [
  { name: 'plus_mixed', expr: '1 + "a"' }, // strict +
  { name: 'div_zero', expr: '1 / 0' }, // core div-by-zero ; reference non-finite
  { name: 'mod_zero', expr: '7 % 0' },
  { name: 'cmp_xtype', expr: '1 < "a"' }, // same-kind comparison
  { name: 'pow_unsupported', expr: '2 ** 3' }, // ** not in subset
  { name: 'overflow', expr: '1e308 * 10' }, // finite-only (Infinity result refused)
  { name: 'nan_source', expr: '0 / 0' }, // finite-only (NaN result refused — both engines, no NaN value ever reaches comparison)
];

// ── D) REVERSE-DIVERGENCE — reference ACCEPTS with a value, core REJECTS ──
// core's `!` is boolean-only (strict, like its `+`); reference's `!` is
// truthiness-based and accepts any scalar. So `!<string>` splits the engines.
const REVERSE_DIVERGENCE: readonly ReverseDivergenceFixture[] = [
  { name: 'not_empty', expr: '!""', referenceValue: true },
  { name: 'not_nonempty', expr: '!"x"', referenceValue: false },
];

describe('core-runtime ↔ reference parity — A) AGREE (both ACCEPT, observable equal)', () => {
  it.each(AGREE.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const core = observeCore(fixture.expr);
    const reference = observeReference(fixture.expr);
    const pinned: Observed = { ok: true, value: fixture.expected };
    expect(deepEqual(core, pinned)).toBe(true);
    expect(deepEqual(reference, pinned)).toBe(true);
    expect(deepEqual(core, reference)).toBe(true);
  });
});

describe('core-runtime ↔ reference parity — B) DIVERGENCE (core ACCEPTS, reference REJECTS)', () => {
  it.each(DIVERGENCE.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const core = observeCore(fixture.expr);
    const reference = observeReference(fixture.expr);
    expect(deepEqual(core, { ok: true, value: fixture.coreValue } satisfies Observed)).toBe(true);
    expect(reference.ok).toBe(false);
  });
});

describe('core-runtime ↔ reference parity — C) BOTH-REJECT (both refuse)', () => {
  it.each(BOTH_REJECT.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    expect(observeCore(fixture.expr).ok).toBe(false);
    expect(observeReference(fixture.expr).ok).toBe(false);
  });
});

describe('core-runtime ↔ reference parity — D) REVERSE-DIVERGENCE (reference ACCEPTS, core REJECTS)', () => {
  it.each(REVERSE_DIVERGENCE.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const core = observeCore(fixture.expr);
    const reference = observeReference(fixture.expr);
    expect(core.ok).toBe(false);
    expect(deepEqual(reference, { ok: true, value: fixture.referenceValue } satisfies Observed)).toBe(true);
  });
});

describe('false-thin guardrails', () => {
  it('POISON: a constant mock observer is flagged as mismatching on a strong majority of AGREE fixtures', () => {
    // A deliberately-wrong observer that always claims `{ok:true, value:0}`.
    const poison = (): Observed => ({ ok: true, value: 0 });
    let mismatches = 0;
    for (const fixture of AGREE) {
      const pinned: Observed = { ok: true, value: fixture.expected };
      if (!deepEqual(poison(), pinned)) mismatches += 1;
    }
    // The gate must DISCRIMINATE: the poison observer disagrees with the pinned
    // value on a strong majority (≥ half) of AGREE fixtures. (Object.is also makes
    // `0` mismatch the pinned `-0`, so neg_zero counts too.)
    expect(mismatches).toBeGreaterThanOrEqual(Math.ceil(AGREE.length / 2));
  });

  it('DISTRIBUTION: the corpus is non-degenerate (substantial core-ACCEPT AND some-REJECT)', () => {
    let coreAccept = 0;
    let someReject = 0;
    for (const fixture of [...AGREE, ...DIVERGENCE, ...BOTH_REJECT, ...REVERSE_DIVERGENCE]) {
      const core = observeCore(fixture.expr);
      const reference = observeReference(fixture.expr);
      if (core.ok) coreAccept += 1;
      if (!core.ok || !reference.ok) someReject += 1;
    }
    // Absolute floors, NOT a percentage: each reconciled divergence legitimately
    // shifts the balance toward agreement (that is the whole point of the D1/D2
    // slices), so a percentage threshold would erode and break on every reconcile.
    // The intent is only "the corpus exercises plenty of BOTH outcomes".
    expect(coreAccept).toBeGreaterThanOrEqual(10);
    expect(someReject).toBeGreaterThanOrEqual(8);
  });

  it('THIN self-check: every category is non-empty (AGREE ≥ 15, DIVERGENCE ≥ 3, BOTH-REJECT ≥ 5, REVERSE ≥ 2)', () => {
    expect(AGREE.length).toBeGreaterThanOrEqual(15);
    // D1b lowered this floor 4 → 3 (NOT to mask thin coverage — the opposite). Each
    // equality reconciliation legitimately MOVES a fixture out of DIVERGENCE into
    // AGREE (D1a moved strict, D1b moves loose), so an absolute floor set when more
    // divergences existed must track the honest post-reconciliation count. The 3
    // remaining are all REAL, still-open divergences (bitwise `|`/`~`/ToInt32 absent
    // from the reference's portable subset). Raising the count by padding synthetic
    // divergences would be the masking move; lowering the floor to the true count is
    // the correct one. Same rationale as the DISTRIBUTION guardrail's absolute floors.
    expect(DIVERGENCE.length).toBeGreaterThanOrEqual(3);
    expect(BOTH_REJECT.length).toBeGreaterThanOrEqual(5);
    expect(REVERSE_DIVERGENCE.length).toBeGreaterThanOrEqual(2);
  });
});
