# KERN 5 R2 M3.31b2b2 Pure Helper/Class Composition

**Status:** COMPLETE — READY TO SHIP
**Date:** 2026-07-16
**Confidence:** 0.99
**Parent objective:** close the remaining same-root M3.31b class-composition gap without widening M3.31c module identity

## Executive Summary

M3.31b2b2 should let an admitted same-root constructor, method, or getter call
an already-owned M3.24 pure helper while preserving one per-run effect-machine
state. Arguments and returns stay inside the closed portable helper domain;
private class instances never cross the helper boundary. The helper re-enters
the canonical sequence synchronously, shares iteration budget/cache/recursion
state, and may be reached from a resumable class frame before or after a class
capability without replay.

This slice deliberately does not let helpers construct classes, call
class members, receive or return instances, or inherit implicit `this`. Whether
that reverse helper-to-class direction belonged in this same slice was sent to
the full Agon roster. All six usable engines selected the one-direction portable
boundary; reverse instance composition remains an explicit M3.31b2b3 follow-up.

## Current State / Root Cause

- **VERIFIED:** the helper graph discovers calls from the selected entry and
  recursively from helper bodies, but rejects any reachable helper when the
  same root scope has classes
  (`packages/core/src/ir/semantics/internal-effect-machine-helper-graph.ts:156-180`).
- **VERIFIED:** the helper owner accepts only same-root linker bindings with a
  non-void return and a pure canonical body; capability, lambda, print, and try
  nodes are excluded
  (`internal-effect-machine-helper-graph.ts:102-147`).
- **VERIFIED:** helper arguments and returns are closed portable values; each
  call gets a fresh environment, shares the caller's state/cache/call stack,
  and rejects yielded effects
  (`internal-effect-machine-helper-runtime.ts:38-51,68-149`).
- **VERIFIED:** class preflight independently walks every snapshotted
  constructor, method, and getter and explicitly rejects any helper call
  (`internal-effect-machine-class-preflight.ts:175-230`).
- **VERIFIED:** the class scalar classifier recognizes a helper call but marks
  it unsupported solely because `runnerClasses` is non-empty
  (`internal-effect-machine-class-value.ts:51-74`).
- **VERIFIED:** runtime class frames already bind the same
  `InternalEffectMachineState` to constructor/member child environments and
  delegate bodies to the canonical sequence
  (`internal-effect-machine-class-frame.ts:46-88,112-176`).
- **VERIFIED:** the portable machine evaluator already owns both class
  member/method evaluation and pure helper calls through one host
  (`portable-machine-evaluator.ts:1-29`).
- **VERIFIED:** structural preflight currently validates helpers first, then
  all class frames, then the root sequence
  (`internal-effect-machine-structure.ts:479-498`).
- **VERIFIED:** capability planning reaches helper calls found inside class
  handlers, but the exact M3.31a compatibility oracle still marks that
  composition unsupported
  (`runner-capability-plan.ts:607-710,713-820`;
  `packages/core/tests/runner-capability-class-frame.test.ts:25-43`).

The gap is therefore not a second runtime or missing syntax. Admission has two
separate graph owners that deliberately refuse to compose: helper reachability
does not use class bodies as roots, while class preflight/classification rejects
the helper calls it can already identify. Runtime state transport is already
shared.

## What Already Works

- M3.24 owns pure same-root helper recursion, portable composite arguments and
  returns, per-run cache isolation, and shared explicit iteration budgets.
- M3.31a-b2b1 own resumable class bodies, constructor/super lifecycle,
  declaring-owner `super.method`, virtual `this.method`, private receiver
  identity, and capability resume without replay.
- The linker already gives helpers and classes the same exact root-module
  scope identity. No public API, parser syntax, or descriptor change is needed.
- The capability planner already follows class-handler-to-helper edges; only
  the unsupported disposition must match the runtime's newly proven boundary.

## Contract

> Verified against current `origin/main` at `d11fb900` on 2026-07-16. No
> ASSUMED claim may feed a final fixture.

