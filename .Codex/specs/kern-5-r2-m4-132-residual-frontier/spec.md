# KERN 5 R2 M4.132 — Post-M4.131 Residual Frontier

**Status:** IMPLEMENTED, VERIFIED, AND REVIEWED — PENDING PUBLICATION
**Date:** 2026-07-29
**Confidence:** 0.98

## Executive Summary

[VERIFIED] M4.131 is published on `main` at
`a92fb14e79cd40fcab8f1c071a2561149028021a` and advances current
canonicalizer coverage to 104/112 with exactly three legacy-parameter
functions.

[VERIFIED] The remaining functions are `quotesource` with two parameter rows,
`expressionsources` with six, and `canonicalize` with fifteen. The current
parameter-ready queue is empty.

[VERIFIED] Under the promoted KIR limits 273051/98/5313 and profile limits
202/308/4493, `quotesource` now projects to profile 54/82/932. It remains
incomplete only because the canonical surface excludes six exact control or
separator characters. `expressionsources` and `canonicalize` remain
unprojectable because their source expressions contain unknown expression
kinds.

[DECIDED] M4.132 publishes a current-state residual-analysis receipt. It does
not widen a limit, alter the canonicalizer, or select a migration. Because the
only available profile is already below every active limit, the exact result is
zero evaluated limit settings, zero actionable candidates, and a null selected
action.

## Inputs

- [VERIFIED] Input commit:
  `a92fb14e79cd40fcab8f1c071a2561149028021a`.
- [VERIFIED] Current cumulative base: 104/112.
- [VERIFIED] Coverage policy SHA-256:
  `254f089ec5d7c0162144aaf78114d33ed603c5cca04ae484f53111c7a83e5d9c`.
- [VERIFIED] Function-facts SHA-256:
  `7cebc6f79375a89e54648e76467e7d66b5dcc90ff7af789bbe2dfb57d6535f42`.
- [VERIFIED] Current KIR limits: 273051 bytes, depth 98, 5313 nodes.
- [VERIFIED] Current profile limits: 202 node rows, 308 property rows, 4493
  value rows.
- [VERIFIED] Current legacy-parameter blockers: three.
- [VERIFIED] Exact reason-assignment SHA-256:
  `a3383dd12d41a3beaca9bf9c0de49ddadc9333c99ca7b14162e0a01ebdb0d338`.

## Contract

| Claim | Tag |
|---|---|
| Analyze the live post-M4.131 coverage and policy | DECIDED |
| Freeze exactly three residual legacy functions | DECIDED |
| Preserve each function id, tool, parameter-row count, and reason set | DECIDED |
| Record `quotesource` profile rows as exactly 54/82/932 | DECIDED |
| Record null profile rows for the two unknown-expression functions | DECIDED |
| Evaluate no profile setting that equals the current limits | DECIDED |
| Publish zero actionable profile candidates and a null action | DECIDED |
| Preserve current coverage, KIR, profile, runtime, and source bytes | DECIDED |
| Preserve all earlier receipts byte-identically | DECIDED |
| Route M4.133 to projection and canonical-surface blocker analysis | DECIDED |

## Exact Assignments

1. `examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource`
   - Parameter rows: 2
   - Profile rows: 54/82/932
   - Reasons:
     - `if.properties.cond.expression.text.character-u007f`
     - `if.properties.cond.expression.text.character-u0080`
     - `if.properties.cond.expression.text.character-u009f`
     - `if.properties.cond.expression.text.character-u2028`
     - `if.properties.cond.expression.text.character-u2029`
     - `if.properties.cond.expression.text.character-ufeff`
2. `examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources`
   - Parameter rows: 6
   - Profile rows: null
   - Reasons:
     - `let.value:unknown-expression-kind`
     - `projection.unknown-expression-kind`
3. `examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize`
   - Parameter rows: 15
   - Profile rows: null
   - Reasons:
     - `projection.unknown-expression-kind`
     - `throw.value:unknown-expression-kind`

