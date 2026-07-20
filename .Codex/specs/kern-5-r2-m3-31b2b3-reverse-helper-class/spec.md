# KERN 5 R2 M3.31b2b3 — Reverse Helper-to-Class Composition

Status: IMPLEMENTED — final fitness wall and terminal 3/3 Agon review passed

## Intent

Close the same-root reverse edge left by M3.31b2b2: an admitted pure KERN
helper may allocate an admitted class, keep the owned instance strictly in
helper-local state, call its pure methods/getters, and return a portable value
through the existing helper contract. The machine must preserve reference-runner behavior without
adding a host/runtime ABI or allowing provider effects to hide inside the
synchronous helper trampoline.

M3.31b2b3 remains synchronous and pure. Effectful class fields, constructors,
methods/getters, pre-super work, and any helper continuation that can suspend
remain the named M3.31b2c boundary. Imported, re-exported, aliased, or
cross-module helper/class ownership remains M3.31c.

## Current State and Root Cause

- **VERIFIED:** M3.31b2b2 admits only class-to-helper composition. The helper
  graph rejects any reachable helper expression that allocates or accesses an
  admitted class with `machine helper: class use is outside the pure helper
  domain`. Evidence: `internal-effect-machine-helper-graph.ts`,
  `valueUsesOwnedClass` and `assertHelperBodyDoesNotUseClasses`.
- **VERIFIED:** the helper runtime accepts only `RunnerPortableValue`
  arguments/results and caches those results by helper name, portable argument
  graph, and integer provenance. Evidence:
  `internal-effect-machine-helper-runtime.ts`, `helperCacheKey`,
  `executePreparedHelper`, and `rememberHelperValue`.
- **VERIFIED:** the compatibility/reference function evaluator already models a
  wider `RunnerFunctionValue = RunnerPortableValue | RunnerClassInstanceValue`
  and deliberately does not cache instance results. Evidence:
  `portable-scalar-domain.ts:145-146` and
  `portable-reference-evaluator.ts`, `evalRunnerFunctionValue`.
- **VERIFIED:** machine-owned class instances carry a private per-run owner and
  are accepted only for preflight or the active machine state. Evidence:
  `internal-effect-machine-class-instance.ts`.
- **VERIFIED:** the class generator can allocate, invoke methods, and read
  getters without yielding when the reached class body is pure; it can also
  yield capabilities when reached bodies are effectful. Evidence:
  `internal-effect-machine-class-frame.ts` and
  `internal-effect-machine-class-value-runtime.ts`.
- **VERIFIED:** `executePreparedHelper` advances the body generator once and
  rejects any suspension or stdout/stderr/capability event. This prevents a
  hidden provider call, but without whole-graph pure preflight it would fail at
  runtime after machine selection instead of falling back before dispatch.
- **VERIFIED:** current class usage admission checks only the selected root
  sequence. Allocation in nested root containers is forbidden, while helper
  bodies are separately blocked by the helper graph. Evidence:
  `internal-effect-machine-class-graph.ts`, `assertRootClassUsage`.
- **VERIFIED:** class member execution currently returns a portable scalar.
  Machine and reference class frames both reject a class-instance member
  result. Evidence: `internal-effect-machine-class-frame.ts`,
  `portable-reference-body.ts`, `finishRunnerClassBody`.
- **VERIFIED:** the release train assigns helper-to-class allocation/member
  access to M3.31b2b3, effect/pre-super work to M3.31b2c, and module identity to
  M3.31c. Evidence: `docs/kern-5-release-train.md` and
  `scripts/source-runner-convergence-manifest.json`.
- **VERIFIED:** the existing containment oracle covers a helper returning a
  freshly allocated instance through a class method, but asserts only machine
  fallback; it does not prove that the compatibility path can consume a class
  instance as a class-member result. Evidence:
  `runtime-envelope-effect-machine-class-helper.test.ts`,
  `keeps helper-to-class instance composition outside this slice`.

## Contract

