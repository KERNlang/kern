# KIR Preview Canonicalizer Inventory Closure

**Status:** READY TO BUILD
**Date:** 2026-08-25
**Confidence:** 0.95

## Executive Summary

PR #554 adds four emitted JavaScript modules for the packaged frontend projection. The current compiled-core digest correctly includes them, but historical canonicalizer reconstruction still passes the 322-path current inventory directly to the frozen 318-path runner-call-cache transition. The repair must project only the four authenticated post-transition paths away before applying the unchanged historical transition, while preserving fail-closed rejection for all other inventory drift.

## Current State / Root Cause

- **VERIFIED:** `packages/core/dist` contains 322 JavaScript paths with inventory digest `7acc8276003ea732f7ae3e18d4feddb235d6726a4277828e704599ea35e1cefa`; the four new paths are `frontend-projection.js`, `frontend-projection/assets.js`, `frontend-projection/contracts.js`, and `frontend-projection/integrity.js` (Node inventory probe, 2026-08-25).
- **VERIFIED:** the frozen runner-call-cache successor contract requires exactly 318 paths and digest `601fce8b504c09757523253d616fbaf118b1b17064d7b1ae9f91d3395fa32d93` (`scripts/kern-canonicalizer/runner-call-cache-historical-transition.mjs:49`).
- **VERIFIED:** `m4145CompiledCoreJavaScriptPaths` supplies the unprojected current inventory to `reconstructRunnerCallCacheCompiledCoreJavaScriptPaths` (`scripts/kern-canonicalizer/coverage-dependencies.mjs:425`, `scripts/kern-canonicalizer/coverage-dependencies.mjs:442`).
- **VERIFIED:** 101 canonicalizer tests fail at the same authenticated-successor rejection after the projection build adds these outputs (`pnpm test:kern-canonicalizer`, 2026-08-25: 850 tests, 749 pass, 101 fail).

## What Already Works

- The current compiled-core digest intentionally hashes every emitted JavaScript file and remains unchanged (`scripts/kern-canonicalizer/coverage-dependencies.mjs:871`).
- The frozen runner-call-cache transition validates its historical 318-to-317 edge and must not be rewritten (`scripts/kern-canonicalizer/coverage-dependencies.mjs:230`).
- Canonical path validation already rejects duplicates, escapes, non-JavaScript paths, and malformed inventories (`scripts/kern-canonicalizer/coverage-dependencies.mjs:134`).

## Contract (Verified)

> Verified against canonicalizer source and compiled inventory on 2026-08-25.

| Behavior | Evidence | Tag |
|---|---|---|
| Current coverage includes all 322 emitted modules | `digestCompiledCoreJavaScript`, `coverage-dependencies.mjs:871` | VERIFIED |
| Historical runner reconstruction consumes the exact frozen 318-path successor | `reconstructRunnerCallCacheCompiledCoreJavaScriptPaths`, `coverage-dependencies.mjs:230` | VERIFIED |
| The four projection outputs postdate the runner transition | `git merge-base --is-ancestor 6f92fe7a c33c3f53` returned 0 | VERIFIED |
| Direct callers share the reconstruction helper | `rg reconstructRunnerCallCacheCompiledCoreJavaScriptPaths scripts/kern-canonicalizer` returned 15 test/source clients | VERIFIED |

## Implementation Options

### A. Dedicated authenticated post-transition projection (recommended)

Publish the exact 322-to-318 path transition in its own immutable evidence module, validate it in the shared reconstruction helper, remove exactly those four paths, then apply the unchanged 318-to-317 runner transition. This repairs every current direct client while preserving a single fail-closed boundary and the repository's historical-transition evidence pattern.

### B. Project only in the top-level historical digest

This leaves the 14 direct test clients broken or forces each caller to duplicate chronology. Rejected because it fragments the shared contract.

### C. Rewrite the frozen runner transition to 322 paths

This falsifies the historical successor inventory by retroactively including later modules. Rejected.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/kern-canonicalizer/coverage-dependencies.mjs` | Modify | Add exact post-runner projection before frozen transition validation |
| `scripts/kern-canonicalizer/frontend-projection-historical-transition.mjs` | Add | Freeze the exact commits and 322-to-318 inventory edge |
| `scripts/kern-canonicalizer/frontend-projection-historical-transition.test.mjs` | Add | Authenticate the new edge and reject hostile inventory mutations |
| `scripts/kern-canonicalizer/runner-call-cache-historical-transition.test.mjs` | Modify | Pin 322-to-318-to-317 composition and hostile inventory cases |

## Acceptance Criteria

- [ ] The live 322-path inventory reconstructs the exact frozen 318-path runner successor, then the exact 317-path predecessor.
- [ ] Missing, extra, renamed, duplicate, escaped, or unapproved post-transition paths fail closed.
- [ ] The current compiled-core digest still includes all four projection modules.
- [ ] Focused runner-call-cache and canonicalizer coverage tests pass.
- [ ] The complete `test:kern-canonicalizer` gate passes.

## Out of Scope

- Changing any frozen historical digest or transition endpoint.
- Changing frontend-projection runtime behavior.
- Generalizing historical inventory transitions beyond this exact successor set.

## Open Questions

None.

## Deploy Order

Ship the canonicalizer projection and the four compiled-module sources in the same PR. There is no mixed-version runtime window because this contract is exercised at build/test time from one checkout.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The full canonicalizer failure might be pre-existing or a parallel-test race | It is deterministic branch-local inventory drift caused by four PR-added outputs | The PR must repair its own historical projection before release |
| An inline exact-path projection was sufficient architecture | Existing canonicalizer history records transitions in dedicated immutable modules | The repair now publishes and tests a dedicated 322-to-318 transition |
