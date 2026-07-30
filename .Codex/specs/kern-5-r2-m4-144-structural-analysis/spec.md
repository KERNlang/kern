# KERN 5 R2 M4.144 — Residual Structural Projection Analysis

**Status:** IMPLEMENTED — READY TO SHIP
**Date:** 2026-07-30
**Base commit:** `e3cc1d133ef90c4e802d8df5318935e3c826398b`
**Confidence:** 0.96

## Executive Summary

[VERIFIED] M4.143 leaves exactly two legacy-parameter functions at 110/112
coverage. `quotesource` has a complete 54/82/932 projection and six exact
canonical text-character blockers. `expressionsources` has six parameter rows
but cannot project at the current structural KIR limits because it exceeds
`maxNodes`.

[VERIFIED] An exact current-source probe finds that the migrated
`expressionsources` root projects at minimum structural KIR limits
`maxBytes=367368`, `maxDepth=122`, and `maxNodes=7136`, producing profile rows
`205/332/6304`. The combined KIR/profile candidate completes exactly
`expressionsources`, one tool, one function, and six parameter rows.

[DECIDED] M4.144 publishes this result as an immutable analysis receipt. It
does not change KERN source, KIR/profile/runtime limits, the cumulative coverage
base, parameter representation, runtime behavior, or ABI. M4.145 owns
structural KIR and runtime-envelope headroom for the selected candidate.

## Current State / Root Cause

- [VERIFIED] M4.143 records `quotesource` at two parameter rows and profile
  54/82/932 with six canonical-surface blockers
  (`scripts/kern-canonicalizer/coverage-residual-analysis-m4-143.json:3-20`).
- [VERIFIED] M4.143 records `expressionsources` at six parameter rows with
  `profileRows: null` and only `projection.limit-nodes`
  (`scripts/kern-canonicalizer/coverage-residual-analysis-m4-143.json:21-29`).
- [VERIFIED] Current KIR limits are 273051 bytes, depth 98, and 5313 nodes;
  current profile limits are 202/308/4493
  (`scripts/kern-canonicalizer/policy.json:6-16,26-30`).
- [VERIFIED] The repository's established projection-analysis algorithm
  doubles the bounded probe ceiling, binary-searches each independent exact
  limit, proves rejection at `minimum - 1`, derives profile requirements, and
  evaluates completion against the cumulative base
  (`scripts/kern-canonicalizer/projection-analysis-m4-133.mjs:121-164,208-342`).
- [VERIFIED] Current-source probe command:
  `node --input-type=module -e <M4.144 bounded projection probe>` on
  `e3cc1d13` returned exact minima 367368/122/7136, rejection codes
  `limit-bytes`/`limit-depth`/`limit-nodes` one below each minimum, and profile
  rows 205/332/6304. Re-evaluation with those exact KIR/profile limits completed
  only `examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources`.

The blocker is therefore not a missing expression family or a simple profile
widening. The migrated function's canonical structural KIR requires a combined
increase on all three measured KIR axes, after which its flattened canonicalizer
tables exceed all three active profile ceilings.

## What Already Works

- M4.143 authenticates the exact live semantic baseline and rejects policy,
  digest, source, decoration, symlink, and receipt drift.
- The current structural projector supports every expression shape used by
  `expressionsources`; a doubled bounded probe projects successfully.
- `quotesource` needs no KIR or profile increase and remains a separate
  canonical-surface problem.
- Existing M4.121, M4.126, and M4.133 receipts provide the bounded exact-minimum
  analysis pattern. No new public contract or runtime path is required.

## Contract

> Verified against current `origin/main` at `e3cc1d13` on 2026-07-30.

| Field / Behavior | Exact value | Evidence | Tag |
|---|---:|---|---|
| M4.143 input digest | `22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e` | `coverage-residual-analysis-m4-143.mjs:26` | VERIFIED |
| Residual functions | 2 | M4.143 receipt lines 2-30 | VERIFIED |
| Base KIR | 273051/98/5313 | `policy.json:6-16` | VERIFIED |
| Base profile | 202/308/4493 | `policy.json:26-30` | VERIFIED |
| `quotesource` requirement | projected 54/82/932; no limit changes; six blockers | M4.143 receipt + exact probe | VERIFIED |
| `expressionsources` requirement | projected 205/332/6304 | exact current-source probe | VERIFIED |
| Required KIR | 367368/122/7136 | exact minima and `minimum - 1` rejection probe | VERIFIED |
| Required profile | 205/332/6304 | current structural projection | VERIFIED |
| Selected candidate | 1 function / 1 tool / 6 parameter rows | exact completion re-evaluation | VERIFIED |
| Source, limits, runtime, ABI | unchanged | evidence-only slice boundary | DECIDED |

