# KERN 5 F2 Structural Helper Cache Keys

**Status:** IMPLEMENTED / CURRENT-GATED F2 PREREQUISITE — ACCEPTANCE REVIEW PENDING
**Date:** 2026-08-17
**Confidence:** 0.92

**Implementation status:** The shared `runner-call-cache` owner is present in
the current candidate. The unchecked acceptance list remains open until its
claim-level evidence and independent review are reconciled; this status does
not change cache capacity or promote any terminal frontend gate.

## Executive Summary

KERN runner helper memoization is required for resumable packrat evaluation, but its flat JSON cache keys repeatedly copy large immutable string arguments. Replace the two evaluator-specific flat-key implementations with one cache-coupled nested-map implementation: top-level strings are collision-free `Map` path segments, while non-string arguments and provenance retain the current JSON terminal encoding. The existing 1,024-entry FIFO remains the sole capacity policy.

## Current State / Root Cause

- **VERIFIED:** `f2readitem(tape, cursor)` flat keys allocate 25,987,427 characters at unary depth 512 and 104,619,676 at depth 1024; the deterministic scaling test reproduces the 4.03x growth (`scripts/kern-frontend-f2-expression/scaling.test.mjs`, RED run on 2026-08-17).
- **VERIFIED:** memoization cannot be removed: grouped arithmetic succeeds with 42 prepares, 30 executes, and 72 lookups, while an uncached diagnostic run performs 99,974 reads and exhausts a 100,000-step budget (`executeInternalRuntimeSourceHandlerSync` comparison on 2026-08-17).
- **VERIFIED:** flat keys are independently implemented with `JSON.stringify` in the effect machine and compatibility evaluator (`packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts:40-45`; `packages/core/src/ir/semantics/portable-reference-evaluator.ts:78-90`).

## What Already Works

- Existing value equality, integer provenance, module/function separation, FIFO capacity, helper suspension, and cached return validation remain authoritative.
- Arrays and records retain current terminal JSON encoding, including safe misses after mutation.
- F2 grammar, tape format, source hashes, work charging, and helper declarations do not change.

## Contract (Verified)

> Verified against current sources and the failed opt-out experiment on 2026-08-17.

| Behavior | Evidence | Tag |
|---|---|---|
| Equal top-level strings must share a cache path by content | JavaScript `Map<string, ...>` uses string value equality; current JSON keys also use content | VERIFIED |
| Different tapes at the same cursor must not cross-hit | tape string is an outer path segment before the cursor terminal | VERIFIED |
| Top-level string contents must not be serialized into each terminal | the new terminal replaces each outer string with a typed positional marker | VERIFIED |
| Arrays/records keep structural JSON behavior | only top-level strings are promoted; all other values remain in the terminal serializer | VERIFIED |
| Total cached returns remain bounded | terminal entry objects are stored in the existing cache `Map` and count toward its existing 1,024 limit | VERIFIED |
| Eviction must not leave reachable zombie entries | eviction removes the leaf and prunes empty parent branches before releasing the entry | VERIFIED |

## Implementation Options

### A. Independent string-ID interner

Rejected: independent eviction can strand live cache entries behind retired IDs and create miss storms.

### B. Parser-local reader state

Rejected: larger authenticated-source change that does not repair the generic cache-key defect.

### C. Source-declared ignored key fields

Rejected: omitting a value is unsound when a helper sees more than one value for that parameter.

### D. Cache-coupled nested maps (selected)

Use raw immutable strings as outer `Map` keys and a typed JSON terminal for the remaining value/provenance tuple. Cache entries own their pruning path, so FIFO eviction removes the entire unreachable leaf without IDs, hashing, thresholds, or background sweeps.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/runner-call-cache.ts` | add shared prepare/lookup/remember implementation | single cache-key authority |
| `packages/core/src/ir/semantics/semantic-env-ownership.ts` | admit opaque object keys in the internal cache map | structural entry tokens |
| `packages/core/src/ir/semantics/internal-effect-machine-types.ts` | align per-helper cache type | effect-machine consumer |
| `packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts` | use shared structural cache API | remove flat serialization |
| `packages/core/src/ir/semantics/portable-reference-evaluator.ts` | use shared structural cache API | compatibility parity |
| `packages/core/tests/runtime-envelope-helper-cache.test.ts` | collision, equality, eviction, mutation, and evaluator tests | shared-contract proof |
| `scripts/kern-frontend-f2-expression/scaling.test.mjs` | retain RED/GREEN byte-work and resumability oracles | F2 promotion proof |
| `scripts/runtime-contract-v1/machine-owner-allowlist.json` | admit the new shared module into the exact source/built runtime graph | frozen closure binding |
| `scripts/runtime-contract-v1/graph.test.mjs` | prove the shared module is reachable and cannot disappear from either graph | closure mutation proof |
| `scripts/source-runner-module-ownership-convergence.mjs` | bind helper state to opaque cache-entry keys | convergence authority |

## Acceptance Criteria

- [ ] Grouped arithmetic succeeds under a 100,000-step budget with 42 prepares, 30 executes, and 72 lookups.
- [ ] Equal strings from distinct allocations hit; distinct tapes at the same cursor do not cross-hit.
- [ ] FIFO eviction removes the oldest terminal and prunes empty branches; reinsertion is a safe miss with no zombie capacity loss.
- [ ] Post-call array/record mutation remains a safe structural miss.
- [ ] Integer provenance and compatibility module/function namespaces remain key-separated.
- [ ] Unary depths 512, 1024, and 2048 parse to `depth + 1` nodes; serialized terminal-key work grows within `2.5x + 4096` per doubling and no tape content is copied into each terminal.
- [ ] Both evaluators return byte-identical values/diagnostics/effects across focused cache fixtures and the full F2 32-test gate passes.
- [ ] Every touched hand-written source file remains below 500 lines.
- [ ] Source and built runtime-contract graphs include the shared cache as an exact reachable machine owner and reject its deletion.

## Out of Scope

- Cache size, eviction policy, parser grammar, F2 wire format, source declarations, adaptive heuristics, hashes, or lossy projections.
- Package publication, tags, or deployment outside the authorized git push.

## Open Questions

None. The selected path has no ASSUMED or OPEN oracle dependency.

## Deploy Order

The shared cache module, both evaluator consumers, tests, and F2 evidence ship atomically from one tree. Cache keys are execution-private and never enter persisted receipts, so there is no external version-skew contract.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| `f2item` cache thrash caused the cliff. | Removing it did not improve the depth-1024 runtime. | Rejected call-site inlining. |
| `f2readitem` had no useful hits and could be non-memoized. | Grouped expressions require repeated hits for frame resumption; opt-out failed 13/32 F2 tests. | Reverted the opt-out contract. |
| A bounded independent string interner was sufficient. | Its lifetime can diverge from cached entry lifetime, causing zombies and miss storms. | Selected cache-coupled nested maps with coordinated pruning. |
