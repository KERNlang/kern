# KERN 5 R2 M4.32 — Authenticated Value-Row Profile Promotion

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-21
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.31 commit
`fdf55cfb52616ef9bdf006a42f6a58a56a10b7c1` authenticated every one of the
69 residual legacy-parameter functions and selected the smallest one-axis
setting that completes evidence in all four corpus tools: node/property/value
rows `16/30/106`, with 12 functions and 44 direct parameter rows.

[DECIDED] M4.32 promotes only `profileLimits.maxValueRows` from 72 to 106.
Node rows remain 16, property rows remain 30, KERN source remains byte-identical,
and no structural family, KIR, ABI, runtime limit, corpus member, or profile
capability changes. The policy promotion must make the exact 12-function cohort
parameter-ready and must not consume it in the same slice.

## Published Input

[VERIFIED] M4.31 is published on `origin/main` and its feature ref at the exact
commit above. Its immutable receipt SHA-256 values are:

- coverage: `668c7e1eec36107c02508535e79c15e5f707dfa4f8e22cc6ab459d95060291cd`;
- prerequisite: `8c29baf2d234e95864819e41d6285a358dc8e23f3193b79f06d69be7d26d5ef6`;
- residual analysis: `160008df86bd3c93b8c307d8ae5f2174b76d39fff92eee6b7f57dd1320379076`.

[VERIFIED] The residual receipt records 69 assignments, 53 functions with
counterfactual profile rows, 50 observed actionable settings, and an assignment
digest of
`7cd89ffda2d591cf9a82fa0f836d5b7f095887a33a9b4c843a117a0ab6734c1c`.

## Root Problem

[VERIFIED] The current 72-value-row limit is an admission-policy ceiling, not a
semantic capability. It masks functions that already complete under the
M4.29 base after an in-memory legacy-to-direct parameter migration. M4.31 proved
that 106 is the smallest observed single-axis ceiling that completes at least
one function from each of assertion-engine, checker, canonicalizer, and
validator.

[VERIFIED] An exact worst-case `16/30/106` boundary executes successfully in
the unchanged portable handler envelope. The same construction at 107 rejects
immediately when the configured ceiling is 106. A broader 128 boundary failed
the unchanged runtime envelope, so M4.32 must not promote beyond 106.

## Promotion Contract

| Surface | M4.31 | M4.32 | Tag |
|---|---:|---:|---|
| max node rows | 16 | 16 | VERIFIED |
| max property rows | 30 | 30 | VERIFIED |
| max value rows | 72 | 106 | DECIDED |
| KERN canonicalizer bytes | unchanged | unchanged | DECIDED |
| active structural families | do/exception/while | unchanged | DECIDED |
| corpus | 104 functions / 9 members / 4 tools | unchanged | DECIDED |
| KIR/runtime/ABI limits | current | unchanged | DECIDED |

[DECIDED] The exact admitted boundary fixture has 13 direct parameters: two
`number[]` parameters followed by eleven `number` parameters, then a return
list containing the integers 0 through 13. Its canonical rows are exactly
`16/30/106`.

[DECIDED] The value-overflow fixture changes only one additional parameter type
from `number` to `number[]`. Its canonical rows are exactly `16/30/107`, and the
handler must reject it without returning a partial canonical result. Existing
node- and property-overflow fixtures remain independently over their unchanged
16 and 30 ceilings.

## Historical Evidence Contract

[DECIDED] The M4.31 residual analysis becomes an immutable historical handoff
before active policy changes. Its checked-in canonical JSON bytes, exact SHA-256,
published source commit, baseline digests, selected `16/30/106` action, and 12
ordered witnesses must remain pinned.

[DECIDED] The terminal checker must load and validate that historical handoff;
it must not regenerate or overwrite it in `--write` mode. Live M4.32 coverage
and prerequisite receipts remain independently regenerated from the 106-row
policy. This prevents later parameter-source migrations from rewriting M4.31's
reason assignments or recommendation.

## Expected Live Transition

[VERIFIED] Under the unchanged corpus and a counterfactual 106-row policy, the
live prerequisite partition contains exactly 12 parameter-ready functions,
four tools, and 44 direct parameter rows:

