# KERN 5 R2 M4.31 — Authenticated Residual Blocker Analysis

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-21
**Confidence:** 0.94

## Executive Summary

[VERIFIED] Published M4.30 commit
`0d4fbc4d3ea5db79cf35a01da9d37ec3e26f9d79` consumes the only frozen
parameter-ready witness. Its live prerequisite receipt is bounded exhaustion:
33/104 base-complete functions, 69 legacy-parameter residual functions, no
ordinary family winner, no parameter-ready witness, and no completing closure
over do, exception, and while.

[DECIDED] M4.31 is an analysis-only release slice. It does not change KERN
source, the cumulative profile, profile limits, the family registry, runtime,
KIR, ABI, or any historical provenance. It converts the already authenticated
69-function residual population into a canonical, checked-in analysis receipt
that explains every residual function and evaluates bounded profile-limit
counterfactuals under the unchanged M4.29 base.

## Published Input

[VERIFIED] The exact M4.30 boundary is:

- base profile `kern.kir-canonicalizer.profile.m4.29`;
- 104 functions across nine handwritten corpus members and four tools;
- 33 base-complete functions;
- 69 residual legacy-parameter functions;
- current profile limits 16 node rows, 30 property rows, and 72 value rows;
- active structural families do, exception, and while;
- seven evaluated non-empty family closures and zero completing closures;
- reason-assignment digest
  `7cd89ffda2d591cf9a82fa0f836d5b7f095887a33a9b4c843a117a0ab6734c1c`;
- coverage-summary SHA-256
  `2af38c98be269861f472182463df850b7111e40389acf0e49e1fc65e3c4b4c5b`;
- prerequisite-summary SHA-256
  `9dd7d8e117deeb473c6d802d735e9e4fbdad7a8d8d34ac304ef4eea5c483501a`.

## Root Problem

[VERIFIED] The exhaustion receipt authenticates a reason census but deliberately
does not publish the 69 function-to-reason assignments whose digest it binds.
Counts overlap: a function can exceed multiple profile limits or also carry a
projection/expression blocker. Therefore the largest raw count is not evidence
that changing that one setting completes any function.

[DECIDED] The next release action must be selected from counterfactual
completion, not from blocker frequency. M4.31 will expose exact assignments and
evaluate candidate profile-limit settings with the existing canonical
completion predicate after in-memory direct-parameter migration.

## Analysis Contract

| Behavior | Contract | Tag |
|---|---|---|
| Format | `kern.kir-canonicalizer.residual-analysis.1` | DECIDED |
| Scope | exact 69 residual functions from live M4.30 measurement | VERIFIED |
| Assignment | each row binds id, tool, parameter rows, profile rows, and all sorted reasons | DECIDED |
| Assignment digest | must reproduce the M4.30 exhaustion assignment digest | DECIDED |
| Current limits | copied from authenticated canonicalizer policy, never literals in analysis logic | DECIDED |
| Candidate limits | deduplicated settings derived only from observed residual profile rows | DECIDED |
| Completion | existing `canonicalizerFunctionCompletes` under unchanged base and candidate limits | DECIDED |
| Structural blockers | remain active and can prevent profile-only completion | DECIDED |
| Ranking | fewer changed axes, then more complete tools, then smaller total delta, then more complete functions and canonical signature | DECIDED |
| Selection | first ranked candidate with at least one completing function, or explicit null exhaustion | DECIDED |
| Authority | analysis recommends the next slice; it does not widen a profile | DECIDED |

## Candidate Construction

[DECIDED] For each residual function with measured profile rows, derive one
candidate setting by raising each current profile limit only as far as that
function requires. Deduplicate identical settings. A setting with no changed
axis is not a profile-widening candidate.

[DECIDED] Evaluate each setting against every residual migrated function with
the unchanged cumulative base and family set empty. Record exact witness ids,
function count, tool count, changed axes, resulting limits, and total absolute
delta. Discard zero-completion settings from the ranked actionable frontier,
but record how many observed settings were evaluated.

[DECIDED] The selected candidate is the first row after ordering by:

1. changed-axis count ascending;
2. complete tools descending;
3. total absolute delta ascending;
4. complete functions descending;
5. canonical `nodes/properties/values` signature ascending.

This ranking prefers a one-knob release slice, maximizes cross-tool evidence,
and then selects the smallest observed widening that reaches that tool breadth.
Function count breaks ties only after blast radius, so a large limit cannot win
merely by admitting more functions. No threshold is embedded in source; all
values are derived from policy and observed rows.

[VERIFIED] The measured result is value rows 72 to 106: 12 completing functions
across all four tools with node/property limits unchanged. A function-first
ranking would instead select 388, which is rejected because it enlarges the
admission surface solely to maximize count and is not the minimum cross-tool
setting.

## Integrity and Mutation Contract

