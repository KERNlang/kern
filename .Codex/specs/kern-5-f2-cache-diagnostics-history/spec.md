# KERN 5 F2 Cache Diagnostics History Re-Anchor

**Status:** IMPLEMENTED / CURRENT-GATED CANDIDATE — CUMULATIVE RECEIPT AND ACCEPTANCE REVIEW PENDING
**Date:** 2026-08-20
**Confidence:** 0.96

## Executive Summary

The F2 structural-cache scaling proof now observes two dimensionally separate cache-key costs while the historical `cacheKeyLength` receipt remains unchanged. Commit `6f92fe7a316f42bed9b74bdddff1f13bc20f08ae` is the authenticated successor of the runner-call-cache boundary. The live transition now re-anchors the unchanged predecessor `5e3bebd283a43e916b014d1406f025bd5bc14bb6` to that successor without changing frozen M4.145 or pre-M4.135 identities.

## Current State / Root Cause

- **VERIFIED:** the transition currently pins successor `6f92fe7a316f42bed9b74bdddff1f13bc20f08ae` (`scripts/kern-canonicalizer/runner-call-cache-historical-transition.mjs:4-18`).
- **VERIFIED:** its tests authenticate the exact successor Git blobs, compiled inventory, retained-owner reconstructions, added cache module, and frozen historical digests (`scripts/kern-canonicalizer/runner-call-cache-historical-transition.test.mjs:54-131`).
- **VERIFIED:** commit `6f92fe7a316f42bed9b74bdddff1f13bc20f08ae` adds two observational fields at the helper-prepare boundary without changing cache lookup or eviction (`packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts:112-123`).
- **VERIFIED:** the diagnostic union retains `cacheKeyLength` and adds terminal-code-unit and outer-string-path dimensions (`packages/core/src/ir/semantics/internal-effect-machine-diagnostics.ts:1-12`).
- **VERIFIED:** before `6f92fe7a`, `pnpm fitness:kern-5` reached F2 and failed only `hostile unary helper cache keys scale linearly`; the preceding canonicalizer archive passed 807/807 and preserved both frozen digests (command output captured 2026-08-20 in this run).

## What Already Works

The structural cache implementation, legacy observer-length compatibility, F2 parser behavior, cache hit/miss/eviction behavior, and frozen predecessor identity do not need redesign. Focused runtime tests pass 11/11, the F2 lane passes 33/33, core build passes, and lint checks 1,375 files clean on `6f92fe7a`.

## Contract (Verified)

> Verified against the current worktree and commit `6f92fe7a316f42bed9b74bdddff1f13bc20f08ae` on 2026-08-20.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| `cacheKeyLength` | `number \| null` | `internal-effect-machine-diagnostics.ts:8-9`; focused legacy/structural diagnostic test | VERIFIED |
| `cacheTerminalCodeUnits` | `number \| null` | `internal-effect-machine-diagnostics.ts:4-5`; `internal-effect-machine-helper-runtime.ts:119` | VERIFIED |
| `cacheOuterStringPathSteps` | `number \| null` | `internal-effect-machine-diagnostics.ts:6-7`; `internal-effect-machine-helper-runtime.ts:118` | VERIFIED |
| Historical predecessor | commit SHA | `runner-call-cache-historical-transition.mjs:4` | VERIFIED |
| New historical successor | commit SHA | `git rev-parse HEAD` after signed commit returned `6f92fe7a316f42bed9b74bdddff1f13bc20f08ae` | VERIFIED |

## Implementation Plan

The implemented repair regenerated the existing authenticated edge from the
unchanged predecessor and the committed successor, then updated its exact tests
and current coverage receipts. Adding a second transition only for additive
diagnostics would duplicate the same cache boundary and complicate ordering;
rebaselining frozen historical digests remains forbidden.

1. Prove the existing focused transition is RED at the new successor for exact retained-owner drift.
2. Regenerate source/compiled reconstruction rows and endpoint identities only from the two pinned commits.
3. Keep the predecessor inventory, M4.145 digest, and pre-M4.135 digest unchanged.
4. Regenerate only current coverage summaries/digests whose live compiled-core identity changed.
5. Run transition, archival canonicalizer, F2, lint/build, automatic role-lens review, and the cumulative KERN 5 wall.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `runner-call-cache-historical-transition.mjs` | regenerated exact edge | binds the committed successor |
| `runner-call-cache-historical-transition.test.mjs` | updated exact successor assertion | rejects stale or fabricated endpoints |
| current coverage receipt files | regenerated | authenticate the present compiled tree only |
| dependent transition tests | updated where endpoint propagation required it | preserve ordered historical reconstruction |

## Acceptance Criteria

- [ ] The focused transition test is RED before regeneration and green after it.
- [ ] Source rows reconstruct exact predecessor Git blobs from exact `6f92fe7a` successor blobs.
- [ ] Compiled rows reconstruct exact predecessor bytes from a deterministic successor build.
- [ ] The predecessor inventory remains 317 files with digest `34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67`.
- [ ] `digestM4145CompiledCoreJavaScript()` remains `29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`.
- [ ] `digestPreM4135CompiledCoreJavaScript()` remains `502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec`.
- [ ] F2 remains 33/33 and the full `pnpm fitness:kern-5` wall passes.
- [ ] Independent Agon review reports no verified blocker.

## Out of Scope

Changing cache identity, cache capacity, parser grammar, frozen historical baselines, package publishing, tags, or deployment policy.

## Open Questions

None. All inputs needed to regenerate the transition are committed and locally verifiable.

## Deploy Order

The diagnostics implementation and transition-data commits are both present in
the current candidate. There is no mixed-version runtime window because
transition files are build/test evidence and both commits move together.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| One combined structural-key length was sufficient. | Terminal code units and outer-string path steps have different units and must remain separate. | Agon tribunal changed the diagnostic contract and tests before source edits. |
| Each `identityText` call emits one prepare event. | Resumable replay emits three identical preparation events in the exercised path. | The test now authenticates consistency across repeats instead of uniqueness. |
| The existing cache-history spec covered the final F2 diagnostics boundary. | It explicitly stopped at the earlier cache/observer successor. | This addendum records the re-anchored committed endpoint. |
