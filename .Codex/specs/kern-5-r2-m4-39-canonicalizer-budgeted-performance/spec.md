# KERN 5 R2 M4.39 Canonicalizer Budgeted Performance

**Status:** PUBLISHED; POST-PUBLISH RUNTIME FIX READY
**Date:** 2026-07-22
**Confidence:** 0.98

## Executive Summary

M4.39 is an optimization-only release slice. It replaces the KERN
canonicalizer's quadratic `tablesok` validation scans with deterministic
portable-`Map` indexes while preserving the current accepted language,
rejection behavior, runtime-handler ABI, KIR contracts, caller-owned runtime
limit, and exact `16/30/106` profile. Profile promotion remains a separate later
slice.

## Verified Baseline

- [VERIFIED] Published M4.32 measured the exact `16/30/106` boundary at
  14.089 seconds and prohibited later widening until the quadratic table
  validator received an explicit budgeted optimization.
- [VERIFIED] Published M4.38 selected `16/30/154` as the smallest current
  one-axis counterfactual, completing 11 functions across three tools.
- [VERIFIED] Exact migrated production execution of
  `examples/selfhost-validator/validator.kern#18:hasimportcyclefrom` at
  `15/24/154` takes approximately 16.4 seconds and fails closed as
  `unsupported-runtime-input` without a result.
- [VERIFIED] Direct execution of the same linked `tablesok` body exposes the
  hidden cause: `InternalEffectMachineError: effect machine iteration budget
  exhausted` at the nested `valueChild` loop in composed-source line 569.
- [VERIFIED] The runtime handler deliberately derives the shared loop budget
  from the validated caller-owned `runtimeLimits.maxCollectionLength`, which is
  currently 65,536. Raising that limit is not an algorithmic fix.
- [VERIFIED] Portable KERN supports `new Map()`, string-keyed `Map.has` and
  `Map.get`, `do Map.set`, scalar map values, `String(number)`, and bounded
  `for`; portable `assign` cannot mutate array indexes.
- [VERIFIED] The helper preflight currently rejects `Map.set` whenever its key
  depends on a helper parameter or loop binding, even when `String(...)` makes
  the runtime key type unambiguous. The exact first rejection is
  `Map.set(nodeSiblingCounts, nodeParentKey, ...)` inside `tablesok`.

## Contract

- [DECIDED] Keep `profileLimits` exactly `16/30/106`.
- [DECIDED] Keep `runtimeLimits.maxCollectionLength` exactly 65,536 and leave
  every other runtime/KIR/expansion limit unchanged.
- [DECIDED] Change only the canonicalizer algorithm inside `tablesok`;
  canonical source for every currently valid table and the failure envelope
  for every currently invalid table must remain unchanged. The supporting
  runtime change is limited to removing repeated copies of an exact
  machine-owned Map while preserving pure speculative precondition checks and
  immutable trace evidence.
- [DECIDED] Extend the shared helper preflight only for deferred `Map.set` keys
  built from string literals, exact unary `String(value)` calls, or `+` trees
  where both branches recursively satisfy that proof. Preserve fail-closed
  rejection for bare/mixed deferred keys, templates, conditionals, assertions,
  and helper-returned keys.
- [DECIDED] Effect-machine writes to exact runtime-owned Maps mutate that
  unaliased machine value in place, avoiding an uncharged full-map copy on
  every insertion. Generic semantic precondition resolution remains pure and
  retains functional-copy behavior.
- [DECIDED] Build scan-specific maps. Composite keys with user-controlled text
  must length-frame the text component: numeric prefix, `":"`, decimal text
  length, `":"`, then the exact text. Numeric tuples use decimal components
  with fixed separators and never share a map with another key domain.
- [DECIDED] Populate indexes in original row order and validate in original row
  order. Never depend on `Map` iteration order.
- [DECIDED] M4.39 must prove exact production success for the migrated
  `15/24/154` witness under the unchanged runtime envelope, but must not admit
  154 rows through the active policy.

## Preserved Table Invariants

1. Parallel table lengths are equal and `nodeKind` is non-empty.
2. Node parents and orders are bounded; non-root parents precede children;
   sibling orders are unique and form the dense range `0..count-1`.
