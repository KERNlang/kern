# KERN 5 R2 M4.115 — checkModule Structural Runtime Headroom

**Status:** READY TO BUILD
**Date:** 2026-07-29
**Confidence:** 0.99

## Executive Summary

[VERIFIED] M4.114 selects exactly one profile-widening candidate:
`checker.kern#24:checkModule`, 58 parameter rows, at profile limits
`122/193/2411`
(`scripts/kern-canonicalizer/coverage-residual-analysis-m4-114.json:85-132`).

[DECIDED] M4.115 authenticates the candidate's structural runtime floor and
rejects promotion. Live binary search found exact floor 176,119:
176,118 fails, 176,119 succeeds, public/internal envelopes match, and the
emitted source round-trips to identical structural KIR. The floor exceeds the
65,536 production ceiling by 110,583 and the 49,152 promotion budget by
126,967. M4.116 investigates the runtime bottleneck.

## Current State / Root Cause

[VERIFIED] The active profile remains `89/125/2100`, structural KIR depth is
76, runtime depth remains 64, and runtime collection capacity is 65,536
(`scripts/kern-canonicalizer/policy.json:6-29`).

[VERIFIED] The selected direct-parameter projection has 122 node rows,
193 property rows, 2,411 value rows, and 58 parameters
(`scripts/kern-canonicalizer/coverage-residual-analysis-m4-114.json:4-17`,
`scripts/kern-canonicalizer/coverage-residual-analysis-m4-114.json:94-113`).

[VERIFIED] The established structural runtime harness encodes and decodes the
projected function, flattens it, invokes the KERN-authored canonicalizer under
a diagnostic iteration budget, verifies public/internal parity, and
round-trips the result
(`scripts/kern-canonicalizer/triple-row-headroom-m4-102-measure.mjs:42-158`).

[VERIFIED] A live bounded binary search on 2026-07-29 produced:

```text
49152 failure
98304 failure
196608 success
...
176118 failure
176119 success
exactFloor=176119; artifactBytes=149053; parameterRows=58
productionDelta=-110583; promotionDelta=-126967
```

A separate exact-floor run returned:

```text
outcome=success; publicParityVerified=true; roundTrip=true
resultLines=122; kirDepth=76; runtimeDepth=64
```

## What Already Works

- [VERIFIED] M4.114 freezes the exact selection and rejects receipt drift,
  decoration, sharing, cycles, non-canonical bytes, and locale variance
  (`coverage-residual-analysis-m4-114.test.mjs:77-177`).
- [VERIFIED] The M4.102 headroom owner already defines the correct
  diagnostic-only rejection shape without changing runtime policy
  (`triple-row-headroom-m4-102.mjs:145-207`).
- [VERIFIED] The current KIR depth already admits `checkModule`; this slice
  requires no KIR widening.
- [VERIFIED] No KERN source, canonicalizer implementation, public runtime ABI,
  or profile/runtime policy needs to change to publish evidence.

## Contract (Verified)

> Verified against live source and runtime measurement on 2026-07-29.

| Behavior | Evidence | Tag |
|---|---|---|
| Witness is only `checkModule` | M4.114 JSON lines 85-132 | VERIFIED |
| Candidate profile is `122/193/2411` | M4.114 JSON lines 94-113 | VERIFIED |
| Parameter rows are 58 | M4.114 JSON lines 4-17 | VERIFIED |
| Artifact size is 149,053 bytes | exact-floor live probe above | VERIFIED |
| 176,118 fails and 176,119 succeeds | binary-search live probe above | VERIFIED |
| Production deficit is 110,583 | `176119 - 65536` | VERIFIED |
| Promotion deficit is 126,967 | `176119 - 49152` | VERIFIED |
| Exact output round-trips | exact-floor live probe above | VERIFIED |
| Public/internal runtime envelopes match | exact-floor live probe above | VERIFIED |
| Runtime policy is unchanged | analysis-only milestone boundary | VERIFIED |

## Implementation Option

Add a milestone-specific measurement owner and immutable receipt following the
M4.102 pattern, plus an exact central assertion and status handoff. Refactoring
historical headroom owners would broaden authenticated implementation churn
without changing this contract, so it is out of scope.

1. Add a RED test importing the absent M4.115 owner.
2. Add a side-effect-free live measurement harness for the exact M4.114
   witness and candidate profile.
3. Freeze exact/below-floor outcomes, parity, round-trip, source identities,
   deficits, and M4.114 provenance in a canonical receipt.
4. Integrate the exact rejection and M4.116 handoff into the central wall.
5. Run targeted tests, the full KERN 5 wall, and automatic high-risk
   role-lens review.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-115-runtime-headroom/spec.md` | add | Claim/evidence boundary |
| `triple-row-headroom-m4-115-measure.mjs` | add | Live bounded runtime measurement |
| `triple-row-headroom-m4-115.{mjs,json,test.mjs}` | add | Immutable evidence owner, receipt, and oracle |
| `triple-row-headroom-m4-115-check.mjs` | add | Exact central assertion without growing the wall driver |
| `coverage-status.{mjs,test.mjs}` | modify | Publish rejection and M4.116 continuation |
| `check-kern-canonicalizer-coverage.mjs` | modify | Make evidence release-blocking |
| coverage summary JSON files | regenerate | Refresh authenticated implementation digests |

## Acceptance Criteria

- [ ] RED fails because the M4.115 owner is absent.
- [ ] M4.114 receipt SHA and selected action remain exact.
- [ ] The measurement reconstructs only `checkModule` with 58 direct params
      and exact structural rows `122/193/2411`.
- [ ] Structural KIR encode/decode and flattening remain exact at depth 76.
- [ ] Budget 176,118 fails and 176,119 succeeds.
- [ ] Exact output round-trips to byte-identical structural KIR.
- [ ] Public and internal runtime envelopes match at the exact floor.
- [ ] Receipt records production deficit 110,583 and promotion deficit
      126,967.
- [ ] Promotion is rejected without changing KIR, runtime, or profile policy.
- [ ] Status hands runtime-bottleneck investigation to M4.116.
- [ ] Receipt uses canonical bytes, rejects drift/decorated/shared/cyclic
      data, and loads identically in a locale-independent process.
- [ ] Current KERN/canonicalizer sources and semantic summary facts remain
      unchanged; repository writers refresh implementation digests.
- [ ] Targeted tests, full KERN 5 wall, and automatic high-risk role review
      pass without unresolved material findings.
- [ ] One signed commit is fetched/rebased before one push and remote `main`
      verifies identically.

## Out of Scope

- Promoting profile limits to `122/193/2411`.
- Reducing or diagnosing canonicalizer runtime cost.
- Migrating `checkModule`.
- Changing KIR/runtime budgets, canonicalizer code, or any KERN source.
- KIR v1 freeze, runtime cutover, RC, stable 5.0, or Fable.

## Open Questions

None.

## Deploy Order

Publish measurement harness, frozen receipt, tests, central assertion, status,
and refreshed implementation identities in one commit. This is additive
evidence with no runtime or source-version skew. M4.116 starts from the
resulting `origin/main`.
