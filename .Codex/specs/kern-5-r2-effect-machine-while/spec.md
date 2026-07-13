# KERN 5 R2 M3.9 Private Effect-Machine While Frames

**Status:** DONE
**Date:** 2026-07-13
**Confidence:** 0.96

## Executive Summary

Move the bounded portable `while` frame from the legacy runner into the private
internal effect machine. The machine will re-evaluate the strict-boolean
condition at each loop head, run every iteration in a fresh marked child scope,
resume capability effects through the existing generator, consume unlabelled
`break` and `continue` only inside loop bodies, and propagate `return`/`throw`.
No callable/module linking, public ABI, or other loop family is promoted.

The full-roster adversarial tribunal selected this slice over unwind and
callable linking:
`/Users/nicolascukas/.agon/runs/tribunal-1783915108331-rph9kd`.

## Current State / Root Cause

- **VERIFIED:** `while` is explicitly legacy while the existing flat, `if`, and
  `branch` corpus is unified (`packages/core/src/ir/semantics/internal-effect-machine.ts:21-38`).
- **VERIFIED:** the machine structurally closes the entire claimed tree before
  the first capability dispatch and forbids every legacy runner call in its
  source (`packages/core/src/ir/semantics/internal-effect-machine.ts:153-187`,
  `scripts/check-runtime-envelope.mjs:51-77`).
- **VERIFIED:** the portable while contract already owns strict-boolean
  condition evaluation, the 100,000-iteration ceiling, fresh marked child
  scopes, consumed `break`/`continue`, and propagated `return`/`throw`
  (`packages/core/src/ir/semantics/while.ts:43-104`).
- **VERIFIED:** sync and async legacy paths currently duplicate the loop driver;
  the async path delegates each body to `asyncReferenceRunSequence`
  (`packages/core/src/ir/semantics/async-reference-runner.ts:445-483`).
- **VERIFIED:** `break` and `continue` already have closed completion records
  and registered primitive contracts (`packages/core/src/ir/semantics/trace.ts:13-23`,
  `packages/core/src/ir/semantics/primitives.ts:61-74`).

The missing ownership is therefore the resumable loop frame, not a new while
language contract.

## What Already Works

Capability preparation/resumption, sync/async provider dispatch, raw trace
accumulation, branch and if nesting, lexical binding helpers, scheduler
cancellation, and failure normalization already have internal owners. The
existing while evaluator and iteration ceiling remain the semantic source of
truth. This slice composes those pieces and does not clone them.

## Contract (Verified)

> Verified against the cited sources on 2026-07-13.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Condition | non-empty expression evaluating to an actual boolean | `while.ts:49-73` | VERIFIED |
| Re-evaluation | condition runs at every loop head | `while.ts:79-103` | VERIFIED |
| Iteration scope | fresh `childEnv`, marked repeatable | `while.ts:86-93` | VERIFIED |
| Loop control | break consumed; continue starts next condition check | `while.ts:96-103` | VERIFIED |
| Abrupt completion | return and throw propagate | `while.ts:99-102` | VERIFIED |
| Termination guard | 100,000 body iterations maximum | `while.ts:43,79-84` | VERIFIED |
| Effect suspension | one generator yields prepared capability requests | `internal-effect-machine.ts:199-230` | VERIFIED |
| Containment | runtime envelope remains private and default-off | `check-runtime-envelope.mjs:91-106` | VERIFIED |

## Implementation Options

### Recommended: machine-owned narrow while frame

Add one generator loop reusing `evaluateWhileCondition`,
`WHILE_MAX_ITERATIONS`, `childEnv`, and `markRepeatableLoopBody`. Admit
unlabelled `break`/`continue` structurally only beneath a while frame. This is
the smallest slice that removes real sync/async semantic duplication and lets
capabilities suspend inside repetition.

### Deferred: try/catch/finally unwind

