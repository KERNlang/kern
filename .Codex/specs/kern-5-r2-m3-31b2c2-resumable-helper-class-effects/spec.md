# KERN 5 R2 M3.31b2c2 — Resumable Helper-to-Class Effects

**Status:** DONE
**Date:** 2026-07-17
**Confidence:** 0.99

## Executive Summary

M3.31b2c2 lets a same-root helper construct or call an owned class whose
selected constructor, method, or getter performs effects. The canonical source
machine must suspend inside that reached class frame, resume exactly once, and
return the helper's declared portable scalar without replaying providers or
leaking helper-local/class-private state.

The boundary stays narrow. Direct `capability` and `print` nodes in helpers
remain outside the pure-helper language. Existing pure helpers keep their
synchronous trampoline and bounded memoization. Only helpers proven by the
frozen same-root graph to compose with classes enter the new generator frame.
Imported/cross-module class or helper identity remains M3.31c.

## Current State and Root Cause

- **VERIFIED:** helper calls are prepared synchronously and executed with one
  `.next()`; any yielded provider request is rejected as `produced side
  effects`. Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts`.
- **VERIFIED:** helper results are memoized by helper name, portable arguments,
  and integer provenance; the cache is bounded at 1024 entries and pure nested
  helpers use a 512-frame trampoline. Evidence:
  `internal-effect-machine-helper-runtime.ts`.
- **VERIFIED:** direct helper bodies exclude `capability`, `lambda`, `print`,
  and `try`. This remains the direct-helper contract. Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts`.
- **VERIFIED:** reverse helper-to-class analysis already proves exact
  helper-local construction, selected constructor/method/getter reachability,
  scalar returns, private receiver containment, and same-root class identity,
  but explicitly rejects reached class `capability` and `print` nodes.
  Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-helper-class.ts`.
- **VERIFIED:** class constructor, method, and getter evaluators are generators
  over the shared machine state and body runner; they already preserve provider
  continuation, class snapshot, call stack, and iteration budget. Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts`.
- **VERIFIED:** class-owned `let`, `print`, and `return` scalar slots classify
  suspending expressions and route them through the generator evaluator.
  Evidence: `internal-effect-machine-class-leaf.ts` and
  `internal-effect-machine-class-value-runtime.ts`.
- **VERIFIED:** scalar helper calls currently classify as pure when their
  arguments and declared return contract are portable; that forces the sync
  evaluator even when the helper reaches an effectful class. Evidence:
  `internal-effect-machine-class-value.ts`.
- **VERIFIED:** whole-class preflight traverses the frozen class registry before
  provider dispatch, and capability planning already follows helper-local class
  construction and selected members. The current unsupported result is caused
  by machine admission rejecting the helper/class graph, not by missing planner
  reachability. Evidence: `internal-effect-machine-class-preflight.ts`,
  `source-runner-admission.ts`, and `runner-capability-plan.ts`.
- **VERIFIED:** `brainstorm-1784263683238-80zv1i-m3-31b2c2-resumable-helper-class`
  completed 3/3 with `claude,codex,agy`. Its winning recommendation requires a
  transitive resumable-helper closure and authored-order nested resumable
  arguments while retaining event-aware body caching.
- **VERIFIED:** live `origin/main` is `d11fb900`; PR #536 is open and contains
  the three stacked M3.31b2 commits through `081a902e`. M3.31b2c2 therefore
  stays on the existing branch until the final pre-push refresh.

## Contract

