# KERN 5 R2 M4.101 — Residual Frontier Analysis

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-27
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published M4.100 commit
`f95952200aec3a13ff71d42f63b7a7ed47010e48` consumes the exact M4.99
one-function/24-row `comparisonOperandsOk` parameter queue. The current
frontier is 90/109 base-complete functions, 16 legacy `fn.params` blockers, no
parameter-ready queue, and bounded active-family exhaustion under the unchanged
74/95/832 profile.

[DECIDED] M4.101 publishes an immutable residual-analysis receipt from those
exact M4.100 facts. It changes no KERN source, generated tool, coverage policy,
runtime/KIR limit, runtime ABI, or cumulative base coverage.

[DECIDED] A structurally actionable profile candidate is not a runtime-headroom
claim. M4.102 must authenticate the selected witness at production and
promotion budgets before any profile promotion.

[DECIDED] M4.101 is not KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main`
`f95952200aec3a13ff71d42f63b7a7ed47010e48`.

[VERIFIED] The M4.100 baseline is:

- 90/109 base-complete functions;
- 16 legacy parameter blockers and 16 residual functions;
- zero parameter-ready functions and zero parameter rows;
- profile limits 74 node rows, 95 property rows, and 832 value rows;
- coverage implementation digest
  `7809416075a702b6165ca035aa991a1aa1b6b5bfdde31d43ab93ded799f3c552`;
- coverage policy digest
  `e5fdb18d2de95a15429e51364fb817b3f99342d272105db6c53091e3baf00b8c`;
- function facts digest
  `f6d17da9c73aa2321ec4cda779cb13d59221e2b8ebc335d914b4c5a013242b2f`;
- residual reason-assignment digest
  `f502a363d83d85b78d0cdc4287aefcd348de042ed94be5f9d14657cf5a6f9913`;
  and
- coverage/prerequisite receipt SHA-256 identities
  `d09c4653140dddfc6050ef2bbb4aff462da58940181a9873b532126ab0ca9eb1`
  and
  `ccc3a0004b31a2a7dc8c5202b03f44729e182de7ecb15095cd52190870d9f88f`.

## Analysis Contract

[DECIDED] M4.101 reuses residual-analysis format
`kern.kir-canonicalizer.residual-analysis.3` and the established deterministic
ranking:

1. fewer changed profile axes;
2. more completed tools;
3. lower total row-limit delta;
4. more completed functions; and
5. canonical lexical limit order.

[VERIFIED] After M4.100, exactly one residual function has complete structural
profile rows:

`examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement`

with 14 parameter rows and profile rows 89/125/2100.

[EXPECTED] Observed-setting evaluation produces exactly one actionable
candidate. It changes all three profile axes from 74/95/832 to 89/125/2100,
has total delta 1,313, completes one canonicalizer function, and selects only
`validstatement`.

[DECIDED] The receipt and status text must state that M4.102 authenticates
structural runtime headroom. They must not imply promotion approval.

## Implementation Plan

1. Add a RED test importing the absent M4.101 analysis boundary.
2. Add a closed M4.101 measurement/validation/loader module bound to the exact
   M4.100 baseline and all 16 residual reason assignments.
3. Write the canonical immutable JSON receipt through the repository writer.
4. Add mutation, historical-preservation, changed-frontier regeneration,
   fresh-process, central integration, and status guards.
5. Regenerate current derived summaries twice for convergence.
6. Run focused and complete canonicalizer gates, full Node 22 KERN 5 fitness,
   mandatory high-risk role-lens review, then signed fetch/rebase-first atomic
   publish.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.100 commit `f9595220`.
- [x] Exact M4.100 baseline and residual population are grounded.
- [x] RED fails at the absent M4.101 module boundary.
- [x] All 16 residual assignments and the exact reason digest authenticate.
- [x] Only observed structural row settings are evaluated.
- [x] Selected structural candidate is exact and does not claim runtime
      headroom.
- [x] M4.101 changes no KERN source, generated tool, policy, runtime/KIR limit,
      ABI, or cumulative base-coverage state.
- [x] M4.95/M4.99/M4.100 immutable evidence remains exact.
- [x] Derived current summaries converge.
- [x] Focused canonicalizer gates pass.
- [x] Complete canonicalizer gate passes.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved verified blocker.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Stop Conditions

- Live M4.100 facts differ from the published baseline or reason digest.
- Any residual assignment lacks an authenticated blocker.
- Candidate ranking differs from the measured observed-setting result.
- The slice requires changing KERN source, coverage policy, runtime/KIR limits,
  runtime ABI, generated artifacts, or historical receipt bytes.
- Status or receipt wording implies runtime headroom or profile promotion.

## Out of Scope

- Proving runtime headroom for 89/125/2100.
- Promoting node/property/value rows or migrating `validstatement`.
- Implementing projection-depth/node, unknown-expression, text-character, or
  exception-flow support.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Implementation Evidence

[VERIFIED] The RED oracle failed at the absent M4.101 module boundary before
implementation.

[VERIFIED] The immutable M4.101 receipt SHA-256 is
`9b389d0b2536cf2cd11d49bc47f1f234c46924c14c2ef160faf633069a3c94f0`.
It authenticates all 16 residual assignments and exact reason digest
`f502a363d83d85b78d0cdc4287aefcd348de042ed94be5f9d14657cf5a6f9913`.

[VERIFIED] Exactly one observed setting is evaluated. The selected structural
candidate changes all three axes to 89/125/2100, has total delta 1,313, and
completes only the 14-parameter `validstatement` canonicalizer function.

[VERIFIED] Status output hands the candidate to M4.102 for structural runtime
headroom authentication and makes no promotion claim.

[VERIFIED] Current coverage remains 90/109 with 16 `fn.params` blockers under
the unchanged 74/95/832 profile. The policy, corpus, function facts, KIR/runtime
limits, ABI, KERN source, and generated tools remain unchanged.

[VERIFIED] Derived summaries converged at:

- coverage implementation digest
  `c4ab1c1fd482feb3f93ec73bfaa9367d212aaf9960057842821e5854fb309e2d`;
- coverage summary SHA-256
  `be6b6ee977befdfbc9f36b2cdcf23892c20d390bca9fcd0014a665245784b72f`;
  and
- prerequisite summary SHA-256
  `970d8f9eed9deb6dc021ecabb16758cf64eb41b9cfa0fb794a248513a67f3dec`.

[VERIFIED] The focused M4.101/current/history/status/coverage matrix passes
91/91 tests, and the central coverage checker passes with the exact M4.101
handoff in its release status.

[VERIFIED] The complete canonicalizer gate passes 425/425 Node tests plus 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes, including
repo consistency, lint, production build, all workspace and infrastructure
tests, conformance/showcase/browser-budget lanes, KIR gates, and the final
`KERN 5 current fitness wall passed` oracle.

[VERIFIED] High-risk role-lens Agon review
`review-1785142693918-mfvjn9` completed 6/6 usable reviewers with zero verified
findings, one needs-check, and eight nits. The needs-check correctly observed
that the closed M4.101 milestone owner closely follows M4.95; it is not a
release blocker because these milestone modules and receipts are immutable
historical trust boundaries, and extracting shared mutable behavior would
widen that boundary and change the measured implementation digest.
