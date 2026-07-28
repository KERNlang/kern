# KERN 5 R2 M4.111 — Structural KIR and Runtime-Envelope Headroom

**Status:** VERIFIED — PUBLISH PENDING
**Date:** 2026-07-28
**Confidence:** 0.95

## Executive Summary

[VERIFIED] M4.110 selected one analysis-only candidate: raise structural KIR
`maxDepth` from 64 to 76, leaving every other KIR limit unchanged, to make
nine functions and 134 parameter rows complete across four tools
(`scripts/kern-canonicalizer/projection-analysis-m4-110.mjs:260-268`).

[DECIDED] M4.111 authenticates that exact nine-function candidate across both
boundaries that matter: byte-exact structural KIR encode/decode/source
round-trip at depth 76, and canonicalizer execution inside the unchanged
runtime envelope. It publishes a deterministic GO/NO-GO receipt but does not
change policy or migrate parameters.

[DECIDED] A GO requires every witness to succeed at or below the established
49,152-step promotion budget, with immediate-below-floor failure, public/internal
runtime parity, and byte-exact KIR round-trip. Otherwise M4.111 publishes NO-GO
and identifies runtime reduction as the next milestone.

[VERIFIED] Live measurement produced GO. The maximum exact floor is 31,028
(`emitstatement`), leaving 18,124 promotion-budget headroom and 34,508
production headroom. Receipt SHA-256 is
`0acd91174c05caa96587876209abe1e3aa8744d3d8643204d07028c3e0526be9`
(`scripts/kern-canonicalizer/kir-depth-headroom-m4-111.json`).

[VERIFIED] Targeted M4.111/status tests passed 58/58, the complete
canonicalizer suite passed 488/488, both derived summaries converged
byte-identically on the second write, and the full Node 22
`pnpm fitness:kern-5` wall passed.

[VERIFIED] High-risk automatic role-lens review used all six live usable
engines at `/Users/nicolascukas/.agon/runs/review-1785268346727-77ec5w`.
All six completed; consensus reported zero verified findings, zero speculative
findings, and no blocker.

[DECIDED] Review suggestions about repeated measurement setup and duplicated
receipt constants are non-blocking archival-tooling concerns. The published
digest rejects source or JSON drift independently, the live test reproduces
all nine exact floors, and the recorded coverage-summary hashes deliberately
identify the `d18950f5` input state rather than the post-integration summaries.

## Current State / Root Cause

[VERIFIED] The active structural KIR policy is `maxDepth: 64`, `maxNodes:
4096`, and `maxBytes: 262144`; the runtime envelope separately has
`maxDepth: 64` and `maxCollectionLength: 65536`
(`scripts/kern-canonicalizer/policy.json:6-24`).

[VERIFIED] M4.110 measured 15 residual roots and selected exact depth 76 for
nine functions / four tools / 134 rows while leaving 13 roots structurally
projectable and two unsupported (`scripts/kern-canonicalizer/projection-analysis-m4-110.mjs:242-268`).

[VERIFIED] Existing headroom measurement establishes the full hop:
structural KIR encode/decode → table flattening → internal runtime handler →
source parse → byte-exact structural KIR re-encode, with optional public ABI
parity (`scripts/kern-canonicalizer/triple-row-headroom-m4-102-measure.mjs:65-157`).

[VERIFIED] Legacy parameter migration is pure and returns a cloned function
root with direct `param` children; it does not mutate the corpus root
(`scripts/kern-canonicalizer/coverage-prerequisite.mjs:57-107`).

## What Already Works

- [VERIFIED] M4.110 freezes the exact candidate population and receipt digest;
  M4.111 consumes it rather than rediscovering or reranking witnesses.
- [VERIFIED] Structural KIR canonical encode/decode already enforces
  caller-supplied depth limits and translates host recursion overflow to
  `limit-depth` (`packages/core/src/kir-structural/canonical.ts:102-120`).
- [VERIFIED] The table adapter validates canonical scalar spelling and exact
  table shape before runtime execution
  (`scripts/kern-canonicalizer/flatten.mjs:54-176`).
- [VERIFIED] The runtime production ceiling and reserved promotion budget are
  existing policy-derived values: 65,536 and 49,152 respectively
  (`scripts/kern-canonicalizer/policy.json:18-24`).

## Contract

> Verified against current `d18950f5` source on 2026-07-28.

