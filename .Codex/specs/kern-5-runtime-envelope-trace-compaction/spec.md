# KERN 5 Runtime-Envelope Trace Compaction Prerequisite

**Status:** IMPLEMENTED — LOCAL RUNTIME GATES PASS; INDEPENDENT REVIEW PENDING

**Date:** 2026-08-14

**Baseline:** `1868480434adb54186b4077144748dd1afa7d07d`

**Tribunal:** `tribunal-1786690772660-ahzitr-kern5-runtime-envelope-trace-com`
(`claude,codex,agy`, 3/3 substantive, GO with narrowing amendments)

**Confidence:** 0.98 after the dedicated regression, full runtime-envelope wall,
source-runner convergence wall, build, lint, and architecture checks passed.

## Objective

The runtime-envelope execution path must never accumulate trace events that its
normalizer will discard. Direct effect-machine and source-runner callers retain
their byte-for-byte full trace contract by default. This private prerequisite
unblocks the KERN 5 F1 P0 65,536-record transport proof without changing a
public runtime ABI or weakening iteration, timeout, capability, or event limits.

## Root Cause

- **[RTC-C1 VERIFIED]** The F1 P0 handler links and executes successfully at 256
  records, but fails at 16,384 with `internal-runner-error`.
- **[RTC-C2 VERIFIED]** Direct execution exposes the underlying
  `RangeError: Maximum call stack size exceeded` at
  `internal-effect-machine-sequence.ts` `appendTrace`, where
  `out.events.push(...next.events)` spreads a record-proportional internal trace.
- **[RTC-C3 VERIFIED]** `let`, `assign`, `for`, and `each` create internal
  `assign` or `iter-next` events. `normalizeInternalRuntimeTrace` retains only
  `stdout`, `stderr`, and `capability`, so the envelope path discards the large
  array only after execution.
- **[RTC-C4 VERIFIED]** The earlier 65,536-scalar text-cache probe emits roughly
  one internal loop event per scalar. F1 emits multiple internal events per
  scalar and crosses the engine's spread-argument limit at 16,384; the earlier
  wall therefore did not close this transport risk.

## Resolved Dependencies

- **[RTC-D1 VERIFIED] Limits are trace-independent.** Loop accounting decrements
  `state.remainingIterations` in `consumeIterationBudget`; scheduler termination
  is installed and checked independently in `runtime-envelope/execute.ts`.
  Suppressing discarded trace events cannot add iterations or extend a timeout.
- **[RTC-D2 VERIFIED] Observable event limits remain exact.** `maxEvents` is
  checked after normalization over only `stdout`, `stderr`, and `capability`.
  Those events remain retained in original order; internal events never counted
  toward this public envelope limit before the change.
- **[RTC-D3 VERIFIED] Pre-normalization consumers are closed.**
  `executeInternalRuntimeEnvelopeSync/Async` and their compatibility twins run
  the engine and immediately normalize its private trace. Direct
  `runInternalEffectMachine*` and source-runner engine call sites consume full
  traces and keep the default full mode.
- **[RTC-D4 DECIDED]** The invariant is normative; the exact mechanism is
  private. The implementation may use an internal trace-retention predicate or
  sink, but no caller may opt the envelope path back into discarded events.

## Contract

- **[RTC-K1]** The shared observable predicate admits exactly `stdout`,
  `stderr`, and `capability`, matching runtime-envelope normalization.
- **[RTC-K2]** Runtime-envelope sync, async, and compatibility paths retain only
  events admitted by that shared predicate while executing; discarded internal
  events are never accumulated in a parent trace.
- **[RTC-K3]** Direct effect-machine sync/async and source-runner paths default
  to full traces with unchanged ordering and payloads.
- **[RTC-K4]** Loop iteration budget, scheduler cancellation/timeout, helper
  caching, capability dispatch, completion, and result normalization are
  unchanged.
- **[RTC-K5]** All event concatenation on the touched path is iterative; no
  record-proportional array is passed as spread arguments.
- **[RTC-K6]** The pre-normalization observable trace for a 16,384-iteration
  assignment-only handler has a deterministic retained-event count of zero,
  while the same direct-machine program retains its exact full trace.
