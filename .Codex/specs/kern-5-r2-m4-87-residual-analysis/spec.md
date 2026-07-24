# KERN 5 R2 M4.87 — 21-Function Residual Analysis

**Status:** READY TO SHIP — REVIEW BLOCKER RESOLVED
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.86 commit
`46337a6549390087ef095c18d0e178cf9ef28392` consumed the exact M4.85
`argProvenanced` parameter queue. The live canonicalizer frontier is 84/105
base-complete functions, 21 legacy `fn.params` blockers, an empty parameter
queue, and bounded exhaustion over 21 residual functions.

[DECIDED] M4.87 publishes an immutable residual-analysis receipt from that
exact frontier. It does not change source programs, profile limits, runtime
limits, KIR limits, or base coverage. M4.88 will separately authenticate
structural runtime headroom before any policy promotion is considered. KERN 5
remains incomplete after this slice.

## Published Input

[VERIFIED] Branch `feat/kern-5-r2-m4-87-residual-analysis` starts clean from
`origin/main` at exact commit
`46337a6549390087ef095c18d0e178cf9ef28392`.

[VERIFIED] Direct measurement binds this baseline:

- base profile `kern.kir-canonicalizer.profile.m4.60`;
- active limits 38 node rows, 61 property rows, and 580 value rows;
- 84/105 base-complete functions and 21 legacy parameter blockers;
- empty parameter migration queue and 21 residual functions;
- coverage implementation digest
  `35059b731c4761f49f1d8102db06cfe3b56b83ce76ff606232cb15f4e4f361e5`;
- coverage policy digest
  `4ac57e59be2bcdb7b9aa0f7f35598703600bf47b4f17709e59c5823c0e605490`;
- function facts digest
  `f6d4abfacc8e9fb592cca4e8aef28b59f6b5af963c07514f00dd760ca798624a`;
  and
- residual reason-assignment digest
  `0e6700b777a3cf2f5ed462636ba292ef69df90de141e3466b8831d8f190b7328`.

## Measured Frontier

[VERIFIED] Five residual functions expose complete structural profile rows,
producing five observed actionable settings. The deterministic candidate
ordering selects:

- changed limits: `maxNodeRows`, `maxPropertyRows`;
- candidate limits: 74 node rows, 77 property rows, 580 value rows;
- total delta: 52 rows;
- completed functions: 3 across 2 tools; and
- witnesses, in exact canonical order:
  - `examples/capstone-checker-subset/checker.kern#18:indexRejectDetail`;
  - `examples/capstone-checker-subset/checker.kern#23:callRejectCode`;
  - `examples/selfhost-validator/validator.kern#2:isreserved`.

[DECIDED] Candidate ranking remains the established deterministic contract:
fewest changed axes, most tools, smallest total delta, most functions, then
canonical serialized limit order. M4.87 must publish all five actionable
candidates and select only the first under that ordering.

## Implementation Plan

1. Add an M4.87 test importing an absent analysis module and capture RED at the
   missing-module boundary.
2. Add the format-3 M4.87 analyzer and canonical JSON writer, bound to the
   exact M4.86 input commit, baseline digests, residual assignments, observed
   settings, and deterministic candidate order.
3. Publish the canonical receipt, pin its SHA-256, add mutation/decorated-data
   rejection and fresh-process determinism tests, and integrate historical
   status/central coverage checks without changing live policy.
4. Run focused tests, writer/no-write reproducibility, the complete
   canonicalizer wall, and full Node 22 `fitness:kern-5`.
5. Run automatic high-risk role-lens review, resolve verified findings, create
   one Agon-signed commit, fetch/rebase `origin/main`, and atomically push the
   feature branch plus `main` once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.86 commit `46337a65`.
- [x] RED fails at the intended absent M4.87 module boundary.
- [x] Receipt binds the exact 84/105, 21-blocker, empty-queue M4.86 frontier.
- [x] All 21 residual assignments and the exact reason digest reproduce.
- [x] Five observed settings produce five actionable candidates.
- [x] Selected action is exactly the 74/77/580 three-function, two-tool
      dual-row candidate with total delta 52.
- [x] Canonical receipt bytes, digest, input commit, and fresh-process loading
      are immutable and fail closed on drift.
- [x] Active profile/runtime/KIR policy and base coverage remain unchanged.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Local Verification Evidence

[VERIFIED] Focused M4.87 and status tests pass 35/35. The complete
canonicalizer wall passes 342/342 Node tests, 55 golden/idempotence/KIR
fixtures, 8 measured witnesses, 3 profile-limit fixtures, and 235 hostile
fixtures.

[VERIFIED] Canonical coverage writer and no-write checks reproduce at 84/105,
21 `fn.params` blockers, an empty parameter queue, bounded 21-function
exhaustion, and the exact published M4.87 next action.

[VERIFIED] Full Node 22 `pnpm fitness:kern-5` exits zero with terminal verdict
`KERN 5 current fitness wall passed.`

## Independent Review Resolution

[VERIFIED] High-risk role review routed all six usable engines. Two reviewers
identified one genuine generator defect: M4.87 compared the live
`coverageImplementationDigest` with the pre-publication M4.86 digest even
though that digest includes the newly added analyzer itself. The comparison
was removed to match the established M4.83 publication contract. Exact base,
policy, profile, function-fact, queue, residual, and reason-assignment facts
remain authenticated, while direct `--write` regeneration now succeeds and
preserves the published bytes.

[REJECTED] One DRY finding proposed sharing the near-identical M4.83 and M4.87
analyzers. These milestone modules intentionally freeze their own validation,
input commit, digest, and measurement logic; coupling immutable historical
receipts to a shared mutable analyzer would enlarge this slice and let later
changes rewrite the code path that authenticates old evidence.

## Stop Conditions

- Live M4.86 facts differ from the exact baseline above.
- The empty queue or 21-function bounded exhaustion no longer reproduces.
- Candidate ranking selects a different action than 74/77/580 with the three
  exact witnesses.
- Publishing the analysis would require moving policy limits or changing
  source/runtime behavior.

## Out of Scope

- Authenticating runtime headroom for the selected witnesses (M4.88).
- Promoting node/property ceilings or consuming a parameter queue.
- Depth/node projection limits, unknown expressions, exception-flow, KIR
  freeze, runtime cutover, public reader export, release versioning, or Fable.