[DECIDED] The receipt validator must fail closed on unknown fields, malformed or
duplicate ids, unsorted rows, invented tools, stale baseline digests, assignment
digest drift, reason omission or invention, candidate settings below current
limits, non-observed settings, incorrect changed axes/deltas, fabricated
witnesses, ranking drift, and selection drift.

[DECIDED] The writer uses the existing canonical regular-file/symlink-safe
summary writer. Check mode recomputes from live facts and requires byte-identical
checked-in JSON. Tests must prove deterministic fresh-process reproduction.

## Implementation Plan

1. Add a RED test requiring the missing residual-analysis module and receipt.
2. Refactor prerequisite measurement only enough to expose frozen migrated
   residual facts from the same authenticated computation used by format 3.
3. Implement canonical assignment, candidate evaluation, validation, and writer
   logic; write the exact receipt only after all implementation `.mjs` files
   settle.
4. Add mutation tests and a terminal checker; regenerate ordinary coverage and
   prerequisite receipts because the authenticated implementation set changes.
5. Seal exact measured counts, hashes, selected next action, release-train
   evidence, and this spec without claiming profile promotion.
6. Run the focused canonicalizer gate, complete Node 22 `fitness:kern-5` wall,
   and full usable non-excluded Agon review; resolve every verified material
   finding.
7. Commit with Agon identity, fetch/rebase onto `origin/main`, atomically push
   the fresh feature ref and authorized main once with `--no-verify`, verify both
   hashes, and start the next slice from fresh `origin/main`.

## File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared analysis contract |
| prerequisite measurement | minimally refactor | reuse exact migrated residual facts |
| residual-analysis module | add | derive and validate canonical analysis |
| residual-analysis receipt | add | durable exact assignments/frontier |
| residual-analysis tests | add | RED, mutations, determinism |
| terminal analysis checker | add | release-fact pins and check mode |
| coverage/prerequisite receipts | regenerate | authenticated implementation digest changes |
| existing exact pins | update only as generated | bind settled implementation bytes |
| release train | update after gates | durable M4.31 evidence |

## Acceptance Criteria

- [x] Fresh M4.31 branch starts at published M4.30 `origin/main` commit
      `0d4fbc4d3ea5db79cf35a01da9d37ec3e26f9d79`.
- [x] M4.30 residual boundary and exact receipt hashes are grounded.
- [x] RED failed first for the missing analysis module and then for the missing
      checked-in receipt.
- [x] Every one of the 69 residual functions has one exact canonical assignment.
- [x] Assignment digest reproduces the published M4.30 exhaustion digest.
- [x] Every candidate setting derives only from policy and observed profile rows.
- [x] Candidate completion uses the unchanged production completion predicate.
- [x] The selected next action is measured and non-null, or explicit bounded
      profile-frontier exhaustion is recorded.
- [x] No KERN source, profile limit, family registry, runtime, KIR, ABI, or
      historical provenance changes.
- [x] Focused canonicalizer gate and complete `pnpm fitness:kern-5` wall pass.
- [x] Full usable-roster review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      fresh feature ref and authorized main; both remote hashes verify.

## Stop Conditions

- Residual assignments cannot reproduce the M4.30 digest.
- Analysis requires changing KERN or widening a policy limit.
- A candidate is not derived from observed rows.
- Completion requires a new evaluator or duplicate predicate.
- The selected action changes when source traversal order alone changes.
- Generated receipts cannot reproduce byte-identically in a fresh process.

## Out of Scope

- Actually changing 16/30/72 profile limits.
- Migrating another parameter cohort.
- Implementing or promoting do, exception, or while.
- Fixing projection/unknown-expression blockers.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion.

## Open Questions

None. The candidate frontier and selected next action are measured outputs, not
design choices.

## Verification Evidence

[VERIFIED] `pnpm test:kern-canonicalizer` passed 98/98 tests, 48 golden/
idempotence/KIR fixtures, eight measured witnesses, three profile-limit
fixtures, and 218 hostile fixtures. The complete Node 22
`pnpm fitness:kern-5` wall passed with exit 0.

[VERIFIED] Agon run `review-1784661248540-s5i0ou` routed the high-risk role
review to all 6/6 usable non-excluded engines. Review found one genuine
correctness edge: terminal status formatting dereferenced a nullable
`selectedNextAction`. The formatter now handles explicit frontier exhaustion;
the post-fix targeted gate passed 21/21 tests plus the terminal receipt checker.
The reported repeated measurement is bounded release-gate work, not a runtime
or product path, and remains intentional so validation re-authenticates live
facts rather than trusting caller-supplied state.

[VERIFIED] Final receipt SHA-256 values are coverage
`668c7e1eec36107c02508535e79c15e5f707dfa4f8e22cc6ab459d95060291cd`,
prerequisite
`8c29baf2d234e95864819e41d6285a358dc8e23f3193b79f06d69be7d26d5ef6`,
and residual analysis
`160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`.
