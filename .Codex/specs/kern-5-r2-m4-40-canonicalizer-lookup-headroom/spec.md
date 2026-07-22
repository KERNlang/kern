# KERN 5 R2 M4.40 Canonicalizer Indexed Lookup Headroom

**Status:** COMPLETE
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

M4.40 removes the canonicalizer's remaining repeated linear scans for
one-based string and number table reads, proves material production headroom at
the exact `15/24/154` witness, and only then promotes the active canonicalizer
profile from `16/30/106` to `16/30/154`. It reuses the existing strict
`List.index(List, Number)` core contract rather than inventing a second indexed
lookup API.

## Verified Baseline

- [VERIFIED] Published M4.39 preserves the active `16/30/106` profile and the
  caller-owned runtime limit `maxCollectionLength=65,536`.
- [VERIFIED] The exact selected witness remains
  `examples/selfhost-validator/validator.kern#18:hasimportcyclefrom` at
  `15/24/154` rows.
- [VERIFIED] On published M4.39, direct `tablesok` has an exact iteration floor
  of 8,151 and complete `canonicalize` has an exact floor of 55,002.
- [VERIFIED] Removing only the `stringat`/`numberat` scan loops in a measurement
  prototype lowers the complete floor from 55,002 to 34,700, a 20,302-iteration
  reduction and approximately 47% production headroom at the unchanged limit.
- [VERIFIED] A validation-only Map-preindex prototype lowered direct `tablesok`
  from 8,151 to 2,567 but worsened complete execution from 55,002 to 55,156;
  helper-cache warming makes that approach unsuitable.
- [VERIFIED] Direct `values[id - 1]` is accepted only when `id` already carries
  integer provenance. Table IDs passed through helper boundaries do not carry
  that provenance, so replacing the loops with raw index syntax fails closed.
- [VERIFIED] `List.index` already exists in the core contract registry and core
  runtime with strict List/Number arguments, zero-based offsets, and
  Undefined for negative, fractional, out-of-range, or sparse misses.
- [VERIFIED] The portable source runner executes `List.length` but currently
  rejects `List.index`; TS/Python native-body lowering also omits the registered
  core-contract operation.

## Contract

- [DECIDED] Reuse `List.index`; do not add `List.get`, weaken raw array-index
  provenance, or encode canonicalizer-specific indexing in the runtime.
- [DECIDED] `List.index` remains zero-based and preserves the existing strict
  core contract. The source runner normalizes its Undefined miss to the
  portable scalar nullish carrier `null`, matching existing source-runner
  normalization; emitted TS/Python retain their native undefined/None nullish
  values. `??` therefore observes the same fallback behavior on all legs.
- [DECIDED] The source runner accepts a bare portable array-binding identifier
  as the list argument and any evaluated finite numeric scalar as the index.
  It performs its own integer and bounds checks and does not grant integer
  provenance to raw index expressions.
- [DECIDED] User binding `List` shadows the builtin namespace. Wrong arity,
  wrong receiver type, and wrong index type fail closed. Negative,
  fractional, out-of-range, and sparse indexes produce the nullish miss.
- [DECIDED] Complete native TS and Python lowering in this slice. Both legs
  validate the strict List/finite-Number boundary, accept integer-valued
  numbers (including negative zero as zero), reject Python booleans as numbers,
  prevent negative-index wraparound, and return their native nullish miss only
  after integer/bounds/own-slot validation.
- [DECIDED] Rewrite only `stringat` and `numberat` to one `List.index` call plus
  `??` fallback. Their public one-based API and `""`/`-1` miss values remain
  unchanged for every finite numeric ID.
- [DECIDED] Keep every runtime, KIR, expansion, ABI, and diagnostic limit
  unchanged.
- [DECIDED] Promote only `profileLimits.maxValueRows`, from 106 to 154, and
  only after the exact production witness succeeds at an authenticated budget
  no greater than 40,000 iterations.

## Implementation Plan

1. Add RED runner tests for successful, missing, invalid, shadowed, sync, and
   async `List.index` calls, plus TS/Python lowering and execution parity.
2. Implement strict unshadowed `List.index` dispatch in the shared portable
   evaluator without altering the raw array-index provenance rules.
3. Rewrite canonicalizer `stringat`/`numberat`, recompose the authenticated
   canonicalizer, and prove exact behavior for valid and hostile helper IDs.
4. Measure and freeze the new exact production floor. Require success at
   40,000 or less under the unchanged 65,536 runtime limit.
5. Promote only max value rows to 154, regenerate live coverage/prerequisite
   receipts, and verify the exact 11-function cohort selected by M4.38.
6. Run focused suites, the complete Node 22 `fitness:kern-5` wall, and
   automatic high-risk role-lens independent review.
7. Rebase onto current `origin/main`, create one signed Agon commit, push the
   complete feature once to a fresh feature ref and authorized `main`, verify
   both refs, then start M4.41 from the new `origin/main`.

## Expected Files

- `.Codex/specs/kern-5-r2-m4-40-canonicalizer-lookup-headroom/spec.md`
- `packages/core/src/ir/semantics/portable-core-evaluator.ts`
- `packages/core/tests/runner-stdlib-namespace-calls.test.ts`
- `packages/core/tests/portable-machine-evaluator.test.ts`
- native TS/Python stdlib lowering, helper injection, and parity tests
- `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern`
- `examples/kern-canonicalizer/canonicalizer.composed.kern`
- `scripts/kern-canonicalizer/composition.json`
- `scripts/kern-canonicalizer/tables-ok-performance.test.mjs`
- `scripts/kern-canonicalizer/policy.json`
- live canonicalizer coverage/prerequisite receipts and exact tests
- `scripts/runner-browser-budget-policy.json`
- `scripts/runner-browser-budget-policy.test.mjs`
- `docs/kern-5-release-train.md`

