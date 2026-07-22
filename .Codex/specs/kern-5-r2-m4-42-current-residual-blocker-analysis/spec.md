# KERN 5 R2 M4.42 Current Residual Blocker Analysis

**Status:** IMPLEMENTED — RELEASE AND REVIEW GATES PASSED; PUBLICATION PENDING
**Date:** 2026-07-22
**Confidence:** 0.95

## Executive Summary

[VERIFIED] Published M4.41 commit
`956bf54717d2b4a75a850755163ac0e076a94606` consumed the complete
M4.40-authenticated parameter queue. The live canonicalizer boundary is now
57/104 base-complete functions, 45 legacy-parameter residual functions, an
exactly empty parameter queue, and bounded exhaustion over the remaining
exception-flow and while-iteration families.

[DECIDED] M4.42 is analysis-only. It will publish a new authenticated current
residual analysis under the unchanged M4.36 base profile and 16/30/154 limits.
It will not change KERN source, profile limits, active families, parser,
runtime, KIR, ABI, generated consumers, or public APIs. The M4.31 and M4.38
receipts remain immutable historical evidence.

## Published Input

[VERIFIED] The exact M4.41 boundary is:

- base profile `kern.kir-canonicalizer.profile.m4.36`;
- limits 16 node rows, 30 property rows, and 154 value rows;
- 104 functions across nine handwritten members and four tools;
- 57 base-complete functions and 45 legacy-parameter residual functions;
- zero parameter-ready functions, tools, and rows;
- active exception-flow and while-iteration families;
- three evaluated non-empty family closures and zero completing closures;
- reason-assignment digest
  `a965461fa32dc4bbb1fdfa3ca153d91d019865e6ddb10e57f64087be6d7402bf`;
- coverage-summary SHA-256
  `eca4d82a8503d961270214a4bf69bca90873bfe624d49228b07ba5627d3f98c2`;
- prerequisite-summary SHA-256
  `1120312f40cb14247c351d732342ab2034db4f3ee0bc2391bc884d1e5cd3bde3`.

## Root Problem

[VERIFIED] M4.38 measured 56 residual functions under 16/30/106 and selected
an 11-function value-row cohort. M4.40 promoted the 154-row profile, and M4.41
migrated that complete cohort. Its M4.38 recommendation is therefore consumed
history and cannot choose the next release slice.

[VERIFIED] The live prerequisite result deliberately stops at “current
residual blocker analysis.” Raw blocker counts overlap and cannot prove which
single limit or limit combination completes a current residual function.

[DECIDED] M4.42 must recompute exact function-to-reason assignments and
bounded observed-limit counterfactuals from the authenticated M4.41
population before any next profile or migration slice is authorized.

## Analysis Contract

| Behavior | Contract | Tag |
|---|---|---|
| Format | `kern.kir-canonicalizer.residual-analysis.3` | DECIDED |
| Scope | exact 45 current residual functions | VERIFIED |
| History | preserve M4.31 v1 and M4.38 v2 modules, receipts, digests, and tests byte-identically | DECIDED |
| Assignment | bind id, tool, parameter rows, profile rows, and sorted reasons | DECIDED |
| Assignment digest | reproduce M4.41 exhaustion digest | DECIDED |
| Candidate limits | derive only from observed residual profile rows and live policy | DECIDED |
| Completion | reuse `canonicalizerFunctionCompletes` under unchanged base and no added family | DECIDED |
| Ranking | fewer axes, more tools, smaller delta, more functions, canonical signature | DECIDED |
| Selection | first completing ranked candidate or explicit null frontier exhaustion | DECIDED |
| Authority | recommendation only; no profile promotion or source migration | DECIDED |

## Candidate Construction

[DECIDED] Counterfactually migrate only remaining authenticated legacy
`fn.params` facts into direct-parameter facts, then require the live
parameter-ready partition to remain empty. For each residual function with
measured profile rows, raise each current limit only as far as that function
requires. Deduplicate settings, discard unchanged settings, evaluate every
setting against every residual function, and retain exact witnesses for
settings completing at least one function.

[DECIDED] Sort actionable candidates by changed-axis count ascending, complete
tools descending, total delta ascending, complete functions descending, then
canonical nodes/properties/values signature. No release threshold or preferred
axis is hardcoded; current policy and authenticated observed facts supply every
number.

## Integrity Contract

[DECIDED] Validation fails closed on format or field drift, malformed or
duplicate ids, unsorted assignments, invented tools, stale baseline digests,
assignment digest drift, reason omission or invention, below-current or
unobserved settings, incorrect axes or deltas, fabricated witnesses, ranking
drift, decorated data, and selection drift.

[DECIDED] Writer/check mode uses the canonical regular-file summary helper and
must reproduce byte-identically in a fresh UTC/C-locale process.

## RED and Implementation Plan

1. Add the M4.42 test surface first and capture failure for the missing v3
   analyzer/receipt.
2. Reuse the proven M4.38 live-analysis algorithm behind a new v3 module,
   wired to current authenticated coverage and prerequisite facts.
3. Generate the exact v3 receipt only after the implementation module settles.
4. Add schema, mutation, decorated-data, historical-preservation, writer, and
   fresh-process determinism checks.