1. `examples/capstone-assertion-engine/compare.kern#5:compareTrees`
2. `examples/capstone-checker-subset/checker-while.kern#3:previousSiblingKind`
3. `examples/capstone-checker-subset/checker-while.kern#7:functionRow`
4. `examples/capstone-checker-subset/checker.kern#10:isForCounter`
5. `examples/capstone-checker-subset/checker.kern#11:isAssigned`
6. `examples/capstone-checker-subset/checker.kern#13:paramOrdinalOf`
7. `examples/capstone-checker-subset/checker.kern#15:argIndexOf`
8. `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#0:validfirst`
9. `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#6:structuralname`
10. `examples/selfhost-validator/validator.kern#0:charokfirst`
11. `examples/selfhost-validator/validator.kern#16:classrow`
12. `examples/selfhost-validator/validator.kern#8:contained`

[VERIFIED] The remaining 57 legacy-parameter functions expose a one-family
structural winner: `do-statement`, with only
`examples/selfhost-validator/validator.kern#14:appendid` in its winning closure.
The 12 parameter-ready witnesses and the residual do witness must remain
disjoint. Terminal release guidance still prioritizes consuming the frozen
parameter queue before implementing do.

## Implementation Plan

1. Add RED assertions for the 106-row policy, exact 106 boundary, exact 107
   rejection, immutable M4.31 handoff, 12-function queue, and disjoint do winner.
2. Convert residual analysis from a live M4.31 measurement into an exact
   published-handoff loader; stop rewriting its JSON receipt.
3. Change only `profileLimits.maxValueRows` from 72 to 106 and update the exact
   boundary fixtures.
4. Regenerate live coverage and prerequisite receipts after all local `.mjs`
   sources settle; pin the exact M4.32 transition and release-train evidence.
5. Run the focused canonicalizer gate, the complete Node 22
   `pnpm fitness:kern-5` wall, and automatic high-risk role-lens Agon review.
6. Commit with Agon identity, fetch/rebase onto `origin/main`, atomically push
   the fresh feature ref and authorized main once with `--no-verify`, verify both
   remote hashes, and start the parameter-migration slice from fresh main.

## Acceptance Criteria

- [x] Fresh M4.32 branch starts at published M4.31 commit
      `fdf55cfb52616ef9bdf006a42f6a58a56a10b7c1`.
- [x] The 106 ceiling and exact 12-function cohort are grounded in M4.31.
- [x] RED proves current 72 policy does not satisfy the new contract.
- [x] M4.31 residual evidence is immutable and no longer regenerated live.
- [x] Policy is exactly `16/30/106`; KERN/runtime/KIR/ABI surfaces are unchanged.
- [x] Exact `16/30/106` succeeds and exact `16/30/107` rejects.
- [x] Live parameter migration is exactly 12 functions, 4 tools, and 44 rows.
- [x] Residual `do-statement` selection is exact and disjoint from migration.
- [x] Focused canonicalizer gate and complete `fitness:kern-5` wall pass.
- [x] Full usable-roster review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      fresh feature ref and authorized main; both remote hashes verify.

## Stop Conditions

- The exact 106 boundary fails the configured runtime envelope.
- The 107 fixture returns success or a partial canonical result.
- Any node/property, runtime, KIR, ABI, corpus, family, or KERN source change is
  required.
- The parameter-ready cohort differs from 12/4/44 or any witness id drifts.
- The residual do witness overlaps the parameter-ready cohort.
- M4.31 historical JSON cannot remain byte-identical and digest-bound.

## Verified Performance Evidence

[VERIFIED] Automatic review identified the synchronous worst-case cost of the
promoted boundary. A local Node 22 reproduction through the production handler
path measured 4.636 seconds for the exact 16/30/72 fixture and 14.089 seconds
for the exact 16/30/106 fixture. Both complete inside the unchanged configured
runtime envelope, so this does not invalidate the bounded internal promotion,
but it is not a release-performance approval.

[DECIDED] No later slice may widen the profile beyond 16/30/106. The quadratic
table-validation path must be optimized and assigned an explicit runtime budget
before canonicalizer runtime cutover or RC; the existing TypeScript bootstrap
path remains primary until that separate gate exists.

## Out of Scope

- Migrating the 12 source functions to direct parameters.
- Implementing or promoting do, exception, or while.
- Raising any profile ceiling beyond `16/30/106`.
- Fixing projection or text-character blockers.
- KIR v1 freeze, public reader export, runtime cutover, or KERN 5 completion.

## Open Questions

None. M4.31 selected the exact policy action and witness queue; M4.32 promotes
that one policy boundary without consuming the resulting source migration.