| Behavior | M3.31b2b2 contract | Evidence | Tag |
| --- | --- | --- | --- |
| Scope identity | helper and class are linker-owned by the selected same-root function/class maps | `internal-effect-machine-helper-graph.ts:127-153`; `internal-effect-machine-class-graph.ts:158-176` | VERIFIED |
| Direction | admitted constructor/method/getter body calls a pure helper; reverse instance composition remains a named later slice | `brainstorm-1784233659602-f4rkmt`, 6/6 selected Option A | VERIFIED |
| Helper body | existing M3.24 synchronous pure canonical sequence only | `internal-effect-machine-helper-graph.ts:102-124` | VERIFIED |
| Arguments | portable scalar, array, or plain-record values only; class instances/functions/host objects excluded | `internal-effect-machine-helper-runtime.ts:38-51,86-104` | VERIFIED |
| Return | explicit portable value; scalar class slots require a portable scalar | `internal-effect-machine-helper-runtime.ts:121-149,197-203` | VERIFIED |
| Receiver | helper call environment has no implicit `runnerThis`; class private receiver remains only in the calling frame | `internal-effect-machine-helper-runtime.ts:125-135` | VERIFIED |
| State | class and helper use one per-run machine state, iteration counter, helper cache, and recursion stack | `internal-effect-machine-class-frame.ts:70-85,133-151`; `internal-effect-machine-helper-runtime.ts:121-180` | VERIFIED |
| Suspension | helper itself cannot yield; surrounding class frames may suspend before/after it without replay | helper effect rejection at `internal-effect-machine-helper-runtime.ts:138-143`; class `yield*` at `internal-effect-machine-class-frame.ts:77-85,139-150` | VERIFIED |
| Current preflight | helper, class, and root analyses run separately; the helper graph is not seeded from class bodies | `internal-effect-machine-structure.ts:479-498`; `internal-effect-machine-helper-graph.ts:156-180` | VERIFIED |
| Target preflight | one immutable class/helper snapshot validates the complete owned graph before the first provider | mixed-graph preflight, inactive-branch, async-mutation, and convergence mutation oracles | VERIFIED |
| Current planner | class-handler-to-helper reachability is found but the path remains `unsupported` | `runner-capability-plan.ts:668-710,713-820`; `runner-capability-class-frame.test.ts:25-43` | VERIFIED |
| Target planner | clear `unsupported` only for the exact runtime-owned same-root class-to-helper graph | same-root positive and imported-helper negative planner oracles | VERIFIED |
| Imports | imported/re-exported/aliased module identity remains M3.31c | release-train M3.31b2b1 boundary | VERIFIED |

## Implementation Options

### A. Class frame to portable pure helper only (selected)

Make helper reachability accept the same-root class registry and seed its
pending set from every admitted class constructor/method/getter body in
addition to the root sequence. Remove the blanket non-empty-class rejection,
but keep helper body/argument/return shape closed.

Teach class preflight and the class scalar classifier that an exact registered
helper call is a pure value. Bind the complete preflight helper registry to the
synthetic class state so structural analysis can validate nested calls without
host execution. Runtime uses the existing class-bound state and helper
trampoline; no new interpreter or continuation is added.

Planner ownership changes only from unsupported to owned for this exact edge.
The helper call itself is still synchronous/pure even when the caller frame is
resumable.

### B. Bidirectional composition in one slice

Also allow a helper body to allocate classes, call methods/getters, or return a
class instance. This matches the broadest reading of "helper/class
composition," but it breaks M3.24's closed portable call boundary, requires a
resumable helper continuation or a new instance transport contract, and makes
helper caching receiver-sensitive. All six brainstorm engines rejected this as
too broad for M3.31b2b2. It becomes a named M3.31b2b3 follow-up rather than
disappearing into the M3.31c module lane.

### C. Helper-to-class only

Rejected as the first move. The existing red admission and release boundary
name class frames calling helpers directly, while helper-to-class crosses the
larger instance/continuation boundary described in Option B.

### D. Inline or duplicate helper execution inside the class evaluator