3. Properties name valid node/value rows and root values; `(node, key)` pairs
   are unique.
4. Values have valid parents/orders/tags; non-root parents precede children;
   sibling orders are unique and dense.
5. Scalar tags have no children and retain exact payload restrictions;
   integers retain exact lexical validation.
6. Root values have exactly one property owner; nested values have none.
7. List children use `list-item`; record children use non-empty `record:` roles,
   roles are unique per record, and roles increase strictly by semantic child
   order even when physical row order differs.

## Implementation Plan

1. Add RED regression coverage for the exact `15/24/154` production witness,
   unchanged profile/budget, and a frozen quadratic reference oracle.
2. Add a focused runtime regression proving helper-local `Map.set` with a
   deferred `String(...)` key and preserving the existing bare-key rejection.
3. Replace node sibling, property duplicate, value child/sibling, property
   ownership, and record-role pairwise scans with Map-backed accumulation and
   row-order replay passes.
4. Recompose and authenticate `canonicalizer.composed.kern`; regenerate only
   live receipts whose implementation digests necessarily change. Preserve
   immutable historical receipts byte-for-byte.
5. Differentially test current fixtures and hostile generated tables against
   the frozen quadratic oracle, including delimiter-like Unicode/text,
   numeric-looking roles, reordered siblings, sparse/duplicate orders,
   ownership errors, scalar children, and record ordering.
6. Measure direct `tablesok` and full production execution at the exact
   `15/24/154` witness. Require complete-handler success at the unchanged
   65,536 production ceiling and direct-`tablesok` success at 32,768. The
   complete handler does not establish safe promotion headroom in this slice;
   the direct validator proves the 2x algorithmic improvement M4.39 owns.
7. Run the focused canonicalizer gate, complete Node 22 KERN 5 fitness wall,
   and automatic high-risk role-lens independent review before publishing.

## Expected Files

- `.Codex/specs/kern-5-r2-m4-39-canonicalizer-budgeted-performance/spec.md`
- `examples/kern-canonicalizer/canonicalizer.kern`
- `examples/kern-canonicalizer/canonicalizer.composed.kern`
- `packages/core/src/ir/semantics/deferred-expression-preflight.ts`
- `packages/core/src/ir/semantics/internal-effect-machine-do.ts`
- `packages/core/src/ir/semantics/internal-effect-machine-leaf.ts`
- `packages/core/src/ir/semantics/portable-map.ts`
- `packages/core/src/ir/semantics/let.ts`
- `packages/core/src/ir/semantics/async-reference-runner.ts`
- `packages/core/tests/ir-semantics-do.test.ts`
- `packages/core/tests/runtime-envelope-effect-machine-do.test.ts`
- `packages/core/tests/runtime-envelope-effect-machine-helper.test.ts`
- `scripts/kern-canonicalizer/composition.json`
- `scripts/kern-canonicalizer/canonicalizer.test.mjs`
- `scripts/kern-canonicalizer/tables-ok-performance.test.mjs`
- live canonicalizer coverage/prerequisite receipts and their exact tests
- `docs/kern-5-release-train.md`

## Acceptance Criteria

- [x] RED reproduces the generic production failure and exact hidden iteration
      exhaustion on the published main baseline.
- [x] No quadratic pairwise scan targeted by this slice remains inside
      `tablesok`; record-role predecessor reads are Map values rather than
      linear ID-helper lookups.
- [x] Frozen-oracle differential tests preserve all acceptance decisions.
- [x] All existing golden, KIR, idempotence, profile-limit, and hostile fixtures
      remain exact.
- [x] Exact migrated `15/24/154` production execution succeeds under unchanged
      limits and returns canonical source with no events or diagnostics.
- [x] The optimized direct `tablesok` witness succeeds at 32,768 and the
      complete handler succeeds at the unchanged 65,536 production ceiling.
- [x] Active profile remains exactly `16/30/106`; no profile promotion occurs.
- [x] Focused and full Node 22 gates pass after the review-driven runtime fix.
- [x] Independent high-risk review has no unresolved material finding.
- [x] Signed Agon commit `f16b81e3` was fetched/rebased before one atomic
      no-verify push to the fresh feature ref and authorized `main`; both refs
      resolved to the published commit.

