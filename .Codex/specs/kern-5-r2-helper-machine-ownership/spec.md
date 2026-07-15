# KERN 5 R2 M3.24 Same-Root Helper Machine Ownership

**Status:** IMPLEMENTED — READY FOR PR
**Date:** 2026-07-15
**Confidence:** 0.99
**Design challenges:** Agon tribunals
`tribunal-1784110901854-r7sjvf` (next-slice ordering, 4/4 seats) and
`tribunal-1784123535127-qt7qcs` (execution seam, 4/4 seats)

## Executive Summary

M3.24 removes the `helper-functions` source-runner convergence blocker for
reachable, same-root, synchronous, pure KERN helper functions. Calls execute
by re-entering the canonical internal effect-machine sequence with the same
iteration state, not through `runPortableReferenceBody` and not through a
second helper interpreter.

The per-run helper registry lives on `InternalEffectMachineState`. A private
symbol associates that state with the current `SemanticEnv`, so portable
expression evaluation can resolve helper calls without a global map and
without threading a new argument through the current 113 evaluator call
sites. Preflight and runtime create distinct states from the same validated
reachable graph; child and cloned environments preserve the private token.

Imported/module-scoped helpers, runner classes/state, async helpers,
capability-producing helpers, and incoming non-root environments remain on
compatibility. Programs whose reachable helper graph contains a loop require
the existing explicit caller-owned `iterationBudget`; this slice adds no
default budget and no public option.

## Current State / Root Cause

- **VERIFIED:** source runner construction installs the linked root
  `runnerFunctions`, `runnerClasses`, empty call stack, and call cache through
  `makeEnv` before selection (`packages/core/src/runner.ts:1063-1087` and
  `packages/core/src/runner.ts:1224-1262`).
- **VERIFIED:** root module scopes tag each local binding with its defining
  scope, while imported bindings retain the defining module's binding object
  (`packages/core/src/runner.ts:490-568`). This identity is sufficient to
  distinguish same-root helpers from imports without adding a public field.
- **VERIFIED:** direct machine admission requires `runnerFunctions` and
  `runnerClasses` to be empty (`packages/core/src/ir/semantics/internal-effect-machine-admission.ts:137-149`).
- **VERIFIED:** the machine portable evaluator rejects every non-`String`
  identifier call (`packages/core/src/ir/semantics/portable-machine-evaluator.ts:4-14`).
- **VERIFIED:** the reference evaluator resolves helper functions, creates a
  fresh call environment, runs `runPortableReferenceBody`, filters effects
  after execution, and caches returns
  (`packages/core/src/ir/semantics/portable-reference-evaluator.ts:323-393`).
  That path is legacy ownership and cannot be imported by the machine.
