# KERN 5 R2 M4.62 Current Residual Blocker Analysis

**Status:** IMPLEMENTED — VERIFIED AND REVIEWED; PUBLISH PENDING
**Date:** 2026-07-23
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.61 commit
`f36a870843ccdd222e8cf2e7595c0e205ed545bf` consumed the final authenticated
parameter-ready row. The current canonicalizer boundary is 73/104
base-complete functions, 30 legacy-parameter residual functions, an empty
parameter queue, and bounded exhaustion under the unchanged 25/50/388 profile.

[DECIDED] M4.62 is analysis-only. It publishes one authenticated current
residual analysis without changing KERN source, generated consumers, coverage
policy, active families, parser, runtime, KIR, ABI, packages, or public APIs.
It cannot authorize a profile promotion or a KERN 5 completion claim.

## Published Input

[VERIFIED] This branch starts at exact `origin/main` commit
`f36a870843ccdd222e8cf2e7595c0e205ed545bf`.

[VERIFIED] The exact M4.61 boundary is:

- base profile `kern.kir-canonicalizer.profile.m4.60`;
- limits 25 node rows, 50 property rows, and 388 value rows;
- 104 functions across nine handwritten members and four tools;
- 73 base-complete functions and 30 legacy-parameter residual functions;
- zero parameter-ready functions, tools, rows, and witnesses;
- sole active family `exception-flow`, with one evaluated non-empty closure
  and zero completing closures;
- residual reason-assignment digest
  `6a2d680c3dfe3fdbddf24f5b6cd383e03d5c2b7ed1fdf5667ec6ea94551c40e5`;
- coverage-summary SHA-256
  `07b9e09c860e803f493599eb809870916df470dfa66c488570d3129431c4a23e`;
- prerequisite-summary SHA-256
  `135759db56ce009c72adedfc4caa0018e78709361388ad1b91ff33bf8c034dfd`;
- implementation, policy, function-fact, and corpus digests
  `613810d0b74e31f21cd756520dbfe94047ba06ee654ef349a86663a32b517d83`,
  `00517a1a5e8958ed4158310a2c5c4815c9a8cf673d98e73f45c41f4edbae408e`,
  `4ef2c486bbff42c35795789ac66e362863a357f5e7d6ca10dd77525576dc761d`,
  and `1ce05b6867a583aef963ee5a8cd087c1865ca88173dc8c4432d3680a382078ae`.

## Root Problem

[VERIFIED] M4.54 selected the prior seven-function two-axis cohort. M4.55
proved runtime headroom, M4.56 promoted the profile, M4.57 migrated that queue,
M4.58-M4.60 added and promoted while iteration, and M4.61 migrated the final
resulting parameter row. Those receipts are consumed historical evidence and
cannot authorize another widening.

[VERIFIED] The live prerequisite receipt intentionally stops at residual
blocker analysis. Its overlapping reason census cannot identify which exact
observed setting completes current residual functions.

[DECIDED] M4.62 recomputes exact function-to-reason assignments and bounded
observed-limit counterfactuals from the authenticated M4.61 population before
any headroom, profile, or migration slice is authorized.

## Analysis Contract

| Behavior | Contract | Tag |
|---|---|---|
| Format | reuse `kern.kir-canonicalizer.residual-analysis.3`; schema unchanged | DECIDED |
| Scope | exact 30 current residual functions | VERIFIED |
| History | preserve every published residual receipt byte-identically | DECIDED |
| Assignment | bind id, tool, parameter rows, profile rows, sorted reasons | DECIDED |
| Assignment digest | reproduce live M4.61 exhaustion digest exactly | DECIDED |
| Candidate limits | derive only from observed residual rows and current policy | DECIDED |
| Completion | reuse canonical base completion semantics with no added family | DECIDED |
| Ranking | fewer axes, more tools, smaller delta, more functions, canonical signature | DECIDED |
| Selection | first ranked completing candidate or explicit null | DECIDED |
| Authority | recommendation only; no promotion, headroom claim, or migration | DECIDED |

## Candidate Construction

[DECIDED] Counterfactually migrate only the 30 authenticated legacy
`fn.params` facts, then require the live parameter-ready partition to remain
empty. For each residual function with measured profile rows, raise each
current limit only as far as that function requires. Deduplicate settings,
discard the unchanged setting, reevaluate all current residual functions with
the canonical base completion contract, and retain exact witnesses for every
setting completing at least one function.

[DECIDED] Sort candidates by changed-axis count ascending, complete tools
descending, total delta ascending, complete functions descending, then the
canonical nodes/properties/values signature. No favored axis, preferred tool,
future ceiling, or release threshold may be hardcoded.

## Read-Only Measured Result

[VERIFIED] All 30 residual functions have one canonical assignment. Fourteen
have profile rows, producing 12 distinct observed settings and 12 positive
candidates. The assignment digest exactly reproduces the M4.61 boundary at
`6a2d680c3dfe3fdbddf24f5b6cd383e03d5c2b7ed1fdf5667ec6ea94551c40e5`.

