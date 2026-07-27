# KERN 5 R2 M4.109 — Residual Frontier Analysis

**Status:** VERIFIED — PUBLISH PENDING
**Date:** 2026-07-27
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.108 commit
`88e311ac5565ed424f71bb2f9ed7a18333a5e8e4` consumes the exact M4.107
one-function/14-row `validstatement` parameter queue. The current frontier is
92/111 base-complete functions, 15 legacy `fn.params` blockers, no
parameter-ready queue, and bounded active-family exhaustion under the
unchanged 89/125/2100 profile.

[DECIDED] M4.109 publishes an immutable residual-analysis receipt from those
exact M4.108 facts. It changes no KERN source, generated tool, coverage policy,
profile limit, runtime/KIR limit, runtime ABI, or cumulative base coverage.

[VERIFIED] Read-only measurement finds no structurally actionable profile
widening: none of the 15 residual functions has complete profile rows, so
there are zero observed settings, zero actionable candidates, and a null
selected action.

[DECIDED] M4.110 must investigate the authenticated projection blockers before
any KIR-limit, profile, source, or family change is authorized.

[DECIDED] M4.109 is not KERN 5 completion.

## Published Input

[VERIFIED] This fresh branch starts at exact `origin/main`
`88e311ac5565ed424f71bb2f9ed7a18333a5e8e4`.

[VERIFIED] The M4.108 baseline is:

- 92/111 base-complete functions;
- 15 legacy parameter blockers and 15 residual functions;
- zero parameter-ready functions and zero parameter rows;
- profile limits 89 node rows, 125 property rows, and 2,100 value rows;
- coverage implementation digest
  `f06254bfd88d53c1887c014689e5a7de451fb5540e04c8dc1c30b27380e42143`;
- coverage policy digest
  `0285747660651cab2ee1029456dc40c190c42d2515937fa6d3534247df363b54`;
- function facts digest
  `d5fa84e9d8cca79d2352ae106a533dd489291b670ab27ad4adc7e70010a2e214`;
- residual reason-assignment digest
  `f200b876c0ed6dd9cd75cfebe1c46c3d6cf97b13e0422886bc13b0f02f46b203`;
- coverage-summary SHA-256
  `e5acb2f5a55be91ff6094eafd8549ffac7bda0699f7d613fcfbf119b3a854d84`;
  and
- prerequisite-summary SHA-256
  `f4c3ae936f7071e67e63044336429a364ef9f7e9c6b96e6432a7b9b3fc864dc9`.

## Analysis Contract

[DECIDED] M4.109 reuses residual-analysis format
`kern.kir-canonicalizer.residual-analysis.3` and its established deterministic
candidate ranking without adding a new policy axis or preferred blocker.

[VERIFIED] Exact read-only measurement produces:

- 15 canonical residual assignments;
- assignment digest
  `f200b876c0ed6dd9cd75cfebe1c46c3d6cf97b13e0422886bc13b0f02f46b203`;
- zero functions with complete profile rows;
- zero distinct observed profile settings;
- zero actionable profile-widening candidates; and
- `selectedNextAction: null`.

[VERIFIED] The authenticated residual reasons include projection depth for 12
functions, projection nodes for one function, projection unknown-expression
kind for two functions, and narrower source-expression/text constraints.
Counts overlap because one function may retain several reasons.

[DECIDED] The terminal status must state that M4.109 found no actionable
profile widening and that M4.110 investigates the projection blockers. It must
not imply that any projection/KIR limit or expression family is approved.

## Implementation Plan

1. Add a RED test importing the absent M4.109 analysis boundary.
2. Add a closed M4.109 measurement/validation/loader module bound to the exact
   M4.108 baseline and all 15 residual reason assignments.
3. Write the canonical immutable JSON receipt through the repository writer.
4. Add mutation, historical-preservation, changed-frontier regeneration,
   fresh-process, central integration, and terminal-status guards.
5. Regenerate current derived summaries twice for convergence.
6. Run focused and complete canonicalizer gates, full Node 22 KERN 5 fitness,
   mandatory high-risk role-lens review, then signed fetch/rebase-first atomic
   publish.

## Acceptance Criteria

- [x] Fresh branch starts at exact published M4.108 commit `88e311ac`.
- [x] Exact M4.108 baseline and residual population are grounded.
- [x] RED fails at the absent M4.109 module boundary.
- [x] All 15 residual assignments and the exact reason digest authenticate.
- [x] Receipt proves zero profile-row facts, settings, and candidates.
- [x] Selected next action is exactly null.
- [x] Status hands off to M4.110 projection-blocker investigation.
- [x] M4.109 changes no KERN source, generated tool, policy, runtime/KIR or
      profile limit, ABI, or cumulative base-coverage state.
- [x] Historical immutable evidence remains exact.
- [x] Derived current summaries converge.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved verified blocker.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push and
      the remote hash verifies identically.

## Stop Conditions

- Live M4.108 facts differ from the published baseline or reason digest.
- Any residual assignment lacks an authenticated blocker.
- Any observed profile setting or actionable candidate appears.
- The slice requires changing KERN source, coverage policy, profile,
  runtime/KIR limits, runtime ABI, generated artifacts, or historical receipt
  bytes.
- Status or receipt wording authorizes a projection or expression change.

## Out of Scope

- Choosing or changing projection depth/node limits.
- Adding unknown-expression, text-character, or exception-flow support.
- Migrating any of the 15 remaining legacy parameter signatures.
- Runtime cutover, KIR v1 freeze, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.

## Implementation Evidence

[VERIFIED] The RED oracle failed at the absent
`coverage-residual-analysis-m4-109.mjs` boundary before implementation.

[VERIFIED] The immutable M4.109 receipt SHA-256 is
`ad6240c77ed276d1f865beb702ceeb7c85767191dbaa3cf36f526505c4e555fb`.
It authenticates all 15 residual assignments and exact reason digest
`f200b876c0ed6dd9cd75cfebe1c46c3d6cf97b13e0422886bc13b0f02f46b203`.

[VERIFIED] The receipt proves zero functions with profile rows, zero evaluated
observed settings, zero actionable profile candidates, and an exact null
selection. The current 89/125/2100 profile is unchanged.

[VERIFIED] Derived summaries converged byte-identically at:

- coverage implementation digest
  `b00cde7baa83e2c7077120f1261409afb182daedc84e3d59554df693f075130d`;
- coverage-summary SHA-256
  `0f3896208c6050f10973498edba84c9a102668602ac0f97b91609f08152e3265`;
  and
- prerequisite-summary SHA-256
  `f9bd3ff0daf1bd1309264ba0540afca26c0b3060514c97003157ad5f872c33d5`.

[VERIFIED] The focused integration matrix passed 89/89. The complete
canonicalizer gate passed 477/477 Node tests plus 55
golden/idempotence/KIR fixtures, eight measured witnesses, three profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passed with the
terminal `KERN 5 current fitness wall passed` oracle.

[VERIFIED] Automatic high-risk role-lens review
`review-1785179863048-gad5w1` completed 6/6 usable reviewers with zero verified
findings, five needs-check duplication concerns, and three nits. Immutable
milestone-owner duplication remains intentionally isolated rather than
refactoring historical trust boundaries in this analysis-only slice. The
baseline fields omitted from the live semantic comparison are independently
bound: the historical implementation digest necessarily predates this
analyzer, while legacy and residual counts are checked explicitly. The valid
stale-spec nit was fixed. No unresolved material finding remains.