## Implementation Options

### A. Exact current-source projection receipt — selected

Load the immutable M4.143 handoff, authenticate current semantic inputs, migrate
the two legacy signatures only in memory, binary-search the three structural
KIR minima, derive exact profile requirements, and publish the sole completing
candidate.

This matches the established M4 analysis chain and keeps promotion/headroom
work in the next slice.

### B. Promote the candidate immediately — rejected

This would skip structural runtime-envelope headroom and conflate analysis,
policy promotion, and queue creation. Historical M4.126-M4.130 separates those
proof obligations.

### C. Rewrite `expressionsources` or `quotesource` now — rejected

Source remediation is a distinct behavioral slice and would destroy the
evidence-only boundary of M4.144.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-m4-144-structural-analysis/spec.md` | add | Frozen claim and evidence |
| `scripts/kern-canonicalizer/projection-analysis-m4-144.{mjs,json}` | add | Measurement and immutable receipt |
| `scripts/kern-canonicalizer/projection-analysis-m4-144.test.mjs` | add | Exact, mutation, minimum, and fresh-process oracles |
| `scripts/kern-canonicalizer/coverage-m4-144-central.mjs` | add | Live central reproduction |
| `scripts/kern-canonicalizer/coverage-status-m4-144.{mjs,test.mjs}` | add | Exact M4.145 handoff |
| `scripts/check-kern-canonicalizer-coverage.mjs` | update | Release-blocking receipt assertion and status |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | Bind the updated coverage implementation provenance |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | regenerate | Bind the updated prerequisite implementation provenance |

No KERN source, policy JSON, runtime, public package, generated KIR schema, or
ABI file is in scope.

## Acceptance Criteria

- [x] RED tests fail because the M4.144 owner/receipt/status do not exist.
- [x] The exact M4.143 receipt digest and input commit bind.
- [x] Live coverage remains 110/112 with exactly the same two residual ids,
      tools, parameter rows, and M4.143 reasons.
- [x] Base KIR is exactly 273051/98/5313 and base profile exactly 202/308/4493.
- [x] `quotesource` remains projected at 54/82/932 with no required KIR/profile
      changes and exactly six canonical-surface blockers.
- [x] `expressionsources` projects at exactly 205/332/6304.
- [x] Exact KIR minima are 367368/122/7136, with each `minimum - 1` rejected by
      its corresponding structural limit code.
- [x] Exact required profile limits are 205/332/6304.
- [x] Exactly one observed combined setting and one actionable candidate exist.
- [x] The candidate changes all three KIR and all three profile axes, completes
      one function and one tool, migrates six parameter rows, and has total
      delta 98002.
- [x] The sole witness is `expressionsources`; `quotesource` remains incomplete.
- [x] The selected next action is the exact candidate.
- [x] Receipt mutation, decoration, accessors, prototypes, sharing, cycles,
      symlinks, noncanonical bytes, stdin import, and symlink entry invocation
      fail closed.
- [x] M4.143 and all earlier receipts remain byte-identical.
- [x] The central checker reproduces M4.144 live.
- [x] Focused and complete canonicalizer gates pass.
- [x] The complete current KERN 5 fitness wall passes.
- [x] Agon review with `-e claude,codex,agy` has no unresolved blocker.
- [ ] Agon-signed commit is fetched/rebased before one push and remote main
      verifies.

## Out of Scope

- Changing `canonicalizer.kern`, `quotesource`, or `expressionsources`.
- Promoting KIR, profile, derived runtime, or ABI limits.
- Measuring production or promotion-budget runtime headroom.
- Creating or consuming a parameter-ready queue.
- Resolving the six `quotesource` character blockers.
- KIR v1 freeze, frontend/compiler ownership, fixed point, interpreter cutover,
  RC/stable release, or Fable.

## Deploy Order

M4.144 is additive evidence and lands alone. Until it lands, M4.143 remains the
current frontier. After it lands, M4.145 may consume only its exact selected
candidate to measure structural and runtime-envelope headroom; no version-skew
or public API window exists.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M4.143 exposed only a node-limit problem | Raising nodes alone reveals a byte limit; exact projection also needs depth 122 | M4.144 must measure a combined three-axis KIR candidate |
| The current profile might remain within 202/308/4493 | Successful projection produces 205/332/6304 | Candidate requires all three profile axes as well |
