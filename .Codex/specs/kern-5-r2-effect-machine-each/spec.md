# KERN 5 R2 M3.11 Private Effect-Machine Array Each Frames

**Status:** COMPLETE
**Date:** 2026-07-13
**Confidence:** 0.95

## Executive Summary

Move only the portable `array` and `array-indexed` forms of `each` from the
legacy reference runners into the private internal effect machine. Preserve the
existing collection resolution and binding semantics through a new lazy
iteration-step owner, consume the shared caller-configured loop budget once per
executed element, and keep pair, entry, pseudo-async, unwind, linking, and
public ABI work explicitly deferred.

The full-roster adversarial tribunal selected this bounded slice over claiming
all six current shapes or moving to try/unwind first:
`/Users/nicolascukas/.agon/runs/tribunal-1783922940092-xlmy9k`.

## Current State / Root Cause

- **VERIFIED:** `each` is globally marked `legacy`, while `for` and `while` are
  unified (`packages/core/src/ir/semantics/internal-effect-machine.ts:23-42`).
- **VERIFIED:** root eligibility, complete-tree structural preflight, and
  execution dispatch special-case only branch/if/for/while frames; any other
  body-bearing node rejects (`packages/core/src/ir/semantics/internal-effect-machine.ts:104-123,194-239,323-363`).
- **VERIFIED:** the canonical `each` contract recognizes six exclusive shapes,
  but `eachRuntimeSteps` eagerly materializes every step with `Array.from`
  (`packages/core/src/ir/semantics/each.ts:63-130,199-290`).
- **VERIFIED:** sync and async legacy paths both consume that materialized step
  list, independently create fresh marked child environments, bind every step,
  and delegate children to their respective reference runner
  (`packages/core/src/ir/semantics/each.ts:292-320`;
  `packages/core/src/ir/semantics/async-reference-runner.ts:536-569`).
- **VERIFIED:** `eachRuntimeSteps` has exactly two production clients, the sync
  contract and async reference runner (`rg -n "eachRuntimeSteps" packages/core/src -g '*.ts'`, 2026-07-13).
- **VERIFIED:** `each.ts` is already 641 lines, so adding machine logic there
  would worsen an oversized handwritten source file
  (`packages/core/src/ir/semantics/each.ts:641`).

The missing ownership is a lazy, shape-gated array iteration frame around the
already unified machine body. Reusing the eager array returned by
`eachRuntimeSteps` would preserve current outputs but would not truthfully own
per-step iteration and would create the wrong seam for future iterator work.

## What Already Works

Collection lookup, proven record-array field resolution, scalar checks, shape
detection, step binding order, `iter-next` identity, child scopes, loop
completions, capability suspension, structural preflight, and the shared nested
iteration budget already have executable owners. This slice changes their
composition, not their public meaning.

## Contract (Verified)

> Verified against the cited sources on 2026-07-13.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Eligible shapes | `array`, `array-indexed` only | `each.ts:88-120`; tribunal verdict | VERIFIED |
| Deferred shapes | `pair-sync`, `pair-async`, `entry-key`, `entry-value` | `each.ts:115-120,227-277`; tribunal verdict | VERIFIED |
| Body shape | present `in`, recognized shape, non-empty child array | `each.ts:123-130` | VERIFIED |
| Collection | binding or proven record-array field; nullish/missing/unproven rejects | `each.ts:164-197` | VERIFIED |
| Step order | source array order; index starts at zero and increments by one | `each.ts:199-225` | VERIFIED |
| Trace | one primary-binding `iter-next` before body events | `each.ts:292-297` | VERIFIED |
| Scope | fresh marked child per element; all step bindings defined there | `each.ts:299-306` | VERIFIED |
| Completion | nearest break/continue consumed; return/throw propagated | `each.ts:308-318` | VERIFIED |
| Budget | one shared configured unit per executed loop iteration | `internal-effect-machine.ts:148-156,257-310` | VERIFIED |
| Containment | private/default-off; no public runtime ABI or legacy call in machine | `scripts/check-runtime-envelope.mjs:51-127` | VERIFIED |

## Implementation Options

### Selected: partial array ownership with a lazy shared step owner

Extract shape detection, preconditions, collection resolution, and lazy step
iteration into a sub-500-line internal helper. Preserve `each.ts` re-exports and
the materialized `eachRuntimeSteps` compatibility wrapper for both legacy
clients. The effect machine admits only the two array shapes and consumes the
lazy iterator directly.

### Rejected: all six shapes

