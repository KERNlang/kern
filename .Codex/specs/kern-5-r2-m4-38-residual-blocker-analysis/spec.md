# KERN 5 R2 M4.38 — Current Residual Blocker Analysis

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-22
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.37 commit
`daeca7e16b4a31454e5e7f6db74747f2eae2de03` consumes the sole direct-parameter
migration witness. The live prerequisite result is bounded exhaustion: 46/104
base-complete functions, 56 legacy-parameter residual functions, no ordinary
family winner, no parameter-ready witness, and no completing closure over the
remaining exception and while families.

[DECIDED] M4.38 is analysis-only. It publishes a new authenticated residual
analysis for the current M4.36 profile without changing KERN source, profile
limits, active families, parser, KIR, runtime, ABI, or historical provenance.
The immutable M4.31 analysis remains byte-identical historical evidence.

## Published Input

[VERIFIED] The exact M4.37 boundary is:

- base profile `kern.kir-canonicalizer.profile.m4.36`;
- limits 16 node rows, 30 property rows, and 106 value rows;
- 104 functions across nine handwritten members and four tools;
- 46 base-complete functions and 56 legacy-parameter residual functions;
- active exception-flow and while-iteration families;
- three evaluated non-empty family closures and zero completing closures;
- reason-assignment digest
  `8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef`;
- coverage-summary SHA-256
  `677f7ec0ae9616017a0db891d5cf87bce93fbb0d93b05f20a758153c2d7eda81`;
- prerequisite-summary SHA-256
  `2922af3886bd0436cdd9f11f247cb46092cf8a94c6d70b07f80b914d3ee5b849`.

## Root Problem

[VERIFIED] M4.31's 69-function frontier was measured before the value-row
promotion, twelve-function migration, do implementation/promotion, and
`appendid` migration. Its selected 72-to-106 value-row action is now consumed
history and cannot choose the next release slice.

[DECIDED] Raw current blocker counts still overlap and cannot prove which
single limit or limit combination completes any residual function. M4.38 must
recompute exact function-to-reason assignments and bounded observed limit
counterfactuals from the authenticated M4.37 population.

## Analysis Contract

| Behavior | Contract | Tag |
|---|---|---|
| Format | `kern.kir-canonicalizer.residual-analysis.2` | DECIDED |
| Scope | exact 56 current residual functions | VERIFIED |
| History | preserve M4.31 v1 module, receipt, digest, and tests byte-identically | DECIDED |
| Assignment | bind id, tool, parameter rows, profile rows, and sorted reasons | DECIDED |
| Assignment digest | reproduce the M4.37 exhaustion digest | DECIDED |
| Candidate limits | derive only from observed residual profile rows and live policy | DECIDED |
| Completion | reuse `canonicalizerFunctionCompletes` under unchanged base and no added family | DECIDED |
| Ranking | fewer axes, more tools, smaller delta, more functions, canonical signature | DECIDED |
| Selection | first completing ranked candidate or explicit null frontier exhaustion | DECIDED |
| Authority | recommendation only; no profile promotion | DECIDED |

## Candidate Construction

[DECIDED] For each residual function with measured profile rows, raise each
current limit only as far as that function requires. Deduplicate settings,
discard unchanged settings, evaluate each against every migrated residual
function, and keep exact witnesses for candidates completing at least one
function.

[DECIDED] Sort actionable candidates by changed-axis count ascending, complete
tools descending, total delta ascending, complete functions descending, then
canonical nodes/properties/values signature. No literal release threshold is
allowed; the current policy and observed facts supply every number.

## Integrity Contract

[DECIDED] Validation fails closed on format/field drift, malformed or duplicate
ids, unsorted rows, invented tools, stale baseline digests, assignment digest
drift, reason omission/invention, below-current or unobserved settings,
incorrect axes/deltas, fabricated witnesses, ranking drift, and selection
drift. Writer/check mode uses the canonical regular-file summary helper and
must reproduce byte-identically in a fresh process.

## Implementation Plan

1. RED-test the missing v2 analyzer and checked-in receipt.
2. Restore the proven M4.31 live-analysis algorithm behind a new v2 surface,
   wired to current authenticated coverage/prerequisite facts.
3. Generate the exact v2 receipt only after implementation source settles.
4. Add schema/mutation/determinism tests and terminal live-result pins.
5. Record the measured recommendation without widening the profile.
6. Run focused validation, complete Node 22 `fitness:kern-5`, six-engine Agon
   review, and resolve every material finding.
7. Commit with Agon identity, fetch/rebase, atomically push the fresh feature
   ref and authorized main once with `--no-verify`, and verify both hashes.

## File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | frozen v2 analysis contract |
| v2 residual-analysis module | add | derive/validate current analysis |
| v2 residual-analysis receipt | generate | durable exact frontier |
| v2 residual-analysis tests | add | RED, mutations, determinism |
| terminal coverage checker | modify | pin current analysis and status |
| coverage/prerequisite receipts | regenerate if implementation digest changes | authenticated live facts |
| exact live pins | update only as measured | bind settled implementation bytes |
| release train | modify after gates | durable M4.38 evidence |

