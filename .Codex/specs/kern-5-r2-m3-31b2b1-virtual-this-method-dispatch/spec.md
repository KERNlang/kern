# KERN 5 R2 M3.31b2b1 Virtual `this.method` Dispatch

**Status:** COMPLETE
**Date:** 2026-07-16
**Confidence:** 0.99
**Parent objective:** M3.31b remaining same-root class composition

## Executive Summary

M3.31b2b1 should own non-optional `this.method(...)` calls in the same
generator-owned class value slots as M3.31b2a. Resolution starts at the
existing private receiver's concrete class, so a base template method invoked
on a derived instance dispatches to the nearest derived override. The selected
method then reuses the M3.31a resumable frame, including exact-once argument
evaluation, async suspension, nested completion, private cleanup, and the
single run-local class snapshot.

The capability planner's static-analysis queue must preserve two identities:
the method's declaring `ownerClass` for `super`, and the concrete
`receiverClass` for virtual `this`. Queue identity must include the receiver
class. This queue is not a runtime or resumption queue. Without both static
identities, one inherited base handler reached on two different derived
classes can be deduplicated before their different overrides are discovered.

Pure helper/class composition, effectful fields, virtual getter/property reads,
pre-super statements, and cross-module class identity remain later slices.

## Current State / Root Cause

- **VERIFIED:** compatibility method calls evaluate a receiver, resolve from
  `receiver.className`, and invoke the nearest method on that same receiver
  (`portable-reference-evaluator.ts:242-312`).
- **VERIFIED:** a class member activation stores the most-derived receiver in
  `runnerThis`, while retaining the declaring owner separately through
  `runnerSuperClass` (`portable-reference-body.ts:182-276`).
- **VERIFIED:** compatibility invocation rejects an already-active exact
  declaring-owner/member label through `runnerCallStack`; KERN class recursion
  is not silently replayed (`portable-reference-body.ts:182-205`).
- **VERIFIED:** the machine receiver helper already returns `runnerThis` only
  when the instance is owned by preflight or the active run state
  (`internal-effect-machine-class-instance.ts:22-31`).
- **VERIFIED:** machine method discovery deliberately returns `undefined` for
  `this` even though it already resolves normal receiver bindings and `super`
  (`internal-effect-machine-class-graph.ts:400-430`).
- **VERIFIED:** the M3.31a method generator already evaluates arguments
  left-to-right, binds a fresh member environment, delegates the body, consumes
  the nested return, and restores private state
  (`internal-effect-machine-class-frame.ts:112-151`).
- **VERIFIED:** whole-graph preflight analyzes every constructor, method, and
  getter against a synthetic owned receiver, while inheritance validation
  rejects cycles, member-kind changes, and method-arity changes
  (`internal-effect-machine-class-preflight.ts:175-235`;
  `internal-effect-machine-class-lineage.ts:43-85`).
- **VERIFIED:** capability planning currently carries only `ownerClass`; an
  unbound `this.method()` therefore falls into `ambiguousMethodNames`, losing
  the concrete receiver identity needed for exact override reachability
  (`runner-capability-plan.ts:650-710,871-925`).
- **VERIFIED:** current admission tests intentionally keep
  `this.method()` on compatibility, so the new oracle begins RED without a
  policy switch or hidden environment toggle
  (`runtime-envelope-effect-machine-class-super-method-admission.test.ts`).

The runtime gap is one exact dynamic-receiver branch in method discovery plus
the existing compatibility recursion guard. The planner gap is different:
declaration identity alone cannot model virtual dispatch, so the receiver class
must survive every queued constructor/method edge.

## Contract

> All claims feeding fixtures are VERIFIED against current compatibility,
> machine, inheritance, and planner sources on 2026-07-16.

