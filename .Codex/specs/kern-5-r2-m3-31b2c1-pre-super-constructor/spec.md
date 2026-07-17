# KERN 5 R2 M3.31b2c1 — Pre-Super Constructor Execution

**Status:** DONE
**Date:** 2026-07-17
**Confidence:** 0.98

## Executive Summary

M3.31b2c1 makes the canonical source machine execute straight-line work before
an explicit derived-constructor `super(...)` in authored order. Constructor
parameters are bound first; pre-super statements may create portable locals and
run class-frame-owned effects; super arguments are then evaluated from those
locals; the base constructor runs; derived fields initialize; and the remaining
constructor body runs. Any pre-super `this` or `super` member access remains a
fail-closed admission error before provider dispatch.

This is a complete release boundary, not the whole former M3.31b2c bucket. The
required 3/3 Agon brainstorm selected a separate M3.31b2c2 slice for resumable
helper-to-class effects because helper execution still has a synchronous,
portable, cached contract. Imported or cross-module identity remains M3.31c.

## Current State / Root Cause

- **VERIFIED:** the constructor planner accepts an explicit `super(...)` only
  when it is the first constructor statement and stores only the remaining body.
  Evidence: `packages/core/src/ir/semantics/internal-effect-machine-class-construction.ts:116-153`.
- **VERIFIED:** the generator frame evaluates super arguments before it runs any
  constructor statements, then initializes the current layer's fields and runs
  the post-super body. Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts:47-89`.
- **VERIFIED:** whole-graph preflight evaluates the super-argument shape against
  an environment containing parameters only, then analyzes the post-super body
  as one normal-completing sequence. Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-class-preflight.ts:189-227`.
- **VERIFIED:** the semantic validator defines explicit-super mode by authored
  placement and rejects double/conditional super plus `this`/`super` member
  access before initialization; it does not require super to be the first
  statement. Evidence: `packages/core/src/semantic-validator.ts:5485-5533`.
- **VERIFIED:** the compatibility/reference constructor is not a valid oracle
  for this gap: it finds a super statement, evaluates its arguments from
  parameters before preceding statements, initializes the base and fields, then
  executes all non-super statements. Evidence:
  `packages/core/src/ir/semantics/portable-reference-body.ts:49-140`.
- **VERIFIED:** root class constructors already own resumable capability frames;
  the class frame body runner yields and resumes without replay. Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts:47-89`
  and the existing async constructor tests in
  `packages/core/tests/runtime-envelope-effect-machine-class-constructor-super.test.ts`.
- **VERIFIED:** helper-to-class reverse composition intentionally rejects
  reached `capability` and `print` nodes to preserve a synchronous portable
  helper result/cache contract. Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-helper-class.ts:195-221`.
- **VERIFIED:** the release ledger assigns effect/pre-super work to M3.31b2c,
  keeps module identity for M3.31c, and retains one parent class-state blocker.
  Evidence: `docs/kern-5-release-train.md:702-732` and
  `scripts/source-runner-convergence-manifest.json:102-108`.
- **VERIFIED:** `brainstorm-1784259240538-6pazi9-m3-31b2c-boundary` completed
  with `claude,codex,agy`; its winning answer and all bids recommended separating
  pre-super class-frame execution from resumable helper continuations.

## What Already Works

- Leading explicit super and implicit no-argument base initialization.
- Resumable base and derived constructor bodies after base initialization.
- Base-to-derived field initialization and existing derived-field override
  semantics.
- Same-root constructor/method/getter frames, virtual and `super` method
  dispatch, and pure helper/class composition.
- Complete class-graph capability and iteration-budget discovery.
- Fail-closed imported/cross-module class identity.

Those owners remain intact; this slice changes only the explicit-super
constructor partition and its preflight/execution order.

## Contract (Verified)

> Verified against branch `feat/kern-5-r2-m3-31b2b2-helper-composition` at
> `c4c96ea6` and live `origin/main` at `d11fb900` on 2026-07-17.