- **VERIFIED:** `InternalEffectMachineState` currently contains only
  `remainingIterations`; it reaches sequence/loop dispatch but does not reach
  `portable-machine-evaluator.ts`, structure, or leaf evaluation
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:45-100`,
  `packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:179-233`,
  and `packages/core/src/ir/semantics/portable-eval-types.ts:10-28`).
- **VERIFIED:** structure preflight clones environments and validates the
  whole root tree before the runtime generator is driven
  (`packages/core/src/ir/semantics/internal-effect-machine-control.ts:5-17`,
  `packages/core/src/ir/semantics/internal-effect-machine-structure.ts:492-498`,
  and `packages/core/src/ir/semantics/internal-effect-machine.ts:45-57`).
- **VERIFIED:** root-only iteration discovery ignores helper bodies today
  (`packages/core/src/runtime-envelope/source-runner-engine.ts:41-55`).
- **VERIFIED:** the convergence manifest records `helper-functions` as
  `environment` / `legacy` and retains class state, non-root environments, and
  implicit budget as separate blockers
  (`scripts/source-runner-convergence-manifest.json:30-54`).
- **VERIFIED:** `internal-effect-machine-structure.ts` is 498 lines and
  `internal-effect-machine-leaf.ts` is 491 lines (`wc -l ...`, 2026-07-15), so
  substantive helper logic must be extracted.

The root cause is not missing helper syntax or reference semantics. It is a
runtime ownership gap: selection rejects the linked helper registry, the
machine evaluator has no helper-call host, and canonical state is not
available at the expression leaf where a helper is invoked.

## What Already Works

- The linker already builds exact function bindings, same-file recursion
  graphs, and defining-module identity. No new parser or public descriptor is
  required.
- The canonical sequence already owns portable statements, completion,
  structured control flow, try/finally rules, and shared loop-budget
  consumption. Helper bodies must reuse it.
- `makeEnv` already clones portable argument values and creates owned binding,
  provenance, call-stack, and cache containers.
- Source selection already has a no-catch-and-retry split. Unsupported helper
  graphs must abstain before selection rather than fall back after machine
  execution starts.
- The legacy/reference helper path remains the compatibility oracle; it is not
  deleted or imported into the machine graph in this slice.

## Contract (Verified and Proposed)

> Verified against the source paths above on 2026-07-15. Rows marked PROPOSED
> are acceptance contracts introduced by M3.24.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Function binding | sync, non-stream, non-void, one KERN handler | `packages/core/src/runner.ts:658-670` | VERIFIED |
| Same-root identity | reachable binding's `module.functions` is the selected root function map | `packages/core/src/runner.ts:501-568` | VERIFIED |
| Class boundary | any non-empty `runnerClasses` remains compatibility | `internal-effect-machine-admission.ts:137-149` | VERIFIED |
| Registry owner | immutable reachable-helper registry belongs to one `InternalEffectMachineState` | acceptance criteria | PROPOSED |
| State transport | private symbol on owned runtime/preflight environments; copied to child/clone scopes | acceptance criteria | PROPOSED |
| Body owner | `runInternalEffectMachineSequence`, sharing the caller's state | `internal-effect-machine-sequence.ts:179-233` | PROPOSED |
| Preflight | every reachable body and call edge validates before root provider invocation | acceptance criteria | PROPOSED |
| Reachability | unused unsupported helpers do not block an otherwise machine-owned program | existing executable-handler reachability pattern in `packages/core/src/runner.ts:832-849` | PROPOSED |
| Arguments | owned portable scalar, array, record, map, and Decimal values; no class/host/function values | existing runner portable domain | PROPOSED |
| Return | explicit return of an owned portable value; scalar call positions additionally require scalar | existing reference assertions at `portable-reference-evaluator.ts:373-393` | PROPOSED |
| Recursion | direct/mutual same-root recursion retains the existing depth contract and never falls back after selection | reference depth guard at `portable-reference-evaluator.ts:335-338` | PROPOSED |
| Effects | helper `print` and `capability` nodes are outside the pure-helper graph | acceptance criteria | PROPOSED |
| Iterations | reachable helper loops require and consume the caller's existing explicit budget | `source-runner-engine.ts:41-71`; sequence consumption at `internal-effect-machine-sequence.ts:42-50` | PROPOSED |
| Async parity | immediate async runner uses the same synchronous helper machine until a root capability yields | existing shared generator in `internal-effect-machine.ts:60-100` | PROPOSED |
| Fallback | unsupported graph selects legacy before execution; selected machine failures never retry legacy | `source-runner-engine.ts:65-110` | VERIFIED |

## Implementation Options

### Option A — State-owned registry with private environment token (recommended)

Extend `InternalEffectMachineState` with a read-only helper registry, helper
call depth/cache state, and a private canonical body-runner delegate. Associate
the state with environments using a module-private symbol. Runtime and
preflight build separate state objects; clones and children copy the symbol.

This keeps state lifetime per run, survives environment cloning, creates no
global mutable authority, avoids 113 evaluator signature changes, and lets
helper calls re-enter the existing sequence.

### Option B — Full evaluator/context argument threading

Thread state through structure, leaf, sequence, capability preparation,
deferred preflight, collection/record helpers, and every evaluator callback.
This is explicit but touches the entire expression/runtime surface and would
force immediate splits of two near-500-line files. It is valid only if the
private token cannot be kept unforgeable or concurrency tests expose leakage.

### Option C — WeakMap or module-level registry

Rejected. Environment identity changes during preflight; using
`runnerCallCache` as a shared key hides authority and complicates nested or
concurrent runs. A module-level map also requires teardown correctness.

### Option D — Dedicated pure-helper interpreter

Rejected. It duplicates control flow, completion, deferred bindings, budget
consumption, and try/finally semantics that the convergence train is removing.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r2-helper-machine-ownership/spec.md` | add/update | frozen claim-tagged contract and evidence |
| `internal-effect-machine-helper-state.ts` | add | private state token, registry/state access, child/clone propagation |
| `internal-effect-machine-helper-graph.ts` | add | safe reachable-call graph, same-root/purity admission, budget discovery |
| `internal-effect-machine-helper-runtime.ts` | add | portable args, call env, recursion/cache, canonical body re-entry, return validation |
| `internal-effect-machine-types.ts` | edit | per-run helper state and unified disposition |
| `internal-effect-machine-admission.ts` | edit | admit only owned validated same-root helper environments |
| `internal-effect-machine-structure.ts` | minimal edit | invoke extracted helper graph/body preflight under 500 lines |
| `internal-effect-machine.ts` | edit | construct/attach per-run state and body-runner delegate |
| `internal-effect-machine-sequence.ts` | minimal edit | canonical helper re-entry delegate and shared state |
| `portable-machine-evaluator.ts` | edit | resolve only state-registry helper calls |
| `portable-machine-shape.ts` | edit | admit registered identifier-call shape without widening unknown calls |
| `deferred-expression-preflight.ts` | edit/extract if needed | treat helper results as deferred and validate call edges without executing providers |
| `semantic-env.ts` / `internal-effect-machine-control.ts` | minimal edit | preserve private state token in child and preflight clones |
| `source-runner-engine.ts` | edit | include reachable helper bodies in explicit-budget discovery |
| machine/source-runner tests | add/edit | RED/GREEN parity, preflight, recursion, budget, concurrency, exclusions |
| convergence manifest/checker/tests | edit | promote only `helper-functions` to owned evidence |
| import-closure policy/tests | edit if graph grows | prove no reference/legacy import edge and bounded browser impact |
| release train/spec | edit after gates | record verified completion evidence only |

