# KERN 5 R2 M3.22 Pair/Entry `each` Machine Ownership

**Status:** DONE
**Date:** 2026-07-14
**Confidence:** 0.97
**Design challenge:** Agon tribunal
`tribunal-1784062476166-n1472j-m3-22-next-slice` (3/3 current engines
completed)

## Executive Summary

M3.22 removes the `each-pair-entry` compatibility blocker by admitting the
already-defined pair-sync, pair-async, entry-key, and entry-value shapes into
the canonical internal effect machine. The shared `each` runtime already
detects and executes all six shapes; only root selection and whole-tree
preflight restrict ownership to array and indexed-array forms.

The slice must also close a latent budget asymmetry before promotion: the
machine currently supplies its iteration-budget callback to the shared
iterator, but that callback is invoked only for array shapes. Every newly
admitted pair/entry iteration must consume the same caller-owned shared budget
before emitting `iter-next` or executing its body.

This is not a public API or expression-language expansion. `lambda`, helper
function environments, runner class state, non-root environments, arbitrary
async iterables, and implicit iteration budgets remain explicitly deferred.

## Current State / Root Cause

- **VERIFIED:** `detectEachShape` recognizes `array`, `array-indexed`,
  `pair-sync`, `pair-async`, `entry-key`, and `entry-value`, while
  `iterateEachRuntimeSteps` executes every shape through one canonical step
  representation (`packages/core/src/ir/semantics/each-runtime.ts:8-56,170-247`).
- **VERIFIED:** pair mode already accepts a bounded `Map` or an array of exact
  two-element tuples; entry mode already requires a plain non-array/non-Map/
  non-Set object and preserves JavaScript key/value order
  (`each-runtime.ts:99-113,178-226`).
- **VERIFIED:** root selection rejects every non-array `each` through
  `isInternalEffectMachineArrayEach`, and whole-tree analysis repeats the same
  array-only gate and length check
  (`internal-effect-machine-structure.ts:40-49,353-364`).
- **VERIFIED:** the machine executor does not contain an array-only branch; it
  delegates every `each` node to `iterateEachRuntimeSteps`
  (`internal-effect-machine-sequence.ts:89-118,200-202`).
- **VERIFIED:** iteration-budget consumption is passed as the iterator callback
  but `iterateCollection` invokes it only inside array and indexed-array loops.
  Pair and entry loops currently emit steps without decrementing the budget
  (`internal-effect-machine-sequence.ts:42-49,96-101`;
  `each-runtime.ts:152-176,178-226`).
- **VERIFIED:** the machine disposition marks `each` as `partial`, and the
  convergence manifest records `each-pair-entry` as a deferred partial node
  (`internal-effect-machine-types.ts:9-28`;
  `scripts/source-runner-convergence-manifest.json:24-31`).
- **VERIFIED:** `internal-effect-machine-structure.ts` is already 493 lines, so
  new validation logic cannot be added there without violating the handwritten
  500-line rule (`wc -l` on 2026-07-14).

The root cause is an ownership gate left behind after the shared iterator was
generalized. Promotion is unsafe as a disposition-only change because pair
tuple malformation could otherwise reject only after earlier iterations have
performed effects, and because non-array iterations currently bypass the
shared budget.

## Contract

| Behavior | Required M3.22 result | Evidence | Tag |
|---|---|---|---|
| Shape ownership | All six existing `EachShape` variants are machine-owned | shared shape detector/iterator already covers six variants | VERIFIED |
| Pair-sync | Bounded `Map` and exact `[key, value]` tuple arrays preserve insertion order | `each-runtime.ts:178-210` | VERIFIED |
| Pair-async | `await=true` retains the existing in-memory observable trace contract | `each.ts:22-33,316-339` | VERIFIED |
| Entry-key/value | Plain records iterate keys/values in object order | `each-runtime.ts:211-226` | VERIFIED |
| Binding trace | Pair primary binding remains the value; entry primary remains the selected key/value | `each-runtime.ts:184-224` | VERIFIED |
| Whole-tree admission | Collection type and every pair tuple are validated before any earlier effect | existing structure preflight pattern | VERIFIED pattern |
| Budget | Every emitted iteration step consumes one caller-owned shared budget unit first | array path currently establishes this invariant | VERIFIED pattern |
| Completion | `break` is consumed, `continue` advances, `return`/`throw` propagate | `internal-effect-machine-sequence.ts:102-117` | VERIFIED |
| Selection | Supported pair/entry programs select the machine; post-selection errors never retry legacy | source runner selector contract | VERIFIED |
| Public API | No new option, default threshold, export, or runner signature | existing `iterationBudget` option remains unchanged | VERIFIED |

## Implementation Plan

1. Add a registry-independent `each` machine-admission helper in
   `each-runtime.ts` (or a small dedicated helper if line pressure requires it)
   that:
   - accepts all six existing shapes,
   - resolves the collection without executing body effects,
   - validates array mode, all pair tuples, or plain-record entry mode,
   - returns the exact finite iteration count for preflight reachability.
2. Rename/generalize the iterator callback from array-element read to iteration
   start and invoke it once before every array, pair, or entry step is yielded.
3. Replace the two array-only structure gates with the generalized helper while
   keeping `internal-effect-machine-structure.ts` at or below 500 lines.
4. Promote `INTERNAL_EFFECT_MACHINE_DISPOSITION.each` from `partial` to
   `unified`.
5. Move `each-pair-entry` from deferred to owned evidence in the convergence
   manifest and update the exact guard/tests without changing the other
   blockers.
