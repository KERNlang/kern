# KERN 5 R2 M3.31b1 Option-C Constructor/Super Lifecycle

**Status:** COMPLETE
**Date:** 2026-07-16
**Confidence:** 0.98

## Executive Summary

M3.31b1 should own the first complete constructor-bearing inheritance path in
the private source-runner machine: exact linker-owned classes in one root
module, Option-C implicit base initialization, and one leading explicit
`super(...)` constructor call with pure scalar arguments. Construction must
evaluate each base layer in language order, suspend inside constructor bodies
without replay, and return only the most-derived private instance after the
complete chain.

This is deliberately smaller than all of M3.31b. `super.member` dispatch,
helper/class composition, effectful field initializers, and final module
identity stay fail-closed. The parent `runner-classes-state` blocker remains
visible until those paths and M3.31c imported/re-exported identity ship.

## Current State / Root Cause

- **VERIFIED:** M3.30 admits only inheritance components with no constructor;
  `assertLineageSurface` rejects any constructor in the lineage.
- **VERIFIED:** M3.31a provides generator-owned constructor, method, and getter
  frames that suspend on the existing capability request without replay.
- **VERIFIED:** current machine allocation evaluates all lineage fields
  base-to-derived before running only the selected class constructor. It has no
  base-constructor activation stack.
- **VERIFIED:** compatibility construction recursively runs base construction,
  then the current layer's fields, then the current layer's constructor.
- **VERIFIED:** compatibility currently extracts explicit `super(...)`
  arguments before running any constructor statement and later removes the
  matching top-level `do`. A legal pure local statement before `super(local)`
  is therefore reordered and its binding is unavailable to argument
  evaluation.
- **VERIFIED:** `hasDirectSuperCtorCall` is the canonical Option-C predicate
  shared by semantic validation and code generation, but compatibility
  construction uses a separate top-level string-prefix check.
- **VERIFIED:** semantic validation permits omitted `super(...)` only when the
  effective base constructor accepts zero arguments, including through
  constructor-less intermediate bases.
- **VERIFIED:** class conformance already freezes public emitted-leg behavior
  for explicit `super(name)`, base field/constructor initialization, and
  implicit base initialization before derived `this` use.
- **VERIFIED:** direct probes on the M3.31a tree produced `7` for a leading
  explicit `super(value)` constructor and `2,7` for an implicit derived
  constructor through a constructor-less middle layer on compatibility; a
  pre-super local used by `super(local)` failed compatibility admission.
- **VERIFIED:** machine member environments do not yet bind
  `runnerSuperClass`; `super.member` is a separate runtime path.

The missing owner is not another scalar expression case. It is a recursive,
resumable construction-layer activation that interleaves base activation,
per-layer field initialization, and constructor bodies while keeping one
most-derived receiver and one run-local class snapshot.

## Contract

| Field / Behavior | M3.31b1 contract | Evidence | Tag |
| --- | --- | --- | --- |
| Scope | exact linker-owned finite lineage in the selected root module | M3.30 lineage/graph owner | VERIFIED |
| Option-C mode | canonical `hasDirectSuperCtorCall`: absent means implicit `super()` at entry; present enters explicit mode | `constructor-super.ts`; semantic validator | VERIFIED |
| Explicit shape | exactly one leading direct top-level `do value="super(...)"`; non-leading, conditional, nested, or duplicate constructor-super remains compatibility | current portable constructor representation | PROPOSED |
| Pre-super segment | none in the admitted domain; any statement before explicit super remains compatibility before provider dispatch | brainstorm boundary plus compatibility debt | PROPOSED |
| Super arguments | evaluate left-to-right exactly once from literals, constructor params, and call-free `this`-independent scalar expressions | compatibility evaluator and fail-closed boundary | PROPOSED |
| Implicit arguments | pass `[]`; reject direct registries when the effective base constructor requires arguments | semantic Option-C rule | PROPOSED |
| Layer order | recursively initialize base; initialize current fields; run current constructor remainder | compatibility and emitted-leg behavior | VERIFIED |
| Constructor-less layer | passes `[]` to its base; arguments are never spread/forwarded through the layer | compatibility recursion plus validator transitive rule | VERIFIED |
| Receiver | one private owned instance whose `className` remains most-derived for the complete chain | M3.30 instance identity | VERIFIED |
| Fields | pure outer scalar initializers only; derived declaration overwrites the base slot, including `undefined` | M3.30 field contract | VERIFIED |
| Suspension | generator stack preserves layer, fields, constructor locals, trace order, and run-local registry; completed constructor-body work never replays | M3.31a frame contract | PROPOSED |
| Completion | every constructor segment completes normally; no instance escapes on error | current constructor frame | VERIFIED pattern |
| Failure timing | malformed lineage, arity, super shape, pre-super access, or unsupported expression rejects before any provider | source-engine admission contract | PROPOSED |
| Mutation | caller metadata replacement after selection cannot alter the registry, constructor bodies, params, fields, or base identity | M3.30 snapshot owner | VERIFIED |
| Deferred | `super.member`, helpers in class frames, effectful fields, imported/re-exported classes, static/setter/stream members | M3.31a spec | VERIFIED |

