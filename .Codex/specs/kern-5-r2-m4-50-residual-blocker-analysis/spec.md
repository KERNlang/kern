# KERN 5 R2 M4.50 Current Residual Blocker Analysis

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-20
**Confidence:** 0.95

## Executive Summary

[VERIFIED] Published M4.49 commit
`87e10471cb2c485d4881b7b65ed459d418292233` consumed the complete M4.48
parameter queue. The current canonicalizer boundary is 64/104 base-complete
functions, 39 legacy-parameter residual functions, an empty parameter queue,
and bounded exhaustion under the unchanged 19/30/388 profile.

[DECIDED] M4.50 is analysis-only. It will publish one authenticated current
residual analysis without changing KERN source, generated consumers, policy,
active families, parser, runtime, KIR, ABI, package versions, or public APIs.
KERN 5 remains incomplete after this slice.

## Published Input

[VERIFIED] The fresh branch starts at exact `origin/main` commit
`87e10471cb2c485d4881b7b65ed459d418292233`.

[VERIFIED] The exact M4.49 boundary is:

- base profile `kern.kir-canonicalizer.profile.m4.36`;
- limits 19 node rows, 30 property rows, and 388 value rows;
- 104 functions across nine handwritten members and four tools;
- 64 base-complete functions and 39 legacy-parameter residual functions;
- zero parameter-ready functions, tools, rows, and witnesses;
- active exception-flow and while-iteration families;
- three evaluated non-empty family closures and zero completing closures;
- residual reason-assignment digest
  `d3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc`;
- coverage-summary SHA-256
  `998955248fe4a5e8a1d35108bdd0cd23e7132e1ede3693bc2f40838d6290596b`;
- prerequisite-summary SHA-256
  `9ffd897ad4e631ea7cb4395fffbdae87a36637d3f5d011eaa377c01f3f2fa403`;
- implementation, policy, and function-fact digests
  `063caa43723772d3ad44b1662b2c345e24f9e46ab914cfdadd71872836de81d8`,
  `3f72981ab56a3b7c6d27b675384349cd93b1a36b5d554dfcead57648794ad00e`,
  and `8b2c88aac92ede8551155c55b870bc2245db042e7cc246946ee60eaa1285c35e`.

## Root Problem

[VERIFIED] M4.46 selected the four-function 19-node-row cohort. M4.47 proved
its runtime headroom, M4.48 promoted the profile, and M4.49 migrated every
selected function. M4.46 is therefore consumed historical evidence and cannot
authorize another widening.

[VERIFIED] The live prerequisite receipt intentionally stops at residual
blocker analysis. Its overlapping blocker counts cannot identify which exact
observed limit setting completes current residual functions.

[DECIDED] M4.50 recomputes exact function-to-reason assignments and bounded
observed-limit counterfactuals from the authenticated M4.49 population before
any profile or migration slice is authorized.

## Analysis Contract

| Behavior | Contract | Tag |
|---|---|---|
| Format | reuse `kern.kir-canonicalizer.residual-analysis.3`; schema unchanged | DECIDED |
| Scope | exact 39 current residual functions | VERIFIED |
| History | preserve every published residual receipt byte-identically | DECIDED |
| Assignment | bind id, tool, parameter rows, profile rows, sorted reasons | DECIDED |
| Assignment digest | reproduce live M4.49 exhaustion digest exactly | DECIDED |
| Candidate limits | derive only from observed residual rows and current policy | DECIDED |
| Completion | reuse canonical completion semantics with no added family | DECIDED |
| Ranking | fewer axes, more tools, smaller delta, more functions, canonical signature | DECIDED |
| Selection | first ranked completing candidate or explicit null | DECIDED |
| Authority | recommendation only; no promotion or migration | DECIDED |

## Candidate Construction

[DECIDED] Counterfactually migrate only the 39 authenticated legacy
`fn.params` facts, then require the live parameter-ready partition to remain
empty. For each residual function with measured profile rows, raise each
current limit only as far as that function requires. Deduplicate settings,
discard the unchanged setting, evaluate all current residual functions, and
retain exact witnesses for settings completing at least one function.

[DECIDED] Sort candidates by changed-axis count ascending, complete tools
descending, total delta ascending, complete functions descending, then the
canonical nodes/properties/values signature. No favored axis, preferred tool,
future ceiling, or release threshold may be hardcoded.

## Implementation Plan

1. Add the M4.50 tests first and capture RED at the missing analyzer/receipt.
2. Reuse the proven M4.46 algorithm with exact M4.49 population guards.
3. Generate canonical receipt bytes only after the analyzer is final.
4. Add mutation, decorated-data, history, writer, fresh-process, status, and
   terminal-gate checks.