> Verified against branch head `666ee884` and live `origin/main` `d11fb900` on
> 2026-07-17. The required brainstorm
> `brainstorm-1784250372081-779t85-m3-31b2b3-boundary` completed 3/3 with
> `claude,codex,agy`; all three selected the portable helper boundary. ASSUMED
> implementation rows still require executable RED/GREEN evidence.

| Behavior | M3.31b2b3 contract | Tag |
| --- | --- | --- |
| Scope identity | helper, class, and every reached member are linker-owned by the selected same-root function/class maps | VERIFIED |
| Helper body | existing M3.24 canonical pure sequence; allocation/member access is newly admitted only for the exact owned class graph | VERIFIED |
| Class body | constructors/methods/getters reached from a helper must complete synchronously without capability, stdout/stderr, async/stream, or unsupported mutation | VERIFIED |
| Arguments | helper arguments remain portable scalar/record/array values; no class instance crosses into a helper parameter in this slice | VERIFIED |
| Local instance | helper `let item = new Widget(...)`, `item.method(...)`, field read, and getter read may use a machine-owned instance | VERIFIED |
| Helper result | remains `RunnerPortableValue`; a helper-local instance never crosses the helper call boundary | VERIFIED decision |
| Class member result | remains a portable scalar; returning an instance from a class method/getter is not widened | VERIFIED decision |
| Caching | every admitted helper result remains portable and keeps the existing bounded deterministic cache contract | VERIFIED decision |
| Suspension | helpers never yield; any reached effectful class path rejects during admission/preflight before provider dispatch | VERIFIED |
| Ownership | helper-local instances retain the active per-run state owner and cannot be returned, forged, or reused across overlapping runs | VERIFIED target invariant |
| Planner | reachability follows helper allocation/member access and marks reached capabilities unsupported unless the exact pure runtime contract owns the path | VERIFIED |
| Imports | imported/re-exported/aliased/cross-module functions or classes remain fail-closed for M3.31c | VERIFIED boundary |

## Options

### A. Local pure composition plus direct helper instance return

Allow helper-local construction and class use. Widen the machine helper result
to `RunnerFunctionValue`, skipping the cache for instance results exactly as
the reference evaluator does. A root or helper-local `let` may receive the
owned instance and use it. Class methods/getters still return portable scalars.

Rejected by all three brainstorm engines. Reference functions can return
instances, but the machine helper ABI is deliberately portable-only and the
named milestone can close its allocation/member-access edge without widening
identity transport or cache behavior.

### B. Local pure composition only; portable helper result only (selected)

Allow a helper to construct/use a same-root owned class only as an
implementation detail and require its final result to remain portable. This
preserves the machine helper signature and cache while closing the release
train's explicit helper-to-class allocation/member-access edge. Instance
transport is not part of the selected M3.31b2b3 contract.

### C. Full instance transport through class member results

Allow a class method/getter to return a helper-created class instance. This
makes the old containment oracle turn green directly, but contradicts the
current machine and reference class-member scalar contracts and expands the
slice beyond helper-to-class ownership. Select only if compatibility execution
proves this is already required behavior.

### D. Resumable/effectful helpers

Convert helper execution into generator-owned continuations so class effects
can suspend inside helpers. Rejected for this slice because it consumes the
explicit M3.31b2c effect boundary, invalidates synchronous helper caching, and
requires a materially different continuation contract.

## Planned Implementation

1. Add RED fixtures for helper-local construction, constructor arguments,
   field/getter/method access, direct instance return, no-cache identity, nested
   helper/class calls, inactive branches, and overlapping runs.
2. Replace the blanket helper class-use rejection with an exact reverse graph
   analysis that records which admitted classes/members are reachable and
   proves their synchronous pure surface before selection.
3. Reuse the generator-owned class evaluator inside the helper body runner;
   preserve one per-run class registry, helper registry, recursion stack,
   iteration budget, and owner token.
4. Keep helper arguments and results portable. Bind machine-owned instances
   only to helper-local class lets and reject every return/argument/transport
   path before provider dispatch.
5. Align structure preflight and capability planning with the same reachability
   proof. Effectful, imported, ambiguous, optional, forged, wrong-arity, and
   unsupported return paths remain compatibility-selected before any provider.