- **[RTC-K7]** Sync and async envelope results/events remain structurally equal.
- **[RTC-K8]** No public export, handler ABI, trace event schema, or default
  direct-machine behavior changes.
- **[RTC-K9]** Machine-ineligible compatibility execution uses a private,
  execution-scoped observable-only retention policy. Sync and async legacy
  runners retain zero internal events at 65,536 iterations while direct
  reference execution keeps the complete default trace.
- **[RTC-K10]** Every reference-runner trace join on the compatibility path is
  iterative. No retained event batch is passed as spread arguments, including
  when all retained events are externally observable.

## Options

### A — Private envelope trace retention policy (selected)

Thread a private full/observable retention policy through the internal machine.
Default full preserves current direct callers. Envelope execution selects
observable. Sequence aggregation filters by the shared predicate and uses
iterative append; `for`/`each` do not retain `iter-next` in observable mode.

### B — Replace spread only (rejected)

Avoids the immediate stack overflow but preserves proportional heap growth and
violates **RTC-K2/K6**.

### C — Reduce F1 guest statements (rejected)

Distorts the consumer around a runtime defect and leaves the next
high-iteration envelope handler exposed.

## Independent-review correction

- **[RTC-R1 VERIFIED]** Review run
  `review-1786707948550-891yag-kern5-f1-trace-history` reproduced stack
  exhaustion in the legacy compatibility fallback at 65,536 iterations.
- **[RTC-R2 DECIDED]** Tribunal
  `tribunal-1786708320748-w7e1cj` rejected public reference-runner parameters.
  The correction uses an internal execution-scoped binding inherited by child
  semantic environments; direct reference calls remain full-trace by default.
- **[RTC-R3 REQUIRED]** A direct full-trace boundary test discriminates the
  spread-argument ceiling from retention. Compatibility tests separately prove
  zero pre-normalization internal events for sync and async legacy execution.
- **[RTC-R4 REQUIRED]** The F1 decoder derives failure metadata from the actual
  source, invocation mode, and authenticated limits. Scaling assertions consume
  the authenticated policy fields rather than duplicated literals.

## Blast Radius

| File | Change |
| --- | --- |
| `packages/core/src/ir/semantics/trace.ts` | Own the shared observable-event predicate. |
| `packages/core/src/ir/semantics/internal-effect-machine-types.ts` | Add private retention option/state. |
| `packages/core/src/ir/semantics/internal-effect-machine-sequence.ts` | Filter and iteratively append; suppress internal loop events in observable mode. |
| `packages/core/src/ir/semantics/internal-effect-machine.ts` | Propagate retention into sync/async state. |
| `packages/core/src/runtime-envelope/internal-engine.ts` | Carry the private engine option. |
| `packages/core/src/runtime-envelope/execute.ts` | Select observable retention for envelope sync/async. |
| `packages/core/src/runtime-envelope/execute-compat.ts` | Select the same behavior on compatibility envelope paths. |
| `packages/core/tests/runtime-envelope-trace-compaction.test.ts` | Prove retained bounds, compatibility, limits, and parity. |

## Acceptance

- [x] RED reproduces the 16,384 F1 stack overflow or equivalent high-iteration
  internal-event accumulation before the runtime change.
- [x] Direct sync and async machine calls retain their exact default full trace.
- [x] Pre-normalization envelope engine trace retains zero events for a
  high-iteration assignment-only fixture.
- [x] Envelope sync/async retain stdout, stderr, and capability events in exact
  order and enforce `maxEvents` unchanged.
- [x] Iteration exhaustion, timeout/cancellation, completion, and results match
  baseline behavior.
- [x] The F1 16,384/32,768/65,536 scaling proof proceeds without proportional
  hidden trace growth or stack overflow.
- [ ] Targeted core tests, typecheck/build, broader local gate, independent Agon
  review, and verified remote-main push pass before the prerequisite is called
  complete.

## Out of Scope

- Public trace streaming, trace schema changes, a public trace mode, generic
  telemetry redesign, F1 lexical behavior, or weakening any runtime limit.
