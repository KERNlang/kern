# KERN 5 R2 M3.31b2a Super-Method Dispatch

**Status:** COMPLETE
**Date:** 2026-07-16
**Confidence:** 0.99
**Parent objective:** M3.31b remaining same-root class composition

## Executive Summary

M3.31b2a should own `super.method(...)` inside already-admitted same-root
constructors, methods, and getters. Resolution starts at the declaring
member's immediate base, walks toward the root, invokes the nearest method on
the existing most-derived private receiver, and reuses the M3.31a generator
stack so arguments and the base method may suspend without replay.

This slice does not bundle helper/class composition, effectful fields,
pre-super statements, or imported module identity. Those paths have different
admission and lifecycle owners and remain compatibility selections before any
provider dispatch.

## Current State / Root Cause

- **VERIFIED:** compatibility member activation binds `runnerSuperClass` from
  the declaring owner's `extendsName`, not from the dynamic receiver class
  (`packages/core/src/ir/semantics/portable-reference-body.ts:182-227,230-276`).
- **VERIFIED:** compatibility `super.method(...)` resolves from that base name,
  walks ancestors, invokes the resolved member on `runnerThis`, and evaluates
  arguments left-to-right (`portable-reference-evaluator.ts:242-269,272-312`).
- **VERIFIED:** emitted TypeScript/Python conformance requires an overridden
  `Dog.describe` to call `Animal.describe` and produce
  `Rex is an animal (a dog)` (`scripts/class-conformance.mjs:53-75`).
- **VERIFIED:** the public source runner compatibility path already produces
  `x/child` and `y/child` for constructor plus super-method dispatch
  (`packages/core/tests/runner-source-executor.test.ts:1123-1154`).
- **VERIFIED:** machine member and constructor environments bind `runnerThis`
  but omit `runnerSuperClass`
  (`internal-effect-machine-class-activation.ts:83-125`).
- **VERIFIED:** machine method-call discovery only accepts an owned identifier
  receiver and therefore cannot resolve the unbound `super` identifier
  (`internal-effect-machine-class-graph.ts:376-420`).
- **VERIFIED:** machine scalar classification and generator evaluation already
  delegate every admitted method call through the resumable method frame
  (`internal-effect-machine-class-value.ts:51-85`;
  `internal-effect-machine-class-value-runtime.ts:59-77`).
- **VERIFIED:** a method invocation creates a distinct semantic environment,
  delegates to a nested body generator, receives its contained completion
  trace, converts that return to a scalar, and then resumes the caller
  (`internal-effect-machine-class-activation.ts:105-125`;
  `internal-effect-machine-class-frame.ts:115-151`).
- **VERIFIED:** whole-graph class preflight rejects every call expression in a
  class body before the scalar classifier can admit it
  (`internal-effect-machine-class-preflight.ts:53-102,147-190`).
- **VERIFIED:** whole-graph preflight visits every constructor, method, and
  getter in every admitted class, so a helper-bearing base target rejects even
  when only a derived `super` call reaches it
  (`internal-effect-machine-class-preflight.ts:147-190`).
- **VERIFIED:** semantic validation treats `super.member` separately from the
  constructor `super(...)` predicate and permits it after implicit base
  initialization (`packages/core/tests/class-semantics.test.ts:677-701`).

The missing behavior is one declaring-owner-aware method resolver plus the
private `runnerSuperClass` binding in machine class activations. A dynamic
receiver-based lookup would be wrong: when a method declared on `Middle` runs
on a `Derived` instance, its `super` must start at `Middle`'s base, not invoke
`Middle` again.

## What Already Works

- M3.31a owns resumable constructor, method, and getter bodies and recursively
  evaluates nested scalar invocations without replay.
- M3.31b1 owns explicit/implicit base construction and leaves one fully
  initialized most-derived receiver for member dispatch.
- The snapshotted run-local class registry already preserves lineage and
  declaring-owner metadata across provider suspension.
- Existing method frames already validate arity, require a scalar return,
  clean up private state on rejection, and preserve trace order.

## Contract (Verified)

> Verified against the cited compatibility, semantic, machine, and conformance
> sources on 2026-07-16. No ASSUMED or OPEN claim feeds a fixture.