## Acceptance Criteria

- [x] A source program whose root calls a reachable same-root pure helper
  selects the machine in sync and immediate-async APIs and matches legacy
  stdout/completion for scalar, array, and record results.
- [x] The helper registry is created per preflight/runtime state from the
  validated reachable graph, is immutable after creation, and is unavailable
  to arbitrary identifier calls or caller-injected raw environments.
- [x] Calls re-enter `runInternalEffectMachineSequence` with a fresh owned call
  environment and the exact same `remainingIterations` object as the root.
- [x] Direct and mutual same-root recursion preserve the existing deterministic
  depth failure; failures never catch-and-retry through legacy.
- [x] Every reachable helper body and call edge is validated before the first
  root capability provider is invoked, including calls in conditions,
  capability inputs, nested branches, loop controls, and other helper bodies.
- [x] An unused unsupported/imported/effectful helper does not block a root
  program that never reaches it; making it reachable selects compatibility.
- [x] Helper `print`, helper `capability`, imported helper edges, module-scope
  switches, non-empty class maps, class values, `this`/`super`/`new`, async or
  stream helpers, and non-portable args/returns remain outside machine
  admission.
- [x] A reachable helper loop selects compatibility without an explicit
  `iterationBudget`; with a budget it consumes the shared counter, and
  exhaustion prevents any later root capability call.
- [x] Helper locals, mutations, and internal trace events do not escape the
  call environment; portable argument composites cannot mutate caller-owned
  values through aliasing.
- [x] Two concurrent async runs with identical helper names have isolated
  registry, call stack, cache, seed/now, and budget state.
- [x] Unknown identifier calls continue failing closed; no host JavaScript
  function or accessor is invoked during admission, preflight, or runtime.
- [x] The runtime import closure contains no reference runner, reference helper
  evaluator/body, registry, Node-only module, or public feature switch.
- [x] `helper-functions` becomes evidenced `unified`; runner class state,
  non-root environment, and implicit iteration budget remain exact deferred
  blockers.
- [x] Every new/extracted helper runtime/test file and every substantively
  edited machine file remains below 500 lines; the pre-existing oversized
  public runner receives only its two-line scope marker.
- [x] Focused tests, complete core tests, convergence/import-closure guards,
  and `pnpm fitness:kern-5` pass before the signed single push. The full usable
  Agon roster was dispatched; all completed findings were verified and fixed,
  and the targeted post-fix review returned no findings.

## RED Oracles

