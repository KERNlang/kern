# KERN 5 RT-5: Asynchronous same-module user function calls

**Status:** IN PROGRESS
**Date:** 2026-09-01
**Base:** `5e359bb6` (RT-4 same-module synchronous user calls)
**Confidence:** 0.88

## Executive Summary

RT-4 gave the shared linked program a call boundary, but it was a *synchronous*
boundary: a `capability` statement anywhere in the reachable callee closure was
rejected at link with `KIR_CALL_CALLEE_CAPABILITY`, because RT-1's expression
evaluator is synchronous and an awaiting callee in expression position would
inject a microtask hop into every leg. Factoring therefore stopped exactly where
it matters — you could not name a piece of behavior that talks to the outside
world.

RT-5 admits a capability inside a callee by narrowing where such a callee may be
*called*: an async-classified callee is admissible only as the entire `value` of
a `let`, `print`, or `return` statement, at any block depth. That position is the
one place where all three legs already have a statement boundary they can suspend
on, so no leg gains an await point in expression position and the synchronous
call boundary RT-4 established is left byte-identical.

## Current State / Root Cause

- **VERIFIED (RED, at base `5e359bb6`):** every async position projects and is
  then rejected by RT-1, the JavaScript compiler and the Python compiler with
  `handler-entry-unsupported`, while the synchronous control is admitted on all
  three legs. Measured 2026-09-01:

  | Probe | F5 | RT-1 / JS / Python at base |
  | --- | --- | --- |
  | `let` value, `print` value, `return` value | projected | `handler-entry-unsupported` |
  | nested-block `let` value (inside an `if` branch) | projected | `handler-entry-unsupported` |
  | transitive callee (`mid` calls the capability-bearing `fetchIt`) | projected | `handler-entry-unsupported` |
  | async callee of an async callee | projected | `handler-entry-unsupported` |
  | binary operand, nested argument, `if` condition | projected | `handler-entry-unsupported` |
  | synchronous callee control | projected | **admitted** |

Root cause: `resolveHelper` in `linked-kir-program/link.ts` faults with
`KIR_CALL_CALLEE_CAPABILITY` for any capability in the reachable closure, and
both `kir-runtime/expression.ts::callHelper` and both emitters' `helperSource`
are unconditionally synchronous.

## Walker Decision (taken before any runtime code was written)

> The tribunal required a recorded choice between (α) refactoring statement
> stepping into a shared core used by both the synchronous `callHelper` path and
> an asynchronous suspending driver, and (β) a separate async walker that mirrors
> the synchronous stepping.

**Chosen: α — one shared statement-stepping core, expressed as a *synchronous*
generator.**

`kir-runtime/expression.ts` gains `walkStatements(...)`, a synchronous generator
that owns the entire statement stepping model — the explicit block-frame stack,
the meter charge, the cancellation checkpoint, `let` binding, `print` tag and
event-budget rules, `if` branch selection, and the return tag guard. It *yields*
a `StatementStep` at the two points where a leg may have to suspend: a
`capability` statement, and a user call to an async-classified callee in
statement-value position.

Two drivers consume it:

- `callHelper` (the synchronous path) drives it with plain `.next()` calls. A
  synchronous generator suspends and resumes with **no microtask hop**, so the
  synchronous path gains no `await` and RT-4's tick discipline is untouched. If
  it ever receives a yield it fails closed, exactly as RT-4's callee-capability
  branch did.
- `execute.ts` drives it from the entry runner's explicit frame stack, which now
  holds *continuation frames*: a stack of core instances. A callee body never
  recurses on the host stack, and the only `await` in the whole chain is the
  provider call inside the capability branch of the driver.

**Rationale.**

1. The binding constraint is that `callHelper` must not gain an `await`. A
   synchronous generator is the one construct that lets the *same* stepping code
   serve an awaiting driver and a non-awaiting one, because the suspension is a
   `yield`, not a promise.
2. β would leave two independently written statement walkers. The
   `walker-divergence` mutant (sync and async walkers stepping an `if`/`else`
   body differently) would then be caught only by whichever fixtures happened to
   cover it. Under α that divergence is *structurally impossible*: branch
   selection, the binding rule, the event-budget rule and the checkpoint are
   written once.
