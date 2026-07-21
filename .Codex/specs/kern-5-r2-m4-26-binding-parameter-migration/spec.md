# KERN 5 R2 M4.26 — Frozen Binding Parameter Migration

**Status:** REVIEWED — PUBLICATION READY
**Date:** 2026-07-21
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.25 commit
`f56cb91e0bce3aa328b6020809d18312fdc6dc36` promotes the exact direct-binding
family and authenticates a five-function, two-tool, nine-row cohort that
becomes complete under the existing M4.25 base after parameter representation
alone is migrated.

[DECIDED] M4.26 applies exactly that frozen cohort to checked-in KERN source.
It removes each target's legacy `fn.params` property, prepends equivalent
ordered direct `param` children, regenerates the two affected generated
consumers and canonicalizer receipts, and leaves the cumulative profile and
all capability/provenance records unchanged.

## Published Input

[VERIFIED] M4.25's authenticated prerequisite receipt records:

- 27/104 functions complete under base profile
  `kern.kir-canonicalizer.profile.m4.25`;
- 75 remaining `fn.params` blockers;
- no ordinary active-family winner;
- five base-only parameter-ready functions across canonicalizer and validator;
- nine ordered legacy parameter rows;
- unary expression as the next one-family prerequisite, with one witness and
  two counterfactual parameter rows.

[VERIFIED] The frozen M4.25 cohort is:

| Function | Ordered parameters | Counterfactual rows | Tool |
|---|---|---:|---|
| `propcount` | `node:number`, `propNode:number[]` | 9 / 17 / 71 | canonicalizer |
| `childcount` | `parent:number`, `nodeParent:number[]` | 9 / 17 / 71 | canonicalizer |
| `valuechildcount` | `parent:number`, `valueParent:number[]` | 9 / 17 / 71 | canonicalizer |
| `indentation` | `level:number` | 7 / 14 / 42 | canonicalizer |
| `paramcount` | `fnRow:number`, `paramFn:number[]` | 9 / 17 / 71 | validator |

[VERIFIED] The exact witness identities are
`canonicalizer-expression-helpers.kern#7:propcount`,
`canonicalizer-expression-helpers.kern#11:childcount`,
`canonicalizer-expression-helpers.kern#13:valuechildcount`,
`canonicalizer-statement-helpers.kern#0:indentation`, and
`validator.kern#9:paramcount`. The source ordinals are immutable inputs to
this slice; migration does not reorder function roots.

## Root Cause

[VERIFIED] Every target body already uses only M4.25-promoted nodes,
properties, and expression kinds. Each target is blocked solely because its
function header still carries the excluded legacy `fn.params` string.

[VERIFIED] Ordered direct `param` children are already the admitted base
representation. The parser and runtime reject mixed legacy/direct parameter
forms, so this is a representation migration and requires no grammar, KIR,
runtime ABI, or evaluator change.

## Migration Contract

| Behavior | Contract | Tag |
|---|---|---|
| Scope | exactly five named roots and nine rows from the M4.25 receipt | VERIFIED |
| Header rewrite | remove only `params=...`; preserve `name`, `returns`, `export`, and property order | DECIDED |
| Direct parameters | prepend exact ordered `param name=... type=...` children before the handler | DECIDED |
| Function semantics | preserve bodies, calls, return behavior, root order, and sibling source bytes | DECIDED |
| Base profile | remain `kern.kir-canonicalizer.profile.m4.25` with seven promotions | DECIDED |
| Active families | remain do, exception, unary, while in current order | DECIDED |
| Provenance | preserve every selection and prerequisite record byte-for-byte | DECIDED |
| Coverage result | advance base completion by exactly five and reduce `fn.params` blockers by exactly five | DECIDED |
| Next prerequisite | remeasure honestly after migration; do not promote unary in this slice | DECIDED |

## Generated Consumers

[VERIFIED] Changes to the expression and statement helper sources require
`scripts/kern-canonicalizer/composition.mjs --write` to regenerate
`canonicalizer.composed.kern` and `composition.json`. The unchanged
`canonicalizer.kern` member must remain byte-identical.

[VERIFIED] The capstone checker corpus embeds flattened validator source, so
the `paramcount` migration requires
`scripts/capstone-checker-subset/gen-fixtures-kern.mjs` to regenerate
`examples/capstone-checker-subset/main.kern`. The separately generated numeric
fixture must remain byte-identical.

[VERIFIED] Exactly three handwritten coverage-corpus members change:
canonicalizer expression helpers, canonicalizer statement helpers, and the
self-host validator. The other six corpus member digests must remain exact.

## Expected Measurement

[INFERRED] Applying the exact frozen cohort should move live coverage from
27/104 to 32/104 and reduce legacy parameter blockers from 75 to 70. The
base-only `parameterMigration` partition should become empty.

[INFERRED] `numberat` should remain the residual unary-expression witness with
two legacy parameter rows, because this slice does not touch its source or the
unary family. Exact occurrence totals, source digests, composite bytes, and
receipt digests are measured outputs and will not be claimed until regenerated
from the final implementation tree.