| Behavior | Contract | Tag |
| --- | --- | --- |
| Direct helpers | Direct helper `capability`, `print`, `lambda`, and `try` remain rejected | VERIFIED |
| Resumable selection | Frozen same-root helpers that compose with classes, plus every helper transitively calling one, enter the generator helper path | VERIFIED |
| Pure helpers | Helpers without class composition keep the existing sync trampoline, recursion limit, cache key, and diagnostics | VERIFIED |
| Class effects | Reached same-root constructor/method/getter `capability` and `print` may suspend or emit trace events | VERIFIED |
| Result | The resumable helper must complete with its declared portable scalar return | VERIFIED |
| Arguments | Portable scalar/record/array arguments and nested pure-helper arguments remain supported; private receivers are forbidden | VERIFIED |
| Nested resumable arguments | Resumable helper arguments evaluate left-to-right before the outer helper body/cache lookup | VERIFIED |
| Trace | Propagate only observable `stdout`, `stderr`, and `capability` events across the helper boundary; helper-local assign/iteration trace stays private | VERIFIED |
| Cache | Cache a completed helper body only when that body produced no observable events; argument effects always run before outer cache lookup | VERIFIED |
| Replay | A provider request, result, failure, or print is observed once; resumption continues the same generator frame | VERIFIED |
| Preflight | Unsupported graph, slot, arity, result, receiver, or module identity rejects before any provider call | VERIFIED |
| Snapshot | Helper/class bodies, members, lineage, metadata, and registries are frozen before first suspension | VERIFIED |
| Concurrency | Overlapping runs isolate generator, state, cache, receiver, bindings, budget, seed, time, and provider results | VERIFIED |
| Planner | Reached class effects become executable when runtime admission owns the frame; no planner-only suppression is allowed | VERIFIED |
| Modules | Imported, re-exported, aliased, ambiguous, or cross-module identity remains M3.31c | VERIFIED |
| ABI | No public runtime, handler, capability, helper, or class ABI changes | VERIFIED |

## Selected Design

### 1. Graph-owned resumable helper identity

Extend helper/class composition analysis to return both the existing scalar
return-node proof and whether the helper uses an admitted class. Build a helper
call graph from the frozen snapshots, seed helpers that compose with a class,
then propagate resumability to every calling helper with a monotone worklist.
Store the closure as a frozen `resumableHelperNames` set on the per-run internal
machine state. Helper classification consults this set; ordinary helpers with
pure arguments remain on the current synchronous path.

This avoids routing every helper through generators and preserves the mature
pure-helper recursion/cache path.

### 2. Generator helper frame

Add a generator entry point beside the synchronous helper evaluator. Its
argument evaluator handles scalar, array, and record shapes recursively and
enters nested resumable scalar helper calls in left-to-right authored order. It
then reuses the existing arity/depth checks, integer provenance, frozen helper
registry, environment construction, state binding, and cache key.

Argument effects occur before cache lookup and are always returned to the
caller. On a body-cache miss it `yield*` delegates the helper body to the
existing canonical body runner. It validates normal completion and the declared
portable scalar result, filters body-internal trace, conditionally remembers an
observable-event-free body completion, and returns the argument events plus
body events/value to the class scalar evaluator.

### 3. Existing class scalar continuation

The class scalar classifier marks a helper call suspending when the callee is in
the resumable closure or any argument is suspending. The runtime recognizes
that helper call before attempting method dispatch and enters the generator
helper frame. Recursive expression owners already concatenate events for
binary, conditional, unary, template, type assertion, and non-null expressions,
so helper effects remain in authored order inside those slots.

### 4. Admission relaxation, not language relaxation

Rename the reverse analyzer's purity terminology to reached-frame terminology
and remove only its rejection of effects inside the selected class frames. All
existing exact receiver, member, construction, scalar shape, graph snapshot,
and module checks remain. Whole-class preflight stays the authority for effect
shape and before-provider rejection.

## Alternatives

### A. Route every helper body through the generator

Rejected. Only calls that are themselves resumable or have resumable arguments
need the generator entry point. Pure-helper bodies retain the proven trampoline,
512-depth recursion, and memoization.

### B. Cache effectful helper results after first completion

Rejected. Identical calls must execute observable providers and prints each
time. Memoizing them changes language semantics.

### C. Disable the helper cache for all class-composing helpers

Possible but not selected. Pure helper-to-class composition is already safely
memoized. Observable-event-aware caching preserves that behavior while
preventing effect elision.

### D. Put continuation logic in the compatibility runtime