## Design

### Receipt owner

Add an M4.132 residual-analysis owner following the established immutable
receipt contract. The owner measures the live policy and live source, checks
the exact post-M4.131 semantic facts, derives migrated facts for the three
legacy functions, and partitions the empty ready queue from the exact residual
set.

The receipt contains canonical JSON-only data and is digest-bound, immutable,
regular-file-only, and reproducible in a fresh locale-independent process.

### Candidate enumeration

Candidate settings may be created only when an observed projected profile
requires at least one active profile limit to increase. `quotesource` is below
all three current limits, so its observed profile must not create a redundant
candidate. The other two functions have no projected profile. Therefore the
evaluated-setting count and actionable-candidate list are both empty.

### Status and handoff

The exact status states that M4.132 found no actionable profile widening across
the three-function residual frontier and directs M4.133 to investigate
projection and canonical-surface blockers. It makes no KERN 5 completion,
self-hosting, runtime-cutover, or release claim.

## Implementation Plan

1. Add RED M4.132 owner, mutation, fresh-process, central, and status tests.
2. Implement the live residual measurement and write the canonical receipt.
3. Wire the receipt and status into the central canonicalizer coverage gate.
4. Regenerate current coverage artifacts twice and prove no semantic frontier
   drift.
5. Run focused tests, the complete canonicalizer suite, full KERN 5 fitness,
   six-engine Agon review, then sign, fetch/rebase, and push once.

## Acceptance Criteria

- [x] RED tests fail before the M4.132 owner/status modules exist.
- [x] The input commit and post-M4.131 semantic digests remain exact.
- [x] The ready queue is empty and exactly three residual functions remain.
- [x] The assignments and reason digest match this specification.
- [x] `quotesource` reports exactly 54/82/932 profile rows.
- [x] The other two residual functions report null profile rows.
- [x] Exactly one residual function has available profile rows.
- [x] No changed profile setting is evaluated.
- [x] No actionable profile candidate is published.
- [x] The selected next action is null.
- [x] Receipt mutation, decoration, sharing, cycles, symlinks, and byte drift
      fail closed.
- [x] M4.125 and all M4.126-M4.131 evidence remains exact.
- [x] Complete canonicalizer and full KERN 5 fitness gates pass.
- [x] Six-engine Agon review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Local Verification Evidence

- [VERIFIED] Focused M4.132 owner, mutation, fresh-process, central, and status
  tests: 5/5 passed.
- [VERIFIED] Coverage write/no-write parity passed with 104/112 base completion,
  three residual functions, and an empty parameter-ready queue.
- [VERIFIED] Complete canonicalizer gate: 605/605 tests, 55
  golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
  fixtures, and 235 hostile fixtures passed.
- [VERIFIED] Full `fitness:kern-5` wall passed, including repo consistency,
  lint, production build, workspace tests, conformance 434/434, class
  conformance 109/109, native KERN 233/233 at 100% coverage, self-host
  validator 39/39, runtime ownership/ABI, KIR closure, and repeated
  canonicalizer gates.
- [VERIFIED] Agon review
  `review-1785349233857-qlml51-m4-132-residual-frontier` completed 6/6:
  zero verified findings, three needs-check observations, and nine nits.
  The needs-check items were verified as non-blocking milestone-local
  receipt ownership, negligible single-gate receipt authentication cost, and
  intentional fail-closed candidate derivation.

## Stop Conditions

- The live input is not commit `a92fb14e`.
- Coverage differs from 104/112 or the legacy population differs from three.
- Any residual id, parameter-row count, tool, profile, or reason differs.
- Any earlier checked-in receipt changes.
- A profile widening appears actionable.
- Implementation would require changing KERN source or active limits.

## Out of Scope

- Migrating `quotesource`, `expressionsources`, or `canonicalize`.
- Changing the canonical character or expression grammar.
- Promoting any KIR/profile/runtime limit.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable, or a KERN 5 completion claim.
