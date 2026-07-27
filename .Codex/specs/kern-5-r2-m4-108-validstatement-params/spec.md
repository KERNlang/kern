# KERN 5 R2 M4.108 — `validstatement` Direct Parameters

**Status:** VERIFIED — PUBLISH PENDING
**Date:** 2026-07-27
**Confidence:** 0.99

## Objective

[VERIFIED] M4.107 publishes exactly one parameter-ready function:
`examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement`,
with 14 legacy parameter rows and canonical profile 89/125/1873.

[DECIDED] M4.108 consumes only that authenticated queue entry by replacing its
legacy `fn.params` property with the same 14 direct `param` children, preserving
function identity, order, return/export contract, handler body, runtime behavior,
active profile limits, runtime limits, and KIR limits.

## Acceptance Criteria

- [x] M4.108 consumes the exact immutable M4.107 one-function/14-row queue.
- [x] Only `validstatement` changes from legacy parameter text to 14 direct
      parameter children, in the authenticated order and types.
- [x] Function identity, ordinal, return/export contract, and semantic handler
      body remain unchanged.
- [x] Coverage advances by exactly one base-complete function and removes
      exactly one `fn.params` blocker.
- [x] The migrated function cannot re-enter the next parameter queue.
- [x] The post-migration prerequisite frontier is measured and authenticated;
      no residual counts or digests are guessed.
- [x] The composed canonicalizer and composition metadata reproduce exactly
      from repository source members.
- [x] Coverage/status summaries reproduce deterministically.
- [x] Full `fitness:kern-5` passes.
- [x] Independent high-risk role review passes.
- [ ] Signed commit is fetched/rebased and pushed once to `main`.

## Non-Goals

- Migrating `emitstatement` or any other legacy-parameter function.
- Changing the active profile, runtime limits, KIR limits, handler ABI, or
  canonicalizer semantics.
- Claiming KIR v1 cutover, full self-hosting, KERN 5 release completion, or
  Fable readiness.

## Verification Plan

[DECIDED] Add an M4.108 fail-closed assertion covering signature, direct
parameter order/types, semantic body digest, source identity, coverage fact,
profile rows, and exact M4.107 queue consumption.

[DECIDED] Regenerate the authenticated canonicalizer composition, write the
live coverage/prerequisite summaries, and bind the current frontier to their
measured post-migration facts.

[DECIDED] Run targeted M4.108/canonicalizer tests, the full KERN 5 fitness gate,
then `agon review uncommitted --primary-engine codex --risk high --roles auto`.

## Verified Result

[VERIFIED] M4.108 advances the cumulative base from 91/110 to 92/111, removes
the authenticated one-function/14-row queue, and leaves a measured bounded
frontier of 15 legacy `fn.params` blockers with no parameter-ready tranche.

[VERIFIED] The final post-review `pnpm fitness:kern-5` wall passed, including
472/472 canonicalizer tests and the terminal
`KERN 5 current fitness wall passed` marker.

[VERIFIED] The independent high-risk role review completed with all 6 usable
engines, no verified blocker, and two valid duplication findings. Both were
resolved by deriving historical signatures from the shared target and reusing
the fail-closed historical-source reconstruction helper; targeted regressions
and the full fitness wall passed afterward.