| Behavior | M3.31b2a contract | Evidence | Tag |
| --- | --- | --- | --- |
| Syntax | non-optional `super.<method>(args...)` only | `portable-reference-evaluator.ts:246-258` | VERIFIED |
| Activation sites | generator-owned `let`, `print`, or `return` scalar leaves in a constructor remainder, method body, or getter body | class leaf generator and compatibility member env | VERIFIED |
| Start class | exact `extendsName` of the currently executing constructor/member owner | `portable-reference-body.ts:200-212,249-261` | VERIFIED |
| Resolution | nearest method from the start class toward the root | `portable-reference-body.ts:156-170` | VERIFIED |
| Receiver | reuse the existing most-derived private receiver | `portable-reference-evaluator.ts:248-257` | VERIFIED |
| Arguments | existing resumable scalar domain, evaluated left-to-right exactly once | M3.31a scalar generator and compatibility evaluator | VERIFIED |
| Body | existing generator-owned class frame; sync or real-async capabilities may suspend without replay | M3.31a frame contract | VERIFIED |
| Caller continuation | a base `return` completes only the nested invocation; the caller consumes the scalar and continues | `internal-effect-machine-class-frame.ts:137-148` | VERIFIED |
| Nested super | a resolved base method receives its own declaring owner's base as the next `runnerSuperClass` | `portable-reference-body.ts:195-212` | VERIFIED |
| Locals | every invoked owner gets a distinct `makeEnv` binding map; same-named locals cannot alias across the chain | `internal-effect-machine-class-activation.ts:105-125` | VERIFIED |
| Preflight | missing base/method, wrong arity, optional call, unsupported argument, or malformed direct metadata rejects before any provider | source runner admission contract | VERIFIED |
| Transitive boundary | every base/derived body is preflighted; a helper-bearing target or virtual `this.method()` keeps the complete graph on compatibility | `internal-effect-machine-class-preflight.ts:147-190` | VERIFIED |
| Expression slots | assign/control/capability/fmt/throw and collection-`do` expressions remain compatibility until those owners accept resumable class values | current leaf/control runtime boundaries | VERIFIED |
| Mutation | resolution after suspension uses only the snapshotted run-local registry and captured owner name | M3.30/M3.31a snapshot contract | VERIFIED |
| Deferred | super getter/property access, `super(...)` outside b1, helper/class composition, effectful fields, imports/module identity | current compatibility and b1 boundaries | VERIFIED |

## Implementation Options

### A. Declaring-owner super-method resolver — selected

Bind `runnerSuperClass: cls.extendsName` in every private constructor and
member environment. Extend the machine method-call resolver with one exact
`super` branch that requires an owned `runnerThis`, resolves from the bound
base in the run-local registry, and returns `receiverName: 'this'`. The current
method frame then owns argument evaluation, body suspension, completion, and
cleanup unchanged. Whole-graph preflight recognizes only this exact call shape
and recursively validates its arguments.

### B. Rewrite all class member dispatch around a generic receiver object

Rejected. Normal identifier calls already have a correct, mutation-tested
owner. Replacing that path increases regression surface without adding a
language behavior required by this slice.

### C. Bundle helpers, effectful fields, and module identity

Rejected. Helpers require mixed-graph reachability and recursion rules;
effectful fields require a construction-time resumable initializer; imported
classes require defining-module identity. None is needed to implement or prove
declaring-owner super dispatch.

## Blast Radius

| File / owner | Action | Reason |
| --- | --- | --- |
| `internal-effect-machine-class-activation.ts` | bind the declaring owner's immediate base in private constructor/member envs | establish exact super start identity |
| `internal-effect-machine-class-graph.ts` | recognize and resolve exact super-method calls | one fail-closed discovery owner |
| `internal-effect-machine-class-preflight.ts` | permit only resolved super calls and recurse through arguments | reject before provider dispatch |
| existing class value/frame modules | reuse unchanged where possible; convergence-pin the route | preserve M3.31a continuation semantics |
| focused super-method oracle | add parity, declaring-owner, suspension, mutation, and negative tests | RED/GREEN evidence |
| capability planner oracle | prove base-method async reachability is no longer unsupported | planner/runtime parity |
| convergence manifest/checker/release docs | add a narrow owner and retain parent blockers | truthful release ledger |

## Acceptance Criteria

- [x] RED proves a semantically valid same-root `super.method(...)` program
      selects compatibility before provider dispatch on the M3.31b1 tree.
- [x] Public source and direct-machine paths byte-match compatibility for an
      override that calls a base method with scalar arguments.
- [x] A three-level hierarchy proves lookup starts from the declaring owner,
      not the most-derived receiver, and chained super calls walk one level at
      a time without recursion, local-binding collision, or replay.
- [x] A super result used before additional caller statements proves the base
      `return` completes only the nested invocation and does not truncate the
      overriding method body.
- [x] Constructor remainder and getter body may call a base method only after
      the M3.31b1 base lifecycle has completed.
