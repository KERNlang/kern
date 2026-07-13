# KERN 5 R2 M3.10 Private Effect-Machine Counted For Frames

**Status:** DONE
**Date:** 2026-07-13
**Confidence:** 0.96

## Executive Summary

Move the portable counted `for` frame from the legacy runner into the private
internal effect machine. Evaluate `from`, `to`, and `step` exactly once at frame
entry through the existing range owner; execute each half-open range iteration
through the shared generator in a fresh marked child scope with an
integer-provenanced induction binding; consume loop-local `break`/`continue`;
and propagate `return`/`throw` without any legacy runner call.

The full-roster adversarial tribunal selected counted `for` over unwind,
collection iteration, and callable linking:
`/Users/nicolascukas/.agon/runs/tribunal-1783917474040-ailjdr`.

## Current State / Root Cause

- **VERIFIED:** `for` remains `legacy` while `while` is generator-native and
  unified (`packages/core/src/ir/semantics/internal-effect-machine.ts:21-40`,
  `packages/core/src/ir/semantics/internal-effect-machine.ts:221-248`).
- **VERIFIED:** the canonical range owner already enforces identifier shape,
  safe-integer bounds, default step, zero-step rejection, half-open positive and
  negative iteration, and evaluated-once range expressions
  (`packages/core/src/ir/semantics/for.ts:42-127`).
- **VERIFIED:** legacy sync execution enters a fresh marked child scope and
  defines the induction variable with integer provenance on every iteration
  (`packages/core/src/ir/semantics/for.ts:129-159`).
- **VERIFIED:** async execution separately duplicates the same frame and calls
  `asyncReferenceRunSequence` for the body
  (`packages/core/src/ir/semantics/async-reference-runner.ts:488-519`).
- **VERIFIED:** M3.9 already provides loop-depth structural validation and
  machine-owned loop-control completions without a reference-runner call
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:166-218`).

The missing ownership is the counted range frame around the shared resumable
body, not a new range or loop-control contract.

## What Already Works

Range expression evaluation, integer provenance, child scopes, capability
suspension/resumption, trace accumulation, scheduler control, nested `if`,
`branch`, and `while`, and normalized failures already have owners. This slice
must call those owners rather than copying range logic or loop constants.

## Contract (Verified)

> Verified against the cited sources on 2026-07-13.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Shape | identifier name, present from/to, array children | `for.ts:42-49` | VERIFIED |
| Bounds | safe integers evaluated once | `for.ts:51-127` | VERIFIED |
| Step | defaults to 1; zero rejects | `for.ts:123-125` | VERIFIED |
| Range | half-open; positive and negative step | `for.ts:132` | VERIFIED |
| Iteration event | one `iter-next` before every body | `for.ts:133` | VERIFIED |
| Scope | fresh marked child with integer binding | `for.ts:139-146` | VERIFIED |
| Completion | break/continue consumed; return/throw propagate | `for.ts:151-157` | VERIFIED |
| Containment | no legacy call in machine; private/default-off | `scripts/check-runtime-envelope.mjs:55-56,91-106` | VERIFIED |

## Implementation Options

### Recommended: generator-native counted for frame

Add a `runFor` generator that calls `forRuntimeRange` once, emits the canonical
iteration event, establishes the same child binding semantics, and delegates
only the body sequence to the machine generator. Extend structural preflight
with loop depth for all `for` descendants.

### Deferred: try/catch/finally unwind

Catch binding tombstones, return-with-catch exclusion, and cleanup completion
ordering form a distinct, stateful unwind protocol and need their own oracle.

### Deferred: each and callable linking

`each` adds multiple collection shapes and iterator events. Callable linking
opens runner environments, frame transfer, recursion, and source identity.
Neither is the single counted-frame slice.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/for.ts` | modify | expose a pure structural shape owner |
| `packages/core/src/ir/semantics/internal-effect-machine.ts` | modify | claim, preflight, and execute counted for frames |
| `packages/core/tests/runtime-envelope-effect-machine-for.test.ts` | add | discriminating range/effect/control fixtures |
| `packages/core/tests/runtime-envelope-effect-machine.test.ts` | modify | exact disposition contract |
| `scripts/check-runtime-envelope.mjs` | modify | bind ownership and deferral witnesses |
| `scripts/kern-5-fitness-policy.json` | modify | add internal counted-for oracle |
| `docs/kern-5-support-matrix.md` | modify | publish truthful internal support evidence |
| `docs/kern-5-release-train.md` | modify | record M3.10 receipt after gates pass |

## Acceptance Criteria

- [x] Root and nested valid counted `for` frames select and remain inside the
  private effect machine; `try` and `each` remain legacy.
- [x] `from`, `to`, and `step` are evaluated exactly once before the first
  iteration; omitted step is 1 and zero step rejects.
- [x] Positive and negative steps use half-open range semantics, including empty
  and direction-mismatched ranges.
- [x] Every iteration emits one canonical `iter-next` before body events and
  uses a fresh marked child scope with an integer-provenanced induction binding.
- [x] Body mutation of the induction binding cannot change the next index;
  inner `let` does not leak, while outer assignments write through.
- [x] Repeated capability effects have byte-identical raw sync/async traces.
- [x] Unlabelled `break`/`continue` are consumed by the nearest loop;
  `return`/`throw` propagate unchanged.
- [x] Complete-tree structural verification rejects unsupported descendants
  before provider calls or trace events.
- [x] Sync and async envelopes enforce one shared caller-configured iteration
  budget across nested loop frames before raw `iter-next` trace growth.
- [x] The machine calls `forRuntimeRange` and contains no copied range evaluator
  or legacy sync/async reference-runner call.
- [x] Public exports and ABI are unchanged; callable environments stay
  ineligible.
- [x] Focused runtime-envelope tests, `pnpm fitness:kern-5`, and terminal
  full-roster `agon review` pass.

## Completion Evidence

- Focused counted-for tests passed 17/17, while tests passed 10/10, and
  `pnpm test:kern-runtime-envelope` passed 91/91 plus containment.
- `pnpm fitness:kern-5`: the repaired full aggregate wall passed on 2026-07-13;
  browser budget remained 75 modules and 290,799 gzip bytes.
- Full-roster review:
  `/Users/nicolascukas/.agon/runs/review-1783921094865-osg7xv-kern5-m3-10-iteration-budget-clo`
  completed 3/3 with zero verified findings. Its two needs-check items were the
  intentionally open spec and release-train checkboxes closed by this receipt.

## Out of Scope

`try`/`catch`/`finally`, `each`, labelled control, iterable protocols, callable
or module linking, runner function/class/`this` environments, public ABI, and
legacy-runner removal.

## Open Questions

None. No ASSUMED or OPEN claim feeds the recommended fixtures.

## Deploy Order

Implementation, tests, policy, matrix, and release receipt ship in one signed
branch commit. The private default-off envelope creates no external skew window.
Kill switch: restore `for: 'legacy'`, remove its ownership row, and restore the
containment deferral witness.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Existing `for` contract coverage could imply machine ownership. | Both sync and async contract paths still delegate the body to a reference runner. | The red oracle must call the private machine directly and prove pre-effect rejection of a nested legacy frame. |
| Normalized `maxEvents` bounded counted-loop execution. | Raw `iter-next` events are filtered during normalization, so a large or nested range could exhaust CPU and memory before the normalized event limit. | The effect machine now consumes one shared budget derived from caller-configured `maxCollectionLength`; direct loop callers must supply it, and sync/async envelope regressions bind the plumbing. |
