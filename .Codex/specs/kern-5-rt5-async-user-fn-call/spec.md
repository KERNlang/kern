# KERN 5 RT-5: Asynchronous same-module user function calls

**Status:** IMPLEMENTED
**Date:** 2026-09-01
**Base:** `5e359bb6` (RT-4 same-module synchronous user calls)
**Implemented at:** `54721dfc` (spec and probe matrix), `e2ec057d` (classification and
position gate), `a20780a6` (the shared walk and the suspending driver), `5fa14e61`
(both emitters), `69f2587f` (oracle suite)
**Confidence:** 0.91

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

Eight production files, 215 net production lines, inside the ten-file and
700-line budget. No `packages/core/src` file is added or removed, so the
canonicalizer historical-transition gate does not apply.

## Acceptance Criteria

- [x] A capability inside a directly called callee and inside a transitively
  reached callee is admitted in `let`, `print` and `return` position at any block
  depth, and agrees byte-identically on RT-1, emitted JavaScript and emitted
  CPython.
- [x] Every other position fails closed at link on all three legs with
  `KIR_ASYNC_CALL_EXPRESSION_POSITION` and the retained
  `KIR_CALL_CALLEE_CAPABILITY` label.
- [x] The classification fixed point is transitive and order-independent, and is
  serialized only when true.
- [x] The entry requires a provider when any reachable callee is async, checked
  before any event is committed.
- [x] The four cancellation fixtures agree on all three legs at the KERN
  checkpoint, with full envelope parity where Contract A promises it.
- [x] Metering is RT-4's formula; a paired call costs exactly twice.
- [x] No emitted synchronous helper contains `await`; every async call site does.
- [x] Every RT-4 call-free and helper-bearing digest is byte-identical.
- [x] RT-4 (50/50), RT-3 (142/142), RT-2 (35/35) and the neighborhood (83/83)
  stay green.

## RED Oracle

At base `5e359bb6` every async position projects and is refused by all three
legs; the sequencing commit records that table verbatim and the implementation
commits flip it, so the `probe-matrix.json` diff in this branch *is* the RED
evidence. Nine of the eleven probed positions moved from
`handler-entry-unsupported` to `admitted` on RT-1, the JavaScript compiler and
the Python compiler at once; `binary-operand`, `if-condition`,
`list-literal-argument` and `nested-argument` stayed refused by design.

| Suite | Tests | Failing at base |
| --- | --- | --- |
| `probe-matrix.test.mjs` | 4 | 0 (it records the base, then the implementation moves it) |
| `classification.test.mjs` | 6 | 6 |
| `behavior.test.mjs` | 18 | 18 |
| `position-gate.test.mjs` | 6 | 2 |
| `provider-propagation.test.mjs` | 4 | 3 |
| `cancellation.test.mjs` | 8 | 6 |
| `metering.test.mjs` | 5 | 5 |
| `emission-structure.test.mjs` | 9 | 8 |
| `compatibility.test.mjs` | 5 | 1 |
| `k0-divergence.test.mjs` | 9 | 9 |

`compatibility.test.mjs` is green at base by construction: it pins the byte
identity that must survive the change, so those rows are a regression fence.

## Verified Result

| Gate | Result |
| --- | --- |
| `pnpm test:kern-5-rt5-async-user-fn-call` | 74/74 |
| `pnpm test:kern-5-rt4-user-fn-call` | 50/50 |
| `pnpm test:kern-5-rt3-binary-expression` | 142/142 |
| `pnpm test:kern-5-rt2-boolean-if` | 35/35 |
| kern-5 r1 / r2 / c-py-1 / cli-shadow neighborhood | 83/83 |
| `packages/core` KIR unit tests | exit 0 |
| `pnpm test:kern-canonicalizer` | green, receipts refreshed |
| `biome check` | clean on every touched file |
| RT-4 byte identity | all twelve digests unchanged; pristine-restore re-diff empty |