| Behavior | Contract | Evidence | Tag |
| --- | --- | --- | --- |
| Explicit shape | Exactly one direct top-level `do value="super(...)"`; statements may precede it | validator discipline plus brainstorm decision | VERIFIED |
| Partition | Planner returns `preSuper`, `superArguments`, and `postSuper`; implicit/root modes have empty `preSuper` | 3/3 brainstorm decision plus enumerated planner clients | VERIFIED |
| Order | params -> pre-super -> super args -> base -> current fields -> post-super | 3/3 brainstorm decision grounded in `internal-effect-machine-class-frame.ts:47-89` | VERIFIED |
| Pre-super values | portable locals and capability results may feed a pure super-argument expression | validator contract plus machine analyzer/capability binding path | VERIFIED |
| Pre-super effects | existing class-frame `capability` and trace-producing nodes may suspend/resume once | existing class-frame generator owner plus 3/3 brainstorm decision | VERIFIED |
| Receiver state | `this`, `this.member`, `super.member`, instance allocation/transport, and field assignment are unavailable before super | semantic validator contract and machine private-receiver invariant | VERIFIED |
| Super arguments | pure scalar expressions only; may reference params and definitely established pre-super locals; helper/class calls remain rejected | current super argument owners plus 3/3 brainstorm decision | VERIFIED |
| Completion | pre-super and post-super partitions must each complete normally on every machine-admitted path | current constructor normal-completion rule plus 3/3 decision | VERIFIED |
| Failure | invalid graph rejects before any provider; provider rejection never retries compatibility and clears private state | existing class-frame failure contract | VERIFIED |
| Snapshot | plan, pre/post bodies, lineage, and metadata are frozen before suspension | class graph snapshot at `internal-effect-machine-class-graph.ts` | VERIFIED |
| Helper effects | helper-reached effectful constructors/methods/getters remain unsupported for M3.31b2c2 | `internal-effect-machine-helper-class.ts:195-221` | VERIFIED |
| Modules | imported/re-exported/aliased/cross-module class identity remains M3.31c | release train and manifest | VERIFIED |
| Public ABI | no exported runtime, handler, capability, helper, or class ABI change | selected internal-machine boundary | VERIFIED |

## Implementation Options

### A. Execute pre-super work inside the existing class generator (selected)

Partition one direct top-level super statement. Run `preSuper` through the
existing generator-owned body runner, evaluate pure super arguments from the
mutated constructor environment, recurse into the base, initialize the current
fields, and run `postSuper`. Reuse one machine state, snapshot, iteration budget,
and provider continuation.

This matches the language validator and preserves all current internal/public
contracts.

### B. Teach compatibility to reorder pre-super locals before machine ownership

Rejected as the primary implementation. The current compatibility constructor
does not model authored order and would still leave canonical execution outside
the owned runtime. It may be corrected later as an oracle-hardening task, but it
cannot substitute for this slice.

### C. Bundle resumable helper-to-class effects

Rejected for M3.31b2c1. That requires changing the synchronous helper trampoline,
portable result cache, reverse reachability, and planner disposition. It is a
separate continuation contract and becomes M3.31b2c2.

### D. Bundle imported/module class identity

Rejected. Defining-module tokens, aliases, import graph ownership, and skew
behavior are M3.31c and have a different trust boundary.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `internal-effect-machine-class-construction.ts` | modify | partition explicit constructors and permit pre-super local names structurally |
| `internal-effect-machine-class-frame.ts` | modify | execute pre-super before argument/base/field/post order |
| `internal-effect-machine-class-preflight.ts` | modify or extract | phase-aware receiver rejection and shared binding analysis |
| `internal-effect-machine-class-runtime.ts` | modify | treat only post-super assignments as initialized instance state |
| new focused tests under `packages/core/tests` | add | RED/GREEN order, effect, admission, snapshot, and parity oracles under 500 lines |
| `runner-capability-class-frame.test.ts` | extend | prove root pre-super effects are executable while helper-reached effects remain unsupported |
| constructor-super convergence owner/tests | extend | kill deletion/reordering/receiver-containment mutations |
| convergence manifest/checker/tests | extend | add M3.31b2c1 owner and retain b2c2/c parent blocker |
| `docs/kern-5-release-train.md` | extend | record exact wall/review evidence and remaining slices |
| this spec | update | status, acceptance evidence, and corrections |