## Stop Conditions

- Any old/new acceptance mismatch or current hostile-fixture drift.
- Any key encoding without a proved injective shape for its comparison domain.
- Any remaining `unsupported-runtime-input`, nondeterminism, or budget
  exhaustion at the exact witness.
- Failure at 32,768 for direct `tablesok`, failure at 65,536 for the complete
  handler, a regression at the frozen 106 boundary, or any acceptance drift.
- Any attempt to compensate by raising the runtime budget or widening the
  active profile in M4.39.

## Agon Challenge Evidence

- Initial all-usable-roster brainstorm:
  `brainstorm-1784692385966-3lyg9a-kern-5-r2-m4-39-canonicalizer-pe`
  produced five plans; all selected an optimization-only Map-indexed slice,
  frozen budget/profile, hostile differential tests, and exact receipts.
- `zai-coding-plan-glm-5.2` emitted no artifact in the initial run or the
  focused completion retry
  `brainstorm-1784692460981-mfur94-kern-5-r2-m4-39-canonicalizer-pe`.
- [DECIDED] The challenge changed delimiter-only keys to length-framed keys,
  added row-order replay and an old/new oracle, and made measured budget
  headroom a merge condition.
- A focused deferred-key challenge
  `brainstorm-1784693035951-dwagh5-kern-5-r2-m4-39-deferred-map-key`
  changed the implementation from a broad runtime-type assumption to a narrow
  syntactic proof. A Codex/Kimi retry
  `brainstorm-1784693144690-htu8rl-kern-5-r2-m4-39-deferred-map-key`
  emitted no additional artifacts.
- High-risk role review `review-1784696200032-ghgp2t` confirmed the
  Map-indexed invariants and exposed remaining generic ID-helper scans. Those
  remain explicitly performance-gated for M4.40 instead of being described as
  completed by this slice.
- Final high-risk role review
  `review-1784696598963-wkmne1-kern-5-r2-m4-39-final` found that the generic
  `Map.set` path copied its complete prefix on each newly admitted deferred
  write. The review-driven fix mutates only exact runtime-owned Maps, keeps
  generic precondition resolution pure, snapshots Map-valued assignment trace
  evidence, stores record roles directly by sibling order, and removes the
  obsolete live M4.38 analyzer behind the immutable published handoff.
- Post-fix full-roster review
  `review-1784699626179-0vt7am-kern-5-r2-m4-39-post-fix` found one remaining
  uncharged quadratic path: the exact owned Map rebind still passed through
  `assignBinding`, which ownership-walked the complete growing prefix. A RED
  iterator-poison regression reproduced the scan; the machine path now uses
  an identity-checked exact-owned scalar-Map rebind that preserves provenance
  cleanup without a graph walk. The generic ID-helper scans reported by the
  performance lens remain the already documented M4.40 work and do not widen
  M4.39.
- Final full-roster confirmation
  `review-1784702046503-8i1uac-kern-5-r2-m4-39-final-post-fix` returned the
  original Codex blocker reporter with no findings. Minimax's two blocking
  claims were disproved against JavaScript Map semantics and the executable
  regression: Map entries are internal slots rather than own properties, so
  `Reflect.ownKeys` remains empty for a populated exact Map, and the test starts
  with `existing -> 0`, poisons Map iteration, then successfully adds
  `next -> 1`. The focused runtime tests and complete fitness wall both pass.
  The push-copy observation is a pre-existing array path outside this
  Map-indexed M4.39 slice. No material finding remains unresolved.
- Targeted review-driven-fix confirmation
  `review-1784699556651-u2wyb3-kern-5-r2-m4-39-mapset-fix` completed 2/2
  independent reviews. Claude reported no findings. The `dist`-import concern
  was disproved because `test:kern-canonicalizer` builds core and CLI before
  loading the test, and the complete wall passed that gate twice. The
  low-confidence aliasing concern was already excluded by the portable value
  domain; the invariant is now documented and a regression proves Map alias
  creation rejects before an in-place write. No material finding remains.
