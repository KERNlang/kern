# KERN 5 R2 M4.105 — Residual Statement Runtime Bottleneck

**Status:** VERIFIED FOR PUBLICATION
**Date:** 2026-07-27
**Confidence:** 0.97

## Objective

[VERIFIED] M4.104 publishes an exact 62,830-iteration floor for the
`validstatement` candidate. That is below the 65,536 production ceiling but
13,678 iterations above the 49,152 promotion budget.

[DECIDED] M4.105 diagnoses that residual deficit without changing KERN source,
the active or candidate profile, runtime limits, the runtime engine, handler
ABI, or any published receipt.

## Published Input

[VERIFIED] This slice starts from exact M4.104 commit
`e69fc5f35343456067f46dfc7f5636a2aaccbbca`.

[VERIFIED] M4.104 receipt digest
`eace33240c8425569685d76530e4b59ec5b07fa874572a93458ea5e17f84ec92`
records:

- 62,829 failure and 62,830 byte-roundtripping success;
- 62,726 retained `for` and 104 retained `while` iterations at the floor;
- zero rollback and zero parent restart; and
- production headroom but promotion-budget NO-GO.

## Measured Boundary

[VERIFIED] At the exact 49,152 promotion budget, execution fails during
validation with 49,152 retained `for` iterations, zero `while` iterations,
zero rollback, and zero parent restart.

[VERIFIED] The observer records 34 `validstatement` and 13
`validstatementlist` helper-execute events at that boundary, versus 73 and 27
at the successful floor. Helper-execute precedes the helper body, so these
counts prove entry rather than completion. Both `emitstatement` and
`emitstatementlist` remain at zero executions.

[VERIFIED] Promotion-budget execution records 76 `propid`, 49 `propcount`,
51 `childcount`, 50 `childat`, and 3,196 `stringat` executions. The successful
floor records 125, 89, 90, 89, and 3,326 respectively.

[DECIDED] The M4.106 optimization target is repeated authenticated
statement-property and child-count traversal during validation. Quoting is not
the residual blocker because emission has not begun at the promotion boundary.

## Acceptance Criteria

- [x] Freeze exact M4.104 receipt bytes and source/runtime identities.
- [x] Reproduce observer-equivalent measurements at 49,152 and 62,830.
- [x] Prove the promotion failure contains only retained loop work.
- [x] Prove emission has not begun at 49,152.
- [x] Publish exact helper counts and deltas without overclaiming per-helper
      loop attribution unavailable from the observer ABI.
- [x] Publish M4.106 as the next optimization slice with no profile promotion.
- [x] Preserve 90/109 base completion and 16 `fn.params` blockers.
- [x] Full fitness and independent review pass with no unresolved blocker.
- [ ] Signed commit is fetched/rebased and pushed once to `main`.

## Verified Result

[VERIFIED] Receipt
`scripts/kern-canonicalizer/runtime-bottleneck-m4-105.json` has SHA-256
`06538ef420d2374ecf39f5b12d775189c73cfa11a66a3ef460cf795c273db7e0`.
It binds the unchanged M4.104 source/runtime identities and records the exact
49,152 failure and 62,830 byte-roundtripping success observations.

[VERIFIED] The 13,678 additional retained iterations comprise 13,574 `for`
and 104 `while` iterations, with zero rollback and zero parent restart.
At the promotion boundary, validation helpers have begun but neither
`emitstatement` nor `emitstatementlist` has begun.

[VERIFIED] The full Node 22 KERN 5 fitness wall passed. High-risk role review
routed all six usable engines. Correctness caught an overclaim that treated
helper-execute events as completed helper bodies; the receipt, status, spec,
and tests now correctly describe those values as execution events. Targeted
live replay and the canonical coverage checker pass after the correction.
The review's shared-validator and checker-registry suggestions remain
non-blocking cross-slice cleanup rather than M4.105 changes.

## Stop Conditions

- Any measurement changes KERN source, runtime limits, handler ABI, or profile.
- Observer-on and observer-off envelopes diverge.
- The successful floor does not round-trip exact structural KIR bytes.
- Evidence cannot distinguish validation from emission.

## Out of Scope

- Implementing the M4.106 runtime-cost reduction.
- Candidate-profile promotion or parameter migration.
- Runtime/KIR/ABI changes, KIR v1 freeze, runtime cutover, semantic
  self-hosting, RC/stable release, Fable work, or a KERN 5 completion claim.