6. Extend machine and source-runner tests for sync/async parity, ordering,
   bindings, malformed preflight, completion propagation, no earlier effects,
   and shared budget exhaustion.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/each-runtime.ts` | edit | generalized admission/count and per-shape iteration callback |
| `packages/core/src/ir/semantics/internal-effect-machine-structure.ts` | edit minimally | call generalized helper; do not exceed 500 lines |
| `packages/core/src/ir/semantics/internal-effect-machine-types.ts` | edit | `each: unified` |
| `packages/core/tests/runtime-envelope-effect-machine-each.test.ts` | extend | machine parity, preflight, budget, completion oracles |
| `packages/core/tests/source-runner-engine.test.ts` | edit | pair/entry selection and machine-only execution |
| `scripts/source-runner-convergence-manifest.json` | edit | promote `each-pair-entry` with evidence |
| `scripts/check-source-runner-convergence.mjs` | edit | exact disposition/deferred-set proof |
| `scripts/source-runner-convergence.test.mjs` | edit | mutation tests for the new owned row |
| release train/spec | edit after gates | record bounded M3.22 evidence |

## Acceptance Criteria

- [x] All six existing `EachShape` values are admitted by the canonical machine
  when the root environment and finite collection satisfy the frozen bounded
  domain.
- [x] Pair `Map`, pair tuple-array, pair-async over bounded in-memory data,
  entry-key, and entry-value traces match the semantic reference runner for
  representative non-empty and empty collections.
- [x] Pair bindings expose both key and value in each fresh child environment,
  while `iter-next` retains the existing value-primary trace contract.
- [x] Entry iteration preserves the existing key/value ordering contract.
- [x] Malformed pair tuples, invalid entry receivers, malformed shape props,
  and unresolved collections reject during whole-tree preflight before any
  earlier capability call, assignment, or loop-body event.
- [x] Every pair/entry iteration consumes exactly one shared caller-owned budget
  unit before `iter-next`; exhaustion prevents the next iteration body/effect.
- [x] `break`, `continue`, `return`, and `throw` behavior remains identical to
  array `each`, including nested control frames.
- [x] Sync and immediate-async source APIs select the machine for admitted
  pair/entry programs and never catch/retry the compatibility runner.
- [x] `each` is marked `unified`; only `each-pair-entry` moves from deferred to
  owned evidence; all other M3.21 blockers remain byte-for-byte represented.
- [x] Every touched handwritten source file remains below 500 lines.
- [x] Focused tests, build/lint, complete `pnpm fitness:kern-5`, and full current-
  roster `agon review` pass before commit and push.

## Completion Evidence

- RED-first focused tests failed for the intended ownership boundaries: all-six
  admission, source selection, shared pair/entry budget consumption, malformed
  pair preflight, and the exact convergence disposition.
- The focused core machine/source-runner suite passed after implementation.
- The complete `@kernlang/core` test suite passed.
- `pnpm test:source-runner-convergence`, `pnpm check:kern-5-contract`,
  `pnpm lint`, and `git diff --check` passed.
- `pnpm fitness:kern-5` passed end-to-end on 2026-07-14.
- The design tribunal completed 3/3 with the bounded pair/entry promotion
  verdict (`tribunal-1784062476166-n1472j-m3-22-next-slice`).
- The first full-roster review found one verified mutable-host-intrinsic gap.
  A RED regression proved an earlier capability could redirect Map/Object
  iteration after preflight; execution now uses captured intrinsics and
  index-based traversal. The post-fix complete fitness wall passed.
- The terminal `claude,codex,agy` review completed 3/3 with zero verified,
  needs-check, or speculative findings
  (`review-1784066250344-bzqds0`). Two non-blocking nits were adjudicated from
  the machine admission contract and supported runtime assumptions.

## RED Oracle

Before implementation, focused tests must fail because:

1. Pair/entry nodes are rejected by `isInternalEffectMachineEligible`.
2. Source-runner selection routes valid pair/entry programs to compatibility.
3. The disposition and executable manifest require `each` to remain partial.
4. Pair/entry steps do not consume the machine iteration budget.
5. No machine oracle proves malformed later tuple rejection before an earlier
   capability effect.

The oracle must not become green through a disposition-only edit, deleting
legacy assertions, materializing arbitrary async iterables, adding a default
budget, or catching machine failure and retrying compatibility.

## Out of Scope

- Arbitrary sync/async iterable host objects or mutation-during-iteration
  semantics.
- Non-identifier `in=` expressions beyond the existing proven record-array
  reference path.
- `lambda`, closure capture, helper-function registries, recursion, or modules.
- Runner class state, `this`, `super`, constructors, or inheritance.
- Non-root semantic environments or parent-scope admission changes.
- Public runner option/signature changes or any implicit iteration threshold.
- Deleting the semantic oracle, reference runner, or compatibility adapter.
- Claiming R2 M3 or KERN 5 complete.

## Deploy Order

M3.22 is based on the exact pushed M3.21 remote branch because M3.21 is not yet
on `origin/main`. Before the single push, fetch and rebase onto that remote
predecessor, or onto `origin/main` if the full predecessor chain has merged.
The compatibility runner remains available for every named deferred blocker.

## Corrections Log

| Original claim | Repository reality | Impact |
|---|---|---|
| Caller-owned iteration budget should be the next standalone slice. | `iterationBudget` and `remainingIterations` already exist and are required for loop selection/execution. | Budget is a promotion guardrail, not a new feature. |
| The shared iterator makes pair/entry promotion disposition-only. | Admission is array-only, tuple validation is lazy, and the budget callback is array-only. | M3.22 needs generalized preflight and callback coverage before promotion. |
| Pair-async requires a new async iterator engine. | The frozen runner contract treats `await=true` as emitter information for bounded in-memory pair data and keeps the same observable trace. | M3.22 can preserve the existing bounded contract without arbitrary async iterables. |
