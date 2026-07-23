# KERN 5 R2 M4.59 — While-Iteration Canonicalizer Implementation

**Status:** READY TO PUBLISH — FULL GATE AND REVIEW GREEN
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published `origin/main` commit
`5880cd680dd3b81084fb5a37b357d06340ea1777` contains the immutable M4.58
`while-iteration` prerequisite handoff. Its canonical record has SHA-256
`5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07`
and freezes one singleton closure: one canonicalizer function, one tool, one
counterfactual parameter row, two catalog facts, two occurrences, and exact
witness `examples/selfhost-validator/validator.kern#19:sortstrings`.

[DECIDED] Implement exact structural `while` validation and emission in the
KERN-authored canonicalizer statement member. A `while` node owns exactly one
required `cond` expression and a recursively validated statement list. It
emits one canonical `while cond=` line followed by its canonical children.
Preserve structural KIR, canonical source, byte idempotence, fail-closed
rejection, authenticated composition, the six immutable prerequisite records,
and current implementation provenance. Do not promote `while-iteration`,
migrate `sortstrings`, or change the cumulative base profile in this slice.

## Published Input

[VERIFIED] The exact M4.58 inputs are:

- commit `5880cd680dd3b81084fb5a37b357d06340ea1777`;
- while prerequisite-provenance SHA-256
  `5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07`;
- coverage-summary SHA-256
  `7646cd99678abd39d88a732a0c74ef3474ede960f7a0f1863d53496dac5aeac2`;
- prerequisite-summary SHA-256
  `9b522cef1894f8ec43db8b71489b3db951264aeb9ade2591e4e672e066a04f8d`;
- coverage-policy SHA-256
  `ca8362845bc2460dde40596674ded29ff8aab3eb4de40a28fd7789cc558937b1`;
- statement member SHA-256
  `9f572824fb6f7424fa87559b03c1c8291ad347c9c5035e7336e3760d739d2c03`;
- validator witness SHA-256
  `b8f2e779ced7577804686ac953cf555fffbc271b974bb29d64310245aa6270e2`.

[VERIFIED] The live baseline remains profile
`kern.kir-canonicalizer.profile.m4.36`, 72/104 base-complete functions, 31
legacy `fn.params` blockers, nine corpus members, four tools, and
`while-iteration` as the exact next one-family prerequisite.

## Current State and Root Cause

[VERIFIED] The family registry defines `while-iteration` as exactly node kind
`while` and property `while.cond`. The parser and structural KIR already
project the condition as an expression record, and the coverage machinery
already treats `while` as a statement container.

[VERIFIED] At the sealed M4.58 input, `validstatement` accepted return,
binding, do, conditional, and counted-iteration statements, then rejected
every other kind. `emitstatement` had no while branch. The M4.59 source now
owns both exact branches while preserving that isolated root-cause boundary.

[VERIFIED] The missing capability is isolated to statement validation and
emission. It does not require parser, structural KIR, runtime, ABI, public API,
family-registry, or selection-policy changes.

## Contract

| Behavior | Exact contract | Tag |
|---|---|---|
| node kind | exactly `while` | VERIFIED |
| properties | exactly one required `cond` property | VERIFIED |
| condition | recursively admitted structural expression via `exprsource` | DECIDED |
| children | zero or more recursively admitted statements via `validstatementlist` | DECIDED |
| emission | `prefix + "while cond=" + quotesource(condition)` followed by canonical children | DECIDED |
| malformed form | reject the whole document with no events or partial result | DECIDED |
| helper count | inline validation/emission; add no KERN function and preserve the 104-function denominator | DECIDED |
| profile | keep `kern.kir-canonicalizer.profile.m4.36` and its 72/104 base unchanged | DECIDED |
| provenance | preserve all six prerequisite records and current implementation provenance byte-for-byte | DECIDED |

## RED and Mutation Plan

[DECIDED] Register a dedicated while fixture module and a static ownership
test before production KERN edits. RED must prove sealed M4.58 lacks both KERN
while validation and emission and that the first valid while fixture is
rejected by the executable canonicalizer.

[DECIDED] Valid fixtures cover a simple loop with binding and assignment,
nested while loops, a conditional body, and an empty body. Every fixture must
preserve exact golden source, structural KIR equality, and second-pass byte
idempotence.

[DECIDED] Hostile mutations cover missing, duplicate, excluded, and future
properties; non-expression and unsupported condition payloads; unsupported
child statements; and malformed nested while conditions. Every hostile table
must reject completely.

## Implementation Plan

1. Add this claim-tagged contract, while fixtures, and missing-ownership test.
2. Capture focused static and executable RED evidence on sealed M4.58.
3. Add one exact `while` branch to `validstatement` and one to
   `emitstatement`, reusing generic child emission.
4. Regenerate composition, the changed statement-member policy digest, and
   authenticated coverage/prerequisite summaries.
5. Update exact live pins while preserving immutable M4.58 provenance and
   keeping while unpromoted.