New handwritten files stay below 500 lines. Existing oversized files receive no
new logic; new test/oracle material goes into focused files.

## Acceptance Criteria

- [x] RED-at-base proves a top-level pre-super `let` feeding `super(local)` is
      compatibility-selected and unavailable to the machine today.
- [x] Parameters are bound before pre-super work; a multi-statement portable
      local chain feeds a pure super-argument expression in authored order.
- [x] A pre-super capability result feeds `super(...)`, suspends/resumes exactly
      once, and orders before base effects, current-layer fields, and post-super
      effects.
- [x] Three inheritance layers execute most-derived pre-super work on descent,
      then base initialization, then post-super work on ascent without replay.
- [x] `this`, bare `this`, `this.member`, `this.method()`, `super.member`, field
      assignment, or receiver transport before super rejects machine selection
      before any provider dispatch.
- [x] Duplicate, nested, conditional, loop-contained, lambda-contained, missing,
      wrong-arity, or constructor-less-base-crossing super forms remain
      fail-closed exactly as before.
- [x] Super arguments remain pure scalar expressions; helpers, class allocation,
      class/member calls, optional calls, missing or unstable locals, and
      non-portable values reject before provider dispatch.
- [x] Pre-super `return`, `throw`, `break`, `continue`, or any path that may not
      complete normally rejects before provider dispatch.
- [x] Implicit-super and leading-explicit-super behavior remains byte-for-byte
      compatible with existing machine tests.
- [x] Async suspension freezes pre/post bodies, super arguments, arity, lineage,
      and fields; mutation after suspension cannot change the active run.
- [x] Overlapping runs isolate constructor locals, provider continuations,
      instance owner, class registry, call stack, iteration budget, seed, and
      time.
- [x] Provider failure in pre-super work occurs once, leaks no receiver/binding,
      and never retries compatibility.
- [x] Capability planning marks reached root pre-super effects executable but
      keeps helper-reached effectful class paths unsupported for M3.31b2c2.
- [x] Imported, re-exported, aliased, ambiguous, or cross-module class identity
      remains unsupported for M3.31c.
- [x] Convergence adds one M3.31b2c1 owner and kills plan partition, execution
      order, pre-super receiver containment, and planner-disposition mutations;
      `runner-classes-state` remains deferred to exact M3.31b2c2/M3.31c.
- [x] Focused RED/GREEN tests, build/typecheck, lint, full `pnpm fitness:kern-5`,
      and final `agon review` with `claude,codex,agy` pass; every verified blocker
      is fixed and the terminal review is clean or fully adjudicated.

## RED Oracle Design

1. `let adjusted = value + 2; super(adjusted * 3)` must return the base field
   value, not evaluate super before the local exists.
2. `capability name=token; let adjusted = token + 1; super(adjusted)` must emit
   provider order `derived-pre, base, derived-post`, once each.
3. A three-level chain must prove descent/ascent ordering and current-layer field
   initialization timing.
4. An earlier root provider followed by a pre-super receiver violation must keep
   provider calls at zero, proving whole-graph preflight.
5. Mutate the pre-super binding, super argument, base lineage, and post-super body
   while an earlier provider is suspended; the active run must use the frozen
   graph.
6. Source capability planning must distinguish root-reached pre-super effects
   from the still-unsupported helper-reached effect path.

