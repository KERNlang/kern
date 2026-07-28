# KERN 5 R2 M4.110 — Projection Blocker Analysis

**Status:** VERIFIED — PUBLISH PENDING
**Date:** 2026-07-28
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.109 commit
`e77fc4567543ad6984b86b97d8a7a8e469020ebd` proves ordinary profile
widening is exhausted: 15 residual functions, no profile-row facts, no
observed profile settings, no candidates, and a null action.

[VERIFIED] The absence of profile rows is caused by the structural KIR
projection boundary, not by the current 89/125/2100 profile alone. Twelve
functions first fail at `maxDepth: 64`, one at `maxNodes: 4096`, and two at
unsupported `new` expression kinds. Several functions retain additional
authored blockers after projection succeeds.

[DECIDED] M4.110 is analysis-only. It counterfactually measures exact
projection requirements and publishes one deterministic candidate without
changing KIR/runtime/profile policy, KERN source, ABI, or cumulative coverage.

[VERIFIED] The first ranked candidate raises only KIR `maxDepth` from 64 to
76. It makes nine functions parameter-ready across all four tools and exposes
134 direct parameter rows. It is a recommendation, not a promotion.

[DECIDED] M4.111 must authenticate the structural KIR and runtime-envelope
safety of the selected depth candidate before any policy change.

[DECIDED] M4.110 is not KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main`
`e77fc4567543ad6984b86b97d8a7a8e469020ebd`.

[VERIFIED] The immutable M4.109 receipt SHA-256 is
`ad6240c77ed276d1f865beb702ceeb7c85767191dbaa3cf36f526505c4e555fb`.
It authenticates:

- 92/111 base-complete functions;
- 15 legacy parameter blockers and 15 residual functions;
- zero parameter-ready rows;
- profile limits 89/125/2100;
- KIR limits including `maxDepth: 64`, `maxNodes: 4096`, and
  `maxBytes: 262144`; and
- reason-assignment digest
  `f200b876c0ed6dd9cd75cfebe1c46c3d6cf97b13e0422886bc13b0f02f46b203`.

## Projection Measurement Contract

[DECIDED] For each exact M4.109 assignment, M4.110 reparses and migrates the
authenticated legacy signature in memory, then evaluates the canonical
structural KIR codec. It may vary only declared KIR numeric limits and must
leave every other policy field exact.

[DECIDED] Minimum requirements are found fail-closed by requiring the candidate
value to pass and the immediately lower value to fail with the expected limit
code. Unsupported expression kinds remain explicit non-limit blockers.

[VERIFIED] Generous bounded measurement produces structural profile rows for
13 functions. Two canonicalizer roots remain blocked by
`unknown-expression-kind`.

[VERIFIED] Twelve roots require depth between 66 and 93. The `validate`
witness additionally requires exact minimums:

- `maxDepth: 98`;
- `maxNodes: 5313`; and
- `maxBytes: 273051`.

[DECIDED] Candidate settings derive only from observed exact minima. A
candidate witness must both project successfully and complete under the
unchanged cumulative base and 89/125/2100 profile.

[DECIDED] Rank candidates by fewer changed KIR axes, more completed tools,
lower total limit delta, more completed functions, then canonical limit
signature. This reuses the established capability-neutral ordering without a
favored tool or hardcoded future ceiling.

## Selected Candidate

[VERIFIED] Exact `maxDepth: 76` with every other KIR limit unchanged completes
nine functions across assertion-engine, checker, canonicalizer, and validator:

1. `examples/capstone-assertion-engine/compare.kern#2:compareList`
2. `examples/capstone-assertion-engine/compare.kern#3:compareMap`
3. `examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven`
4. `examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven`
5. `examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk`
6. `examples/capstone-checker-subset/checker.kern#20:mapKeyToken`
7. `examples/capstone-checker-subset/checker.kern#21:mapKnownBefore`
8. `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement`
9. `examples/selfhost-validator/validator.kern#15:exportkind`

[VERIFIED] Their parameter-row total is 134. `rejectLine` requires depth 77
and therefore remains outside the selected candidate. `checkModule`,
`quotesource`, `validate`, `expressionsources`, and `canonicalize` retain
profile, authored, multi-limit, or unsupported-expression blockers.

## Verification Evidence

[VERIFIED] The M4.110 receipt uses format
`kern.kir-canonicalizer.projection-analysis.1` and exact SHA-256
`38f26bb48237832163acb8fa99ee0b65b8dc343f77f6a7570481e54d01d6732f`.

[VERIFIED] The RED test first failed at the absent M4.110 module boundary.
After implementation:

- targeted M4.110 and status tests passed 56/56;
- the complete canonicalizer suite passed 482/482;
- canonical coverage and prerequisite summaries converged byte-identically on
  the second regeneration;
- `git diff --check` passed; and
- the full Node 22 `pnpm fitness:kern-5` wall passed.

[VERIFIED] High-risk automatic role-lens review used all six live usable
independent engines at
`/Users/nicolascukas/.agon/runs/review-1785218451822-aw956z`.
The consensus reported zero verified findings. The correctness and security
lenses returned no findings; both overall lenses returned only nits.

[DECIDED] One DRY reviewer proposed moving counterfactual projection cleanup
and archival receipt helpers into shared modules. The blocker claims were
rejected after tracing the actual code: `migrateLegacyFunctionForPrerequisite`
is pure, and candidate completion delegates to the canonical
`migrateFunctionFact` and `canonicalizerFunctionCompletes` owners. A shared
contract refactor would expand this analysis-only milestone and is not
required for correctness.

## Implementation Plan

1. Add a RED test importing the absent M4.110 analysis owner.
2. Implement exact per-function projection requirement measurement against the
   immutable M4.109 population.
3. Freeze canonical receipt bytes, source commit, input digest, requirements,
   candidate ranking, and exact selected witnesses.
4. Add mutation, lower-bound, historical-preservation, fresh-process, central
   integration, and terminal-status guards.
5. Regenerate deterministic summaries twice, run targeted and full Node 22
   KERN 5 gates, then mandatory high-risk role-lens review.
6. Create one signed commit, fetch/rebase, push once to main, and verify the
   remote hash.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.109 commit `e77fc456`.
- [x] Current projection failures and generous-limit outcomes are measured.
- [x] RED fails at the absent M4.110 module boundary.
- [x] All 15 M4.109 assignments are consumed exactly once.
- [x] Exact per-function projection requirements are authenticated.
- [x] Candidate settings derive only from measured minima.
- [x] Selected candidate is exact depth 76 with nine functions, four tools,
      and 134 parameter rows.
- [x] No KIR/runtime/profile policy, KERN source, ABI, generated tool, or
      cumulative coverage state changes.
- [x] Historical receipts remain exact and derived summaries converge.
- [x] Targeted, complete canonicalizer, and full KERN 5 fitness gates pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and the remote hash
      verifies identically.

## Stop Conditions

- M4.109 input digest, assignment population, or reason digest differs.
- A minimum does not fail at value minus one with the expected code.
- Candidate selection requires an invented limit or preferred tool.
- The selected candidate is not exact depth 76 / nine functions / four tools /
  134 rows.
- Implementation requires an in-scope policy or product change.

## Out of Scope

- Promoting KIR depth 76 or changing any runtime envelope.
- Migrating the nine selected parameter signatures.
- Raising profile rows for `checkModule` or `validate`.
- Adding `new` expressions or changing `quotesource` text constraints.
- KIR v1 freeze, runtime cutover, RC/stable release, Fable work, or a KERN 5
  completion claim.