[VERIFIED] The first deterministic action changes one axis: raise
`maxNodeRows` from 25 to 28 while keeping `maxPropertyRows` at 50 and
`maxValueRows` at 388. Its total delta is three and it completes exactly four
functions across two tools:

1. `examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude`
2. `examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail`
3. `examples/selfhost-validator/validator.kern#10:fnokat`
4. `examples/selfhost-validator/validator.kern#12:ownexportkind`

[DECIDED] This result is a recommendation only. M4.63 must independently prove
exact structural runtime headroom for all four witnesses before the node-row
profile can move.

## Implementation Plan

1. Add M4.62 tests first and capture RED at the missing analyzer/receipt.
2. Reproduce format-3 measurement against the exact M4.61 boundary.
3. Freeze canonical receipt bytes and an immutable input-commit/digest loader.
4. Add mutation, decorated-data, history, fresh-process, status, and terminal
   gate checks while leaving every product and policy surface unchanged.
5. Regenerate live summaries only if the authenticated implementation digest
   requires it, then run focused, canonicalizer, and complete Node 22 gates.
6. Run automatic high-risk role-lens review, resolve verified findings, create
   one signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Implementation Evidence

[VERIFIED] RED failed at the intended missing
`coverage-residual-analysis-m4-62.mjs` module boundary before implementation.

[VERIFIED] The analyzer recomputes exactly 30 assignments, 14 profile-row
facts, 12 distinct observed settings, and 12 positive candidates. It selects
exact 28/50/388 headroom with four functions across two tools and 37 total
parameter rows. Mutation, decorated-data, M4.54-history, fresh-process, status,
prerequisite, and complete residual-history tests pass 41/41.

[VERIFIED] Current immutable artifact hashes are:

- M4.62 receipt SHA-256
  `5339ffa5c128efbe857b53e64a67092d72b8b6b6cbe6cc3ea16c96f4939e79cc`;
- M4.62 analyzer SHA-256
  `c1e06ac0b645ffe38cfbf7af3139819405bbfa3d2b56816ec33ac22d67ebe3b2`;
- live coverage-summary SHA-256
  `ea14f05bc46fbcbba7d56ccfbb748c65de1f3c4080708736a671d42d366bb95c`;
- live prerequisite-summary SHA-256
  `fa75b97922ab4ee9f1eb16cf28f50755a9524b3763ec68d0af866560c959b247`;
- coverage implementation, policy, function-fact, and corpus digests
  `8a228c11633a3397499de8ca2b5b052e000f72a149462612a1cc91ec68a871ea`,
  `00517a1a5e8958ed4158310a2c5c4815c9a8cf673d98e73f45c41f4edbae408e`,
  `4ef2c486bbff42c35795789ac66e362863a357f5e7d6ca10dd77525576dc761d`,
  and `1ce05b6867a583aef963ee5a8cd087c1865ca88173dc8c4432d3680a382078ae`.

[VERIFIED] The complete Node 22 `fitness:kern-5` wall passed. After review,
the full canonicalizer gate passed again at 218/218 tests plus 55
golden/idempotence/KIR fixtures, eight measured witnesses, three profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] Automatic high-risk role-lens review
`review-1784800561443-zzz2m9` completed 6/6. It reported zero verified
findings, six needs-check findings, one speculative finding, and nine nits.
The two current-slice material findings were fixed: the terminal status no
longer names already-completed residual analysis as the next action, and the
tests now execute the live M4.62 analyzer and require exact equality with the
frozen receipt. Four duplication concerns are deliberate immutable milestone
isolation and are deferred rather than widening this analysis-only slice. The
low-confidence entry-point hardening concern assumes untrusted repository
writers outside this local build-evidence trust model. No unresolved material
finding remains.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.61 commit `f36a8708`.
- [x] All current residual facts and the exact candidate ranking are grounded.
- [x] RED fails at the intended missing M4.62 analyzer/receipt boundary.
- [x] Every current residual function has one canonical assignment.
- [x] Assignment digest reproduces the live M4.61 exhaustion receipt.
- [x] Candidate settings derive only from current policy and observed rows.
- [x] Selection is exact 28/50/388 with four functions across two tools.
- [x] Historical receipts remain byte-identical.
- [x] No KERN source, generated consumer, profile, family, parser, KIR,
      runtime, ABI, package, or public surface changes.
- [x] Focused gates and complete Node 22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- Residual count is not 30 or the parameter-ready partition is non-empty.
- Assignment digest differs from the published M4.61 exhaustion digest.
- Candidate construction needs a number not supplied by current policy or
  authenticated observed facts.
- The selected setting is not exact 28/50/388 with the four measured witnesses
  across checker and validator.
- Historical evidence or an out-of-scope product surface changes.

## Out of Scope

- Runtime-headroom proof for 28 node rows.
- Promoting the node-row limit, migrating the selected parameter rows, or
  adding exception-flow support.
- Version bump, release candidate, stable release, Fable work, or a KERN 5
  completion claim.
