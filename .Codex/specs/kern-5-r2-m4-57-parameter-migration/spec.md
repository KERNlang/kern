# KERN 5 R2 M4.57 Seven-Function Parameter Migration

**Status:** IMPLEMENTED — FULL GATES AND REVIEW PASS; PENDING PUBLICATION
**Date:** 2026-07-20
**Base commit:** `8928684827706b2abac1f4906f785a389afb91c6`

## Objective

[VERIFIED] M4.56 publishes an exact seven-function, four-tool, 102-row
parameter queue after promoting only `maxNodeRows` to 25 and
`maxPropertyRows` to 50. Its canonical prerequisite receipt has SHA-256
`13a420892453e03eed314ddad2f50ceeed4fe0f01e50cc3ee1a72a253caad26b`.

[DECIDED] M4.57 consumes exactly that frozen queue by replacing each target's
legacy quoted `fn.params` property with ordered direct `param` child nodes.
It changes no function name, parameter name, parameter type, order, return
type, export flag, handler, body semantics, call site, profile limit, parser,
runtime, KIR codec, ABI, package version, or public API.

## Exact Migration Queue

| Tool | Function | Direct parameter rows | Post-migration profile |
| --- | --- | ---: | --- |
| assertion engine | `compareNode` | 13 | 24/39/373 |
| checker | `literalTrue` | 7 | 23/33/244 |
| checker | `checkerWhileRejectDetail` | 22 | 25/49/189 |
| checker | `termProvenanced` | 11 | 24/36/237 |
| checker | `whileRejectDetail` | 22 | 25/48/188 |
| canonicalizer | `emitstatementlist` | 15 | 25/50/235 |
| validator | `owncallable` | 12 | 24/42/212 |

[VERIFIED] The queue totals 102 rows and is distributed across five
handwritten KERN source files representing four tools.

## Immutable Input

[DECIDED] Before live coverage can move, M4.57 publishes the exact M4.56
`coverage-prerequisite-summary.json` bytes as
`coverage-prerequisite-m4-56.json`. A dedicated loader must:

1. require format `kern.kir-canonicalizer.prerequisite-summary.3`;
2. pin digest
   `13a420892453e03eed314ddad2f50ceeed4fe0f01e50cc3ee1a72a253caad26b`;
3. pin source commit `8928684827706b2abac1f4906f785a389afb91c6`;
4. reject non-JSON, decorated, cyclic, noncanonical, missing, and symlinked
   receipts;
5. preserve the exact ordered seven-function queue and the already measured
   `while-iteration` ranking without remeasurement.

## Source and Generated Ownership

[VERIFIED] The handwritten edits are limited to:

- `examples/capstone-assertion-engine/compare.kern`;
- `examples/capstone-checker-subset/checker-while.kern`;
- `examples/capstone-checker-subset/checker.kern`;
- `examples/kern-canonicalizer/canonicalizer-statement-helpers.kern`;
- `examples/selfhost-validator/validator.kern`.

[VERIFIED] Repository writers own the derived surfaces:

- `node scripts/capstone-checker-subset/gen-fixtures-kern.mjs` regenerates
  the checker fixture aggregate that embeds affected sources;
- `node scripts/kern-canonicalizer/composition.mjs --write` regenerates the
  canonicalizer composite and authenticated composition record;
- the canonicalizer coverage writers regenerate the live coverage and
  prerequisite receipts.

[DECIDED] Unaffected generated artifacts remain digest-pinned: the numeric
checker fixture, selfhost-validator fixture main, and assertion-engine fixture
main must stay byte-identical unless a repository writer proves otherwise.

## Behavioral Contract

[DECIDED] Each migrated target must satisfy all of the following:

- the legacy `params` property is absent and no longer quoted;
- direct `param` children are the exact ordered prefix before the handler;
- the semantic body digest is unchanged from M4.56;
- the measured fact no longer reports `fn.params`;
- profile blockers are empty at the unchanged 25/50/388 limits;
- measured parameter-node count equals the frozen queue row count.

[DECIDED] The aggregate post-migration coverage must be exactly 72/104
base-complete with 31 remaining legacy `fn.params` blockers. The consumed
parameter queue must be empty. The previously measured one-function
`while-iteration` prerequisite for validator `sortstrings` becomes the next
release action; M4.57 does not promote that family.

## Test-First Plan

1. Add the M4.57 target, immutable-handoff, mutation, generated-reproduction,
   and aggregate-coverage tests; capture RED before source conversion.
2. Publish the immutable M4.56 receipt and loader.
3. Convert exactly the seven function signatures to direct child parameters.
4. Regenerate only repository-owned derived artifacts and live receipts.
5. Pin exact post-migration file contracts and prove every frozen semantic
   body digest remains unchanged.
6. Run targeted tests, all affected capstones, canonicalizer replay, full
   Node 22 fitness, then the mandatory high-risk role-lens Agon review.

## Acceptance

- [x] RED is recorded against the unchanged M4.56 sources.
- [x] The immutable M4.56 handoff authenticates exact bytes and rejects drift.
- [x] Exactly seven functions and 102 ordered parameter rows are migrated.
- [x] All seven semantic body digests remain unchanged.
- [x] Coverage is exactly 72/104 with 31 legacy parameter blockers.
- [x] The live parameter queue is empty and `while-iteration` is next.
- [x] Generated consumers reproduce exactly from repository writers.
- [x] Targeted gates, full Node 22 fitness, and high-risk review pass.
- [ ] The signed commit is rebased before atomic publication to the feature
      ref and `main`, and both remote refs resolve to the same commit.

## Release Boundary

[DECIDED] M4.57 is a migration slice, not KERN 5 completion. The subsequent
slice must freeze this migrated frontier and independently promote or reject
the measured `while-iteration` prerequisite.
