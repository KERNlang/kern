# KERN 5 R2 M3.31a Resumable Class Frames

**Status:** COMPLETE
**Date:** 2026-07-16
**Confidence:** 0.97
**Parent objective:** M3.31 full class runtime ownership

## Executive Summary

M3.31a gives the private source-runner machine one resumable same-root class
activation model. Direct constructors, methods, and getters may execute the
already-unified internal sequence, yield the existing capability request, and
resume the same activation without replay. Invocation-bearing scalar
expressions use a generator-recursive evaluator; wholly invocation-free
subtrees continue through the existing synchronous portable evaluator.

This slice deliberately does not close `runner-classes-state`. Option-C
`super`, helper/class composition, effectful field initializers, imported or
re-exported classes, and defining-module identity remain M3.31b/c work. The
existing compatibility path remains selected for those shapes before any
provider runs.

## Current State / Root Cause

- **VERIFIED:** the outer machine already schedules one
  `InternalEffectMachineGenerator`, yields only
  `InternalCapabilityEffectRequest`, and resumes with `.next(result)` or
  injects provider failure with `.throw(error)`
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:70-139`).
- **VERIFIED:** machine construction currently advances a child sequence once
  and rejects if it yields
  (`internal-effect-machine-class-runtime.ts:332-359`).
- **VERIFIED:** machine methods/getters currently execute one scalar return
  synchronously (`internal-effect-machine-class-runtime.ts:362-420`).
- **VERIFIED:** graph admission restricts methods/getters to one return and
  constructors to direct field assignments
  (`internal-effect-machine-class-graph.ts:59-126`).
- **VERIFIED:** all root/helper nodes are preflighted through one structural
  analyzer before machine selection
  (`internal-effect-machine-structure.ts:475-493`;
  `source-runner-engine.ts:69-100`).
- **VERIFIED:** `async-portable-scalar.ts:63-176` already freezes the required
  recursive evaluation order for unary, binary, conditional, template, and
  call expressions. The machine may mirror that control shape but may not
  import compatibility execution.
- **VERIFIED:** capability planning treats called constructors, methods, and
  getters as executable reachability, including async providers
  (`runner-capability-plan.test.ts:279-327,434-497`).
- **VERIFIED:** provider transport errors are JavaScript generator errors, not
  KERN `throw` completion records; machine cleanup must unwind, but M3.31a must
  not invent new KERN try/catch/finally semantics
  (`internal-effect-machine.ts:35-48`;
  `internal-effect-machine-try.ts:14-59`).

The missing owner is the invocation continuation between a synchronous scalar
leaf and the already-resumable class body. Calling `.next()` and later
restarting the leaf would repeat completed arguments, field writes, sibling
calls, or provider requests. A cached pending exception is therefore not a
valid positive suspension mechanism.

## What Already Works

- M3.26-M3.30 own exact linker-created same-root class metadata, direct state,
  pure direct members, pure getters, and constructorless inheritance.
- Class bindings and complete same-root lineages are snapshotted before the
  first provider and remain run-local.
- The outer scheduler already owns sync/async providers, timeouts, environment
  revalidation, and iteration budget.
- Portable numeric/coercion helpers already freeze float-collapse, truthiness,
  comparison, and string conversion semantics.

## Contract (Verified)

> Verified against the cited sources on 2026-07-16. No ASSUMED or OPEN claim
> feeds an M3.31a fixture.

| Behavior | M3.31a contract | Evidence | Tag |
| --- | --- | --- | --- |
| Yield ABI | class frames yield only the existing internal capability request | `internal-effect-machine-types.ts:46-71` | VERIFIED |
| Continuation | one JavaScript generator stack owns local evaluation state across resume | `internal-effect-machine-sequence.ts:183-238` | VERIFIED |
| Error path | provider error is injected with `machine.throw`; generator cleanup unwinds; no compatibility retry | `internal-effect-machine.ts:35-48,95-139`; `source-runner-engine.ts:114-133` | VERIFIED |
| Metadata | exact root-module class registry is snapshotted before execution | `internal-effect-machine-class-graph.ts:162-176` | VERIFIED |
| Evaluation order | left-to-right arguments/templates/binary operands; lazy `&&`, `||`, `??`, and conditional branches | `async-portable-scalar.ts:63-176` | VERIFIED |
| Numeric semantics | reuse existing portable arithmetic/coercion/truthiness guards | `portable-core-evaluator.ts:248-279`; `portable-scalar-domain.ts` | VERIFIED |
| Preflight | every reachable class frame and every descendant ValueIR is classified before any provider | root structural preflight at `internal-effect-machine-structure.ts:475-493`; new class-frame oracle | VERIFIED |
| Scope | same-root direct construction/dispatch plus M3.30 constructorless inherited dispatch; no super/module/helper expansion | M3.30 spec and deferred row | VERIFIED |
| Ledger | add an evidenced sub-owner only; retain the exact full M3.31 blocker | `scripts/source-runner-convergence-manifest.json:66-72` | VERIFIED |

## Selected Design

Add a total recursive ValueIR classifier with exactly three outcomes:
`pure`, `suspending`, and `unsupported`.

- Every current ValueIR kind is handled explicitly. Unknown kinds are
  `unsupported`.
- `pure` means the complete descendant tree is invocation-free and may be
  delegated unchanged to the synchronous portable evaluator.
- `suspending` means a supported class constructor/method/getter exists in the
  tree; the generator evaluator owns the complete ancestor through completion.
- `unsupported` poisons the whole root during preflight, including inactive
  conditional or short-circuit branches.
- Runtime evaluation remains lazy: only the selected conditional branch and a
  required short-circuit RHS execute.
- The generator evaluator mirrors the repository's async recursive evaluator
  and reuses exported arithmetic/coercion/scalar helpers. It never rebuilds
  values as source literals.
- Class frames use `yield*` to run the existing internal sequence. Fresh local
  environments, receiver identity, class-registry snapshot, call stack, and
  iteration budget remain tied to the current machine state.
- Provider errors unwind through `yield*` and restore private state in
  JavaScript `finally` blocks. They are not converted into KERN completion
  records. This cleanup is not a transaction over receiver field writes that
  occurred before the provider threw.

A manual ValueIR program-counter stack is rejected because it duplicates
evaluation order and exception unwinding. A generic rewrite of the stable sync
evaluator is rejected because it expands the blast radius before the class
suspension contract is proven.

## Exact M3.31a Boundary

Admit:

- same-root direct constructors whose bodies use the existing unified sequence
  and complete normally;
- same-root methods/getters whose bodies use the existing unified sequence and
  return one portable scalar on every path;
- direct or nested method/getter reads inside admitted scalar unary, binary,
  conditional, template, and class-argument expressions;
- constructor/method/getter capability suspension in sync and async runners;
- constructorless inherited method/getter dispatch already owned by M3.30,
  provided the body contains no `super`.

Keep fail-closed before provider dispatch:

- explicit or implicit constructor chaining and every `super` form;
- helper-to-class, class-to-helper, and effectful field initializer paths;
- imported, re-exported, aliased, or cross-module class identity;
- static, stream, or explicitly async class members;
- unsupported ValueIR descendants, class-instance transport/forgery, and
  nested allocation/dispatch forms not listed above.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| new class-frame ValueIR classifier | add total preflight classification | prove pure/suspending/unsupported before providers |
| new generator ValueIR evaluator | add no-replay recursive evaluation | preserve exact continuation and order |
| new class activation module | prepare/drive constructor, method, getter frames | one receiver/environment lifecycle |
| new resumable leaf module | bridge root/member leaves into generator frames | keep existing 463-line leaf file below 500 |
| `internal-effect-machine-sequence.ts` | `yield*` the resumable leaf bridge | compose nested class frames with scheduler |
| class graph/preflight modules | admit and analyze exact frame bodies | reject unsupported bodies before providers |
| class runtime | delegate shared preparation; preserve pure fast path | avoid duplicating class state semantics |
| focused M3.31a test file | add RED/GREEN replay, error, async, isolation, parity oracles | discriminating evidence below 500 lines |
| convergence checker/manifest/tests | add sub-owner without deleting parent blocker | truthful partial receipt |
| fitness/release/spec docs | require and record focused evidence | release-chain visibility |

Existing handwritten files already near 500 lines may only shrink or receive a
small routing hook; new logic belongs in extracted modules.

## Acceptance Criteria

- [x] A constructor mutates receiver state, yields a sync capability, resumes,
      and proves every pre-yield mutation/provider request occurred exactly
      once.
- [x] An async constructor resumes with the same receiver, registry, call
      stack, and iteration budget; two overlapping runs remain isolated.
- [x] A method and getter each yield an async capability and return the provider
      result through direct `let`, `print`, and `return` leaves.
- [x] Nested invocation in a binary, template, conditional, short-circuit, and
      argument expression preserves left-to-right order, skips inactive
      branches, and never replays completed siblings.
- [x] Provider rejection/timeout unwinds private frame bindings, calls the
      provider once, performs no compatibility retry, and leaves a later fresh
      run healthy.
- [x] The recursive classifier walks inactive branches and rejects any
      unsupported descendant before an earlier root/class provider executes.
- [x] Pure class constructor/method/getter behavior, numeric provenance,
      constructorless inheritance, and snapshot isolation remain byte-for-byte
      compatible with M3.26-M3.30 fixtures.
- [x] `super`, helper/class mixing, effectful field initializers, imported
      classes, nested allocation, and forged metadata remain compatibility
      paths before provider dispatch.
- [x] Capability planning removes `unsupported` only for the exact newly owned
      class-frame paths and still reports provider requirements correctly.
- [x] Manifest adds one evidenced `runner-class-resumable-frames` owner while
      preserving `runner-classes-state` with its exact M3.31 follow-up.
- [x] Mutation tests kill classifier deletion, pure misclassification, replay,
      sync-evaluator reconstruction, provider retry, partial ledger promotion,
      and compatibility-owner imports.
- [x] Every new/touched handwritten source or test remains below 500 lines.
- [x] Focused suites, convergence tests, lint/build/typecheck, exact
      `pnpm fitness:kern-5`, and six-engine `agon review` pass.

## Out of Scope

- Option-C implicit/explicit `super`, base constructor ordering, and
  `super.member` dispatch (M3.31b).
- Helper/class composition and effectful field initializers (M3.31b).
- Imported/re-exported module identity and final class-row promotion (M3.31c).
- Static/setter/stream/explicitly async class members or arbitrary host values.
- Any public continuation/frame API or change to the capability request ABI.
- New KERN provider-error catch/finally semantics.

## Open Questions

None for M3.31a. The private module-token decision is an M3.31c question and
does not feed this slice's implementation or fixtures.

## Deploy Order

Build and verify in an isolated detached worktree while PR #534 runs. If #534
is still open at publication time, rebase the complete slice onto its latest
head and update that branch once. If #534 is present on `origin/main`, create
`feat/kern-5-r2-m3-31a-class-frames` from fresh `origin/main`, transfer only the
validated M3.31a diff, rerun the required local gate, rebase immediately before
the single push, and open the PR. Never push an old branch after its PR merges.

During version skew, older packages and every out-of-scope shape keep selecting
compatibility before provider execution. The parent blocker remains visible.

## Corrections Log

| Original claim | Reality | Impact |
| --- | --- | --- |
| A cached pending exception could resume class leaves. | It restarts synchronous evaluation and can replay completed work. | Use the JavaScript generator stack as the continuation. |
| Pure-subtree delegation could be heuristic. | A suspending descendant hidden under a pure ancestor would enter the sync evaluator. | Require total recursive classification before any delegation. |
| Provider errors should run KERN finally blocks. | The scheduler injects a JavaScript error; KERN try handles completion records. | Preserve generator cleanup and existing KERN error semantics. |
| M3.31 could safely flip the whole class row at once. | Super lifecycle, helper composition, and module identity are independent contracts. | Ship M3.31a/b/c and promote only after M3.31c. |

## Adversarial Record

- `nero-1784187010383-0b3oeh-kern-m3-31a-generator-adapter` exposed the
  recursive-purity, provider-error, evaluation-order, and preflight gaps in the
  first draft.
- `brainstorm-1784187095211-1fpomc` completed 6/6. Every usable engine selected
  the generator-recursive evaluator over a manual stack or generic rewrite,
  conditioned on exhaustive classification, no value reconstruction, and
  parity/no-replay fixtures.
- `nero-1784192014576-ugz8bp` rejected making capability planning a new
  runtime-envelope importer. The implementation instead extracts one shared
  semantic admission predicate and reuses the runner's exact single-module
  scope builder, preserving envelope containment and planner/runtime parity.
- `review-1784199956730-meez5j-kern-5-r2-m3-31a-terminal-final` completed all
  six usable engines. Its two blocking verdicts were disproved against the
  current tree: unresolved construction returns before dereference, and the
  extracted runner-scope module exists, exports the required surface, and
  passes the full TypeScript/workspace build. Remaining findings are either
  covered regressions, conservative admission, or documented M3.31b/c scope.