5. Regenerate authenticated live summaries if the implementation closure
   changes, then run focused and complete Node 22 fitness gates.
6. Run high-risk role-lens Agon review, resolve verified findings, create one
   signed commit, fetch/rebase, and push once with `--no-verify`.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.49 commit `87e10471`.
- [x] RED fails at the intended missing M4.50 analyzer/receipt boundary.
- [x] Every current residual function has one canonical assignment.
- [x] Assignment digest reproduces the live M4.49 exhaustion receipt.
- [x] Candidate settings derive only from current policy and observed rows.
- [x] Selection is measured, deterministic, and not manually chosen.
- [x] Historical receipts remain byte-identical.
- [x] No KERN source, generated consumer, profile, family, parser, KIR,
      runtime, ABI, package, or public surface changes.
- [x] Focused gates and complete Node 22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- Residual count is not 39 or the parameter-ready partition is non-empty.
- Assignment digest differs from the published M4.49 exhaustion digest.
- Candidate construction needs a number not supplied by current policy or
  authenticated observed facts.
- Historical evidence or an out-of-scope product surface changes.

## Measured Result

[VERIFIED] RED was captured before implementation: the focused test failed at
the intentionally missing `coverage-residual-analysis-m4-50.mjs` boundary.

[VERIFIED] The authenticated M4.50 analysis covers all 39 residual functions.
Twenty-three have profile rows, producing 23 distinct observed settings and 23
positive candidates. The assignment digest reproduces the M4.49 boundary at
`d3175ab22aaf82a3e37a5c439b4e603d3922e53224b649176c9940d9e04431dc`.

[VERIFIED] The first canonical action changes one axis: raise only
`maxPropertyRows` from 30 to 31. Its total delta is one and it completes one
function in one tool: `examples/selfhost-validator/validator.kern#17:`
`classcyclefrom`, with six parameter rows and measured profile rows 19/31/202.
Its only residual reason is `profile.rows.properties`. This is a recommendation
only; M4.50 does not change the active 19/30/388 profile.

[VERIFIED] Canonical SHA-256 evidence is:

- M4.50 receipt:
  `14fdff4dce865a79215eabdb02b05a29c62a66c633561e9643e2a46f38020e4f`;
- M4.50 analyzer:
  `8a8c5f061b87ad6881d51a9d9abe00c7d1a4f639c259b409b4f899d730c85678`;
- live coverage and prerequisite receipts:
  `5240c7896ab3992a91b918e8c2d4cb36316cd49500a631a7c50fbb605ee04954`
  and `4509179584d95da5b51c9540678ed60e9e6c361cdb9ec09fa9ddf718aaeb4b5e`;
- implementation, policy, function-fact, and corpus digests:
  `dcaf4485e454b2aa366bb80d529fea9cb0bc8e79bc11a4d2cb336372c60b5d34`,
  `3f72981ab56a3b7c6d27b675384349cd93b1a36b5d554dfcead57648794ad00e`,
  `8b2c88aac92ede8551155c55b870bc2245db042e7cc246946ee60eaa1285c35e`,
  and `a918c5e489e4fa8046ad790a4502844b5b9fb0ed703d8c728e6ea4434d392092`.

[VERIFIED] The focused M4.50/status suite passes 9/9. The complete standalone
canonicalizer wall passes 161/161 tests plus 51 golden/idempotence/KIR, eight
measured-witness, three profile-limit, and 226 hostile fixtures. The complete
Node 22 `fitness:kern-5` wall passes, including all workspace, infrastructure,
conformance, native, runner, browser-budget, runtime/KIR/ownership/convergence,
and repeated canonicalizer gates.

## Independent Review Evidence

[VERIFIED] Required high-risk role-lens Agon review
`review-1784753205306-w4aaia-kern-5-r2-m4-50` completed all 6/6 usable
independent seats. Consensus reported zero verified findings and zero blockers.

[VERIFIED] The sole needs-check candidate requested a shared receipt validator
and frontier implementation. Current source and published history disprove it
as a safe slice-local refactor: M4.50 intentionally reproduces the exact M4.46
measurement algorithm, while M4.38, M4.42, M4.43, M4.46, and M4.47 each retain
milestone-local plain-data validation after becoming immutable loaders.
Centralizing those contracts would couple historical evidence to future code
and change authenticated implementation closure outside this analysis slice.
The candidate-signature ordering nit is also the frozen canonical textual
tie-break after numeric axis, tool, delta, and function ranks; it does not
alter the selected M4.50 action. No review-driven source change is warranted.

## Resolved Question

[VERIFIED] The deterministic result is the exact 19/31/388 single-axis,
single-function frontier above. M4.51 must authenticate runtime/property-row
headroom for that exact witness before any profile promotion is considered.