Rejected. It would create a second helper interpreter, duplicate recursion,
cache, budget, completion, and preflight rules, and violate the convergence
objective.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-r2-m3-31b2b2-helper-class-composition/spec.md` | add/update | frozen contract and evidence |
| `internal-effect-machine-helper-graph.ts` | edit/extract | seed reachable helpers from admitted class bodies; remove blanket class-map rejection |
| `internal-effect-machine-helper-preflight.ts` | edit | validate the combined graph under a complete synthetic state |
| `internal-effect-machine-class-preflight.ts` | edit/extract | admit exact pure helper expressions and bind helper registry during class analysis |
| `internal-effect-machine-class-value.ts` | edit | classify exact helper calls as pure even with a class registry |
| `internal-effect-machine.ts` | minimal edit if needed | construct one graph snapshot once for preflight and runtime |
| `runner-capability-plan.ts` or extracted dispatch helper | edit, planner must shrink | clear unsupported only for exact owned class-to-helper paths |
| focused runtime/admission/planner tests | add | RED/GREEN, no-replay, isolation, exclusion, and reachability oracles |
| convergence manifest/checker/tests | edit | add one sub-owner; retain the parent class blocker |
| release train | edit after gates | record exact evidence and remaining M3.31b/c work |

Every new handwritten source/test file stays below 500 lines. The existing
1,111-line planner must shrink if touched.

## Acceptance Criteria

- [x] RED-at-base: a same-root class method calling `decorate(answer)` remains
      compatibility-selected and planner-marked unsupported before this slice.
- [x] A constructor, method, and getter can each call a reachable same-root pure
      helper with literal, parameter, local scalar, and `this.field` portable
      arguments and receive a portable scalar result.
- [x] A helper reachable only from a class body is included in the immutable
      per-run helper registry; unused unrelated helpers do not become reachable.
- [x] A class capability before and after a helper call executes exactly once
      in sync and real-async runners; helper evaluation and class state do not
      replay across suspension.
- [x] Nested helper calls and direct/mutual helper recursion preserve M3.24's
      depth/cache behavior when invoked from a class frame.
- [x] Helper loops consume the caller-owned shared iteration budget; missing or
      exhausted budget rejects before any later provider call.
- [x] Two overlapping async class runs with identical helper/class names isolate
      helper registry/cache, class registry/receiver, budget, seed, and time.
- [x] Helper arguments/results remain portable and cloned as already frozen;
      a helper cannot receive/return a class instance, access implicit `this`,
      mutate receiver state, construct a class, or call a class member.
- [x] Helper print/capability/async/stream bodies, imported helpers/classes,
      non-portable values, optional calls, wrong arity, missing helpers, and
      metadata mutation reject before provider dispatch.
- [x] Whole-graph preflight examines helper calls in inactive conditional and
      short-circuit branches and in every admitted class body before effects.
- [x] Capability planning reaches capabilities in the class frame and its pure
      helpers exactly, clears unsupported for owned paths, and keeps reverse or
      imported composition unsupported.
- [x] Existing M3.24 helper-only and M3.26-M3.31b2b1 class-only behavior remains
      byte-compatible, including virtual/super dispatch and snapshot isolation.
- [x] A new convergence owner records pure class-to-helper composition while
      `runner-classes-state` retains effectful fields, pre-super statements,
      reverse instance composition if deferred, and M3.31c module identity.
- [x] Focused tests, build/typecheck/lint, exact `pnpm fitness:kern-5`, and final
      six-engine `agon review` pass with every finding adjudicated.

## RED Oracle Design

1. Extend the current planner red oracle so the same `llm.complete` class method
   returning `decorate(answer)` has one executable requirement but one
   unsupported execution at base.
2. Add runtime parity where a capability precedes a class method helper call;
   base selects compatibility before invoking the instrumented provider.
3. Add helper-only-from-class reachability; base helper registry omits it.
4. Add a kill test where the helper attempts `new Widget()` or returns a class
   instance; a blanket removal of the class-map guard must not make it pass.
5. Add a no-replay async trace and overlapping-run isolation fixture.
6. Add a class-body helper loop with exact budget exhaustion before a later
   capability.

The oracle must not turn green by importing the reference runner, allowing
class values into `RunnerPortableValue`, making helper effects resumable,
flattening module scopes, marking all helpers reachable, weakening preflight,
or merely clearing planner `unsupported` without runtime ownership.

## Out of Scope

- Imported, re-exported, aliased, or cross-module helper/class identity.
- Effectful, async, stream, generator, or stdout-producing helpers.
- Helpers receiving/returning class instances, implicit receiver state, or
  private class metadata.
- Helpers allocating classes or invoking methods/getters; this is the explicit
  M3.31b2b3 reverse-composition follow-up.
- Effectful field initializers, virtual getter/property expansion, statements
  before explicit `super(...)`, nested/conditional super, setters, statics, or
  streams.
- New public runtime, capability, continuation, class, or helper ABI.

## Open Questions

None. The brainstorm resolved the direction question; RED/GREEN, the complete
fitness wall, and the adjudicated terminal review promote every target row to
VERIFIED.

## Deploy Order

Build only on `feat/kern-5-r2-m3-31b2b2-helper-composition`, created from
fresh merged `origin/main` at `d11fb900`. Run focused and full local gates, then
the full usable Agon review roster. Commit granularly, fetch and rebase
immediately before one push, wait for GitHub Build/Test, merge through the
approved native-git fallback if the App guard repeats its non-terminating
pattern, and never push this branch after merge.

No public ABI changes create a package skew contract. Older packages keep the
mixed graph on compatibility; newer packages select the machine only for the
proved same-root portable boundary.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| Helper/class composition needed a new runtime continuation. | Class frames already bind the same state and the M3.24 helper is deliberately synchronous/pure. | Reuse the existing trampoline for class-to-helper; do not add a continuation. |
| Removing the helper graph's class-map guard is sufficient. | Reachability does not seed from class bodies, class preflight explicitly rejects helpers, and the class scalar classifier rejects them. | Admission, preflight, classification, runtime registry, and planner must converge together. |
| Combined preflight and cleared planner ownership were current VERIFIED behavior. | Preflight is split and the exact planner regression expects `unsupported`. | Downgraded both target rows to ASSUMED until executable evidence exists. |
| Shallow registry capture was enough for async isolation. | The original helper binding still exposed mutable body nodes while a provider was suspended. | Deep-snapshot helper binding body/handler/params before structural preflight; the mid-flight mutation oracle now returns the original result. |
| The existing helper-first selector branch would validate mixed graphs. | Reachable helpers caused admission to skip full class-frame preflight, allowing private receiver transport to bypass the class guard. | Run full class preflight first whenever an admitted class graph exists; a dedicated convergence mutation kills branch reordering. |
| Rejecting only a direct `this` helper argument closed receiver transport. | `identity(this!)` was still machine-selected because wrapper expressions hid the bare private receiver. | Share one recursive receiver predicate between structural preflight and value classification while preserving allowed `this.field` scalar reads. |
| Cloning only the top-level helper props object was a complete snapshot. | Nested arrays/records in `IRNode.props` and structured return metadata still shared references with the source binding. | Deep-clone both node props and return metadata; direct snapshot and convergence mutation oracles kill shallow copies. |
| Scalar-only helper argument classification covered the portable helper contract. | Portable array and record literals were structurally valid but still made the mixed graph fall back to compatibility. | Admit composite helper arguments only through the existing portable machine-let shape proof; suspending expressions and class construction remain unsupported. |
| Snapshotting helper bindings isolated nested calls from later metadata mutation. | Nested helper call-shape validation still read the original live `runnerFunctions` map after async suspension. | Build helper execution environments from the frozen per-run helper registry; an async arity-mutation oracle and convergence kill bind the boundary. |
| Reverse-composition containment covered every private receiver expression. | The class-use walker caught `this.field` but missed bare `this`, bare `super`, and indexed `this[...]` inside helper bodies. | Reject private receiver identifiers at the graph boundary; three graph-level RED oracles and a convergence mutation lock the rule. |
| A portable helper call was scalar merely because it appeared in a scalar class slot. | Helpers declared `any` could return composites, and helpers with scalar declarations could lie in their return bodies, after an earlier provider ran. | Require an explicit portable scalar return contract and prove every scalar helper return body before machine admission. |
| Filtering the helper registry to scalar contracts was sufficient for return-body proof. | It rejected the existing M3.24 `questionText(makeQuery(...))` contract because generic nested helpers may legitimately produce portable composite arguments. | Carry separate scalar-position and generic-argument predicates through shape proof, recursively admit exact pure helper arguments, and add a convergence kill. |

## Verification Evidence

- RED/GREEN runtime and public-source oracles:
  `packages/core/tests/runtime-envelope-effect-machine-class-helper.test.ts`.
- Planner ownership and imported-helper containment:
  `packages/core/tests/runner-capability-class-frame.test.ts`.
- Convergence owner and five named kill mutations:
  `scripts/source-runner-class-helper-convergence.test.mjs`.
- Focused convergence wall: 433 runtime/planner units plus 27 convergence tests;
  `pnpm test:source-runner-convergence` passed on 2026-07-16.
- Exact aggregate wall: `pnpm fitness:kern-5` passed on 2026-07-16 with
  432/432 cross-target fixtures, 109/109 class fixtures, 233 native cases,
  48/48 checker fixtures, 39/39 validator verdicts, 40 application fixtures
  across three legs plus whole-app boot, and browser budget 149 modules /
  1,504,140 raw / 324,003 gzip bytes / 60 ms cold / 92 ms median; the
  required repeat measured 57 ms cold / 88 ms median.
- Initial full-roster Agon review `review-1784236442005-xtko8x`: 6/6 engines
  completed, zero consensus-verified findings. Its wrapped-private-receiver
  concern became a failing RED oracle and was fixed before the final fitness
  wall. The fixture-field needs-check was disproved against the production
  admission contract: root `runnerThis`/`runnerSuperClass` must be absent.
- Second full-roster Agon review `review-1784238408653-tdc0cw`: 6/6 engines
  completed. The claimed missing convergence file mapping was disproved by the
  central `FILES.classHelperGraph` binding and repeated green baseline/mutation
  walls. The nested-metadata snapshot concern became a failing direct oracle
  and was fixed with structured deep clones before the final fitness wall.
- Third full-roster Agon review `review-1784240330837-1grirm`: four usable
  verdicts returned while Claude errored and Kimi timed out. GLM's portable
  composite-argument concern became a failing RED oracle and was fixed through
  the existing portable-shape proof before the final fitness wall. The claimed
  helper-only regression was disproved by the class-graph conditional and the
  green M3.24 helper suite.
- First terminal full-roster Agon review `review-1784242429634-pwgyrc`: 6/6
  engines completed. Codex's live nested-helper metadata finding became a
  failing async RED oracle and was fixed by deriving helper call environments
  from the frozen per-run registry. The remaining needs-check claims were
  disproved by recursive class-use containment, per-run state lifetime,
  combined-structure root coverage, and existing helper-only oracles.
- Second terminal full-roster Agon review `review-1784244496719-9oo0jq`: 6/6
  engines completed with zero verified findings. Agy and Kimi's bare private
  receiver needs-check became three failing graph-level RED oracles and was
  fixed before the final fitness wall. The template-literal claim was disproved
  by the recursive helper-argument receiver predicate.
- Third terminal full-roster Agon review `review-1784246309546-pbzrmw`: 6/6
  engines completed. Codex's composite-helper scalar-return blocker became two
  RED oracles and was fixed with an explicit scalar contract plus return-body
  proof. The resulting M3.24 nested-record regression was traced to scalar and
  generic argument contexts, fixed without admitting class values, and pinned
  by a focused oracle and convergence mutation.
- Final full-roster Agon review
  `review-1784249101282-nraj2q-m3-31b2b2-final`: five engines returned and Kimi
  timed out at the full 600-second wall. Consensus's only verified item was
  ensuring all new files enter the commit. The unrelated-class needs-check was
  disproved: a helper-only path with a valid dormant class remains machine
  selected, while a dormant class attempting private-receiver transport is
  intentionally rejected by the whole-graph contract. No code blocker remains.

## Adversarial Record

Full-roster brainstorm `brainstorm-1784233659602-f4rkmt` completed 6/6 on
`claude,codex,agy,kimi-for-coding-k3,minimax-coding-plan-minimax-m3,zai-coding-plan-glm-5.2`.
All engines selected Option A. Consensus reasoning: it reuses the existing
per-run state and synchronous portable helper trampoline, keeps receiver
identity outside the helper cache key, and requires no new continuation or
instance transport. Bidirectional composition would make caching receiver- or
allocation-sensitive, widen `RunnerPortableValue`, and require resumable helper
frames. The run also identified the false target-as-VERIFIED rows corrected
above and required narrower convergence guards plus reverse/import kill tests.