| Behavior | M3.31b2b1 contract | Tag |
| --- | --- | --- |
| Syntax | exact non-optional `this.<method>(args...)` | VERIFIED |
| Activation sites | generator-owned `let`, `print`, or `return` value slots in constructors, methods, and getters | VERIFIED |
| Start class | `runnerThis.className`, not the declaring owner | VERIFIED |
| Resolution | nearest method from the concrete receiver class toward the root | VERIFIED |
| Receiver | reuse the existing most-derived private receiver | VERIFIED |
| Override safety | inherited kind and arity changes reject during graph admission | VERIFIED |
| Arguments | existing resumable scalar domain, evaluated left-to-right exactly once | VERIFIED |
| Body | existing nested class generator; sync or real-async effects may suspend without replay | VERIFIED |
| Recursion | reject an exact already-active resolved owner/member label using the captured call stack | VERIFIED |
| Construction | a base constructor may virtually dispatch on the most-derived receiver after its own base lifecycle begins; an override that reads a not-yet-initialized derived field fails exactly as compatibility does | VERIFIED |
| Planner owner | after every resolution, `ownerClass` is the class where the selected method was found and becomes the start identity for a later `super` call | VERIFIED |
| Planner receiver | concrete receiver class remains the start identity for a later `this` call | VERIFIED |
| Planner queue | handler identity includes concrete receiver class to prevent override-path deduplication | VERIFIED |
| Preflight | missing method, wrong arity, optional call, getter/property call, malformed metadata, or unowned receiver rejects before provider dispatch | VERIFIED |
| Mutation | selected registry, receiver class, resolved owner, params, and body remain the run-local snapshot across suspension | VERIFIED |
| Deferred | `this.getter`/field property virtualization, helpers, effectful fields, imports/modules, non-leaf node slots | VERIFIED |

## Implementation Options

### A. Dynamic private receiver plus dual planner identity — selected

Extend `internalMachineClassMethodForCall` with one `this` branch that requires
the owned private receiver, starts resolution at `receiver.className`, and
returns `receiverName: 'this'`. Reuse the existing generator frame and add the
compatibility call-stack guard there. Generalize class preflight's admitted
member-call branch from `super` to exact `super` or `this` calls.

Extend the extracted capability dispatch result and handler queue with
`receiverClass`. Direct root calls set it to the constructed class; inherited
calls retain it; `this` resolves from it; `super` resolves from the declaring
owner's base while retaining it. Include it in queue keys.

### B. Resolve `this` from the declaring owner

Rejected. That is statically simpler but semantically wrong: a base template
method would bypass the derived override and disagree with compatibility and
emitted target behavior.

### C. Mark every same-named class method reachable

Rejected. This hides the receiver contract, pulls unrelated classes and async
capabilities into the plan, and can leave otherwise owned frames marked
unsupported. Exact receiver propagation is small enough to prove directly.

### D. Bundle helper/class composition and effectful fields

Rejected. Helpers use a separate trampoline and graph registry; fields require
a construction-time resumable initializer. Neither is needed for virtual
method dispatch.

## Planned Changes

- Extend the private class resolver and method frame; keep ordinary receiver
  and `super` behavior unchanged.
- Generalize only the existing class value-slot preflight; keep assignment,
  control, capability-input, `do`, fmt, and throw slots fail-closed.
- Extend `runner-capability-class-dispatch.ts` so the oversized planner loses,
  rather than gains, virtual-dispatch mechanics.
- Add focused lifecycle/admission tests plus exact capability-reachability
  oracles for a base template invoked on two different derived receivers.
- Add one convergence owner and retain helper/effect/pre-super/module blockers.

## Acceptance Criteria

- [x] RED proves a valid `this.method(...)` class graph selects compatibility
      before provider dispatch on the M3.31b2a tree.
- [x] A base template method invoked on a derived instance dispatches to the
      nearest derived override, reuses the same receiver, and continues after
      the nested return.
- [x] A three-level hierarchy proves `this` dispatch starts at the concrete
      receiver while a nested `super` starts at the selected override's
      declaring base.
- [x] Constructor remainder, method, and getter value slots exercise virtual
      calls without changing M3.31b1 construction order.
- [x] A base constructor that virtually selects a derived override reading a
      not-yet-initialized derived field matches compatibility failure before
      provider dispatch; this slice does not invent JavaScript TDZ semantics.
- [x] Arguments evaluate left-to-right exactly once and an async derived
      override suspends without replaying the base template or caller.
- [x] Exact direct and indirect recursive member labels reject with the
      compatibility error boundary and clear private activation state.
- [x] Provider rejection performs no compatibility retry and leaves no private
      activation state.
- [x] Post-selection mutation of receiver class metadata, inheritance,
      methods, params, bodies, or original registry cannot redirect dispatch.
- [x] Optional calls, missing methods, wrong arity, getter/property calls,
      unsupported arguments, invalid inheritance, and forged entry
      `runnerThis` reject before provider dispatch.