The oracle must not turn green by moving pre-super work after base initialization,
evaluating super arguments twice, exposing a receiver before super, broadening
super arguments to calls, importing compatibility execution, disabling helper
purity, flattening module scopes, or clearing planner `unsupported` without
runtime ownership.

## Out of Scope

- Resumable/effectful helper-to-class continuations (M3.31b2c2).
- Helper parameters/results that transport class instances.
- Conditional or nested super execution, even if every branch calls super.
- Effectful expressions inside `super(...)`; effects must be explicit pre-super
  statements whose portable result feeds a pure argument.
- Async/stream constructors as a new language or public ABI construct.
- Setters, statics, streams, public instance serialization, or transactional
  rollback of already-observed provider effects.
- Imported/re-exported/aliased/cross-module class identity (M3.31c).
- Promotion or deletion of the parent `runner-classes-state` blocker.

## Open Questions

None. All acceptance criteria rest on source-verified contracts or the explicit
3/3 boundary decision.

## Deploy Order

This is an internal additive ownership slice with no external version-skew
window. A post-review `git fetch origin` and `git ls-remote origin
refs/heads/main` both resolved live `origin/main` to `d11fb900`; it still does
not contain `666ee884` or `c4c96ea6`. The slice therefore remains stacked on
`feat/kern-5-r2-m3-31b2b2-helper-composition`. Immediately before the single
push: fetch `origin` again, rebase onto current `origin/main`, run the scoped
post-rebase gate, and push with `--no-verify`. If both prior slices appear in
`origin/main` during that final refresh, create
`feat/kern-5-r2-m3-31b2c1-pre-super-constructor` from `origin/main` and replay
only this slice.

## Verification Receipt

- Focused convergence: selected pre-super runtime suites plus all adjacent
  runner/class/helper suites passed; all 37 convergence mutation checks passed.
- Exact final wall: `pnpm fitness:kern-5` passed after the focused selector was
  corrected in both `package.json` and the fitness-policy mirror.
- Final wall metrics: 432/432 cross-target fixtures, 109/109 class fixtures, 233
  native cases, 48/48 checker fixtures, 39/39 validator verdicts, and 40
  application fixtures on three legs plus whole-app boot.
- Required browser wall: 150 modules, 1,521,167 raw bytes, 326,404 gzip bytes,
  58 ms cold import/execute, and 87 ms median browser import/execute.
- Terminal review: `review-1784262755790-138qtd-m3-31b2c1-pre-super-final`
  completed 3/3 with zero verified and zero needs-check findings. The
  speculative eager-fast-path concern was disproved by the live call chain:
  preparation is preflight-only and real construction always enters the
  generator frame. The remaining duplicate parse is a non-behavioral nit.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| M3.31b2c should bundle every remaining same-root class effect. | Root class frames already own effects; only pre-super ordering and helper-reached effects remain, with different continuation contracts. | Split b2c1 pre-super from b2c2 helper continuations. |
| Compatibility/reference can serve as the pre-super oracle. | It evaluates super args before preceding statements and later runs those statements after fields. | Use language validation plus machine RED/GREEN order oracles; do not copy compatibility ordering. |
| Supporting pre-super locals only requires relaxing the leading-super check. | Planner, preflight, frame execution, initialized-field approximation, capability planning, and convergence all consume the constructor plan. | Change the complete ownership chain and bind it with mutation tests. |
| Pre-super work should receive the private instance and rely on runtime errors. | The language forbids receiver access before super, and a prior provider would make late failure observable. | Add phase-aware whole-graph receiver containment before any dispatch. |
| The focused convergence command already selected every new test. | Its class pattern initially omitted `pre-super`, although the broad workspace suite still executed the tests. | Add `pre-super` to the command and policy mirror, rerun focused convergence, then rerun the exact full wall. |
| Preflight preparation might execute a separate eager constructor fast path. | Preparation only builds an analysis receiver/environment; runtime construction always enters `evaluateInternalMachineClassNewFrame`. | Adjudicate the review item as disproved without changing validated behavior. |
