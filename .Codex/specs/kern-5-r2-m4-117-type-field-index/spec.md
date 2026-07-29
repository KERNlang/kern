# KERN 5 R2 M4.117 — Authenticated Type-Field Index

**Status:** VERIFIED FOR PUBLICATION
**Date:** 2026-07-29
**Confidence:** 0.95

## Executive Summary

[VERIFIED] M4.116 attributes 142,249 of the 176,119 retained iterations needed
to canonicalize `checkModule` to 59 complete `typefields` scans over the same
2,411-row value table. Promotion and production fail during function-parameter
type validation before statement validation or emission starts
(`scripts/kern-canonicalizer/runtime-bottleneck-m4-116.json`).

[DECIDED] M4.117 will replace those repeated scans with one memoizable
table-wide projection plus a fixed-width view. It will preserve the exported
`typesource` and `typefields` signatures, all malformed-type rejection
semantics, the runtime/handler ABI, policy limits, and the 122/193/2411
candidate profile.

## Current State / Root Cause

[VERIFIED] `typesource` has no local loop and calls
`typefields(id, valueParent, valueRole)` once per type lookup
(`examples/kern-canonicalizer/canonicalizer.kern:1-31`).

[VERIFIED] `canonicalize` calls `typesource` for the function return type and
every parameter during validation, and repeats type lookups during emission
(`examples/kern-canonicalizer/canonicalizer.kern:285-360`).

[VERIFIED] `typefields` currently scans every `valueParent` row to count direct
children and select unique `record:kind` and `record:element` children. A
duplicate recognized role returns `[-1,-1,-1]`
(`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:222-241`).

[VERIFIED] The M4.116 exact-floor observation records 59 `typefields`
executions and 142,249 completed `typefields` iterations, exactly
`59 * 2,411`
(`scripts/kern-canonicalizer/runtime-bottleneck-m4-116.json`).

## What Already Works

[VERIFIED] `tablesok` authenticates value-table lengths, ownership,
parent-before-child order, sibling order, role uniqueness for record children,
and scalar payload shape before function type validation
(`examples/kern-canonicalizer/canonicalizer.kern:362-518`).

[VERIFIED] The existing M4.106 `statementtablefacts` /
`statementfacts` pair proves the runtime can memoize one table-wide KERN
projection and reuse a fixed-width numeric view without changing the runtime
(`examples/kern-canonicalizer/canonicalizer-expression-helpers.kern:243-360`).

[VERIFIED] M4.115 and M4.116 receipts already freeze the pre-optimization
boundary and attribution. Their live-measurement tests are the only tests that
must become archival after the executable composition changes
(`scripts/kern-canonicalizer/triple-row-headroom-m4-115.test.mjs:73-89`;
`scripts/kern-canonicalizer/runtime-bottleneck-m4-116.test.mjs:128-153`).

## Contract

> Verified against the current KERN source and M4.116 receipt on 2026-07-29.

| Behavior | Evidence | Tag |
|---|---|---|
| `typesource` signature and call sites remain unchanged | `canonicalizer.kern:1-31,285-360` | VERIFIED |
| `typefields(parent,valueParent,valueRole)` remains exported | expression helpers `:222-241` | VERIFIED |
| direct-child count includes recognized and unknown roles | current increment at `:231-232` | VERIFIED |
| duplicate `record:kind` rejects the whole type | current early return at `:233-236` | VERIFIED |
| duplicate `record:element` rejects the whole type | current early return at `:237-240` | VERIFIED |
| absent recognized roles retain id `0` | current initialization at `:227-229` | VERIFIED |
| runtime memoization keys include identical helper arguments | M4.116 freezes 59 executions from 118 validation/emission preparations | VERIFIED |

## Implementation Options

### Option A — Memoizable table projection behind `typefields` (selected)

Add private `typefieldtablefacts(valueParent,valueRole)`. It performs one input
collection loop and one bounded parent-row materialization loop, producing
three slots per parent: child count, unique kind id, and unique element id.
Rewrite exported `typefields` as a loop-free fixed-width view that calls the
projection with identical table arguments.

This keeps every caller and exported signature stable, uses the already proven
M4.106 cache pattern, and reduces 59 full scans to one collection/materialization
pair.

### Option B — Thread a precomputed index through `typesource`

