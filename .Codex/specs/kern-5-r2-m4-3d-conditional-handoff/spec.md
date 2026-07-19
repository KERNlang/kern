# KERN 5 R2 M4.3d — Conditional Handoff Evidence

**Status:** SEALED
**Date:** 2026-07-19
**Confidence:** 0.95

## Objective

[VERIFIED] M4.3c selected `conditional` from the exact promoted binary base:
two newly complete functions, one tool, 1,115 occurrences, and witnesses
`pathAppendKey` and `failResult`.

[DECIDED] Freeze that pre-implementation selection as immutable provenance
before changing the KERN canonicalizer corpus. Extract the pure completion and
ranking engine from the 497-line coverage owner at the same boundary. This
slice changes evidence plumbing only; it adds no KERN capability.

## Source Contract

[VERIFIED] The frozen input is commit
`736e2d1237b6d154b7abbf5f853103c459627424` with:

- coverage-summary format `kern.kir-canonicalizer.coverage-summary.3`;
- coverage-summary SHA-256
  `2f201a51f1a2d580f6cf4521ebfa6f1a896851edc069bcb20562ecc2f53de8ee`;
- coverage-policy SHA-256
  `163629a32b2184f0fb27b6b58e6a95a5ccbcde846371d59d4dc0812d2a666b5c`;
- canonicalizer SHA-256
  `dab1023f45baa3161505715de7d4773f520a202992f0b69133b18939e6dd13c5`;
- 99 functions, eight handwritten corpus members, and four tools.

[VERIFIED] Existing `selectionProvenance` is the separately pinned M4.3a
binary-selection evidence used by the active base promotion. It cannot be
repurposed for the next implementation tranche.

## Exact Changes

[DECIDED] Add
`coverage-implementation-selection-provenance.json` using the existing
canonical format-1 schema. It pins the exact M4.3c source contract and
conditional winner row. The loader validates canonical bytes and a literal
SHA-256 digest independently from M4.3a provenance.

[DECIDED] Receipt and summary expose two explicit roles:

- `selectionProvenance`: M4.3a evidence authorizing binary in the active base;
- `implementationSelectionProvenance`: M4.3c evidence authorizing the next
  conditional implementation slice.

[DECIDED] Receipt and summary formats advance to format 4. Policy format,
profile id, base facts, candidate families, ranking weights, and tie-breaking
remain unchanged. Old-format consumers reject by exact version checks.

[DECIDED] Move pure function-completion and family-ranking behavior to
`coverage-selection.mjs`. `selectCanonicalizerTranche` remains the public
authentication boundary and continues to reject cloned facts and policy drift
before invoking the pure engine.

## Oracles

1. Before implementation, the handoff test failed because the second loader
   export did not exist.
2. Both provenance records must load independently with distinct pinned
   digests and exact snapshots.
3. Receipt/summary must contain both roles and format 4.
4. Live measurement remains 4/99 base-complete with the exact conditional
   winner.
5. The extracted engine must preserve ranking bytes and authenticated-wrapper
   rejection behavior.
6. The executable KERN canonicalizer remains exactly 25,892 bytes with the
   same composition and SHA-256.
7. The coverage policy remains format 2, profile M4.3c, with `conditional`
   still an active candidate.
8. Repeated summary generation is canonical and deterministic.

## Slice Boundary

[DECIDED] This prerequisite stops before editing KERN source or composition.
The dependent conditional implementation must cite the frozen M4.3c evidence,
regenerate live receipts honestly, and stop again before promoting conditional
into the cumulative base.

## Adversarial Result

[VERIFIED] Nero run `nero-1784466451452-4v97mx` reported `FLAWED`, but its
hardware-memory-map, cryptoloader, attestation, and boot assumptions do not
exist in this repository. The applicable challenge was consumer schema skew.
Repository search found only atomic internal scripts/tests consuming this
receipt, so the slice updates every consumer with exact format-4 checks and no
compatibility window.

## Acceptance

- [x] Intended RED observed before the second provenance loader existed.
- [x] M4.3a and M4.3c provenance are separately canonical and digest-pinned.
- [x] Receipt/summary distinguish both evidence roles.
- [x] Ranking output and winner are unchanged.
- [x] Executable KERN canonicalizer, policy, profile, and family facts are
      unchanged.
- [x] Coverage implementation is below 440 lines after extraction.
- [x] Focused canonicalizer gate passes.
- [x] Complete Node 22 KERN 5 fitness wall passes.
- [x] Full usable-roster Agon review has no unresolved material finding.

## Terminal Evidence

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passed from the
clean prerequisite worktree. Clean-worktree compilation regenerated the
compiled-core receipt binding from `f72c6a7f...` to `592b39f8...`; no
`packages/core` source changed, and the full clean wall authenticated the new
digest.

[VERIFIED] Full-roster review
`review-1784468516053-xupoi8` completed five of six usable engines with zero
verified or needs-check findings. Codex exhausted its account limit after
retry. The single speculative proposal—to require the historical selection to
equal every future live winner—was rejected because M4.4 must intentionally
change live canonicalizer facts while retaining this immutable input evidence.

## Out of Scope

- Implementing or promoting `if`/`else`.
- Changing public ABI, runtime ownership, parser behavior, or formatter claims.
- Adding another base promotion under coverage-policy format 2.
