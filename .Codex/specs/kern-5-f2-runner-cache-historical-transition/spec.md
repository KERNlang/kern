# KERN 5 F2 Runner Cache Historical Transition

**Status:** READY TO BUILD

**Date:** 2026-08-17
**Confidence:** 0.93

## Objective

Authenticate the exact compiled-core and runtime-source delta introduced by structural runner-call caching so the frozen M4.145 canonicalizer proof continues to reconstruct its original 317-file predecessor from the current 318-file build.

## Pinned Boundary

- **VERIFIED — predecessor commit:** `5e3bebd283a43e916b014d1406f025bd5bc14bb6`
- **VERIFIED — successor commit:** `60d7382a004b5112962e0cefe9087d6b234a1af0`
- **VERIFIED — added source:** `packages/core/src/ir/semantics/runner-call-cache.ts`
- **VERIFIED — added compiled path:** `ir/semantics/runner-call-cache.js`
- **VERIFIED — successor compiled inventory:** 318 paths, digest `601fce8b504c09757523253d616fbaf118b1b17064d7b1ae9f91d3395fa32d93`
- **VERIFIED — predecessor compiled inventory:** 317 paths, digest `34aa878fbfb82d4235547aed9abec7cd1d6c848f68d990ad9cba915d1def5d67`
- **VERIFIED — added source digest:** `e7422014c4b90c02065f929e6c56c0c0ff398f816ddf99fd51d71efd4887dfca`
- **VERIFIED — added compiled digest:** `55f9848f0ee4faf199eea2fdd68ce7c9400d2de6d5272c94da6236f990fbe49f`

## Claims

| Claim | Evidence | Tag |
|---|---|---|
| The new cache module is a post-M4.145 successor and must be removed before older inventory validators run. | The full KERN 5 gate rejects the 318-file live inventory at environment quarantine; removing only the added path reproduces the authenticated 317-file digest. | VERIFIED |
| Retained runtime owners changed across the pinned boundary and must reconstruct exact predecessor bytes before the frozen M4.145 digest is computed. | The successor changes `internal-effect-machine-helper-runtime.ts` and `portable-reference-evaluator.ts`; type-only owners must be classified explicitly. | VERIFIED |
| Transition data must be derived only from the two pinned commits. | Both commits now exist locally with exact source blobs; the successor build provides exact emitted bytes. | VERIFIED |
| Existing M4.145 and pre-M4.135 digests must remain unchanged. | They are frozen historical identities, not baselines to update. | VERIFIED |

## Required Design

1. Add a dedicated `runner-call-cache-historical-transition.mjs` with immutable claim, full predecessor/successor commits, exact source and compiled manifests/endpoints, inventory endpoints, retained-owner reconstructions, added-path identities, and a validator that rejects drift.
2. Derive reconstruction rows from `git show` of the pinned commits and deterministic TypeScript builds of both endpoints. Runtime code must contain no live Git/process/file-system lookup; tests may verify pinned blobs with Git.
3. In `coverage-dependencies.mjs`, validate and project the 318-file runner-cache successor to the authenticated 317-file predecessor **before** environment-quarantine validation. Do not add the new path to the late `POST_M4145_COMPILED_CORE_PATHS` filter.
4. Reconstruct changed retained compiled owners back across this new edge before applying older historical edges. Explicitly authenticate any type-only emitted identities.
5. Add focused tests for exact commits, manifests, source/compiled endpoints, 318→317 membership, additions/removals/renames/duplicates/path escapes, mutated retained bytes, mutated added-module bytes, and unchanged frozen historical digests.

## Rejected Designs

- Rebaseline any prior inventory or historical digest.
- Fabricate a commit identity for uncommitted bytes.
- Filter `runner-call-cache.js` without authenticating the full successor and predecessor inventories.
- Add the path only to `POST_M4145_COMPILED_CORE_PATHS`; that stage is after the failing validators.
- Read Git or the working tree dynamically from runtime transition data.

## Acceptance Criteria

- [ ] The dedicated transition tests pass from the successor tree.
- [ ] The live compiled-core digest remains sensitive to the new module and retained owners.
- [ ] `digestM4145CompiledCoreJavaScript()` remains `29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2`.
- [ ] `digestPreM4135CompiledCoreJavaScript()` remains `502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec`.
- [ ] The full `pnpm fitness:kern-5` gate passes without changing an older authenticated identity.
- [ ] An independent high-risk Agon review with role lenses reports no verified blocker.

## Scope Boundary

This transition only authenticates the already-committed F2 structural cache boundary. It does not change cache behavior, parser grammar, cache capacity, package publishing, tags, or deployment policy.