Rejected. The release goal is canonical machine ownership; compatibility is
not an acceptable executor for this newly admitted path.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `internal-effect-machine-helper-class.ts` | modify | classify admitted class composition and allow reached class effects |
| `internal-effect-machine-helper-graph.ts` | modify | compute transitive resumable helper names with scalar-return proof |
| `internal-effect-machine-helper-contract.ts` | modify | query frozen resumable helper identity |
| `internal-effect-machine-helper-runtime.ts` plus focused module if needed | modify/add | prepare from evaluated values and add generator body execution below 500 lines |
| `internal-effect-machine-class-value.ts` | modify | classify only resumable helper calls as suspending |
| `internal-effect-machine-class-value-runtime.ts` | modify | enter generator helper frame |
| `internal-effect-machine-types.ts` | modify | hold frozen per-run resumable helper names |
| `internal-effect-machine.ts` | modify | install graph result before structure preflight/execution |
| focused runtime/admission/snapshot tests | add | RED/GREEN continuation and containment oracles |
| planner/convergence tests and scripts | extend | bind executable disposition and mutation coverage |
| manifest/release train/spec | update | close M3.31b2c2 and leave M3.31c exact |

No new logic goes into the already oversized capability planner. All new or
substantially expanded handwritten files remain below 500 lines.

## Acceptance Criteria

- [x] RED-at-base proves a root call to a helper whose helper-local class method
      invokes a capability is compatibility-selected/rejected by machine-only.
- [x] A reached constructor, method, and getter can each suspend and resume once
      through the helper boundary in sync and async source runners.
- [x] Provider and trace order matches authored constructor/method/getter order;
      no effect is replayed after resume.
- [x] `print` inside a reached class member is observable and prevents caching.
- [x] Two identical calls to an effectful helper invoke providers twice; two
      identical calls to a pure class-composing helper retain safe memoization.
- [x] Helper-local assigns, iteration events, class receiver identity, and
      instance fields do not escape the helper boundary.
- [x] Existing scalar, array, record, integer-provenance, and nested pure-helper
      arguments retain behavior; nested resumable arguments run left-to-right
      exactly once before the outer body/cache lookup.
- [x] A wrapper helper that transitively calls a class-composing helper is
      marked resumable even when it has no direct class syntax.
- [x] Existing pure recursive helper depth 512, loop budget, cache bound,
      concurrency, seed/time, and diagnostics remain unchanged.
- [x] Unsupported direct helper effects, private receiver transport, instance
      returns/reassignment, optional members, non-scalar class results, wrong
      arity, and unsupported nesting reject before provider dispatch.
- [x] Invalid class nodes or completion paths reached only through a helper are
      found during whole-graph preflight before an earlier root provider runs.
- [x] Mutation after an earlier suspension cannot change helper/class body,
      member selection, lineage, arity, return metadata, or provider identity.
- [x] Overlapping async runs isolate continuations, helper cache, class state,
      arguments, budget, seed, time, and failures.
- [x] A provider rejection escapes once, runs generator cleanup, and never
      retries through compatibility.
- [x] Planner marks reached same-root helper/class effects executable while
      retaining imported/cross-module and unsupported-slot findings.
- [x] Convergence kills removal of resumable identity, yield/resume, event
      filtering, no-effect cache, preflight, snapshot, and planner ownership.
- [x] M3.31b2c2 becomes current ownership in the manifest; the sole remaining
      parent class-state follow-up is M3.31c module identity.
- [x] Focused gates, typecheck, lint, full `pnpm fitness:kern-5`, and terminal
      `agon review -e claude,codex,agy` pass with every verified blocker fixed.

## RED Oracle Matrix

1. Helper-local class method performs `capability`, then returns a scalar.
2. Effectful constructor feeds a pure method; provider runs before method.
3. Pure constructor plus effectful getter returns through a compound/template
   scalar expression in exact trace order.
4. Identical effectful helper calls execute twice; identical pure composition
   remains eligible for cache reuse.
5. Nested pure and resumable helper arguments into another helper remain
   supported in left-to-right effect order; disabling the transitive closure or
   argument generator must fail the oracle.
6. Direct helper capability remains rejected with provider count zero.
7. Unsupported reached member after an earlier root capability keeps provider
   count zero, proving global preflight.
8. Async suspension followed by mutation of helper/class registries and member
   bodies still returns from the frozen snapshot.
9. Two overlapping async runs return their own values and never share events or
   class fields.