## Implementation Options

### A. Recursive generator-owned construction layers — selected

Create one private construction-layer generator. Allocation creates an empty
most-derived private receiver. For each layer, the generator determines the
canonical Option-C mode, evaluates permitted leading-super arguments,
recursively completes the base layer, initializes the current layer's pure
fields, and runs the constructor remainder. One constructor environment belongs
to each layer and survives every suspension in that remainder.

Graph admission independently validates direct registries: exact base identity,
constructor arity, one leading direct super statement, call-free scalar super
arguments, and no unsupported descendant anywhere in the chain. Public source
semantic validation remains necessary but is never the machine's only guard.

### B. Extract super arguments and run all constructors afterward

Rejected. This preserves the current compatibility reordering, loses pre-super
locals, and cannot represent capability suspension at the authored position.

### C. Ship constructor super and `super.member` together

Deferred after the completed brainstorm. They share lineage metadata but not lifecycle:
constructor super recursively creates layers before the receiver is usable,
whereas `super.member` dispatch runs on an already-complete receiver and needs
declaring-owner method resolution. Combining them enlarges the first regression
surface without being required for a constructor-bearing inheritance program.

### D. Flip the complete class blocker

Rejected. Helper/class composition, effectful fields, defining-module tokens,
and imported class identity remain independent unowned contracts.

## Blast Radius

| File / owner | Action | Reason |
| --- | --- | --- |
| new private construction-layer module | add recursive generator activation | isolate lifecycle from scalar dispatch |
| `internal-effect-machine-class-activation.ts` | split empty receiver and one-layer field initialization | stop eager whole-lineage fields |
| `internal-effect-machine-class-frame.ts` | delegate allocation to construction-layer generator | preserve M3.31a continuation semantics |
| `internal-effect-machine-class-lineage.ts` | replace blanket constructor rejection with exact b1 admission | admit only the frozen lineage |
| `internal-effect-machine-class-preflight.ts` | preflight both constructor segments and super arguments | reject before provider dispatch |
| focused class-super oracle | add source/direct parity, order, suspension, and negatives | RED/GREEN evidence |
| convergence manifest/checker/tests | add narrow evidenced owner, retain parent blocker | truthful release ledger |
| release train/spec | record exact scope and receipts | auditable handoff |

## Acceptance Criteria

- [x] RED proves the current machine routes constructor-bearing inheritance to
      compatibility before provider dispatch.
- [x] Public source and direct-machine paths construct a derived class whose
      explicit linear `super(arg)` initializes base fields/constructor before
      derived fields/constructor, byte-matching compatibility and emitted legs.
- [x] Option-C omitted `super` injects no-arg base initialization at entry and
      permits derived `this` use only after the base layer completes.
- [x] A transitive lineage with a constructor-less middle class reaches the
      effective base constructor and preserves most-derived receiver identity.
- [x] A non-leading explicit super, including `let local; super(local)`, remains
      compatibility before provider dispatch and is recorded as b2 parity debt.
- [x] Leading super arguments evaluate left-to-right exactly once and accept
      only literals, constructor params, and call-free `this`-independent
      scalar expressions.
- [x] Base and derived constructor capabilities execute in authored order on
      sync and real-async providers; provider rejection never retries
      compatibility or leaks the partial receiver.
- [x] Direct registries reject wrong arity, duplicate/conditional/nested super,
      non-leading super, effectful/call arguments, pre-super
      `this`/`super.member`, cyclic/unknown/replaced bases, and post-selection
      metadata mutation before any earlier provider.
- [x] Constructor-less inheritance and all direct-class M3.26-M3.31a behavior
      remain byte-for-byte stable.
- [x] `super.member`, helper/class composition, effectful fields, imported
      classes, and module identity remain compatibility paths before provider
      dispatch.
- [x] One narrow convergence owner becomes unified while
      `runner-classes-state` remains deferred to M3.31b2/c.
