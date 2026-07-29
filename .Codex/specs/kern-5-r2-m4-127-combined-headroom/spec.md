# KERN 5 R2 M4.127 — Combined Structural and Runtime Headroom

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-07-29
**Confidence:** 0.95

## Executive Summary

[VERIFIED] Published M4.126 commit
`03c9b1d0ac6d00bd5f53522ef138ff089822c3a6` freezes one actionable
projection candidate for
`examples/selfhost-validator/validator.kern#20:validate`.

[VERIFIED] M4.126's review hardening was published at
`04e8f943ee070b4fc0b1d2ceb063adc53ecc5f06`; M4.127 binds that exact
post-review commit as its execution baseline.

[VERIFIED] The candidate requires KIR limits 273051 bytes / depth 98 / 5313
nodes plus profile limits 202 node rows / 308 property rows / 4493 value rows.
It would migrate 41 direct parameter rows.

[DECIDED] M4.127 authenticates the combined structural boundary and measures
the exact canonicalizer runtime floor. It publishes evidence only: no KIR,
profile, runtime, source, ABI, corpus, or parameter policy changes.

[DECIDED] Promotion is approved only when the exact floor is at or below the
49152 promotion budget. A floor above 49152 but at or below the 65536
production ceiling is a promotion-budget NO-GO. A floor above 65536 is a
production-ceiling NO-GO.

## Contract

| Behavior | Tag |
|---|---|
| Bind exact M4.126 receipt digest and input commit | DECIDED |
| Reproduce exactly one `validate` witness and 41 parameter rows | DECIDED |
| Authenticate candidate KIR bytes, depth, and node limits | DECIDED |
| Prove each required KIR axis fails exactly one unit below | DECIDED |
| Reproduce exact 202/308/4493 flattened rows | DECIDED |
| Execute with candidate profile limits through the internal runtime handler | DECIDED |
| Verify exact-floor public/internal ABI parity and source roundtrip | DECIDED |
| Measure the minimum successful iteration budget | DECIDED |
| Classify GO or NO-GO against 49152 and 65536 | DECIDED |
| Keep all live policy and source semantics unchanged | DECIDED |

## Implementation

1. Add a RED test importing the absent M4.127 combined-headroom owner.
2. Build an isolated measurement harness that binds the M4.126 candidate,
   migrates `validate` in memory, authenticates the three KIR boundaries,
   flattens the structural artifact, and executes the canonicalizer with the
   candidate profile.
3. Search the exact runtime floor within a bounded diagnostic envelope; rerun
   the exact floor with public ABI parity and the immediately lower budget as
   a failure witness.
4. Freeze source identities, limits, boundary evidence, runtime disposition,
   and next milestone in canonical JSON with mutation and fresh-process tests.
5. Add isolated status and central assertion owners, wire the canonical
   coverage gate, converge derived summaries, then run full fitness and
   high-risk independent review before one rebased push.

## Acceptance Criteria

- [x] RED proves the M4.127 owner is absent before implementation.
- [x] Exact M4.126 digest and selected candidate remain immutable.
- [x] Candidate KIR encodes and roundtrips exactly.
- [x] Bytes, depth, and nodes each fail at the exact one-unit-lower boundary.
- [x] Structural rows equal 202/308/4493.
- [x] Runtime arguments use the exact candidate profile.
- [x] Exact floor succeeds and one less fails.
- [x] Exact-floor public/internal handler parity is verified.
- [x] Receipt decision matches the promotion and production budgets.
- [x] No live policy, runtime, ABI, corpus, source, or parameter change.
- [x] Derived summaries converge byte-identically.
- [x] Focused, canonicalizer, and full KERN 5 gates pass.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Review Resolution

[VERIFIED] The automatic high-risk role review routed all six usable seats and
reported zero consensus-verified findings.

[VERIFIED] The proposed summary-digest blocker was false: the authenticated
coverage digest path-frames every local `.mjs` implementation owner, so adding
the M4.127 owners must rotate it. Two byte-identical summary regenerations and
the full fitness wall reproduced the published digest.

[VERIFIED] The proposed `low === 1` edge is outside this immutable receipt:
M4.127 authenticates one exact floor of 54894 and executes both 54893 failure
and 54894 success/public-parity witnesses. No generic search utility or future
witness contract is published.

[DECIDED] Repeated per-probe preparation, live exact/below execution in the
default canonicalizer gate, and independent receipt-field assertions remain
intentional evidence-isolation costs. They prevent prepared mutable state from
crossing runtime probes and keep the archived claim independently fail-closed.

## Stop Conditions

- M4.126 receipt, selected witness, candidate limits, or input commit drifts.
- Candidate projection does not reproduce its exact KIR/profile boundaries.
- Runtime measurement cannot complete inside the bounded diagnostic envelope.
- Publishing evidence would require changing live policy or source semantics.

## Out of Scope

- KIR or profile promotion.
- `validate` parameter migration.
- Runtime-cost optimization.
- Canonical text-character or unknown-expression-kind implementation.
- KIR v1 freeze, runtime cutover, RC/stable release, Fable, or KERN 5
  completion.