## Acceptance Criteria

- [x] RED proves published main rejects source-runner `List.index` and retains
      the 55,002 complete floor.
- [x] `List.index` matches the existing strict contract for hits and nullish
      misses, in sync and async source execution, with shadowing preserved.
- [x] Raw dynamic array indexing remains provenance-gated exactly as before.
- [x] `stringat` and `numberat` contain no scan loop and preserve their existing
      public behavior for valid, zero, negative, fractional, and out-of-range
      IDs.
- [x] Existing golden, idempotence, KIR, hostile, and frozen-oracle decisions
      remain exact.
- [x] Exact `15/24/154` complete execution succeeds at an authenticated budget
      no greater than 40,000 under the unchanged runtime envelope.
- [x] Active profile is exactly `16/30/154` and completes the exact 11-function
      M4.38 cohort without admitting an unselected policy family.
- [x] Focused tests and the complete Node 22 KERN 5 fitness wall pass.
- [x] Independent high-risk role-lens review has no unresolved material finding.
- [x] Signed Agon commit is fetched/rebased before one atomic no-verify push to
      the fresh feature ref and authorized `main`, and both refs are verified.

## Implementation Evidence

- [VERIFIED] Portable and native TS/Python execution expose one strict
  `List.index` contract; raw dynamic indexing remains independently guarded.
- [VERIFIED] The exact production witness fails below 34,700 iterations,
  succeeds at 34,700, and passes the 40,000 promotion gate under the unchanged
  65,536 production ceiling.
- [VERIFIED] The active profile is 16/30/154 and authenticates 11 functions,
  three tools, and 39 structured parameter rows.
- [VERIFIED] Composite/helper SHA-256 values are
  `de4710746e4c4c6ba30970577eefbdb284d282eaf58de30d78bfea45fa758080`
  and `9329756e2373e5afc68903cafeb0043a9a50e3a07f7710a9f115d7628455726f`.
- [VERIFIED] Coverage/prerequisite receipt SHA-256 values are
  `1b4eaebc67bc0c1e9287259dce0de9feed453e06b68de60ef1348bdaed5e3819`
  and `e298ccec225eb339b6a566ed1c607b2abf14d11c9719557a9dc29a4de7dec9c9`;
  compiled core is bound at
  `7b8d3540cb8927db1e9c8d3d2938671103186bed4cc32c955d68e5dbb82c7448`.
- [VERIFIED] Required browser measurements pass on the exact 157-module M4.40
  graph at 1,553,103 raw bytes and 333,617 gzip bytes; the latest required
  measurement passed at an 89 ms browser median (89/89/95 ms samples), with
  the fixed 5% bloat guard retained.
- [VERIFIED] Focused validation passes 112/112 plus 51 golden, eight witness,
  three profile-limit, and 226 hostile fixtures. The complete Node 22
  `fitness:kern-5` wall passes with 434/434 cross-target, 109/109 class, and
  233/233 native KERN assertions at 100% coverage.
- [VERIFIED] Automatic high-risk review
  `review-1784707821710-ju7ajt-kern-5-r2-m4-40-final` completed against the
  implementation. Its verified lexical `List` shadowing and generated-helper
  collision findings were fixed with regression coverage; its non-finite-index
  concern was disproved by the evaluator's existing portable-scalar guard.
- [VERIFIED] Targeted independent post-fix review
  `review-1784711104800-11arvy-kern-5-r2-m4-40-review-fixes` completed 1/1 with
  no findings.

## Stop Conditions

- Any accepted/rejected table decision, canonical source, KIR, or hostile
  fixture changes.
- Any implementation that treats a miss as a valid scalar other than the
  documented nullish boundary carrier, bypasses namespace shadowing, or weakens
  raw dynamic-index provenance.
- Complete witness floor exceeds 40,000, the unchanged 65,536 envelope fails,
  or any runtime/KIR/ABI limit changes.
- Profile promotion differs from exactly `16/30/154`, the 11-function cohort
  drifts, or current 106-row coverage regresses.

## Challenge Evidence

- [VERIFIED] Full usable non-excluded Agon brainstorm
  `brainstorm-1784700864342-574mmf-kern-5-r2-m4-40-list-index` completed 6/6
  engines.
- [DECIDED] Five of six plans required TS/Python completion in this slice; the
  plan now includes the full cross-target contract and a shared hostile matrix.
- [DECIDED] The challenge added explicit Python negative-index, boolean,
  integral-float, negative-zero, sparse-slot, and runtime shape guards.
- [DECIDED] The proposed 49,152 replacement ceiling was rejected because its
  premise was incorrect: the published 55,002 floor and 34,700 prototype were
  both measured on the exact 154-row witness, not the 106-row active boundary.
  The precommitted 40,000 ceiling is stricter and remains the promotion gate.
- [DECIDED] Suggestions to retain the old linear scan as the `??` fallback were
  rejected because KERN's `??` fallback is an expression and the current scan
  is a statement loop; retaining it would also leave the hot path available.