## Review Correction Carried Forward

[VERIFIED] The complete post-M4.25 high-risk review is
`review-1784631406278-9iplpf`: all six usable non-excluded identities were
routed with no shortfall and all six returned output. One reviewer marked a
blocking concern by assuming source string `state.value` becomes a canonical
text literal. The actual pipeline first calls `projectExpressionText`, and the
exact binding test passes with zero blockers for `state.value` while rejecting
call and binary assignment roots.

[VERIFIED] The same review's concern that `let.kind` might evade validation is
also contradicted by `includedUnexpectedProperties`, which compares authored
property keys against the exact local base profile. The exact mutation passes
only when it produces a blocker. Unprojectable expression text is separately
recorded as an excluded projection by the authenticated function inspection
path before completion is evaluated.

[DECIDED] M4.26 corrects M4.25's durable evidence to cite the complete
six-identity review and the verified resolution. Non-material cleanup requests
remain outside this representation-only slice.

## RED Plan

[DECIDED] Extend `assertStructuredParameterMigrations` first to require the
five new target signatures, nine ordered direct parameter children, exact
post-migration line counts, no `fn.params` blocker, and the frozen profile-row
shapes. On unchanged M4.25 source, the assertion must fail for the intended
source-shape boundary.

[DECIDED] Update coverage/prerequisite terminal pins to require 32/104, 70
legacy blockers, an empty base-only parameter partition, and the remeasured
unary prerequisite. Before source and receipt regeneration, those assertions
must fail against M4.25 facts.

## Implementation Plan

1. Add RED exact-source and live-receipt assertions for the frozen cohort.
2. Rewrite only the five target function signatures and nine ordered rows.
3. Regenerate capstone checker fixtures and canonicalizer composition using
   repository writers; prove unrelated generated inputs remain unchanged.
4. Update exactly three corpus digests and regenerate authenticated coverage
   and prerequisite receipts from the live tree.
5. Pin measured facts across coverage, prerequisite, handoff, terminal check,
   this spec, and the release train.
6. Run focused checker/validator/canonicalizer gates and the complete Node 22
   KERN 5 fitness wall, then automatic high-risk role-lens review.
7. Resolve every verified material finding, commit with Agon identity, fetch
   and rebase onto `origin/main`, atomically push the fresh feature ref and
   explicitly authorized `main` once with `--no-verify`, verify both refs, and
   start M4.27 from fresh `origin/main`.

## File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared M4.26 contract and evidence |
| M4.25 spec | correct evidence | cite complete six-identity terminal review |
| expression helper KERN | modify | three signatures / six rows |
| statement helper KERN | modify | one signature / one row |
| validator KERN | modify | one signature / two rows |
| capstone checker `main.kern` | regenerate | embeds changed validator structure |
| canonicalizer composite/record | regenerate | exact changed helper bytes |
| parameter migration assertions | modify | RED source/profile boundary |
| coverage policy | modify | exactly three corpus member digests |
| coverage/prerequisite summaries | regenerate | authenticated post-migration facts |
| coverage/prerequisite/handoff tests | modify | exact M4.26 live boundary |
| terminal coverage check | modify | release-fact pins and status |
| release train | modify | durable M4.26 evidence and M4.25 correction |

## Acceptance Criteria

- [x] Fresh M4.26 branch starts at published M4.25 `origin/main` commit
      `f56cb91e0bce3aa328b6020809d18312fdc6dc36`.
- [x] Exact five-function/nine-row source and receipt input is grounded.
- [x] RED fails on unchanged M4.25 for the intended target-signature boundary.
- [x] Exactly five target functions lose `fn.params` and gain nine ordered
      direct `param` children; no target body or call site changes.
- [x] Expression helpers become 174 lines, statement helpers 146 lines, and
      validator 481 lines, all below the 500-line handwritten ceiling.
- [x] Exactly three handwritten corpus digests change; all other corpus and
      immutable provenance digests remain exact.
- [x] Repository writers regenerate the checker consumer and canonicalizer
      composition; numeric checker and canonicalizer main bytes remain exact.
- [x] Each migrated function reproduces its frozen counterfactual profile row
      counts exactly.
- [x] Live coverage is exactly 32/104 with 70 `fn.params` blockers, a null
      ordinary winner, and an empty base-only parameter-ready partition.
- [x] Live prerequisite selection is regenerated honestly and keeps migrated
      functions disjoint from residual witnesses.
- [x] Focused checker, validator, and canonicalizer gates pass; the complete
      Node 22 KERN 5 fitness wall passes on the final implementation tree.
- [x] Full usable-roster high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the feature ref and explicitly authorized `main`; both remote hashes are
      verified.

## Current Implementation Evidence

[VERIFIED] The new source-shape assertion rejects the published M4.25 source at
the exact expression-helper boundary, 168 lines instead of 174. After the
migration, all five targets have only ordered direct `param` children and
reproduce the frozen 9/17/71 or 7/14/42 counterfactual rows.

