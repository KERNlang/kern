# KERN 5 R2 M4.98 — Property-Row Early-Exit Optimization

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-27
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.97 commit
`98b023acb48a69deb92c6c3407d948099388517b` removes whole-parent helper replay
and authenticates the exact `comparisonOperandsOk` runtime floor at 53,086.

[VERIFIED] Every remaining charged operation is a retained KERN `for`
iteration. `propid` executes 96 times over as many as 95 property rows and
`propcount` executes 53 times over the same table, exposing as many as 14,155
logical property-row iterations.

[VERIFIED] `flattenKirRoots` emits all properties of a node together before it
recurses into later nodes. Its `propNode` table is therefore nondecreasing for
every admitted adapter output.

[DECIDED] M4.98 authenticates that ordering invariant in KERN `propertyfacts`,
then lets `propid` and `propcount` stop when the current property owner exceeds
the requested node. It publishes a new exact floor without changing the
runtime engine, handler ABI, active structural profile, or iteration limit.

[DECIDED] Even if M4.98 reaches the 49,152 promotion budget, profile promotion
and parameter migration remain separate later milestones.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main` commit
`98b023acb48a69deb92c6c3407d948099388517b`.

[VERIFIED] M4.97 receipt
`scripts/kern-canonicalizer/runtime-cost-m4-97.json` has SHA-256
`9b0d7ce9b03c1b8f54e701172c66cb3b834fa9476e346d8ba25e82bf21549e71`.

[VERIFIED] M4.97 exact-floor diagnostics report:

- 53,086 attempted and retained `for` iterations, with zero rollbacks;
- 96 `propid` executions and 53 `propcount` executions;
- one preserved `expressionsources` execution; and
- byte-identical public/internal success at the exact floor.

## Root Cause

[VERIFIED] `propid` and `propcount` scan `propNode` to the physical end even
after they have passed all rows belonging to the requested node.

[VERIFIED] The adapter constructs node ids in preorder and appends each node's
property rows before visiting later nodes. Thus all admitted property owners
form a nondecreasing sequence.

[VERIFIED] KERN `propertyfacts` currently validates ranges, duplicate
node/key pairs, and value ownership, but does not authenticate this ordering
property. Adding an early exit without that validation would be unsound for
direct hostile table arguments.

## Runtime and Language Contract

[DECIDED] `propertyfacts` rejects a property owner smaller than the previous
row's owner. This closes the flat-table contract around the ordering already
produced by the canonical adapter.

[DECIDED] After `tablesok` accepts the table, private `propid` and `propcount`
helpers may return as soon as `propNode[i] > node`. They are not standalone
module exports because their ordering precondition belongs to `canonicalize`.

[DECIDED] Empty property tables, absent nodes, duplicate keys, duplicate value
owners, out-of-range ids, and all existing canonical outputs preserve their
current results.

[DECIDED] No host-only intrinsic, function-name special case, cache-limit
increase, public option, new syntax, runtime-limit change, or policy promotion
is permitted.

## Implementation Plan

1. Add RED tests proving a decreasing `propNode` table is rejected and the two
   lookup helpers own authenticated early exits.
2. Add the monotonic-owner guard to KERN `propertyfacts` and bounded early
   exits to `propid` and `propcount`; regenerate the exact composition.
3. Remeasure the M4.97 witness, find the new adjacent failure/success floor,
   and publish immutable M4.98 evidence against exact M4.97 history.
4. Regenerate coverage prerequisites and source authentication without moving
   any active profile limit.
5. Run focused canonicalizer/runtime tests, the complete Node 22 KERN 5
   fitness wall, and mandatory independent review before one fetched/rebased
   atomic push.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.97 commit `98b023ac`.
- [x] The remaining logical-loop owner is grounded in live diagnostics.
- [x] Adapter construction proves nondecreasing admitted `propNode` rows.
- [x] A decreasing `propNode` sequence fails closed before source generation.
- [x] `propid` and `propcount` stop only after passing the requested owner.
- [x] Existing golden/idempotence/hostile output remains byte-identical.
- [x] The exact M4.98 floor is measured with adjacent failure/success budgets.
- [x] Public/internal envelopes remain byte-identical at the new floor.
- [x] M4.97 receipt remains immutable and exactly authenticated.
- [x] Active profile and runtime/KIR/ABI limits remain unchanged.
- [x] Focused, complete, and full Node 22 KERN 5 gates pass.
- [x] Independent review has no unresolved verified blocker.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- Any accepted canonical adapter output contains decreasing property owners.
- Early exit changes a canonical or hostile fixture verdict unexpectedly.
- The optimization depends on a host-only shortcut or public ABI widening.
- The new floor does not materially reduce the 3,934-step promotion deficit.
- Exact evidence cannot distinguish this reduction from unrelated drift.

## Out of Scope

- Profile promotion or parameter migration.
- Helper-cache policy changes or public runtime options.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Implementation Evidence

[VERIFIED] The exact M4.98 witness fails at 46,380 and succeeds at 46,381
retained loop iterations with zero rollback. This reduces the M4.97 floor by
6,705 steps, leaves 19,155 steps of production headroom, and leaves 2,771
steps below the 49,152 promotion budget.

[VERIFIED] Public and internal execution envelopes are byte-identical at the
new floor. The immutable M4.98 receipt SHA-256 is
`21ab630c3c937ee62d15fadfcec9faee80cf87a2d7eb6fdee7c41b3723efc201`.

[VERIFIED] The regenerated canonicalizer composition is 53,298 bytes with
composite SHA-256
`983eed5c8841b0cdf41a0b678734f2457c97545a88607969acc9fd4dcc1fc807`.

[VERIFIED] The complete canonicalizer gate passes 410/410 Node tests, 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures. Coverage remains 89/109 base-complete with
17 `fn.params` blockers and no profile promotion.

[VERIFIED] The complete Node 22 `fitness:kern-5` wall passes after all
review-driven fixes, including repository consistency, lint, production build,
workspace tests, release policy, cross-target conformance, runner smoke,
whole-app behavior, runtime/KIR ownership and ABI gates, and diff hygiene.

## Independent Review

[VERIFIED] High-risk role-lens review run
`review-1785130465942-kh1v2c` routed to all 6/6 usable independent engines and
completed with no failed reviewer.

[VERIFIED] Four actionable review findings were reproduced and fixed:

- receipt validation now rejects array accessors without invoking getters;
- the M4.98 measurement owner has no import-time `process.argv` side effect;
- ordering-dependent `propid` and `propcount` helpers are private; and
- the M4.97 archival floor test no longer hardcodes a future optimization's
  exact floor.

[VERIFIED] Focused regressions, the 410-test canonicalizer gate, and the full
KERN 5 fitness wall all pass after those fixes. No verified blocker remains.
