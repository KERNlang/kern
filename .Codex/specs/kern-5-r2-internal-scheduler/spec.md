# KERN 5 R2/M3.5 Internal Scheduler Control

**Status:** DONE
**Date:** 2026-07-13
**Confidence:** 0.98

## Executive Summary

M3.5 adds private, default-off scheduler control to the internal runtime
envelope. A caller may supply a validated cancellation signal, a validated
timeout, or both. The control begins before handler execution, bounds async
interceptor/provider waits, and fails transactionally with distinct stable
diagnostics. This slice does not publish a scheduler, handler, or capability
ABI and does not claim that arbitrary host effects can be cancelled.

## Current State / Root Cause

- M3.1-M3.4 are remotely complete through `e42367c3`; M3.4 introduced an async
  interceptor wait before provider dispatch. **VERIFIED**
- Async provider calls already have a per-call timeout, but interceptor waits
  have no bound and can prevent envelope completion indefinitely.
  (`internal-capability-interceptor.ts:125-130`) **VERIFIED**
- The runtime envelope catches execution errors only after the sync/async
  runner settles; it has no cancellation or deadline classification.
  (`runtime-envelope/execute.ts:20-51`) **VERIFIED**
- Failure envelopes already suppress all result and event data.
  (`runtime-envelope/normalize.ts:76-86`) **VERIFIED**
- Every typed handler invocation owns a fresh `runnerCallCache`, which is the
  existing private per-call identity inherited by nested/rebuilt environments.
  (`runtime-envelope/handler-entry.ts:115-126`) **VERIFIED**
- Tribunal `tribunal-1783894547878-y97hg7-kern5-m3-5-next-slice` selected
  private scheduler deadline/cancellation semantics before trace unification,
  linking, value widening, or ABI promotion. **VERIFIED**

## Contract

| Field / Behavior | Contract | Tag |
|---|---|---|
| Surface | Optional `scheduler` exists only on the unexported internal envelope options | DECIDED |
| Cancellation | Caller-supplied `AbortSignal`; already-aborted and later-aborted runs fail as `execution-cancelled` | DECIDED |
| Timeout | Caller-supplied positive finite safe-integer milliseconds; no product default or literal threshold | DECIDED |
| Precedence | An already-aborted signal wins before timeout setup; after start, the first observed terminal control wins | DECIDED |
| Identity | Scheduler state is keyed by the fresh per-handler `runnerCallCache`, with parent fallback for nested environments | DECIDED |
| Async waits | Envelope execution and interceptor/provider waits race the same terminal control | DECIDED |
| Sync work | Already-aborted control fails before sync execution; CPU-bound sync work is not preemptible in this slice | GUARD |
| Failure | Cancellation/timeout produces one closed diagnostic, absent result, and zero events | GUARD |
| Late settlement | Late promise resolution/rejection is observed and cannot mutate the returned envelope or dispatch a provider after a cancelled interceptor wait | GUARD |
| Cleanup | Timers and abort listeners are removed on every exit; no scheduler handle survives a settled envelope | GUARD |
| Default | Omitted scheduler preserves current sync/async bytes and provider timeout behavior | GUARD |
| Public status | `runtime-handler-abi` remains planned; no public barrel, runner option, browser entry, or package export changes | GUARD |

## Implementation Choice

Add a private `runtime-envelope/internal-scheduler.ts` module that validates and
owns per-call control state. `execute.ts` installs and disposes it around the
existing runner. The M3.4 dispatch helpers use the same state to race async
interceptor and provider waits. Scheduler errors normalize into two new closed
runtime diagnostic codes.

The timer bounds waiting, not arbitrary host work. A host provider may continue
internally after KERN stops waiting because the current provider ABI has no
cancellation channel. Its late settlement is consumed and cannot add envelope
events/results. Abort propagation into providers is deferred until the public
capability ABI is designed.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/runtime-envelope/internal-scheduler.ts` | Add | Private validation, state, wait race, cleanup |
| `packages/core/src/runtime-envelope/types.ts` | Modify | Internal scheduler-control type and diagnostic codes |
| `packages/core/src/runtime-envelope/execute.ts` | Modify | Install/check/race/dispose around envelope execution |
| `packages/core/src/runtime-envelope/normalize.ts` | Modify | Stable cancellation and timeout classification |
| `packages/core/src/ir/semantics/internal-capability-interceptor.ts` | Modify | Race interceptor/provider waits with per-call control |
| `packages/core/tests/runtime-envelope-scheduler.test.ts` | Add | Binary cancellation/deadline/cleanup oracle |
| Containment, policy, matrix, release train | Modify after proof | Bind internal M3.5 without ABI promotion |

## Acceptance Criteria

- [x] Omitted scheduler preserves current sync and async envelope bytes.
- [x] Invalid scheduler shapes, unknown fields, invalid signals, and invalid
      timeout values fail before handler execution with no events/result.
- [x] Already-aborted sync and async calls fail as `execution-cancelled` before
      the body or provider runs.
- [x] In-flight abort during an interceptor wait prevents provider dispatch and
      returns a stable closed cancellation envelope.
- [x] Scheduler timeout during an interceptor or async-provider wait returns
      `execution-timeout`, distinct from provider capability timeout.
- [x] Late resolution and rejection after a scheduler terminal event are
      observed without unhandled rejection, envelope mutation, or new events.
- [x] Abort listeners and timers are removed after success, failure,
      cancellation, and timeout.
- [x] A later handler call has fresh scheduler state and cannot observe the
      prior call's terminal state.
- [x] Public exports and the planned `runtime-handler-abi` gate remain unchanged.
- [x] `pnpm test:kern-runtime-envelope` and `pnpm fitness:kern-5` pass.
- [x] Final Agon review with `claude,codex,agy` has zero verified findings.

## Explicit Deferrals

Sync/async trace-engine unification, module/helper/class linking, Decimal and
nested-record/map/class value symmetry, public ABI promotion, provider abort
propagation, quotas, retries, rollback, and user-facing CLI timeout policy are
not part of M3.5.

## Kill Conditions

- Any global, environment-variable, or public runner control is introduced.
- Any timeout threshold is hardcoded instead of supplied by the caller.
- A cancellation/timeout envelope contains partial events or a result.
- Provider dispatch occurs after an interceptor wait has already terminated.
- A timer/listener survives a settled envelope.
- The public runtime-handler ABI gate is promoted.

## Deploy Order

Ship M3.5 as one private default-off slice. Then tribunal the next dependency
between trace-engine convergence and bounded linking; value symmetry and public
ABI freeze remain later.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Tribunal described generic cancellation across provider work | The current provider ABI exposes no abort channel | M3.5 stops waiting and suppresses late settlement; provider abort propagation is explicitly deferred |
| Tribunal requested zero lingering handles | A host provider may own unrelated handles outside KERN control | The executable oracle binds only scheduler-owned timers/listeners and late promise observation |
| A disposed scheduler generation should always delete its state immediately | A cancelled generation may retain a handle-free terminal tombstone while old work remains pending | Fresh handler calls remain isolated by `runnerCallCache`; unsafe same-environment reuse cannot revive cancelled work under a newer generation |

## Completion Evidence

- Commit `103ffcca` is present on
  `origin/feat/kern-5-r1-kir-v1-parity`. **VERIFIED**
- `pnpm fitness:kern-5` passed on 2026-07-13, including 45 focused runtime
  envelope tests and the complete workspace/release wall. **VERIFIED**
- Agon review
  `review-1783897091165-u04ede-kern5-m3-5-internal-scheduler-fi` completed
  with all three engines and zero verified findings. **VERIFIED**