This would claim pseudo-async ownership without a true portable AsyncIterable
value and would promote pair/entry iterator choices prematurely.

### Rejected: try/unwind first

Try/catch/finally requires cleanup ordering and completion replacement rules.
It is a separate stateful frame; the release train already identifies `each`
as the next loop-ownership gap.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/each-runtime.ts` | add | lazy canonical shape, resolution, and step owner |
| `packages/core/src/ir/semantics/each.ts` | modify | re-export helper and preserve materialized legacy wrapper |
| `packages/core/src/ir/semantics/internal-effect-machine.ts` | modify | partially claim, preflight, and execute array each frames |
| `packages/core/tests/runtime-envelope-effect-machine-each.test.ts` | add | discriminating ownership/budget/effect/control fixtures |
| `packages/core/tests/runtime-envelope-effect-machine.test.ts` | modify | exact partial disposition contract |
| `scripts/check-runtime-envelope.mjs` | modify | bind partial ownership and legacy-shape deferrals |
| `scripts/kern-5-fitness-policy.json` | modify | add M3.11 internal oracle |
| `docs/kern-5-support-matrix.md` | modify | publish truthful private support evidence |
| `docs/kern-5-release-train.md` | modify | record M3.11 only after terminal gates pass |

## Acceptance Criteria

- [x] Root and nested `array` and `array-indexed` each frames select and remain
  inside the private effect machine.
- [x] Pair-sync, pair-async, entry-key, and entry-value frames remain ineligible
  for machine selection and retain legacy behavior.
- [x] The machine consumes a lazy per-step iterator; legacy sync/async clients
  retain the materialized compatibility wrapper with unchanged fixtures.
- [x] Source array order, primary-binding `iter-next` events, and zero-based
  index bindings match the existing contract.
- [x] Each executed element uses a fresh marked child scope; element/index/inner
  bindings do not leak, while outer assignments write through.
- [x] Repeated capability effects have byte-identical raw sync/async traces.
- [x] Unlabelled break/continue are consumed by the nearest each frame;
  return/throw propagate unchanged.
- [x] One caller-configured iteration budget is shared across nested each,
  for, and while frames; exhaustion fails transactionally with no normalized
  partial events.
- [x] Complete-tree structural verification rejects try or non-portable each
  descendants before provider calls or trace events.
- [x] The effect machine contains no sync/async reference-runner call and public
  exports, handler ABI, callable environments, and module linking stay unchanged.
- [x] `each.ts` finishes below 500 lines and every new handwritten source file
  is below 500 lines.
- [x] Focused runtime-envelope tests and `pnpm fitness:kern-5` pass.
- [x] Terminal `agon review` with `claude,codex,agy` passes.

## Out of Scope

Pair and entry iteration, true async iterator protocols, `try`/`catch`/`finally`,
labelled control, callable or module linking, runner function/class/`this`
environments, public ABI promotion, and legacy-runner removal.

## Open Questions

None. No ASSUMED or OPEN claim feeds the fixtures.

## Deploy Order

Helper extraction, machine frame, tests, policy, matrix, and release receipt
ship in one signed branch push. The compatibility wrapper keeps both legacy
clients stable during the private internal change, so there is no public skew
window. Kill switch: restore `each: 'legacy'`, remove the partial machine
branches/oracle row, and leave the extracted compatibility helper in place.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| All six existing shapes could move by calling `eachRuntimeSteps`. | The helper eagerly materializes, and pair-async does not represent a true portable async iterator. | M3.11 owns only array shapes through a new lazy step owner. |
| Consuming the budget after obtaining a lazy step was sufficiently bounded. | Array iteration reads an accessor while obtaining the step, so the budget must be checked before that read. | The lazy owner accepts a machine-only boundary callback; exhaustion cannot touch the next element. |

## Verification Receipt

- `pnpm --filter @kernlang/core test --testPathPatterns=runtime-envelope-effect-machine-each`: 13 tests passed.
- `pnpm test:kern-runtime-envelope`: 104 tests and containment guard passed.
- `pnpm fitness:kern-5`: full aggregate wall passed after the terminal production fix.
- Agon review: 3/3 `claude,codex,agy`, zero findings or nits:
  `/Users/nicolascukas/.agon/runs/review-1783927823353-cse3pk-kern5-m3-11-budget-fix-verificat`.
- Closed-diff Agon review: 3/3, zero actionable findings and one out-of-scope
  nit about unchanged legacy entry-key/value object acceptance:
  `/Users/nicolascukas/.agon/runs/review-1783927991405-a4vs0f-kern5-m3-11-terminal-closed`.