5. Pin the measured current result and terminal guidance without implementing
   the recommendation.
6. Run focused validation and the complete Node 22 `fitness:kern-5` wall.
7. Run automatic role-lens independent review, resolve every material finding,
   fetch/rebase, create one Agon-signed commit, and atomically push the fresh
   feature ref plus authorized `main` once with `--no-verify`. The bypass is
   limited to this already-authorized push after the stronger complete fitness
   wall and independent review pass; it avoids rerunning the narrower scoped
   hook and does not bypass any unexecuted gate.
8. Verify both remote refs and start the next slice from fresh `origin/main`;
   never reuse the M4.42 branch.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | frozen v3 analysis contract |
| M4.42 residual-analysis module | add | derive and validate the current analysis |
| M4.42 residual-analysis receipt | generate | durable exact frontier |
| M4.42 residual-analysis tests | add | RED, mutations, history, and determinism |
| terminal coverage checker | modify | pin current analysis and status |
| coverage status formatter/tests | modify | distinguish M4.42 from historical M4.38 |
| coverage/prerequisite receipts | regenerate only if live implementation digest changes | preserve authenticated baseline |
| release train | modify after gates | durable M4.42 evidence |

## Measured Result

[VERIFIED] The v3 receipt contains exactly 45 sorted assignments and reproduces
the M4.41 reason-assignment digest
`a965461fa32dc4bbb1fdfa3ca153d91d019865e6ddb10e57f64087be6d7402bf`.
Exactly 29 residual functions expose profile rows, yielding 29 distinct
observed settings and 29 positive actionable candidates.

[VERIFIED] The first ranked action changes only `maxValueRows`, from 154 to
388. Its total delta is 234 and it completes two functions across two tools:

- `examples/capstone-checker-subset/checker-while.kern#2:checkerSafeIntText`;
- `examples/kern-canonicalizer/canonicalizer.kern#1:validbinaryop`.

[VERIFIED] The authenticated implementation digest is
`6c74f747f3df19ea9e09eb88be4e0aa10d54a7319f90af0eeffe4054ad9ebd2d`.
Coverage, prerequisite, and M4.42 residual-analysis whole-file SHA-256 values
are `e578c3a828ef1a2757fd285de02afc3cdbb98e2b5ef9299f577bab8d14aa27b6`,
`b01651c6993078bc364edb62d95fce092e37e630e71d46f9338ca1554e7a2e96`,
and `f37fed74d24a739adf3584ceb7608f8d25c490d2325ebc1c127e05ee15238a8e`.
The M4.31 and M4.38 receipts remain byte-identical at
`160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`
and `8bc1be3c941c8fd2d8a4a5990de0266f54ae986fbfd1e4712e6044c78cc092cd`.

[VERIFIED] Focused validation passes all 117 canonicalizer tests plus 51
golden/idempotence/KIR fixtures, eight measured witnesses, three profile-limit
fixtures, and 226 hostile fixtures.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on the exact
integrated tree, including all 22 workspace projects, 434/434 cross-target
fixtures, 109/109 class fixtures, 233/233 native KERN assertions at required
100% coverage, runner/browser/app behavior, self-host parity, runtime/KIR
ownership, and the repeated terminal 117-test canonicalizer replay. The
required browser measurement remains inside policy at 157 modules, 1,553,103
raw bytes, 333,617 gzip bytes, and an 89 ms median (86/89/95 ms samples).

[VERIFIED] Automatic medium-risk role-lens review
`review-1784716745356-42xprs-kern-5-r2-m4-42-final` completed 2/2. The security
lens found no issue. The overall lens found no blocker and two nits: milestone
bindings are now named explicitly for M4.38/M4.42, and the authorized
`--no-verify` publication step now records why no gate is skipped. Exact
whole-file receipt hashes were also recomputed locally. No material finding
remains unresolved.

## Acceptance Criteria

- [x] Fresh M4.42 branch starts at published M4.41 commit `956bf547`.
- [x] RED fails at the missing v3 analyzer/receipt boundary.
- [x] Every current residual function has one exact canonical assignment.
- [x] Assignment digest reproduces the M4.41 exhaustion digest.
- [x] Candidate settings derive only from live policy and observed rows.
- [x] Selection is measured and non-null, or explicit frontier exhaustion is
      published.
- [x] M4.31 and M4.38 history remains byte-identical.
- [x] No KERN source, generated consumer, profile, family, parser, KIR,
      runtime, ABI, or public API changes.
- [x] Focused gates and complete `pnpm fitness:kern-5` pass on Node 22.
- [x] Automatic role-lens review has no unresolved material finding.
- [ ] Signed Agon commit is fetched/rebased before one atomic no-verify push to
      the feature ref and authorized `main`; both refs are verified.

## Out of Scope

- Implementing or promoting the selected profile setting.
- Migrating any additional parameter cohort.
- Adding exception-flow or while-iteration support.
- Claiming KERN 5 completion.

## Open Questions

[VERIFIED] None within this analysis-only slice. M4.43 must independently
authenticate runtime headroom before deciding whether the selected 388-row
setting is promotable; M4.42 does not authorize that promotion.