- [x] Capability planning reaches the exact async override selected by each
      concrete receiver, retains correct `super` ancestry inside that override,
      and does not pull an unrelated same-named method into executable scope.
- [x] Existing normal receiver dispatch, super dispatch, constructor lifecycle,
      and compatibility-only expression slots remain stable.
- [x] `runner-class-virtual-this-method-dispatch` becomes one evidenced unified
      owner; the parent blocker retains exact helper/effect/pre-super/module
      follow-ups.
- [x] Every new/touched handwritten file remains below 500 lines; the existing
      oversized planner shrinks through extraction.
- [x] Focused tests, convergence, lint/build, exact `pnpm fitness:kern-5`, and
      final six-engine Agon review pass with every finding adjudicated.

## Out of Scope

- Virtual `this.getter` or field/property reads, setters, static members, or
  streams.
- Base templates whose virtual target exists only on a derived class; the
  closed graph remains compatibility-selected until abstract/required method
  contracts give preflight a declaring-class witness.
- Helper calls from class frames or class calls from helpers.
- Capability/helper calls in field initializers or resumable field setup.
- Calls in assignment RHS, controls, capability inputs, fmt/throw values, or
  collection-`do` nodes.
- Statements before explicit constructor `super(...)`, conditional/nested
  constructor-super, or broader constructor-super expressions.
- Imported, re-exported, aliased, or cross-module class identity.
- General recursion, public frame APIs, or capability ABI changes.

## Adversarial Record

Nero `nero-1784227324370-sw17rp` returned **FLAWED** and rated the draft 22%
correct. Its five attacks were adjudicated against the current KERN model:

1. The field-shadowing/getter scenario requires pre-super statements and
   setter dispatch, both outside this slice. Constructor-time virtual dispatch
   remains real, so the acceptance matrix now pins compatibility failure when
   an override reads a not-yet-initialized derived field.
2. The alleged mutable runtime queue does not exist. The queue discussed here
   is capability-planner worklist state; runtime frames use the snapshotted
   class registry and an immutable receiver `className`. The static queue key
   is explicitly `resolved owner x concrete receiver x member`.
3. Setter/getter pairs are outside the KERN method-only contract. For nested
   method `super`, the spec now says explicitly that `ownerClass` becomes the
   class where virtual lookup found the selected method.
4. KERN compatibility, not JavaScript TDZ behavior, is the semantic oracle.
   Pre-super statements remain rejected; a base constructor dispatching to a
   derived override is separately executable and must reproduce compatibility
   success or failure.
5. KERN inheritance is single-parent. The described D-to-B-to-A chain is
   already covered by the contract: receiver lookup starts at D, records B as
   the selected owner, and nested `super` starts at B's immediate base A.

The pass therefore sharpened fixtures and planner identity without changing
the selected implementation. Build-decision confidence rose to 0.92 because
every runtime claim had a current-source owner and the remaining risks were
executable; the header records the later post-fitness confidence.

## Deploy Order

This slice stacks on `feat/kern-5-r2-m3-31b2-super-member` because GitHub PR
creation is permission-blocked and the user explicitly requested continued
stacking on the same branch. Build and review the entire slice locally, fetch
and rebase immediately before the single push, and never create a second push
for partial work.

## Final Review Record

All six usable engines completed both the initial final review
(`review-1784229445070-ij7bxg-kern-5-r2-m3-31b2b1-virtual-this`) and the
post-fix review
(`review-1784230029905-13rm3s-kern-5-r2-m3-31b2b1-virtual-this`). The valid
findings closed generic class-call diagnostics, member-body `print`, nested
virtual arguments, derived-only target documentation/admission, malformed
planner-key failure, constructor-key convergence, dedicated planner-test file
size, inherited-owner recursion coverage, and two-receiver base-constructor
planning coverage.

The post-fix MiniMax blocker was disproved. `findExecutableKernHandlers`
passes `item.receiverClass` into every next `calledExecutableHandlers` call,
and constructor refs retain `receiverClass: name`. The added executable oracle
constructs two derived classes sharing one base constructor whose
`this.load()` resolves to different overrides; capability planning returns
both exact requirements with no unsupported execution. The other important
recursion/key-collision claims contradicted the exact-label compatibility guard
or described desired deduplication of identical immutable lookup triples.