3. It is cheaper, not more expensive. The core replaces the duplicated stepping
   loops that already existed in `execute.ts` and `expression.ts`, so the slice
   stays inside the ≤10 file / ≤700 net line budget without a 5a/5b split.

The one behavioural difference between the entry and a callee — the entry meters
its `return` statement and a callee does not, and their return-type mismatch
faults carry different closed codes — is a two-field policy passed to the core,
not a second copy of the walker.

## Contract

> Binding tribunal verdict for slice `rt5-async-user-fn-call`.

### Scope

An async-classified callee is admissible **only** as the entire `value` of a
`let`, `print`, or `return` statement, at any block depth. Every other position —
binary operand, nested argument of another call, item of a list literal, `if`
condition, `capability` input — is rejected at link with
`KIR_ASYNC_CALL_EXPRESSION_POSITION` under the existing closed wire code
`handler-entry-unsupported`.

Recursion is still rejected (`KIR_CALL_RECURSION`). The exports policy, the
closed cross-call type set `{boolean, text, list<boolean>, list<text>}`, the
F0–F5 pipeline, the ledger and the corpus are untouched.

#### `KIR_CALL_CALLEE_CAPABILITY` is narrowed, not deleted

RT-4's rule was "a `capability` anywhere in the reachable callee closure is
rejected, at every call position". RT-5 narrows it to "a `capability` anywhere in
the reachable callee closure is rejected **when the callee is reached from a
non-statement position**". The label is therefore retained and is emitted
alongside the position label, so the rejected diagnostic reads

```
<label>: KIR_ASYNC_CALL_EXPRESSION_POSITION (KIR_CALL_CALLEE_CAPABILITY)
```

`async` has exactly one source under the fixed point below — a `capability`
statement — so the two facts are always jointly true at a rejected position, and
the message states both. The position-gate suite pins both labels, so deleting
either one fails.

### Classification

`async(f) = containsCapability(f) ∨ ∃ callee g of f . async(g)`.

This is exactly RT-4's memoized reachable-closure walk
(`linkedStatementsInvokeCapability`), including argument-position calls, so RT-5
reuses it rather than adding a second traversal. The fixed point is computed
**once** in the linker, after the whole reachable closure is linked, by asking
the shared walk for each linked helper in name-sorted order. Because recursion is
rejected the closure is acyclic and the memo is exact, so the answer is
order-independent.

The result is stored on the linked helper record as `async`, with
**omit-when-false canonicalization**: the field is `undefined`, and therefore
absent from `canonicalJson`, for every synchronous helper. A call-free program
still carries no `helpers` field at all. This is what keeps every RT-4 digest —
call-free *and* helper-bearing — byte-identical, and it is pinned as a
canonicalization contract plus an emitter-agreement fixture.

### Execution on RT-1

Suspension happens only at the `capability` statement inside an async callee, on
the entry runner's explicit frame stack. Callee frames are pushed as continuation
frames; a return pops one and resumes the parent with the value. The capability
ordering is exactly RT-4's: charge the meter → `checkAbort` → evaluate the input
→ check the event budget → `await` the provider → post-await `checkAbort` →
validate the slot → commit the event. Resume is zero-cost in the meter.

Metering is RT-4's formula unchanged: one step for the call node, one step per
argument node left to right, one dispatch step, then the callee's body statement
steps, with the callee's `return` consuming no statement step.

### Provider propagation

The entry's `hasCapability` is already computed over the whole reachable closure,
so it becomes true when any reachable callee is async. The provider check stays
**pre-execution** on all three legs: it runs before the pre-cancelled check and
before any statement, so a program whose first statement is a `print` and whose
second statement calls a transitively async callee fails with `capability-error`
having committed **no** event.

### Cancellation contract

**Contract A — leg-defined resolution boundary.** KERN-checkpoint parity is
required across the three legs: every leg must observe an abort at the same
*KERN* checkpoint (statement boundary, post-await checkpoint) and produce the
same envelope. Native scheduler-hop parity is explicitly **not** promised: a
JavaScript `await` adds a promise-job hop that Python's `await` of an already
completed coroutine does not have, so a fixture that counts host microtasks may
legitimately land on different sides of a hop on different legs.

Consequently:

- Fixtures whose abort is delivered *by the provider* assert full envelope
  byte-parity across the three legs, because the provider call is a KERN
  checkpoint on every leg.
- Fixtures whose abort is delivered by a *host microtask counter* assert only
  that the KERN-level outcome agrees, and are restricted to capability-free
  (RT-4-shaped) chains where no leg has a suspension point at all.

### Emission

An async-classified helper is emitted as `async function` (JavaScript) and
`async def` (Python). A call site emits `await` only when the callee is
async-classified at link; a synchronous callee's call site is byte-identical to
RT-4. Python must `await` the coroutine and never call it bare.

Because Python wraps every expression node in `_expression(_meter, lambda: …)`
and a lambda cannot contain `await`, the async call is lowered at the *statement*
level in both emitters rather than inside the expression lowering: the call
node's meter step is emitted explicitly and the awaited call becomes the
statement's right-hand side. The evaluation order — call-node step, then
arguments left to right, then dispatch — is identical to the synchronous
lowering.

### Format compatibility

`LinkedKernKirProgram.program` is untouched, `TARGET_KERNEL_SHA256` is unchanged,
and no `LinkedKernKirExpression` variant is added, so the RT-3 K0 golden's
`linkedExpressionKinds` inventory is unchanged too.

**Blocking oracle:** every RT-4 digest — the five call-free fixtures and the
seven helper-bearing fixtures — must stay byte-identical for the linked program,
both emitted artifacts and both manifests. If it cannot hold, the slice stops.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | Modified | Optional `async` on the helper record and the async-name accessor. |
| `packages/core/src/kir-runtime/linked-kir-program/expression.ts` | Modified | `containsAsyncCall`, and `isAsync` on the call scope. |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | Modified | The position gate, the narrowed capability label, the fixed point, and the `async` flag on emitted helpers. |
| `packages/core/src/kir-runtime/linked-kir-program/index.ts` | Modified | Re-export the async accessor. |
| `packages/core/src/kir-runtime/expression.ts` | Modified | The shared statement-stepping core, and `callHelper` reduced to a synchronous driver. |
| `packages/core/src/kir-runtime/execute.ts` | Modified | The suspending driver over a stack of continuation frames. |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | Modified | `async` helper lowering and the awaited statement-level call site. |
| `packages/core/src/compiler/kir-python/emitter.ts` | Modified | The Python twin. |
| `scripts/kern-5-rt5-async-user-fn-call/*` | Added | Probe matrix, classification golden, position gate, behavior, provider propagation, cancellation, metering, emission structure, compatibility, K0 divergence. |
| `package.json` | Modified | Root `test:kern-5-rt5-async-user-fn-call` script. |

Eight production files. No `packages/core/src` file is added or removed, so the
canonicalizer historical-transition gate does not apply.

## Acceptance Criteria

- [ ] A capability inside a directly called callee and inside a transitively
  reached callee is admitted in `let`, `print` and `return` position at any block
  depth, and agrees byte-identically on RT-1, emitted JavaScript and emitted
  CPython.
- [ ] Every other position fails closed at link on all three legs with
  `KIR_ASYNC_CALL_EXPRESSION_POSITION` and the retained
  `KIR_CALL_CALLEE_CAPABILITY` label.
- [ ] The classification fixed point is transitive and order-independent, and is
  serialized only when true.
- [ ] The entry requires a provider when any reachable callee is async, checked
  before any event is committed.
- [ ] The four cancellation fixtures agree on all three legs at the KERN
  checkpoint, with full envelope parity where Contract A promises it.
- [ ] Metering is RT-4's formula; a paired call costs exactly twice.
- [ ] No emitted synchronous helper contains `await`; every async call site does.
- [ ] Every RT-4 call-free and helper-bearing digest is byte-identical.
- [ ] RT-4 (50/50), RT-3 (142/142), RT-2 (35/35) and the neighborhood (83/83)
  stay green.

## Out of Scope

- Recursion, cross-module calls, member and dynamic callees, closures.
- An async callee in expression position, which is the whole point of the
  position gate.
- Integer signatures across a call boundary, which F5 rejects upstream.
- Corpus clearance, KIR schema or version changes, release-gate promotion.

## Open Questions

None blocking.