The byte-identity claim was measured twice. The compatibility suite pins all
twelve RT-4 digests to values recorded on the base before any production file
moved. Independently, the eight production files were restored from `5e359bb6`,
the package rebuilt, every helper-bearing digest recorded, the slice restored,
rebuilt and recorded again: the diff is empty.

## Mutation Battery

Twenty-two mutants, applied as per-file backup copies and restored from those
copies, never by `git checkout`. All twenty-two are killed.

| Mutant | Killed by |
| --- | --- |
| `sync-callee-made-async` | classification |
| `await-dropped-at-async-call-site` (JavaScript) | behavior (three-leg envelope) |
| `await-dropped-at-async-call-site` (Python) | behavior (three-leg envelope) |
| `js-helper-not-async` | behavior |
| `python-helper-not-async` | behavior |
| `provider-check-entry-only` (RT-1) | provider-propagation |
| `provider-check-entry-only` (JavaScript) | provider-propagation |
| `provider-check-entry-only` (Python) | provider-propagation |
| `provider-check-made-lazy` | provider-propagation |
| `abort-swallowed-during-await` | cancellation |
| `post-await-checkabort-dropped` (JavaScript) | cancellation |
| `post-await-checkabort-dropped` (Python, first) | emission-structure |
| `post-await-checkabort-dropped` (Python, both) | emission-structure |
| `capability-event-committed-after-abort` | cancellation |
| `resume-double-metered` | metering |
| `classification-not-propagated-transitively` | classification |
| `classification-order-dependent` | classification |
| `async-flag-serialized-when-false` | compatibility |
| `expression-position-async-admitted` | position-gate |
| `walker-divergence` (if/else in a callee) | behavior |
| RT-4 `depth-policy-disabled` | RT-4 type-gate |
| RT-4 `closure-memo-removed` | RT-4 effects |

Two findings came out of the first pass.

- **`walker-divergence` survived** the first battery. Every callee-branch fixture
  in the suite took its *then* side, so a walker that ignored the condition
  inside a helper agreed with the real one everywhere. Two fixtures close it: a
  callee that takes its else side and a callee that falls through an untaken
  branch, both asserted on the events they commit and on the provider never being
  reached.
- **The Python post-await checkpoint is behaviourally redundant.** Removing both
  of its occurrences changed no envelope on any fixture, because the Python
  kernel's `_invoke_capability` — RT-2-era, untouched here — already fails closed
  on an abort or a timeout before it returns. The checkpoint is therefore pinned
  *structurally* rather than behaviourally: the emission suite asserts it follows
  the provider await and counts the helper's checkpoints exactly. Both variants
  die on that pin.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| The entry's return value can be handed back from the driver and turned into an envelope after the await. | `await runFrames()` yields to the microtask queue, so a queued abort gets a checkpoint RT-1 has and the emitted JavaScript does not. RT-2 and RT-3 tick fixtures caught it immediately. | The envelope is built inside the driver loop, exactly where RT-4 built it, and the await stays after the envelope exists. |
| An abort can be delivered between committing a capability event and entering the next statement. | The only suspension point any leg has is the provider call, and `events.push` through the next checkpoint is synchronous on all three legs, so nothing can interleave. | The commit-boundary fixture uses two capabilities: the abort lands inside the second provider await, so the first event is committed and the second never is. |
| RT-4's blanket `KIR_CALL_CALLEE_CAPABILITY` can simply be deleted. | The tribunal required it retained as a narrowing. | It is emitted alongside `KIR_ASYNC_CALL_EXPRESSION_POSITION`, and the position-gate suite pins both labels so deleting either fails. |
| A capability result can be passed as an argument to an async callee. | RT-4's cross-call type rule gives a capability result no static type, so such an argument was already inadmissible. | The mixed entry-capability fixture passes a parameter instead; the rule is RT-4's and is untouched. |

## Out of Scope

- Recursion, cross-module calls, member and dynamic callees, closures.
- An async callee in expression position, which is the whole point of the
  position gate.
- Integer signatures across a call boundary, which F5 rejects upstream.
- Corpus clearance, KIR schema or version changes, release-gate promotion.

## Open Questions

None blocking.