Unwind replacement and cleanup ordering are a separate state-machine boundary.
A simple trace can pass while finally semantics remain wrong, so it needs its
own slice and oracle.

### Deferred: callable/module linking

Current eligibility deliberately requires empty function/class environments.
Opening calls adds frames, argument/value transfer, link identity, recursion,
and capability traversal; it is not a bounded control-frame extension.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/internal-effect-machine.ts` | modify | claim, preflight, and execute while frames |
| `packages/core/tests/runtime-envelope-effect-machine-while.test.ts` | add | discriminating loop/effect/control fixtures |
| `packages/core/tests/runtime-envelope-effect-machine.test.ts` | modify | exact disposition and eligibility contract |
| `packages/core/tests/runtime-envelope-effect-machine-branch.test.ts` | modify | replace the retired while-deferral witness |
| `scripts/check-runtime-envelope.mjs` | modify | bind ownership and legacy-runner exclusion |
| `scripts/kern-5-fitness-policy.json` | modify | add internal while-frame oracle |
| `docs/kern-5-support-matrix.md` | modify | publish truthful internal support evidence |
| `docs/kern-5-release-train.md` | modify | record M3.9 receipt after gates pass |

## Acceptance Criteria

- [x] Root and nested portable `while` frames select and remain inside the
  private effect machine; `try`, `each`, and `for` remain legacy.
- [x] The condition is strict boolean, is re-evaluated after every normal or
  continue completion, and a false initial condition performs no body effects.
- [x] Every iteration uses a fresh marked child scope: inner `let` bindings do
  not leak or collide, while assignments to outer bindings write through.
- [x] A capability effect may suspend and resume on multiple iterations with
  byte-identical raw sync/async traces and encounter-order events.
- [x] Unlabelled `break` is consumed as normal loop exit; unlabelled `continue`
  skips the rest of the body; `return` and `throw` propagate unchanged.
- [x] `break` and `continue` outside any claimed while body are not accepted by
  the effect machine.
- [x] Complete-tree structural verification rejects an unsupported node in any
  while/if/branch subtree before any provider call or trace event.
- [x] The shared iteration ceiling is preserved without copying its numeric
  value into the machine.
- [x] The machine source contains no call to a legacy sync or async reference
  runner, and public exports/ABI remain unchanged.
- [x] Focused runtime-envelope tests, `pnpm fitness:kern-5`, and terminal
  full-roster `agon review` pass.

## Completion Evidence

- `pnpm test:kern-runtime-envelope`: 74 tests and containment passed.
- `pnpm fitness:kern-5`: the full aggregate wall passed on 2026-07-13;
  browser budget remained 75 modules and 290,786 gzip bytes.
- Full-roster review:
  `/Users/nicolascukas/.agon/runs/review-1783916973232-dov05x-kern5-m3-9-effect-machine-while`
  completed 3/3 with zero findings.

## Out of Scope

`try`/`catch`/`finally`, `for`, `each`, labelled loop control, callable or
module linking, runner function/class environments, expanded value symmetry,
public runtime/handler/capability/trace ABI, and removal of the legacy runner.

## Open Questions

None. The recommended path has no ASSUMED or OPEN claim feeding its fixtures.

## Deploy Order

Implementation, tests, policy, matrix, and release receipt ship in one signed
branch commit. The runtime envelope stays private and default-off, so there is
no external version-skew window. Kill switch: restore `while: 'legacy'`, remove
the private while ownership row, and restore the containment deferral witness.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Tribunal shorthand called the slice a disposition flip plus two completions. | Root loop-control rejection and loop-depth-aware structural preflight are required so `break`/`continue` cannot escape the claimed corpus. | The implementation must carry structural loop context even though runtime completion records already exist. |
| The inherited M3.8 preflight regression used malformed `while` as an unsupported-node witness. | `while` is now unified; `try` remains the correct unsupported frame. | The regression fixture now uses `try`, preventing stale evidence while preserving the pre-effect assertion. |
