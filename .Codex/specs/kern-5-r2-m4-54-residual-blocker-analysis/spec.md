# KERN 5 R2 M4.54 Current Residual Blocker Analysis

**Status:** READY TO SHIP — FULL FITNESS AND INDEPENDENT REVIEW PASS
**Date:** 2026-07-23
**Confidence:** 0.96

## Executive Summary

[VERIFIED] Published M4.53 commit
`87431a527dfb8d0f3a707b74ce33907392670a51` consumed the complete M4.52
parameter queue. The current canonicalizer boundary is 65/104 base-complete
functions, 38 legacy-parameter residual functions, an empty parameter queue,
and bounded exhaustion under the unchanged 19/31/388 profile.

[DECIDED] M4.54 is analysis-only. It publishes one authenticated current
residual analysis without changing KERN source, generated consumers, policy,
active families, parser, runtime, KIR, ABI, package versions, or public APIs.
KERN 5 remains incomplete after this slice.

## Published Input

[VERIFIED] The fresh branch starts at exact `origin/main` commit
`87431a527dfb8d0f3a707b74ce33907392670a51`.

[VERIFIED] The exact M4.53 boundary is:

- base profile `kern.kir-canonicalizer.profile.m4.36`;
- limits 19 node rows, 31 property rows, and 388 value rows;
- 104 functions across nine handwritten members and four tools;
- 65 base-complete functions and 38 legacy-parameter residual functions;
- zero parameter-ready functions, tools, rows, and witnesses;
- active exception-flow and while-iteration families;
- three evaluated non-empty family closures and zero completing closures;
- residual reason-assignment digest
  `158ee2e9ee592986fa70f10e7345a243db0b082f7949497275e2dce2141ae6c8`;
- coverage-summary SHA-256
  `ae82ad725240338fb5cb37e3847e8b06e8a1940f771a7e2d75a4f0a6c10f779c`;
- prerequisite-summary SHA-256
  `c53e760123fc4f48c37a905d76d291f8bb4eacb12dbb792461fdd84358062416`;
- implementation, policy, function-fact, and corpus digests
  `6bb9375f22dd1bee7dd371c43f725d68a79dc2e83e94b2cecc3c1c3c5c15dd93`,
  `213ce7266b0d8e449c4333483fe8862ae7d3fc69f2aaa7b869595dcbd5111d5c`,
  `7f42974aba8157c6f20fae3cf0c7632317e36e2e7c0d6e5869c32aa31970dc78`,
  and `da83239e2f10cf3a14350fc935c43ca44fcaf461e6513e14cc25ff984ec3c9de`.

## Root Problem

[VERIFIED] M4.50 selected the one-function 31-property-row cohort. M4.51
proved its runtime headroom, M4.52 promoted the profile, and M4.53 migrated the
selected function. M4.50 is consumed historical evidence and cannot authorize
another widening.

[VERIFIED] The live prerequisite receipt intentionally stops at residual
blocker analysis. Overlapping blocker counts cannot identify which exact
observed setting completes current residual functions.

[DECIDED] M4.54 recomputes exact function-to-reason assignments and bounded
observed-limit counterfactuals from the authenticated M4.53 population before
any profile, headroom, or migration slice is authorized.

## Analysis Contract

| Behavior | Contract | Tag |
|---|---|---|
| Format | reuse `kern.kir-canonicalizer.residual-analysis.3`; schema unchanged | DECIDED |
| Scope | exact 38 current residual functions | VERIFIED |
| History | preserve every published residual receipt byte-identically | DECIDED |
| Assignment | bind id, tool, parameter rows, profile rows, sorted reasons | DECIDED |
| Assignment digest | reproduce live M4.53 exhaustion digest exactly | DECIDED |
| Candidate limits | derive only from observed residual rows and current policy | DECIDED |
| Completion | reuse canonical completion semantics with no added family | DECIDED |
| Ranking | fewer axes, more tools, smaller delta, more functions, canonical signature | DECIDED |
| Selection | first ranked completing candidate or explicit null | DECIDED |
| Authority | recommendation only; no promotion, headroom claim, or migration | DECIDED |

## Candidate Construction

[DECIDED] Counterfactually migrate only the 38 authenticated legacy
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

[VERIFIED] All 38 residual functions have one canonical assignment. Twenty-two
have profile rows, producing 22 distinct observed settings and 22 positive
candidates. The assignment digest exactly reproduces the M4.53 boundary at
`158ee2e9ee592986fa70f10e7345a243db0b082f7949497275e2dce2141ae6c8`.

[VERIFIED] The first deterministic action changes two axes: raise
`maxNodeRows` from 19 to 25 and `maxPropertyRows` from 31 to 50 while keeping
`maxValueRows` at 388. Its total delta is 25 and it completes seven functions
across all four tools:

1. `examples/capstone-assertion-engine/compare.kern#4:compareNode`
2. `examples/capstone-checker-subset/checker-while.kern#14:literalTrue`
3. `examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail`
4. `examples/capstone-checker-subset/checker.kern#14:termProvenanced`
5. `examples/capstone-checker-subset/checker.kern#6:whileRejectDetail`
6. `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist`
7. `examples/selfhost-validator/validator.kern#11:owncallable`

