# KERN 5 R2 M4.60 — While-Iteration Profile Promotion

**Status:** IMPLEMENTED — GATES AND REVIEW GREEN, PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published `origin/main` commit
`5e50cc91f08bd29cf51c9a12acfcff199e4fe127` contains the reviewed M4.59
while canonicalizer. The KERN-authored statement member accepts exactly one
required structural `cond` expression, recursively validates and emits the
statement list, and rejects malformed shapes without partial output. The
authenticated composed executable is 50,476 bytes at SHA-256
`94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`.

[VERIFIED] Immutable M4.58 prerequisite provenance
`5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07`
authenticates `while-iteration` as the exact singleton causal input: one
function, one tool, one counterfactual parameter row, two catalog facts, two
occurrences, and exact witness
`examples/selfhost-validator/validator.kern#19:sortstrings`.

[DECIDED] Promote only the exact while family into cumulative coverage profile
M4.60 through the immutable M4.58 prerequisite record. Remeasure base-only
parameter readiness and the residual exception-flow frontier, but do not
migrate `sortstrings` or modify any KERN source in this slice.

## Published Input

[VERIFIED] The exact M4.59 boundary is:

- commit `5e50cc91f08bd29cf51c9a12acfcff199e4fe127`;
- profile `kern.kir-canonicalizer.profile.m4.36`;
- 72/104 base-complete functions and 31 legacy `fn.params` blockers;
- policy SHA-256
  `6f7c62d5e74253a158a29c037ca8eafe56466f431fa9ec0fe21292bccc84954c`;
- coverage-summary SHA-256
  `3ff15ee3068b4a1d1ed273c5a33a269d45948f42c2980f3c4056c201c024a91c`;
- prerequisite-summary SHA-256
  `be873c3b08c4da4b16b318776c68cf1bc84d0ba638faac749f770621fca1860f`;
- coverage-base-profile SHA-256
  `50e3ed8ce98d1744163c9d6e6674e68444ab1761f3c071e5a7b3f56c27a2a8e9`;
- coverage-profile SHA-256
  `382fc8ca3efb672c72eeb0e33ead337e05d7beab08dcdf67e2e9849b3ad9f24b`;
- validator SHA-256
  `b8f2e779ced7577804686ac953cf555fffbc271b974bb29d64310245aa6270e2`.

## Current State and Root Cause

[VERIFIED] The cumulative M4.36 base does not include node kind `while`,
property identity `while.cond`, or the M4.58 provenance row. The
`while-iteration` family therefore remains active even though M4.59 proved its
executable validation, emission, hostile boundary, idempotence, and structural
KIR parity.

[VERIFIED] `coverage-profile.mjs` already treats `while` as a recursive
statement container, rejects unsupported children and invalid statement
sequencing, and projects every lowered expression through the recursive base
expression profile. Promotion therefore needs only the exact local base
contract: `while` with required `cond`, no optional properties, recursive
children, and the existing recursive expression admission.

[DECIDED] Adding only the node kind is insufficient because that would neither
require `cond` nor bind promotion to immutable evidence. M4.60 must advance the
profile identity, append the exact prerequisite citation, add the exact
node/property profile, remove while from active families, and preserve every
earlier promotion in order.

## Promotion Contract

| Behavior | Exact contract | Tag |
|---|---|---|
| policy format | remain `kern.kir-canonicalizer.coverage-policy.3` | VERIFIED |
| base identity | advance to `kern.kir-canonicalizer.profile.m4.60` | DECIDED |
| promotion row | append `while-iteration` with M4.58 digest and `prerequisite` kind | DECIDED |
| base node | append `while` in canonical node-kind order | DECIDED |
| base property | add exactly required `while.cond`; no optional properties | DECIDED |
| condition | project and complete recursively under the cumulative expression base | DECIDED |
| children | preserve recursive statement-container validation and sequencing | DECIDED |
| active families | remove while; preserve only `exception-flow` | DECIDED |
| implementation pointer | advance from do to the while prerequisite promotion | DECIDED |
| KERN executable | remain byte-identical to published M4.59 | DECIDED |
| parameter migration | remeasure only; do not edit `sortstrings` | DECIDED |
| historical evidence | preserve four selection and six prerequisite records byte-for-byte | DECIDED |

## Remeasurement Contract

[DECIDED] Preserve the format-3 prerequisite partition:

1. counterfactually migrate exact legacy parameter pairs;
2. record functions completing under the M4.60 base alone in
   `parameterMigration`;
3. exclude those witnesses from residual active-family closure ranking;
4. evaluate every non-empty closure of the remaining active family;
5. publish either a measured selection or authenticated bounded exhaustion.

[EXPECTED] The sealed M4.58 closure predicts `sortstrings` becomes the exact
one-function, one-tool, one-row base-only parameter-ready tranche. With only
`exception-flow` left active, the live measurement is expected to report
bounded exhaustion, but both outcomes are measured facts and must not be
hardcoded before regeneration.

## Current Evidence

[VERIFIED] RED failed first against sealed M4.59 on the old
`kern.kir-canonicalizer.profile.m4.36` identity and the absent local
`while.cond` enforcement. The promotion oracle then passed 12/12, and the
broader targeted promotion, handoff, prerequisite, status, and historical
migration set passed 64/64.

[VERIFIED] The implemented M4.60 policy authenticates at SHA-256
`d76a6f0acdc1b981014b192e424b150a7b802d44bd20bbdff31cd8bcafb5d76f`;
the cumulative base-profile module authenticates at
`795de7b476484a544afa837dda6a052e8442ccda72f16e7730f60eb489d0a079`.
The coverage and prerequisite receipts authenticate at
`0912893a2caf11c4132fa8c880d0835488e8254f42ea2599625133970e710836`
and `c24a3f59fab134a0845980550196f5d843c05d28986ea68a6e31642e3577dfdf`.
Their implementation digest is exactly
`122393317edb7cbd592ecad875e3d77b5cfa185a12c1f0f888bccef26b96f616`.