[VERIFIED] The changed handwritten SHA-256 values are
`3b5c6affbb2232c5bd0cfcf2d73fdb2141b22ca50e074ff750f926798620d417`
for expression helpers,
`cc4e9aaafc55269e1278d354776c67924737d32e1824413708cb01a6ac2f4f62`
for statement helpers, and
`95ba4b55a80f939f3e04bc9b53dd244c5100e19e9e4c0d40d577bf5ec4f4cbe4`
for validator. The other six handwritten corpus members remain exact.

[VERIFIED] The regenerated canonicalizer composition is 39,430 bytes at
SHA-256 `5337c271465e710261901af18fe55d19a6e69a62f976d0d0fe44df209c4a2974`.
Its unchanged main member remains
`c7bfb896a4905fe8ebfde0dabf821ac0e35da881f30a8d117b31aa90dea03b14`.
The regenerated checker consumer is
`da8363aefa44519a42c3c7e9bcaed6029d7e18db664831b8cd9a28d4048c9ff6`;
the numeric checker remains
`4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`.

[VERIFIED] Policy, coverage-summary, and prerequisite-summary SHA-256 values
are `9a1175b209c38ee0a56ef2da8ee114170e87455e6a0ccd79a3f838dd8558e653`,
`d1b8de698fb76227e586fd3e101895f0a0cd1c5c204fc0edb79a838fef2a2fbf`,
and `df2316b3ec0d1fa169640bea723483574332ef43174341471537065bcceb5e12`.
The authenticated corpus, implementation, and function-facts digests are
`a99e6773a47023bb6b833f6dd34b1d9c475888be99924dac07f13b2c1ba58e7c`,
`78a8dab24fac8116735e1582db3363bf40da06cc90d786f887b0ff27caf075bb`,
and `68a20ac32504a4c079e778b75dd613a224a1d03113ba31db41bd3c2a880d127f`.
Profile digest
`366123a03fa2d444347f740b77a53e0a8b1b9de668fd681c5167ce1365c97dd7`
is unchanged.

[VERIFIED] Live measurement is exactly 32/104 base-complete with 70
`fn.params` blockers, a null ordinary winner, and zero functions/rows in the
base-only migration queue. Unary expression remains the one-family next
prerequisite at 48 occurrences; `numberat` remains its single two-row witness.
The focused coverage/prerequisite/handoff set passes 33/33 plus the exact
terminal coverage check.

[VERIFIED] The complete focused execution gate passes checker parity 48/48
with 36 hostile attempts rejected, validator parity 39/39, all 88
structural/authentication/profile tests, 40 golden/KIR/idempotence fixtures,
eight measured witnesses, three profile-limit fixtures, 202 hostile fixtures,
and the exact final 32/104 coverage check.

[VERIFIED] Review-discovered partition coverage now directly proves a
base-complete counterfactual enters `parameterReady` while a blocked
counterfactual enters `residual`; the test fails if the partitioner silently
classifies every fact as residual.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes on the final
implementation tree, including every workspace and release-policy gate,
432/432 cross-target fixtures, 109/109 class fixtures, 233/233 native fixtures
at 100% coverage, 40 whole-app fixtures across three legs, runner/browser
budgets, checker, validator, KIR, runtime, ownership, and convergence
contracts, and the repeated final canonicalizer gate.

[VERIFIED] Automatic high-risk role-lens review
`review-1784634663411-o7v3xc` routed all six usable non-excluded identities
with verified primary implementer `codex`, no exclusions, and no routing
shortfall; all six returned and none reported a blocker. The claimed 34/34
focused and 89/89 canonicalizer count reflected an out-of-scope test injected
by an earlier auxiliary review process. Removing that review contamination and
regenerating its stale receipts restored authenticated implementation digest
`8a22fa8e68c94910f16382cf761965b8331279d44b87e0a0219948fca963770c`;
the final focused gate then passed 33/33 with the terminal check green. The
remaining findings concern future assertion-table refactoring, a vacuous
intermediate optional-chain assertion already followed by a non-vacuous deep
equality, and the explicitly authorized push convention; none changes this
frozen slice.

## Stop Conditions

- A frozen target requires a semantic body/call change rather than only a
  parameter representation change.
- Any non-target handwritten source changes.
- Any parser, KIR schema, runtime, ABI, base profile, active family, or
  historical provenance change is required.
- The five migrated functions do not reproduce frozen profile rows or do not
  become base-complete.
- Parameter-ready and residual partitions overlap or fail to cover the
  remeasured prerequisite facts.
- A generated artifact cannot be reproduced by its repository writer.

## Out of Scope

- Migrating `numberat` or any function outside the frozen five-function set.
- Implementing or promoting unary, do, exception, or while capability.
- Refactoring coverage property-key ownership, mutation-table generation,
  test imports, allocation patterns, or traversal performance.
- KIR v1 freeze, public reader export, runtime cutover, or a KERN 5 completion
  claim.

## Open Questions

None. Generated hashes and exact post-migration occurrence totals are outputs,
not unresolved design choices.