[DECIDED] This result is a recommendation only. A later slice must prove exact
runtime headroom for these witnesses before either profile limit can move.

## Implementation Plan

1. Add M4.54 tests first and capture RED at the missing analyzer/receipt.
2. Reproduce the proven format-3 measurement against the exact M4.53 boundary.
3. Freeze canonical receipt bytes and an immutable input-commit/digest loader.
4. Add mutation, decorated-data, history, fresh-process, status, and terminal
   gate checks while leaving every product and policy surface unchanged.
5. Regenerate live summaries after implementation bytes settle, then run
   focused, canonicalizer, and complete Node 22 fitness gates.
6. Run high-risk role-lens Agon review, resolve verified findings, create one
   signed commit, fetch/rebase, and atomically push once with `--no-verify`.

## Implementation Evidence

[VERIFIED] RED failed at the intended missing
`coverage-residual-analysis-m4-54.mjs` module boundary before implementation.

[VERIFIED] The implemented analyzer recomputes the exact 38 assignments, 22
profile-row-bearing functions, 22 distinct evaluated observed settings, and
22 positive candidates. It selects exact 25/50/388 headroom with seven
functions across four tools and 102 total parameter rows. Mutation,
symbol-decoration, M4.50-history, and fresh-process tests all pass.

[VERIFIED] Immutable artifact hashes after the complete local gate are:

- M4.54 receipt SHA-256
  `9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423`;
- M4.54 analyzer SHA-256
  `2210e0a46db3ef2f7930640d258ccf843ca93201678ca99c76d5c28b994f2ea8`;
- live coverage-summary SHA-256
  `6475265b907af06f564870723ea1a2c8c3fa92784581c79ef571de0f54e6189e`;
- live prerequisite-summary SHA-256
  `1349932bd6fbba25e870d77235259bc36e9a8c9bcd5c78b1027fe02972778a7d`;
- coverage implementation, coverage policy, corpus, function-fact, and
  canonicalizer policy digests
  `d64c74f0b1ec33eb7700122acb28934e71d20966087abd9a49094b4e7be91f6b`,
  `213ce7266b0d8e449c4333483fe8862ae7d3fc69f2aaa7b869595dcbd5111d5c`,
  `da83239e2f10cf3a14350fc935c43ca44fcaf461e6513e14cc25ff984ec3c9de`,
  `7f42974aba8157c6f20fae3cf0c7632317e36e2e7c0d6e5869c32aa31970dc78`,
  and `c6838abc0d5dd2db23f1050b7acc3e0411f5d8e4ffbe90abd47bcdcf2ada95ac`.

[VERIFIED] Focused residual/current tests pass 50/50. The standalone
canonicalizer wall passes 179/179 tests plus 51 golden/idempotence/KIR, eight
measured-witness, three profile-limit, and 226 hostile fixtures. The complete
Node 22.22 `fitness:kern-5` wall passes with the terminal M4.54 status and no
product or policy change.

[VERIFIED] High-risk role-lens review
`review-1784765519833-ajerxw-kern-5-r2-m4-54` completed all 6/6 usable
reviewers. Its one verified blocker correctly found that the M4.53 analyzed
boundary had been mislabeled `sourceCommit`; M4.54 now exposes the truthful
`inputCommit` field while its own immutable identity remains the receipt
digest. The post-fix canonicalizer wall passes 179/179 plus 51/8/3/226. Three
needs-check DRY observations are not material: milestone-local status,
checker, digest, and loader guards deliberately remain independent so a
shared edit cannot authorize historical drift. Nine bounded CI-only nits do
not affect correctness, runtime behavior, or release safety. No unresolved
material finding remains.

## Acceptance Criteria

- [x] Fresh branch starts at published M4.53 commit `87431a52`.
- [x] RED fails at the intended missing M4.54 analyzer/receipt boundary.
- [x] Every current residual function has one canonical assignment.
- [x] Assignment digest reproduces the live M4.53 exhaustion receipt.
- [x] Candidate settings derive only from current policy and observed rows.
- [x] Selection is exact 25/50/388 with seven functions across four tools.
- [x] Historical receipts remain byte-identical.
- [x] No KERN source, generated consumer, profile, family, parser, KIR,
      runtime, ABI, package, or public surface changes.
- [x] Focused gates and complete Node 22 `fitness:kern-5` pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify.

## Stop Conditions

- Residual count is not 38 or the parameter-ready partition is non-empty.
- Assignment digest differs from the published M4.53 exhaustion digest.
- Candidate construction needs a number not supplied by current policy or
  authenticated observed facts.
- The selected setting is not exact 25/50/388 with the seven measured
  witnesses across all four tools.
- Historical evidence or an out-of-scope product surface changes.

## Out of Scope

- Runtime-headroom proof for 25 node rows or 50 property rows.
- Promoting either limit, migrating the selected parameter rows, or adding
  exception-flow or while-iteration support.
- Version bump, release candidate, stable release, or KERN 5 completion claim.
