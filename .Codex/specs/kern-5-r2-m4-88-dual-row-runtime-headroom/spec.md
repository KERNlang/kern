# KERN 5 R2 M4.88 — Dual-Row Structural Runtime Rejection Receipt

**Status:** COMPLETE — PRODUCTION-CEILING NO-GO PUBLISHED
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.87 commit
`e7933c9d09bbeab9e6f41221370cb608cbf8a278` freezes the exact 21-function
residual frontier and selects candidate profile 74/77/580. The selected cohort
is exactly three legacy-parameter functions across the checker and validator,
with 40 total parameter rows.

[VERIFIED] Public-handler measurements found exact structural runtime floors
36,229, 51,321, and 107,594. The controlling `isreserved` floor exceeds the
65,536 production ceiling by 42,058 and the fixed 49,152 promotion budget by
58,442. M4.88 therefore publishes an immutable evidence-only
`rejected-over-production-ceiling` receipt. It does not promote the candidate,
weaken a limit, or change runtime/source behavior. M4.89 owns source-level
canonicalizer runtime-cost reduction. KERN 5 remains incomplete.

## Published Input

[VERIFIED] Branch `feat/kern-5-r2-m4-88-dual-row-headroom` starts from exact
published M4.87 commit `e7933c9d09bbeab9e6f41221370cb608cbf8a278`.

[VERIFIED] The immutable M4.87 handoff is:

- receipt SHA-256
  `9046716d876c336140b567a8a40a9b52750106b2ac5db66f38f7621e935c203a`;
- residual-analysis input commit
  `46337a6549390087ef095c18d0e178cf9ef28392`;
- selected limits 74 node rows, 77 property rows, and 580 value rows;
- three functions across two tools and 40 total parameter rows;
- unchanged production collection ceiling 65,536 and KIR depth 64; and
- active profile 38/61/580.

[VERIFIED] The M4.87 source state is bound by:

- coverage implementation digest
  `0d34962bf373ba4a9f47a7afb5ec4044ba2e426a3370e1deaf92cee1ca56253a`;
- coverage-summary SHA-256
  `cc34bcc0d17f9cfa3f173eb9ee8fcbaef174e093f5880c63ecef0f87ae9caf13`;
- prerequisite-summary SHA-256
  `fe6eb4b314e718696e04c9127ebaea1f232d2b993737d4eba1bf17d5a17c5076`;
- coverage-policy SHA-256
  `4ac57e59be2bcdb7b9aa0f7f35598703600bf47b4f17709e59c5823c0e605490`;
  and
- canonicalizer-policy SHA-256
  `a929434c674ecbed5688eb36235f81c203d5d0eb4a34583554caad116960614c`.

## Witness Contract

| Witness | Params | Rows N/P/V | Exact floor | Production delta | Promotion delta |
|---|---:|---:|---:|---:|---:|
| `checker.kern#18:indexRejectDetail` | 24 | 41/67/404 | 36,229 | +29,307 | +12,923 |
| `checker.kern#23:callRejectCode` | 15 | 47/64/478 | 51,321 | +14,215 | -2,169 |
| `validator.kern#2:isreserved` | 1 | 74/77/572 | 107,594 | -42,058 | -58,442 |

[DECIDED] Each witness is parsed from authenticated handwritten source and
counterfactually migrated with `migrateLegacyFunctionForPrerequisite`. The
migrated function is structurally encoded and decoded, flattened, and executed
through `kern.runtime.handler.v1` with exact candidate limits 74/77/580.

[VERIFIED] Bound source SHA-256 values are:

- checker source
  `a04a2242cb7762b9753f16e49cc0b849eadd736d2d1667d691d267603394ad59`;
- validator source
  `a9d278832edf050f3a96699980d88fa740f345d85192222b241bb6cc3ac2a2ee`;
- canonicalizer composite
  `fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28`;
- composition JSON
  `894cf14bc391d3109a20fb6abef8d1c98cab426e2ed6d238d414c8aee46cff3b`;
  and