Rejected: it changes an exported signature and every validation/emission call
site without reducing the projection work further.

### Option C — Add a runtime intrinsic or mutable cache

Rejected: it changes the runtime or ABI for a KERN-source-local optimization
that existing helper memoization already supports.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| expression-helper KERN member | edit | add projection and fixed view |
| composed canonicalizer and composition receipt | regenerate | authenticate exact executable source |
| canonicalizer source-contract test | edit | RED oracle for layout and rejection sentinels |
| M4.80 historical owner/test | edit | preserve immutable earlier typefields receipt |
| M4.106 historical composition reconstruction | edit | preserve its pre-M4.117 source identity |
| M4.115/M4.116 tests and M4.116 owner | edit | convert live evidence to authenticated archival evidence |
| M4.117 measure/owner/receipt/tests/check | add | freeze adjacent new runtime boundary and optimization facts |
| coverage status/check/generated summaries | edit/regenerate | publish the M4.117 handoff |

## Acceptance Criteria

- [x] A source-contract RED test fails before implementation.
- [x] `typefieldtablefacts` owns exactly one value-row collection loop and one
      bounded parent materialization loop.
- [x] `typefields` owns no loop and reads exactly three fixed slots.
- [x] `typesource` and exported `typefields` signatures remain unchanged.
- [x] Duplicate kind or element roles still produce `[-1,-1,-1]`.
- [x] Unknown child roles still contribute to the exact child count.
- [x] Canonical, hostile, idempotence, structural round-trip, and public-parity
      behavior remain unchanged.
- [x] The successful witness executes `typefieldtablefacts` exactly once, with
      zero rollback and zero parent restart.
- [x] The adjacent exact floor is at or below the 49,152 promotion budget.
- [x] M4.80, M4.106, M4.115, and M4.116 receipts remain byte-identical
      authenticated historical evidence.
- [x] Runtime/KIR limits, handler ABI, active profile, and candidate profile
      remain unchanged.
- [x] Full Node 22 KERN 5 fitness and mandatory high-risk role review pass with
      no unresolved verified blocker.
- [ ] Signed commit is fetched/rebased and pushed once to `main`.

## Out of Scope

- Promoting or migrating `checkModule`; that requires a later evidence slice.
- Raising runtime, KIR, or profile limits.
- Changing runtime cache behavior or the public handler ABI.
- Solving the other five residual blockers.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Open Questions

None block implementation. The exact new floor is intentionally measured after
the source and semantic oracles pass.

## Deploy Order

Repository-internal source, generated composition, receipts, and archival
adapters publish atomically in one rebased push. There is no version-skew
window.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| “single-pass index” implies one total KERN loop | Robust fixed-width materialization needs one collection loop plus one bounded parent-row loop | The load-bearing guarantee is one scan of the input value rows, not one total loop |

## Implementation Evidence

[VERIFIED] The source-contract test failed before implementation because
`typefieldtablefacts` was absent, then passed after the helper and fixed-width
view were added.

[VERIFIED] The exact adjacent runtime boundary is 38,693 retained iterations:
38,692 fails, 38,693 succeeds, and the successful result is byte-identical to
the input. This reduces the M4.116 floor by 137,426 iterations and leaves
10,459 iterations of promotion-budget headroom.

[VERIFIED] The successful witness executes `typefieldtablefacts` once, with
zero rollback and zero parent restart. The immutable receipt is
`scripts/kern-canonicalizer/runtime-cost-m4-117.json`, SHA-256
`125529edf09c4523e778288052c3b66cf08c8099a4f0d18ef25038cb64b54778`.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passed on
2026-07-29, including the 524-test canonicalizer suite, 434/434 cross-target
fixtures, 109/109 class fixtures, 233/233 native KERN assertions at 100%
coverage, runtime ABI, KIR containment, source-runner convergence, browser
budget, and diff hygiene.

[VERIFIED] The mandatory high-risk role review completed with all 6 usable
reviewers. It reported no verified blocker. Direct exported calls with parent
ids outside authenticated table bounds were confirmed to have changed
behavior; the old behavior is now preserved through existing scan helpers only
on that out-of-range branch. Executable tests cover normal counts, missing and
unknown roles, both duplicate-role sentinels, positive out-of-range parents,
and negative parents. The admitted indexed path and its exact floor are
unchanged.