| Behavior | Evidence | Tag |
|---|---|---|
| Input population is the exact M4.110 selected witness list | `projection-analysis-m4-110.mjs:253-268` | VERIFIED |
| Candidate KIR changes only `maxDepth` to 76 | `projection-analysis-m4-110.mjs:260-268` | VERIFIED |
| Runtime limits remain the checked-in policy values | `policy.json:18-24` | VERIFIED |
| Each migrated root must encode and decode under candidate KIR limits | `canonical.ts:102-120` | VERIFIED |
| Each decoded root is flattened through the validated table adapter | `flatten.mjs:54-176` | VERIFIED |
| Runtime success must parse and re-encode to identical KIR bytes | `triple-row-headroom-m4-102-measure.mjs:78-97` | VERIFIED |
| Public and internal runtime envelopes must agree at the exact floor | `triple-row-headroom-m4-102-measure.mjs:133-145` | VERIFIED |

## Implementation

One real option exists: extend the established structural-headroom receipt
pattern to all nine M4.110 witnesses. Promoting policy first would erase the
evidence boundary, while measuring only projection or only runtime would leave
half of the contract unauthenticated.

1. Add a RED M4.111 test that imports an absent measurement owner.
2. Build a live harness that consumes the immutable M4.110 selection, migrates
   each exact source root, encodes/decodes at candidate depth 76, flattens the
   decoded root, and runs the unchanged canonicalizer runtime.
3. Find each exact runtime floor by binary search; require floor success and
   immediate-below-floor failure, then verify public/internal parity at the
   floor.
4. Freeze source identities, candidate limits, structural metrics, exact
   floors, headroom/deficit, round-trip, parity, and a deterministic GO/NO-GO
   decision in a canonical receipt.
5. Integrate the receipt into status and the central coverage integrity chain;
   regenerate derived summaries twice.
6. Run targeted tests, the complete canonicalizer suite, full Node 22 KERN 5
   fitness, and high-risk six-engine role-lens review before one signed,
   rebased push.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-111-structural-kir-runtime-envelope/spec.md` | add | Claim and evidence boundary |
| `scripts/kern-canonicalizer/kir-depth-headroom-m4-111-measure.mjs` | add | Live nine-witness structural/runtime measurement |
| `scripts/kern-canonicalizer/kir-depth-headroom-m4-111.{mjs,json,test.mjs}` | add | Immutable receipt owner and regression guards |
| `scripts/kern-canonicalizer/coverage-status.{mjs,test.mjs}` | modify | Publish exact M4.112 handoff |
| `scripts/check-kern-canonicalizer-coverage.mjs` | modify | Repository-wide receipt integrity |
| canonical coverage summaries | regenerate | Source-identity convergence only |

## Acceptance Criteria

- [x] RED fails because the M4.111 owner is absent.
- [x] Exact M4.110 receipt digest and nine selected witnesses are consumed.
- [x] Candidate KIR limits are exactly the active limits except `maxDepth: 76`.
- [x] Every witness encodes, decodes, flattens, canonicalizes, reparses, and
      re-encodes to byte-identical KIR at depth 76.
- [x] Every exact floor succeeds and its immediately lower budget fails.
- [x] Public and internal runtime envelopes match at each exact floor.
- [x] GO is emitted only if all nine floors are at or below 49,152; otherwise
      NO-GO carries exact production/promotion deficits.
- [x] Policy, KERN source, runtime ABI, generated tools, and cumulative
      coverage remain unchanged.
- [x] Receipt mutation, decoration, cycles, sharing, history drift, and
      fresh-process loading fail closed.
- [x] Derived summaries converge; targeted, complete canonicalizer, and full
      KERN 5 fitness gates pass.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one push and remote `main`
      verifies identically.

## Out of Scope

- Promoting `kirLimits.maxDepth` to 76.
- Changing runtime `maxDepth` or `maxCollectionLength`.
- Migrating the nine parameter signatures.
- Adding unsupported `new` expressions.
- KIR v1 freeze, runtime cutover, release candidate, stable 5.0, or Fable.

## Open Questions

None. The exact nine-witness runtime disposition is measured GO.

## Deploy Order

Publish M4.111 evidence first. A later milestone may promote depth 76 only when
this receipt says GO. Existing consumers continue using depth 64 throughout
the skew window, so this slice has no runtime compatibility window.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| A decoded `StructuralKirNode` could be passed directly back to `encodeStructuralKir` as an extra canonicality check. | The encoder accepts core IR (`type`/`props`), while decoded structural nodes use `kind`/`properties`. The established byte-exact check reparses canonicalizer source to core IR before re-encoding. | Removed the invalid redundant check and retained the production encode → decode → flatten → runtime → parse → encode path. |
