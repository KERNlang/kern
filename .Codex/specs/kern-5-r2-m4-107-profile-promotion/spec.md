# KERN 5 R2 M4.107 — Authenticated Profile Promotion

**Status:** VERIFIED — PUBLISH PENDING
**Date:** 2026-07-27
**Confidence:** 0.94

## Objective

[VERIFIED] M4.101 selected the exact 89/125/2100 profile action for
`validstatement`. M4.106 authenticates its exact runtime floor at 39,016,
leaving 10,136 iterations below the 49,152 promotion budget.

[DECIDED] M4.107 promotes only those three profile ceilings and publishes the
resulting exact `validstatement` 14-row parameter queue. Runtime limits, KIR
limits, runtime implementation, handler ABI, and source semantics remain
unchanged.

## Acceptance Criteria

- [x] M4.101 selection and M4.106 receipt are digest-bound causal inputs.
- [x] Active profile becomes exactly 89/125/2100.
- [x] Runtime and KIR limits remain unchanged.
- [x] `validstatement` is the only parameter-ready witness, with 14 rows.
- [x] No parameter migration is consumed in this slice.
- [x] Coverage/status artifacts reproduce deterministically.
- [x] Full `fitness:kern-5` passes.
- [x] Independent high-risk review passes.
- [ ] Signed commit is fetched/rebased and pushed once to `main`.

## Verified Result

- Active profile: 89 node rows, 125 property rows, 2,100 value rows.
- Coverage: 91/111 base-complete; 16 `fn.params` blockers.
- Ready queue: only `validstatement`, exactly 14 parameter rows.
- Residual frontier: bounded exhaustion across 15 functions.
- Runtime floor remains the M4.106 exact 39,016 with 10,136
  promotion-budget headroom.
- Runtime implementation, runtime/KIR limits, public ABI, and source semantics
  are unchanged.
- Agon high-risk role review completed across all 6 usable engines. Its valid
  policy-digest concern was fixed by reconstructing and hashing historical
  policy bytes; unrelated policy drift now fails closed.

## Out of Scope

- Consuming the `validstatement` parameter queue.
- Runtime, ABI, KIR v1, cutover, self-hosting, release, or Fable claims.