Before implementation, tests must fail for the right reasons:

1. A valid same-root `double(x)` helper program selects `legacy`, not machine.
2. Direct canonical execution rejects an otherwise owned non-empty helper map.
3. Root `capability` followed by a malformed reachable helper lacks proof that
   helper validation precedes provider invocation.
4. A helper loop is invisible to `requiresIterationBudget` and can only reach
   compatibility today.
5. No canonical oracle proves direct/mutual recursion, composite arguments and
   returns, or concurrent helper-run isolation.
6. The exact convergence checker requires `helper-functions` to remain
   deferred.

The oracle must not turn green by calling `runPortableReferenceBody`, importing
`portable-reference-evaluator`, duplicating the helper interpreter, allowing
raw host functions, flattening imported scopes into the root, adding an
implicit budget, weakening existing compatibility assertions, or introducing
a catch-and-retry path.

## Verification Evidence

- `pnpm --filter @kernlang/core test` passed the complete core suite.
- `pnpm test:kern-runtime-envelope` passed machine-only import-closure and
  runtime-envelope checks.
- `pnpm test:source-runner-convergence` passed the executable convergence
  contract with `helper-functions` promoted to unified M3.24 ownership.
- `pnpm lint` passed.
- `pnpm fitness:kern-5` passed the complete current fitness wall, including
  432/432 conformance fixtures, 109/109 class fixtures, 48/48 capstone checker
  fixtures, 39/39 self-host validator verdicts, and all app/drift checks.
- The required browser budget passed at 128 modules, 1,383,753 raw bytes,
  305,750 gzip bytes, 51 ms cold import+execute, and 79 ms median browser
  import+execute.
- Full-roster Agon review run
  `review-1784125207615-08sv17-kern-5-r2-m3-24-helper-machine-o` completed on
  four engines; Claude errored and agy timed out. The completed reviewers found
  branch wrapper/quoted-label handling and empty class-map identity gaps; all
  were reproduced and fixed.
- Targeted post-fix Agon review
  `review-1784126406523-z3h7a8-kern-5-r2-m3-24-post-fix` returned no findings.

## Out of Scope

- Imported, re-exported, or defining-module-switched helper execution.
- Runner classes, constructors, methods, fields, class instances, `this`,
  `super`, inheritance, or protected instance state.
- Incoming `SemanticEnv.parent` admission.
- Async/stream/generator helpers, promises, closures, thunks, dynamic import,
  or host functions/objects.
- Capability or stdout/stderr effects inside helpers.
- Adding an implicit iteration budget or changing public runner options.
- Deleting the legacy/reference helper oracle.
- Removing compatibility selection or claiming R2 M3 complete.

## Deploy Order

M3.24 starts at merged PR #529, `origin/main` commit `a8c8444a`. Before its
single push, fetch and rebase onto the then-current `origin/main`; never push
the deleted M3.23 branch again. M3.24 must merge before the class-state slice
starts, because that slice reuses helper call/re-entry machinery.

During version skew, no public ABI changes: old packages keep helper programs
on compatibility; the new package selects the machine only for the proven
same-root graph. Rollback restores the non-empty helper-map admission guard and
returns the manifest row to deferred; there is no persistent data or public
feature flag.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The remaining implicit budget blocker should precede helpers. | Explicit budget state and consumption already exist; helper bodies are missing consumers. | M3.24 precedes class state, non-root environments, and implicit default policy. |
| `InternalEffectMachineState` already flows through structure, leaf, and portable evaluation. | It currently reaches only the runtime sequence/loop path; evaluator hosts receive `(name, args, env, evaluate)`. | A private environment token is required to expose the state-owned registry without global mutable state. |
| A state-embedded registry needs zero API/signature work. | State construction, environment transport, helper graph admission, evaluator host behavior, and preflight all require bounded internal edits. | The spec enumerates the real blast radius and extracts new modules to keep files below 500 lines. |
| Add a default-off feature flag as the kill switch. | The release train uses executable admission/manifest rollback, and a new switch would add public/config drift. | Rollback is structural: restore admission and manifest; no new flag. |
| Preflight should reject every unsupported helper declaration. | The frozen requirement is every reachable helper body; unused declarations are not executable. | Admission builds a reachable graph, preventing unused legacy-only helpers from blocking valid roots. |
