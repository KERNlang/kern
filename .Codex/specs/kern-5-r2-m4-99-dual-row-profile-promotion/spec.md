# KERN 5 R2 M4.99 — Authenticated Property/Value Profile Promotion

**Status:** REVIEWED — READY TO PUBLISH
**Date:** 2026-07-27
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.98 commit
`3f46e61659a052055ed30cd5c09bb9ceded31403` authenticates the exact
`comparisonOperandsOk` runtime floor at 46,381 retained iterations. This is
2,771 iterations below the fixed 49,152 promotion budget and 19,155 below the
unchanged 65,536 production ceiling.

[VERIFIED] M4.95 selected exactly one profile-complete witness under candidate
profile 74/95/832:
`examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk`,
with 24 parameter rows and structural rows 53/95/832.

[DECIDED] M4.99 promotes only `maxPropertyRows` from 77 to 95 and
`maxValueRows` from 580 to 832. `maxNodeRows` remains 74.

[DECIDED] M4.99 publishes, but does not consume, the exact one-function,
one-tool, 24-row parameter queue. M4.100 owns that migration.

## Published Inputs

[VERIFIED] The branch starts at exact `origin/main`
`3f46e61659a052055ed30cd5c09bb9ceded31403`.

[VERIFIED] M4.95 residual-analysis receipt SHA-256 is
`f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928`.
Its selected action changes exactly `maxPropertyRows` and `maxValueRows`.

[VERIFIED] M4.98 runtime-cost receipt SHA-256 is
`21ab630c3c937ee62d15fadfcec9faee80cf87a2d7eb6fdee7c41b3723efc201`.
It authenticates candidate profile 74/95/832, exact floor 46,381, zero
rollback, public/internal parity, and positive promotion-budget headroom.

## Promotion Contract

[DECIDED] The active profile after M4.99 is exactly:

```json
{
  "maxNodeRows": 74,
  "maxPropertyRows": 95,
  "maxValueRows": 832
}
```

[DECIDED] The published queue is exactly:

| Witness | Tool | Parameter rows | Structural rows |
|---|---|---:|---|
| `checker-while.kern#15:comparisonOperandsOk` | checker | 24 | 53/95/832 |
| total | 1 tool | 24 | 1 function |

[DECIDED] The promotion assertion binds:

1. M4.95 selected candidate, changed axes, witness identity, and row counts.
2. M4.98 candidate profile, promotion disposition, exact floor, and headroom.
3. The new policy profile exactly equals 74/95/832.
4. Runtime `maxCollectionLength` remains 65,536 and KIR `maxDepth` remains 64.
5. Authored corpus remains 109 functions with 17 legacy `fn.params` blockers.
6. Base-complete count remains 89 until M4.100 consumes the queue.
7. Bounded exhaustion remains with exactly 16 residual functions outside the
   published queue.
8. The parameter queue remains exactly 1 function, 1 tool, and 24 rows.

[DECIDED] Profile-limit fixtures move mechanically to one row above each
active limit: node 75, property 96, and value 833. Each is admitted only by
raising its own corresponding profile limit by one.

## Evidence and Drift Boundaries

[DECIDED] M4.99 must preserve exact M4.95 and M4.98 receipt bytes. Validation
must fail closed on candidate, promotion, floor, queue, or policy drift.

[DECIDED] Generated coverage/prerequisite summaries and current-policy pins
may change because active profile facts change. Historical receipts and
historical milestone semantics must not be rewritten.

[DECIDED] Canonicalizer KERN source, checked-in composite bytes, authored
corpus source, runtime engine, handler ABI, parser, KIR limits, and production
runtime limits remain unchanged.

## Implementation Plan

1. Add RED tests at the absent M4.99 promotion boundary for exact policy,
   exact queue, M4.95/M4.98 evidence, and immutable input receipts.
2. Add the M4.99 promotion module with cloned active-profile and queue exports
   plus a complete fail-closed assertion.
3. Move only policy profile limits and the three one-row-over fixtures.
4. Rebind current coverage/prerequisite/status/checker contracts to M4.99 and
   regenerate derived summaries twice for convergence.
5. Run focused tests, the complete canonicalizer gate, full Node 22 KERN 5
   fitness wall, and mandatory independent high-risk review.