[VERIFIED] Live coverage is exactly 72/104 base-complete with 31 legacy
`fn.params` blockers. `while-iteration` is the tenth ordered promotion,
`exception-flow` is the only active family, and the residual family search is
authenticated bounded exhaustion: one non-empty closure evaluated, zero
completing closures, and no selected prerequisite. Base-only parameter
readiness is exactly one function, one tool, and one row: witness
`examples/selfhost-validator/validator.kern#19:sortstrings` at 25 node rows,
43 property rows, and 266 value rows. The next action is therefore the exact
`sortstrings` parameter migration.

[VERIFIED] No handwritten KERN source changed. The M4.59 composed executable
remains 50,476 bytes at SHA-256
`94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
the validator remains
`b8f2e779ced7577804686ac953cf555fffbc271b974bb29d64310245aa6270e2`.
The focused canonicalizer gate passed 210/210 Node tests, 55
golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures. The complete `pnpm fitness:kern-5` wall
then passed with terminal marker `KERN 5 current fitness wall passed.`

[VERIFIED] Automatic high-risk role-lens review
`review-1784792621566-64jcux` completed all 6/6 usable reviewers with zero
consensus-verified findings. Dedicated security, performance, and correctness
lenses returned no findings. The concrete test-oracle observations were
resolved by pinning exact while blocker identities, restoring the
parameter-ready/residual disjointness assertion, clarifying the promotion test
title, and updating live milestone labels. Because all canonicalizer `.mjs`
files are authenticated evidence, both receipts were regenerated after those
review fixes. The final targeted set passed 29/29 and the complete focused gate
again passed 210/210 plus all 55/8/3/235 fixture classes. Historical milestone
guards and current-frontier assertions remain intentionally explicit; no
unresolved material finding remains.

## RED and Mutation Plan

[DECIDED] Add a promotion-specific test before policy/profile edits. RED must
fail against sealed M4.59 at the old M4.36 profile identity and missing tenth
promotion row.

[DECIDED] Mutation coverage rejects missing, duplicated, reordered, mistyped,
or wrong-digest while provenance; reintroduced active-family overlap;
missing/extra condition properties; malformed or unsupported conditions;
unsupported children; orphan `else`; and non-terminal or duplicate returns.

[DECIDED] Tests also prove M4.59 KERN bytes, corpus members, profile limits,
family registry, every historical provenance record, and the 104-function /
four-tool denominator remain exact.

## Implementation Plan

1. Add this contract and promotion oracle; capture RED against exact M4.59.
2. Change only the cumulative policy and local base-profile definition needed
   to admit exact while.
3. Regenerate live coverage/prerequisite summaries and pin only measured M4.60
   facts while preserving immutable records and KERN bytes.
4. Run focused Node 22 canonicalizer tests, the complete KERN 5 fitness wall,
   and automatic high-risk role-lens review.
5. Commit with Agon identity, fetch/rebase immediately before one atomic
   `--no-verify` push, verify both refs, and start the next slice fresh from
   `origin/main`.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared promotion and evidence contract |
| `coverage-policy.json` | modify | M4.60 base, while promotion, family removal |
| `coverage-base-profile.mjs` | modify | exact while local base contract |
| `coverage-promotion.test.mjs` | modify | identity/provenance/overlap RED and pins |
| `coverage-while-promotion.test.mjs` | add | condition/child/sequence mutation proof |
| coverage/prerequisite/handoff tests | modify | exact live partition and pointer |
| coverage check command | modify | exact M4.60 release facts |
| coverage/prerequisite summaries | regenerate | authenticated post-promotion measurement |
| release train | modify | durable M4.60 evidence and next slice |

## Acceptance Criteria

- [x] Fresh branch starts from exact published M4.59 `origin/main`.
- [x] M4.59 executable, M4.58 provenance, M4.36 profile, and while family are
      grounded in current source and receipts.
- [x] RED fails first on sealed M4.59 profile/promotion state.
- [x] While promotion cites exact immutable M4.58 prerequisite provenance and
      becomes the implementation pointer.
- [x] Exact required condition and recursive statement-container profile is
      mutation-killed without widening M4.59.
- [x] While is removed from active families while exception remains exact.
- [x] Base-only parameter readiness and residual selection/exhaustion are
      regenerated and pinned from live authenticated facts.
- [x] KERN composition, corpus, family registry, limits, and every historical
      provenance record remain exact.
- [x] Focused Node 22 canonicalizer gate and complete KERN 5 fitness wall pass.
- [x] Automatic high-risk role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push to
      feature and explicitly authorized `main`; both refs are verified.

## Out of Scope

- Migrating `sortstrings` parameters or editing any handwritten KERN source.
- Exception-flow implementation, promotion, or handoff work.
- Parser, structural KIR, runtime, ABI, evaluator, public exports, package
  versions, profile limits, family registry, or corpus membership changes.
- Refactoring historical provenance loaders, receipt formats, or fixture
  frameworks.
- KIR v1 freeze, runtime cutover, Fable work, or KERN 5 completion claim.

## Stop Conditions

- Promotion requires changing KERN source, parser behavior, structural KIR,
  runtime, ABI, public contracts, profile limits, or family registry.
- Immutable M4.58 provenance does not authenticate the exact while family.
- The promoted profile accepts a form rejected by M4.59 or rejects an admitted
  M4.59 while form.
- `sortstrings` fails to enter the measured base-ready partition or source
  bytes change before its dedicated migration slice.
- Any historical record, focused/full wall, or terminal review gate fails
  unresolved.