10. Capability planner reports executable for the admitted path and unsupported
    for the same imported path.

The oracle must not turn green by disabling helper memoization globally,
re-running a generator from the beginning, exposing private trace/state,
broadening direct helper effects, flattening module identity, suppressing
planner findings without runtime ownership, or falling back to compatibility.

## Out of Scope

- Direct effect nodes in helper bodies.
- Composite results from a class method/getter or a class-composing helper in a
  class scalar slot.
- Class instances crossing helper parameters, results, or external bindings.
- Setters, static members, streams, async-language syntax, or transactional
  rollback of already observed external effects.
- Imported/re-exported/aliased/cross-module helper or class identity (M3.31c).
- Public ABI or compatibility-runtime promotion.

## Adversarial Decision

The full-roster challenge accepted observable-event-aware body caching because
helper-local class instances cannot escape and the cache is per run. The cache
lookup occurs only after arguments execute, so argument effects are never
elided. Any body `stdout`, `stderr`, or `capability` event prevents storage.
Wrapper helpers are included through a fixed-point call-graph closure; direct
syntax-only marking is forbidden.

## Deploy Order

The user reports PR #536 merged. M3.31b2c2 was developed on its former stacked
branch while the merge was pending. Immediately before the one allowed push:
fetch origin, verify that the exact prior tree is now on main, cut a fresh
M3.31b2c2 branch from live `origin/main`, and replay only this slice. Run a
scoped post-rebase gate, push once with `--no-verify`, and hand over the printed
PR link. If the remote has not yet converged, preserve the stack and rebase it
onto live `origin/main` instead.

## Verification Receipt

- `pnpm fitness:kern-5`: PASS. The wall included lint, build, workspace tests,
  432/432 cross-target fixtures, 233 native contracts, 48/48 checker fixtures,
  39/39 validator verdicts, and 40 application fixtures on three legs plus
  whole-app boot.
- Required browser budget: PASS at 152 modules, 1,535,195 raw bytes, 328,258
  gzip bytes, 64 ms cold import/execute, and 127 ms median browser
  import/execute. The earlier runner-smoke sample also passed at 71 ms cold and
  123 ms median.
- Source-runner convergence: PASS with all 43 mutations killed, including the
  resumable-helper closure, generator yield, event-aware caching, nested
  composite arguments, resumable array execution, admission/body preflight
  closure, frozen registry, and ownership checks.
- Focused helper/class effect oracles: PASS for method, constructor, getter,
  wrapper transitivity, nested authored-order arguments, effect-aware cache,
  print visibility, pure cache retention, direct-effect rejection, frozen
  snapshots, concurrency isolation, and planner admission.
- Terminal `agon review -e claude,codex,agy`: PASS 3/3 with zero verified and
  zero needs-check findings
  (`review-1784269895309-ubvwed-m3-31b2c2-resumable-helper-class`). Its one
  0.55-confidence speculative classifier concern is disproved because scalar
  helper classification returns `suspending` before the fallback branch, as
  exercised by the passing nested `decorate(readRemote())` oracle. The
  `super.<getter>` note describes an explicitly rejected existing boundary;
  the remaining Set-allocation and recursive-traversal notes are
  non-behavioral nits.

The initial implementation review
`review-1784266077644-j5lb17-m3-31b2c2-resumable-helper-class` returned 3/3.
One claimed missing `append` binding was disproved by the source. The verified
composite-argument finding exposed three coupled gaps: admission preflight did
not bind the resumable helper closure, helper-body preflight discarded machine
state, and the runtime did not recursively resume array/record descendants.
RED array/record oracles reproduced them; admission state ownership, recursive
argument preflight/runtime evaluation, and three convergence kills close the
boundary. The remaining claimed nested-helper-return gap was disproved because
scalar classification already marks the outer helper suspending.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| Direct class composition alone determines resumability | Wrapper helpers transitively inherit resumability | Add fixed-point call-graph closure |
| Nested resumable arguments may stay fail-closed | They are required for authored-order composition | Add recursive generator argument evaluation |
| Adversarial challenge pending | 3/3 challenge completed | Spec approved for implementation |
