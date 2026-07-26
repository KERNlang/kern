# KERN 5 R2 M4.90 — Authenticated Dual-Row Profile Promotion

**Status:** PUBLISHED
**Date:** 2026-07-26
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published M4.89 commit
`4cf3dae0cab95c0f5c894f8f2c628e6c709f2bec` reduces the exact M4.88
three-witness structural-runtime maximum from 107,594 to 27,514 iterations.
That leaves 21,638 iterations below the fixed 49,152 promotion budget and
38,022 below the unchanged 65,536 production ceiling.

[DECIDED] M4.90 promotes only the authenticated canonicalizer profile limits:
`maxNodeRows` from 38 to 74 and `maxPropertyRows` from 61 to 77.
`maxValueRows` remains 580. Runtime, KIR, parser, handler ABI, canonicalizer
source, corpus source, and generated product artifacts remain unchanged.

[DECIDED] M4.90 publishes but does not consume the combined exact parameter
migration queue:

| Witness | Tool | Parameter rows | Structural rows |
|---|---|---:|---|
| `checker.kern#18:indexRejectDetail` | checker | 24 | 41/67/404 |
| `checker.kern#23:callRejectCode` | checker | 15 | 47/64/478 |
| `canonicalizer.kern#2:exprsource` | canonicalizer | 7 | 13/23/175 |
| `validator.kern#2:isreserved` | validator | 1 | 74/77/572 |
| total | 3 tools | 47 | 4 functions |

[DECIDED] M4.91 owns migration of those 47 parameter rows. M4.90 does not
change any authored function signature or claim KERN 5 completion.

## Published Inputs

[VERIFIED] The immutable evidence chain is:

- M4.87 residual analysis selected the exact 74/77/580 candidate with three
  profile witnesses and 40 parameter rows;
- M4.88 receipt format `kern.kir-canonicalizer.dual-row-headroom.4`, SHA-256
  `285b42785be8f651d323444ddd3464381b337b74557bbd07e8c3f4bad02a89bb`,
  rejected promotion because its exact 107,594 floor exceeded both ceilings;
- M4.89 receipt format `kern.kir-canonicalizer.runtime-cost-reduction.2`,
  SHA-256
  `c41cfbb3d7fb6f9d5f32f2d59f58e6e8d5ce7a65f77040316c7497c8cd89f86c`,
  authenticates optimized exact floors 24,273, 23,104, and 27,514; and
- M4.89 exposes `exprsource` as an independent active-profile parameter
  witness with 7 rows and profile 13/23/175.

## Promotion Contract

[DECIDED] The active profile after M4.90 is exactly:

```json
{
  "maxNodeRows": 74,
  "maxPropertyRows": 77,
  "maxValueRows": 580
}
```

[DECIDED] The promotion assertion must bind all of the following:

1. M4.89 candidate profile equals the new active profile exactly.
2. M4.89 disposition is `headroom-authenticated` with next milestone M4.90.
3. M4.89 maximum floor is 27,514 and promotion headroom is 21,638.
4. Runtime `maxCollectionLength` remains 65,536 and KIR `maxDepth` remains 64.
5. Authored corpus remains 106 functions with 22 legacy `fn.params` blockers.
6. Base-complete count remains 84 until M4.91 consumes the published queue.
7. The parameter queue is exactly 4 functions, 3 tools, and 47 rows.
8. Bounded exhaustion remains, with exactly 18 residual legacy-parameter
   functions outside the published queue.

[DECIDED] Profile-limit fixtures move mechanically to one row above each
active limit: node 75, property 78, and value 581. Each counterfactual fixture
must remain admitted only when its corresponding limit is raised by one.

## Evidence and Drift Boundaries

[DECIDED] M4.90 must preserve exact bytes for the M4.87, M4.88, and M4.89
receipts. The new promotion module authenticates those receipts before
accepting policy movement.

[DECIDED] Generated coverage and prerequisite summaries may change because
policy and measured frontier facts change. They must be regenerated only after
all source modules settle and must reproduce byte-identically in a fresh
process.

[DECIDED] The existing M4.87 regeneration path remains archival and must reject
the new promoted frontier without rewriting historical evidence.

## Implementation Plan

1. Add RED M4.90 tests for the missing promotion module, exact policy, exact
   combined queue, M4.89 evidence binding, and immutable receipt bytes.
2. Add `coverage-m4-90-dual-row-promotion.mjs` with cloned active-profile and
   parameter-migration exports plus a complete promotion assertion.
3. Move only `policy.json` profile limits and the three limit fixtures.
4. Rebind `coverage-current`, prerequisite snapshots, status output, and the
   terminal coverage checker to M4.90.
5. Regenerate summaries; run focused tests, complete canonicalizer gates, the
   full Node 22 KERN 5 fitness wall, and six-engine high-risk role review.
6. Create one Agon-signed commit, fetch and rebase on `origin/main`, then
   atomically push the feature branch and main once with `--no-verify`.

## Acceptance Criteria

- [x] Branch starts at exact published M4.89 commit `4cf3dae0`.
- [x] RED fails at the missing M4.90 promotion boundary.
- [x] Only node/property profile limits move to 74/77; value remains 580.
- [x] Runtime, KIR, ABI, canonicalizer source, and corpus source remain exact.
- [x] M4.89 exact receipt and optimized floors remain immutable.
- [x] Combined queue is exactly 4 functions/47 rows/3 tools.
- [x] Base-complete count remains 84/106 with 22 legacy parameter blockers.
- [x] Bounded exhaustion leaves exactly 18 residual functions.
- [x] Profile-limit fixtures reject exactly 75/78/581 rows.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved material finding.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; remote
      branch and main hashes verify identically.

## Stop Conditions

- Any M4.89 optimized witness exceeds 49,152 iterations.
- The measured queue differs in identity, ordering, rows, or tool ownership.
- Promotion requires changing value rows, runtime policy, KIR limits, ABI, or
  canonicalizer/corpus source.
- M4.87, M4.88, or M4.89 historical receipt bytes drift.
- Any function signature is migrated or consumed in this slice.

## Out of Scope

- Consuming the M4.90 parameter queue.
- Raising value, runtime, collection, projection-depth, or KIR limits.
- Module-envelope admission, runtime cutover, KIR v1 freeze, RC/stable release,
  Fable work, or a KERN 5 completion claim.