## Measured Result

[VERIFIED] The version-2 receipt contains exactly 56 sorted assignments and
reproduces M4.37 reason-assignment digest
`8ae6a54e20836ad1b560c88c59fed44e6bd96ecdfbee30cf5cb5404d44f0daef`.
Exactly 40 residual functions expose profile rows, yielding 39 distinct
observed settings and 39 positive actionable candidates.

[VERIFIED] The first ranked action changes only `maxValueRows`, from 106 to
154. Its total delta is 48 and it completes 11 functions across three tools:

- `checker-while.kern#10:isLengthType`;
- `checker-while.kern#5:checkerElseRejectDetail`;
- `checker.kern#19:mapArgToken`;
- `checker.kern#8:isArrayBinding`;
- `canonicalizer-expression-helpers.kern#10:propid`;
- `canonicalizer-expression-helpers.kern#12:childat`;
- `canonicalizer-expression-helpers.kern#14:valuechildat`;
- `canonicalizer-expression-helpers.kern#15:recordfield`;
- `canonicalizer-expression-helpers.kern#2:valididentifier`;
- `canonicalizer-expression-helpers.kern#3:validexpressionidentifier`;
- `validator.kern#18:hasimportcyclefrom`.

[VERIFIED] The authenticated implementation digest is
`54d297b6a080d9862d8125b9c28a10f3309686c9e86e192205b8e4a9a68d66ce`.
Coverage, prerequisite, and M4.38 residual-analysis whole-file SHA-256 values
are `fc37c7ac4f34b3517937068e7b7307f78d72db39efd3848121a7b40553cd33b8`,
`7832331bce8ebdb8aafe9a74755505b88b66224a34b125e4b76195f6666428f8`,
and `8bc1be3c941c8fd2d8a4a5990de0266f54ae986fbfd1e4712e6044c78cc092cd`.
The M4.31 receipt remains byte-identical at
`160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`.

[VERIFIED] Focused Node 22 validation passes 108/108 structural and receipt
tests, 51 golden/idempotence/KIR fixtures, eight measured witnesses, three
profile-limit fixtures, and 226 hostile fixtures.

[VERIFIED] The exact integrated tree passes the complete Node 22
`pnpm fitness:kern-5` wall on 2026-07-22, including all 22 workspace projects,
168/168 release-policy tests, 432/432 cross-target fixtures, 109/109 class
fixtures, 233 native KERN assertions at 100% coverage, runner/browser/app
gates, self-host checker and validator parity, runtime/KIR ownership gates,
and the repeated terminal canonicalizer replay.

[VERIFIED] Final six-seat role-lens review
`review-1784691513868-za02lj-kern-5-r2-m4-38-final` completed across every
usable non-excluded engine. The reviewer that found the `toJSON` impersonation
returned zero findings after the fix; another independently verified the
population math, candidate ordering, selected witnesses, receipt digests, and
terminal pins. Claims that the module/tests or historical hashes were missing
were disproved against the staged files and exact `daeca7e1` blobs. Remaining
items are non-material future refactoring suggestions. No material finding
remains unresolved.

## Acceptance Criteria

- [x] Fresh M4.38 branch starts at published M4.37 `origin/main` commit
      `daeca7e16b4a31454e5e7f6db74747f2eae2de03`.
- [x] Exact M4.37 residual boundary and receipt hashes are grounded.
- [x] RED fails for the missing v2 receipt with exact `ENOENT`.
- [x] Every current residual function has one exact canonical assignment.
- [x] Assignment digest reproduces the published M4.37 exhaustion digest.
- [x] Candidate settings derive only from live policy and observed rows.
- [x] Selection is measured and non-null, or explicit frontier exhaustion is
      published.
- [x] M4.31 history remains byte-identical.
- [x] No KERN source, profile, family, parser, KIR, runtime, or ABI change.
- [x] Focused gate and complete `pnpm fitness:kern-5` wall pass after the
      review fix.
- [x] Six-engine review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push;
      feature and main refs verify exact.

## Stop Conditions

- Current assignments do not reproduce the M4.37 exhaustion digest.
- Analysis requires a KERN or profile mutation.
- A candidate is not derived from observed current rows.
- Completion requires a duplicate evaluator or new predicate.
- Selection changes with source traversal order alone.
- M4.31 historical evidence changes.

## Out of Scope

- Applying the selected limit change.
- Migrating another parameter cohort.
- Implementing/promoting exception-flow or while-iteration.
- Fixing projection or unknown-expression blockers.
- KIR freeze, public reader export, runtime cutover, or KERN 5 completion.

## Open Questions

None. The candidate frontier and selected action are measured outputs.