6. Update convergence ownership/checker and release evidence only after focused
   tests, local gate, exact `pnpm fitness:kern-5`, and mandatory final Agon
   review pass.

## Blast Radius

| Area | Expected action |
| --- | --- |
| `.Codex/specs/.../spec.md` | freeze claims and corrections |
| helper graph/reverse reachability | admit exact pure helper-to-class edges; preserve snapshots |
| helper runtime | preserve `RunnerPortableValue`; execute helper-local class frames under the active state |
| helper/class preflight | prove reached class paths pure and complete before dispatch |
| class value/leaf evaluation | bind/use owned helper-produced instances without widening public wire values |
| machine state/selection | keep one owned registry/state and fail closed on drift |
| capability planner | mirror exact reverse reachability and unsupported boundaries |
| focused runtime/planner tests | RED/GREEN parity, isolation, cache, mutation, exclusions |
| convergence manifest/checker/tests | add M3.31b2b3 sub-owner; retain b2c/c parent blocker |
| release train | record final wall/review evidence and remaining boundary |

Any new handwritten source/test file stays below 500 lines. Existing oversized
files may only shrink or receive a minimal edit backed by extracted modules.

## Acceptance Criteria

- [x] RED-at-base proves a same-root helper that allocates a class and returns a
      scalar through a method/getter is compatibility-selected today.
- [x] A reachable helper can construct an exact same-root class with literal,
      parameter, local, nested-helper, and portable composite-derived scalar
      arguments.
- [x] Helper-local field reads, pure method calls, and pure getter reads match
      reference behavior, including inherited and virtual/super dispatch that
      is already owned by the class runtime.
- [x] A helper-local instance never crosses the helper boundary: direct return,
      nested helper argument/result, class field storage, public envelope
      completion, and stale-run reuse remain rejected before provider dispatch.
- [x] Every admitted helper returns a portable value and retains the current
      deterministic bounded cache behavior.
- [x] Helper parameters remain portable. Passing an instance into a helper,
      returning a forged instance, or transporting an instance across a run or
      module rejects before provider dispatch.
- [x] Effectful class fields/constructors/methods/getters, helper print/effects,
      async/stream bodies, and any path that would suspend inside the helper
      remain compatibility-selected for M3.31b2c.
- [x] Wrong arity, missing members, optional calls, class mutation prohibited by
      the frozen pure contract, recursive member/helper cycles, and unsupported
      expression descendants fail closed before provider dispatch.
- [x] Whole-graph preflight examines inactive/short-circuited helper-to-class
      paths and freezes function/class/member metadata before async suspension.
- [x] Two overlapping async runs isolate class instances, helper cache, owner
      token, registry snapshots, call stack, iteration budget, seed, and time.
- [x] Planner reachability matches runtime ownership for local pure paths and
      keeps imported, effectful, ambiguous, or unsupported paths marked
      unsupported.
- [x] Existing M3.24 helper-only and M3.26-M3.31b2b2 class/helper behavior stays
      green, including class-to-helper calls and mutation-isolation kills.
- [x] Convergence adds one reverse-composition owner while
      `runner-classes-state` retains M3.31b2c effects/pre-super and M3.31c
      module ownership.
- [x] Focused gates, typecheck/tests/build/lint, exact `pnpm fitness:kern-5`, and
      final `agon review` with `claude,codex,agy` pass with findings adjudicated.

## RED Oracle Design

1. Pure local path: helper constructs `Widget`, calls method/getter, returns a
   scalar; base must select compatibility and machine-only must reject for the
   current class-use guard.
2. Instance containment: root `let item = makeWidget()` and a class member that
   returns `makeWidget()` must remain rejected for the portable/scalar result
   restrictions.
3. Cache kill: repeated helpers with fresh helper-local instances and equal
   portable results retain the existing portable cache semantics; no instance
   enters the cache.
4. Effect kill: an earlier root capability followed by a helper that reaches an
   effectful class member must reject selection and leave provider calls at 0.
5. Snapshot kill: mutate helper/class/member bodies and arities while an earlier
   async provider is suspended; the run must use its frozen graph.
6. Isolation kill: overlap identical names across two runs and prove no
   instance/cache/registry leakage.