- structural KIR codec
  `04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.

## Rejection Contract

[DECIDED] The promotion budget remains three quarters of the 65,536 production
ceiling: 49,152 steps, reserving 16,384 production steps. The diagnostic
boundary 107,594 exists only to authenticate the controlling floor. It is not
a runtime-policy value and cannot satisfy production or promotion admission.

[DECIDED] M4.88 proves:

1. exact M4.87 receipt, selection, assignments, sources, and active profile;
2. exact counterfactual migration to the published parameter and row counts;
3. each `exactFloor - 1` fails with `unsupported-runtime-input`;
4. each `exactFloor` succeeds with no diagnostics/events and round-trips to
   byte-identical structural KIR;
5. `isreserved` separately fails at the unchanged 65,536 production ceiling;
6. the maximum floor and both deficits are exact arithmetic;
7. diagnostic success never changes or satisfies the production policy; and
8. module-envelope admission remains explicitly outside the claim.

[DECIDED] The receipt disposition is
`rejected-over-production-ceiling`, with `productionCeilingDeficit = 42058`,
`promotionBudgetDeficit = 58442`, `requiredFloorReduction = 58442`, and
`nextMilestone = M4.89`. Raising either limit is prohibited.

## Adversarial Plan Delta

[VERIFIED] Initial approach: measure the three floors within the production
ceiling and publish either a promotion GO or budget-only NO-GO.

[VERIFIED] Measurement changed the premise: `isreserved` failed at 65,536 and
succeeded only at exact diagnostic boundary 107,594. A six-engine Agon
brainstorm (`brainstorm-1784905653042-cd7ai4-m4-88-over-production-no-go`)
unanimously recommended an immutable evidence-only rejection receipt, explicit
diagnostic/production separation, exact boundary bracketing, and an M4.89
runtime-cost route.

[DECIDED] Three repeated trials were not adopted because the failure boundary
is a deterministic iteration counter, not a noisy timing sample. One exact
floor-minus-one/floor pair per witness plus immutable digest binding proves the
boundary without tripling a multi-minute gate.

[ASSUMED] M4.89 can reduce canonicalizer cost without semantic change. That is
not an M4.88 acceptance dependency; if false, the candidate remains rejected.

[VERIFIED] The first full gate exposed a pre-existing live-test pin to compiled
core bytes retained by an accumulated TypeScript build (`edcfa…`). Removing
only ignored `packages/core/dist` and force-emitting the exact 304 source files
produced the deterministic clean-tree digest `7b8d…` (also 304 JavaScript
files). M4.88 updates that live compiled-tree expectation and current summaries;
no historical receipt or core source is rewritten.

[VERIFIED] High-risk role-lens review completed with all six routed engines.
It found no verified blocker. Review-driven fixes remove a parent-symlink-
sensitive receipt-path comparison and split the three independent runtime-floor
proofs into separate Node test files so the existing test runner can execute
them concurrently without dropping any boundary, production-failure, or
round-trip assertion. The clean-checkout `dist` concern is satisfied by the
`test:kern-canonicalizer` core/CLI build prefix. The explicitly authorized
`--no-verify` push follows the complete manual Node 22 fitness wall, which is
strictly broader than the repository pre-push hook.

[VERIFIED] The post-review Node 22 fitness wall passed through its exact
`KERN 5 current fitness wall passed.` terminal marker. Both exhaustive
canonicalizer invocations passed 350/350 tests; the parallelized invocation
completed in 219.3 seconds instead of the pre-review 347.2-second serial run,
without weakening or omitting a witness assertion.

## Implementation Plan

1. Preserve the captured missing-module RED test.
2. Freeze a canonical M4.88 rejection receipt bound to M4.87 and all source,
   policy, summary, runtime-handler, composition, and codec identities.
3. Add mutation/history/fresh-process tests plus independent public-handler
   boundary and round-trip tests for all three witnesses.
4. Integrate the receipt into the terminal coverage checker and status output.
5. Regenerate current summaries only after `.mjs` bytes settle; run focused,
   complete canonicalizer, and full Node 22 fitness gates.
6. Run automatic high-risk role-lens review, resolve verified findings, make
   one signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.87 commit `e7933c9d`.
- [x] Exact M4.87 selection and three witness assignments are grounded.
- [x] RED fails at the intended missing M4.88 receipt boundary.
- [x] Exact floors and production/promotion deficits are measured.
- [x] Every exact boundary and output round-trip is independently tested.
- [x] Receipt is canonical, source-bound, regular-file-only, and tree-only.
- [x] Production failure and diagnostic-only success remain distinct claims.
- [x] Module-envelope admission remains explicitly unclaimed.
- [x] No active product, source, runtime, ABI, or profile surface changes.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- M4.87 digest, input commit, selection, assignment, or source bytes drift.
- Any migrated witness changes its exact published parameter or row counts.
- Runtime success is non-monotonic at an exact measurement boundary.
- Any exact floor exceeds the fixed 107,594 diagnostic bound.
- Round-trip identity fails or evidence requires active-policy/runtime drift.

## Out of Scope

- Promoting `maxNodeRows` or `maxPropertyRows`.
- Migrating the selected 40 parameter rows.
- Raising runtime or promotion limits.
- Implementing the M4.89 runtime-cost reduction.
- Projection depth/nodes, unknown-expression, exception-flow, runtime cutover,
  stable KIR, RC/stable release, Fable work, or a KERN 5 completion claim.