6. Create one Agon-signed commit, fetch and immediately rebase on
   `origin/main`, then atomically push the feature branch and main once with
   `--no-verify`.

## Acceptance Criteria

- [x] Branch starts at exact published M4.98 commit `3f46e616`.
- [x] RED fails at the missing M4.99 promotion module boundary.
- [x] Only property/value profile limits move to 95/832; node remains 74.
- [x] Runtime, KIR, ABI, canonicalizer source, and corpus source remain exact.
- [x] M4.95 and M4.98 receipt bytes remain immutable.
- [x] Queue is exactly 1 function/24 rows/1 tool.
- [x] Base-complete remains 89/109 with 17 legacy parameter blockers.
- [x] Bounded exhaustion leaves exactly 16 residual functions.
- [x] Profile-limit fixtures reject exactly 75/96/833 rows.
- [x] Focused and complete canonicalizer gates pass.
- [x] Full Node 22 KERN 5 fitness wall passes.
- [x] Independent high-risk review has no unresolved verified blocker.
- [x] Signed commit is fetched/rebased before one atomic no-verify push; both
      remote hashes verify identically.

## Implementation Evidence

[VERIFIED] The RED test failed at the absent
`coverage-m4-99-dual-row-promotion.mjs` boundary before implementation.

[VERIFIED] The active policy is exactly 74/95/832. Runtime collection length
remains 65,536 and KIR depth remains 64. No canonicalizer KERN source,
checked-in composite, authored corpus source, runtime engine, handler ABI,
parser, or KIR contract changed.

[VERIFIED] The M4.95 and M4.98 receipts retain SHA-256 identities
`f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928`
and
`21ab630c3c937ee62d15fadfcec9faee80cf87a2d7eb6fdee7c41b3723efc201`.
The historical M4.98 loader now authenticates its frozen published 74/77/580
policy while M4.99 owns the live promoted profile.

[VERIFIED] Generated evidence converges at canonicalizer-policy digest
`687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09`,
coverage-implementation digest
`ebe92b8e6a7f19da7d6743f3b551506bacfe997043b695d87a05412082cd3f8c`,
and function-facts digest
`6a2c8e406f2bd5e3847c55e3e1fb01eb19c7f6b7c7cd6e73cbb77abfe3c3875d`.
Coverage is 89/109 with 17 legacy parameter blockers, an exact 1-function,
1-tool, 24-row queue, and 16 bounded residual functions.

[VERIFIED] The independent boundary fixtures measure exactly 75/75/100,
48/96/150, and 59/62/833 node/property/value rows. Each is admitted only by
raising its corresponding active profile limit by one.

[VERIFIED] Focused M4.99 tests pass 4/4, the current-frontier matrix passes
22/22, and the complete canonicalizer gate passes 415/415 Node tests plus all
55 golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 235 hostile fixtures.

[VERIFIED] The mandatory high-risk role-lens review completed with all 6
usable independent engines in
`/Users/nicolascukas/.agon/runs/review-1785135523380-d7qd30`. It returned no
verified blocker. Its one important needs-check finding was confirmed: the
current coverage assertion still passed live policy through historical
M4.86/M4.90/M4.94 milestone assertions. The fix makes each historical
assertion authenticate only its own published profile or receipt, removes the
dead live-M4.94 projection, and leaves M4.99 as the sole owner of the current
74/95/832 policy assertion. Targeted regression tests pass 60/60 after that
fix.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passed again from
the final reviewed source state, including all workspace, release-policy,
canonicalizer, cross-conformance, native, runner, ABI, KIR, quarantine, and
repeated final-state gates.

## Stop Conditions

- M4.95 or M4.98 receipt identity or semantics drift.
- The measured queue differs in identity, ordering, rows, or tool ownership.
- Promotion requires changing node rows, runtime/KIR limits, ABI,
  canonicalizer/corpus source, or a production runtime option.
- `comparisonOperandsOk` no longer succeeds within the 49,152 promotion
  budget under exact public/internal parity.
- Any function signature is migrated or consumed in this slice.

## Out of Scope

- Consuming the M4.99 parameter queue.
- Raising node, runtime, collection, projection-depth, or KIR limits.
- KIR v1 freeze, runtime cutover, semantic self-hosting, RC/stable release,
  Fable work, or a KERN 5 completion claim.