6. Run the focused Node 22 canonicalizer gate, complete KERN 5 fitness wall,
   and automatic high-risk role-lens review before one rebased atomic publish.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared M4.59 implementation contract and evidence |
| `scripts/kern-canonicalizer/while-fixtures.mjs` | add | isolated valid and hostile while corpus |
| `scripts/kern-canonicalizer/fixtures.mjs` | modify | register while fixtures |
| `scripts/kern-canonicalizer/canonicalizer.test.mjs` | modify | exact KERN validation/emission ownership |
| statement helper member | modify | KERN-owned while validation and emission |
| composed source and composition record | regenerate | authenticate changed KERN bytes |
| coverage policy | modify | refresh only the statement-member digest |
| live coverage/prerequisite receipts and pins | regenerate/update | bind final implementation and corpus digests |
| release train | modify | record M4.59 evidence and next slice |

## Acceptance Criteria

- [x] Branch starts from exact published M4.58 `origin/main`.
- [x] Registry, parser projection, ownership gap, witness, profile, and
      provenance are grounded in current source.
- [x] RED proves M4.58 lacks KERN-owned while validation/emission.
- [x] KERN owns exact one-condition validation and recursive child validation
      and emission.
- [x] Missing, duplicate, extra, malformed, unsupported, and invalid-child
      while forms fail closed.
- [x] Valid fixtures pass exact golden output, structural KIR equality, and
      second-pass byte idempotence.
- [x] While remains unpromoted; profile, family registry, closure identity,
      implementation pointer, and all six prerequisite records stay exact.
- [x] Authenticated composition, policy corpus digest, and live summaries are
      regenerated from the final tree.
- [x] Focused Node 22 canonicalizer gate and complete KERN 5 fitness wall pass.
- [x] Automatic high-risk role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      the feature ref and explicitly authorized `main`; both refs are verified.

## Out of Scope

- While promotion, `sortstrings` migration, next-family selection, or KERN 5
  release.
- Changing parser, structural KIR, runtime ABI, evaluator, public exports,
  package versions, profile limits, family registry, or selection semantics.
- Refactoring historical provenance loaders or fixture frameworks.
- Exception, lambda, record, decimal, or conditional-expression work.

## Stop Conditions

- Published M4.58 or immutable while provenance differs from the exact input.
- Correct while emission requires a parser, KIR, runtime, ABI, or public
  contract change.
- Structural KIR cannot survive canonicalization and a second parse.
- Any prerequisite record, base profile, closure member, baseline, or current
  implementation provenance changes.
- Any focused, full-wall, or terminal-review gate fails unresolved.

## Current Evidence

[VERIFIED] RED first failed at `missing KERN-owned while validation`. The
final 182-line, 12,072-byte KERN statement member authenticates at SHA-256
`adfa0c49cee230106ba7cff2249a0306f98aefc009d7e2581a3ffc622f6e9ff7`.
Its 50,476-byte composed executable authenticates at
`94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
the composition record authenticates at
`cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995`.

[VERIFIED] Live coverage remains profile M4.36 at 72/104 base-complete with
31 legacy parameter blockers. `while-iteration` remains selected and
unpromoted at two catalog facts/two occurrences; `sortstrings` remains the
one-function, one-tool, one-row witness; and implementation provenance remains
the immutable `do-statement` record. The policy, coverage receipt, and
prerequisite receipt authenticate at
`6f7c62d5e74253a158a29c037ca8eafe56466f431fa9ec0fe21292bccc84954c`,
`3ff15ee3068b4a1d1ed273c5a33a269d45948f42c2980f3c4056c201c024a91c`,
and
`be873c3b08c4da4b16b318776c68cf1bc84d0ba638faac749f770621fca1860f`.
The immutable M4.58 record and validator witness remain byte-identical.

[VERIFIED] Focused Node 22 `pnpm test:kern-canonicalizer` passes 207/207
tests plus 55 golden/KIR/idempotence fixtures, eight measured witnesses,
three profile-limit fixtures, and 235 hostile fixtures. The complete Node
22.22 `pnpm fitness:kern-5` wall passes, including all three canonicalizer
replays, 434/434 cross-target fixtures, 109/109 class fixtures, 233/233 native
assertions at 100% declared coverage, and 40 whole-app fixtures across three
legs.

[VERIFIED] Mandatory high-risk role-lens review
`review-1784788924213-73zblw` completed with all 6/6 usable reviewers, zero
verified findings, six needs-check observations, and four nits. The security,
correctness, performance, and one overall lens reported no findings. The
needs-check observations were resolved against the actual contracts:
`composition.mjs` derives all byte lengths and hashes, atomically writes the
composite and record, and rejects any checked-in drift; repeated historical
digest pins are intentional immutable milestone contracts; the source-section
assertion follows the existing ownership-test pattern; and the fixture-array
mutation is behavior-pinned and does not affect product code. The remaining
fixture-helper and test-structure suggestions are non-blocking maintenance
debt outside this exact capability slice. Publication remains pending.
