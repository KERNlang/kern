# KERN 5 R2 M4.126 — Four-Function Projection Analysis

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-07-29
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.125 commit
`9b5a5dc7c64a257356c412b6e1d98d85404d538b` freezes the exact current
103/112 canonicalizer frontier: four legacy-parameter functions, no
profile-row evidence, and no actionable profile widening.

[VERIFIED] The immutable M4.125 input contains `quotesource`,
`expressionsources`, `canonicalize`, and `validate`, with reason-assignment
digest `d56df2cc197c26f4c6f302c32e6447828e1e7359ba6f525f82bda5b6e2b5c481`.

[VERIFIED] Structural projection exposes exact requirements for `quotesource`
and `validate`, while `expressionsources` and `canonicalize` remain unsupported
on `unknown-expression-kind`. `quotesource` projects at depth 93 but stays
non-actionable because its canonical text-character blockers are independent
of KIR limits.

[VERIFIED] `validate` is the only actionable combined witness. It requires KIR
limits 273051 bytes / depth 98 / 5313 nodes plus profile limits 202 node rows /
308 property rows / 4493 value rows. The candidate migrates 41 parameter rows
with total delta 14422.

[DECIDED] M4.126 publishes only projection/canonical-surface evidence. It does
not promote KIR limits, alter runtime or profile policy, change source
semantics, or migrate parameters. If an actionable KIR candidate exists, the
next milestone owns structural/runtime headroom authentication.

## Contract

| Behavior | Tag |
|---|---|
| Bind exact M4.125 receipt digest and assignment digest | DECIDED |
| Reproduce exactly four live residual function identities | DECIDED |
| Probe existing KIR axes `maxBytes`, `maxDepth`, and `maxNodes` | DECIDED |
| Compute exact minimum passing limits for projectable roots | DECIDED |
| Preserve unsupported projection codes verbatim | DECIDED |
| Retain canonical-surface blockers outside KIR limit removal | DECIDED |
| Rank only candidates that complete at least one residual function | DECIDED |
| Keep KIR, runtime, profile, ABI, corpus, and source policy unchanged | DECIDED |
| Select the exact six-axis `validate` candidate | VERIFIED |

## Implementation

1. Add a RED M4.126 test importing the absent projection-analysis owner.
2. Load the exact M4.125 residual receipt and authenticate the current live
   residual identities and structural KIR baseline.
3. Migrate each legacy signature in memory, probe doubled structural limits,
   and binary-search exact per-axis minima for projectable functions.
4. Re-run prerequisite completion at each observed setting while removing only
   `projection.*` exclusions; keep all canonical-surface exclusions active.
5. Freeze exact requirements, unsupported codes, ranked candidates, and the
   selected action in canonical JSON with hostile mutation and fresh-process
   tests.
6. Add isolated M4.126 status and central assertion owners, integrate the
   canonical coverage gate, converge generated summaries twice, run full
   fitness and high-risk review, then fetch/rebase and push once.

## Acceptance Criteria

- [x] RED proves the M4.126 owner is absent before implementation.
- [x] Receipt binds exact M4.125 digest `eb2b0750…652`.
- [x] Live residual ids exactly match all four M4.125 assignments.
- [x] Current structural KIR baseline remains exact.
- [x] Every function records either exact minimum KIR limits or one unsupported
      projection code.
- [x] Candidate completion removes only projection exclusions.
- [x] Canonical-surface text-character blockers remain active.
- [x] Selected action is deterministically ranked from measured facts.
- [x] Receipt validation rejects mutation, decoration, sharing, cycles,
      symlinks, and noncanonical bytes.
- [x] M4.125 and all earlier published evidence remain immutable.
- [x] No KIR/runtime/profile/ABI/corpus/source semantic policy changes.
- [x] Derived summaries converge byte-identically.
- [x] Focused, canonicalizer, and full KERN 5 gates pass.
- [x] High-risk automatic role-lens review has no unresolved material finding.
- [x] Signed commit is fetched/rebased before one push and remote main verifies.

## Stop Conditions

- M4.125 digest, assignment digest, live residual identities, or structural KIR
  baseline differs from the published contract.
- A minimum limit does not fail exactly one unit below with its expected code.
- Candidate completion requires deleting a non-`projection.*` exclusion.
- Publishing evidence requires a policy, runtime, ABI, corpus, or source change.

## Out of Scope

- KIR headroom measurement or promotion.
- Canonical text-character or unknown-expression-kind implementation.
- Parameter migration or runtime optimization.
- KIR v1 freeze, runtime cutover, RC/stable release, Fable, or KERN 5
  completion.