- [x] Every touched handwritten source/test file remains below 500 lines.
- [x] Focused tests, capability planning, convergence, runtime envelope,
      browser budget, and exact `pnpm fitness:kern-5` pass.
- [x] Final full-roster `agon review` completes with every reported finding adjudicated
      against the current tree.

## Out of Scope

- Conditional or nested constructor-super execution.
- Any statement before an explicit constructor-super call.
- Effectful, helper, class-member, or capability-bearing super arguments.
- `super.method()`, super getter/property access, or cross-owner dispatch.
- Helper calls from constructors/methods/getters and helper/class recursion.
- Capability or helper calls in field initializers.
- Imported, re-exported, aliased, or cross-module class construction.
- Static members, setters, streams, arbitrary host values, public frame APIs,
  rollback promises, or a new capability ABI.
- Promotion or deletion of the full `runner-classes-state` blocker.

## Open Questions

None for M3.31b1. Constructor-less layers pass `[]`; the body runner reuses one
environment per constructor activation; effectful super arguments and all
pre-super statements are rejected from machine admission. Compatibility
ordering correction, broader argument expressions, and argument forwarding
belong to b2 and do not feed this implementation.

## Deploy Order

M3.31b1 stacks locally on the verified #534 head while that PR awaits an
authorized merge path. Before any push, fetch `origin`, inspect whether #534 is
now in `main`, and either create a fresh feature branch from `origin/main` or
continue the still-open branch exactly as directed. Never push the old branch
after merge.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| M3.31b was one constructor/super/helper/field slice. | Constructor layering, super-member dispatch, helper composition, and effectful fields have separate runtime owners. | Start with b1 constructor layering and retain the parent blocker. |
| Existing compatibility construction is a complete oracle for explicit super placement. | It extracts args before executing pre-super statements and uses a separate string-prefix detector. | Probe and correct or narrow before claiming parity. |
| Whole-lineage eager field initialization can be reused. | Base constructor must run before derived fields; eager initialization violates layer order once constructors exist. | Split empty receiver creation from per-layer fields. |

## Adversarial Record

Full-roster brainstorm
`brainstorm-1784214424237-larxrq-kern-5-m3-31b1-super-boundary`
completed 6/6 and recommended **NARROW**. The incorporated boundary admits
only implicit no-arg descent and one leading top-level explicit super with
call-free scalar arguments. Pre-super statements, effectful arguments,
super-member dispatch, helpers, effectful fields, and module identity remain
separate fail-closed work. The brainstorm also confirmed that constructor-less
layers pass `[]` and that each constructor frame must retain one environment
across suspension.

The first terminal review
`review-1784217580758-2mesx2-kern-5-r2-m3-31b1-constructor-su`
completed 6/6 with zero verified findings and five needs-check items. Four
reviewers independently questioned the obsolete synchronous construction
fallback; tracing proved every admitted construction is generator-owned, so the
dead fallback was deleted and its live frame owner was convergence-bound. The
reported lambda-super blocker was disproved because the canonical Option-C
predicate intentionally ignores non-executed lambda calls while frame preflight
still rejects the lambda expression before dispatch. That trace exposed one
separate verified preflight bug: pure constructor arguments caused a resumable
construction result to be treated as exact, so base-constructor values could
select the wrong outer control path. Every class-construction output is now
marked deferred, with a regression and mutation witness.

The final full-roster review dispatched all six usable engines across
`review-1784220056869-n5svyh-kern-5-r2-m3-31b1-constructor-su` and the missing-
engine retry
`review-1784220336939-kraaju-kern-5-r2-m3-31b1-constructor-su`. Five engines
returned usable reports; Kimi timed out twice, including the retry's complete
600-second wall. No returned report verified a blocker. The repeated field-
initializer receiver concern was disproved by the frozen M3.30 outer-scalar
contract, which explicitly forbids field initializers from reading `this`.
The eager-preflight/base-constructor concern is unreachable because every
resolvable construction is intercepted by deferred construction preflight,
and lineage reconciliation preserves its structural field state. Remaining
reports were performance/diagnostic nits or defenses already provided by
independent lineage admission and runtime checks.

The exact final `pnpm fitness:kern-5` wall passed after those corrections with
432/432 cross-target fixtures, 109/109 class fixtures, 233 native cases, 48/48
checker fixtures, 39/39 validator verdicts, and 40 application fixtures on
three legs plus whole-app boot. The browser wall passed at 147 modules /
1,486,452 raw / 321,435 gzip bytes / 60 ms cold / 90 ms median. Build, lint,
workspace, infrastructure, runtime ABI, internalization, and source-runner
convergence gates also passed.