7. Planner kill: local pure reachability clears only the owned path; imported or
   effectful variants retain an exact `unsupported` execution.

The oracle must not turn green by returning or caching instances, adding instances to the
public `RunnerPortableValue` wire domain, importing the reference runner,
flattening module scopes, allowing effectful helper suspension, admitting all
classes/members, or clearing planner `unsupported` without runtime ownership.

## Out of Scope

- Helper parameters or results that transport class instances.
- Public runtime-envelope serialization of class instances.
- Effectful/async/stream helpers or class work reached from helpers.
- Effectful fields, statements before explicit `super(...)`, nested/conditional
  super, setters, statics, or streams (M3.31b2c).
- Imported/re-exported/aliased/cross-module helper or class identity (M3.31c).
- A new public runtime, capability, scheduler, continuation, class, or helper
  ABI.

## Open Questions

None at the contract level. Implementation must still prove the smallest sound
whole-graph purity analysis and exact planner edge through RED/GREEN tests.

## Deploy Order

This slice is stacked on
`feat/kern-5-r2-m3-31b2b2-helper-composition` because live Git and GitHub still
show `666ee884` outside `origin/main` and no PR exists. Before the one push:
fetch `origin`, rebase onto the then-current `origin/main`, resolve the whole
stack, run the scoped post-rebase gate, and push with `--no-verify`. If the
prior slice appears in `origin/main` before implementation begins, retire this
branch and recreate the slice from fresh `origin/main` instead.

## Corrections Log

| Original claim | Current evidence | Impact |
| --- | --- | --- |
| Reverse composition necessarily needs a resumable helper continuation. | Pure class generators finish synchronously, and M3.31b2c explicitly owns effects. | Keep b2b3 pure; reject suspension during preflight. |
| The helper result must stay `RunnerPortableValue`. | The reference function evaluator can return owned class instances, but the 3/3 boundary review selected the narrower portable helper result and existing deterministic cache contract. | Keep the internal machine helper result portable; no ABI or cache widening. |
| The old reverse oracle proves instance return through class members. | It proves fallback only; both machine and reference class members currently assert scalar results. | Do not widen class member returns without new compatibility evidence. |
| Direct helper instance return is required to close M3.31b2b3. | The 3/3 brainstorm selected helper-local allocation/member access with a portable final result. | Keep helper/class instance identity inside one helper invocation and preserve caching. |
| Existing admission layers make the reverse scanner's shallow argument and getter checks sufficient. | The first full-roster review identified local proof gaps; end-to-end RED probes disproved most immediate bypasses, but direct private-receiver transport between reached methods was live. | Make the reverse proof self-contained: validate exact scalar shapes, resolve `this`/`super` getters, reject receiver transport and parenthesisless construction, and validate the entire return around class scalar leaves. |
| A helper-local class scalar cannot be passed as another class method's scalar argument. | The first terminal review showed `item.add(item.value)` was needlessly rejected even though the inner field read is already proven scalar and local. | Normalize proven helper-local class scalar leaves before portable argument validation; keep raw instances rejected. |
| Existing binding tracking remains sound after helper-local assignment. | The next terminal review reproduced machine selection followed by provider dispatch and late failure after `assign target=item` replaced a tracked class instance. | Reject reassignment of a tracked helper-local class binding during reverse preflight and bind the diagnostic plus provider-before-helper oracle into convergence. |
| Reverse helper-to-class traversal must separately propagate class-member loop budgets. | Final review needs-check; source admission already ORs `internalMachineClassGraphRequiresIterationBudget(env)`, whose complete class graph scans every constructor, method, and getter recursively. Existing class-frame budget tests exercise this owner. | No duplicate budget channel added; the finding is adjudicated false. |
| Assignment targets must be parsed as ordinary value expressions by reverse purity traversal. | Class preflight restricts class-field targets to canonical `this.field`; class runtime accepts only canonical `receiver.field`; the ordinary leaf owner accepts only portable identifiers. Parsing an LHS as a read would mis-model assignment semantics. | Keep target validation with the existing target owners; add only the exact tracked-binding reassignment guard. |