- [x] Existing M3.31a argument evaluation remains left-to-right and exactly
      once, and the focused M3.31b2a oracle proves the base method may suspend
      on a real async provider without replaying the derived activation.
- [x] Provider rejection unwinds both derived and base activations, performs no
      compatibility retry, and leaves no private activation state. A receiver
      constructed before the call remains an ordinary completed root binding;
      this slice does not invent transactional rollback.
- [x] Post-selection mutation of `extendsName`, methods, bodies, params, or the
      original class registry cannot change the selected base method.
- [x] Direct registries reject missing/unknown base, missing method, wrong
      arity, optional super call, super getter/property access, unsupported
      arguments, and forged entry `runnerSuperClass` before any provider.
- [x] A helper-bearing base target and a base method containing virtual
      `this.method()` dispatch keep the entire graph on compatibility before
      any earlier provider.
- [x] Capability planning marks async capabilities reached through the base
      method executable without an unsupported class-frame marker.
- [x] Existing normal method/getter dispatch, constructor-super lifecycle,
      constructorless inheritance, and compatibility boundaries remain stable.
- [x] `runner-class-super-method-dispatch` becomes one evidenced unified owner;
      `runner-classes-state` retains helper/effect/module follow-ups.
- [x] Every new or touched handwritten source/test file remains below 500 lines;
      the pre-existing oversized capability planner was reduced by extraction.
- [x] Focused tests, convergence, lint/build, exact `pnpm fitness:kern-5`, and
      final full-roster Agon review pass with every returned finding adjudicated.

## Out of Scope

- Super field/getter/property reads, setters, static members, or streams.
- Super calls in assignment RHS, controls, capability inputs, fmt/throw values,
  or collection-`do` nodes.
- Virtual `this.method()` calls from class frames, including a base template
  method that dynamically dispatches to a derived override.
- A statement before explicit constructor `super(...)`, conditional/nested
  constructor-super, argument forwarding through constructor-less layers, or
  broader constructor-super expressions.
- Helper calls from class frames, class calls from helpers, mixed recursion,
  or helper-bearing super arguments.
- Capability/helper calls in field initializers.
- Imported, re-exported, aliased, or cross-module class identity.
- New rollback semantics, public frame APIs, or capability ABI changes.

## Open Questions

None for the selected super-method-only owner. The compatibility runtime has
no special `super.<getter>` property-read branch, so getter/property super is
not promoted into an oracle here.

## Deploy Order

This internal eligibility expansion ships core behavior, focused oracle,
convergence policy, and release evidence in one branch created from fresh
`origin/main`. Older or skewed packages select compatibility for the new shape.
Immediately before the single push, fetch and rebase the branch. Merge only
after all PR checks pass; never reuse the branch after merge.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| M3.31b2 should bundle all remaining same-root class work. | Super dispatch, helper composition, and effectful field initialization have separate admission and lifecycle owners. | Ship b2a as a complete super-method owner and retain explicit b2 follow-ups. |
| Super lookup can start at the receiver's base. | The receiver may be more derived than the declaring method; dynamic lookup can reinvoke the same override. | Bind and resolve from the declaring owner's base. |
| The method frame needs a new continuation type. | M3.31a already owns argument and body suspension once discovery returns a resolved method and receiver. | Extend discovery/preflight only; reuse the generator frame. |

## Adversarial Record

Nero `nero-1784223614804-ftom64` returned **FLAWED** and rated the original
decision 33% correct. Its return-truncation, shared-local, and shared-handler
scenarios assumed super execution would reuse one body frame; the current
machine instead creates a new semantic environment and nested body generator,
then converts the contained return completion to a scalar before the caller
continues. Its helper-escape scenario is blocked because whole-graph preflight
visits the base body independently. Its virtual-dispatch scenario is a real
boundary, not a live bug: `this.method()` remains unsupported and causes the
whole graph to select compatibility. The acceptance criteria now make all five
assumptions executable: post-super continuation, same-named locals across
three levels, transitive helper rejection, and virtual-dispatch rejection.

The final review dispatched all six usable engines. Five completed in
`review-1784226020031-rupwy5-kern-5-r2-m3-31b2a-super-method-`; Claude's engine
failed twice there, then completed in
`review-1784226650868-o94yce-kern-5-r2-m3-31b2a-super-method-`. No engine
returned a verified blocker. The valid `print`-site coverage nit was closed in
the linked public-source oracle. The repeated field-initializer concern does
not apply: compatibility evaluates field expressions in the plain construction
environment without `runnerThis` or `runnerSuperClass`, and this slice keeps
effectful fields outside admission. Nested super calls in super-call arguments
are intentional members of the existing resumable scalar-argument domain.
