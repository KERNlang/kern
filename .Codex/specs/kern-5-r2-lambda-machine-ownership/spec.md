# KERN 5 R2 M3.23 Lambda Machine Ownership

**Status:** DONE
**Date:** 2026-07-15
**Confidence:** 0.99
**Design challenge:** Agon tribunal
`tribunal-1784066461235-77kln0-m3-23-next-slice` (3/3 current engines
completed)

## Executive Summary

M3.23 removes the sole remaining node-kind blocker from source-runner
convergence by moving the already-frozen single-expression `lambda` contract
onto the canonical internal effect machine. The existing contract supports
expression-bodied closures, `List.map`, `List.filter`, direct invocation of
closures created inside the expression/setup scope, by-reference setup
capture, and fresh callback parameter scopes.

The current semantics live inside `lambda.ts`, which also imports contract
registry surfaces. This slice extracts the evaluator into a registry-
independent runtime owner shared by the semantic reference adapter and the
machine. The machine must not import the contract registry, call the reference
runner, evaluate host functions, or relax the root-environment boundary.

This is not helper-function, class, module, or general non-root-environment
support. Incoming environments with a parent, runner function/class state, or
host function values remain on compatibility. Loop-bearing programs still
require a caller-owned explicit iteration budget.

## Current State / Root Cause

- **VERIFIED:** `lambda` is the only remaining node entry marked `legacy` in
  `INTERNAL_EFFECT_MACHINE_DISPOSITION`; the convergence manifest contains the
  same sole deferred `kind: "node"` row.
- **VERIFIED:** source-runner selection currently routes a valid
  `List.map(xs, x => x)` lambda program to compatibility
  (`packages/core/tests/source-runner-engine.test.ts:65-79`).
- **VERIFIED:** `packages/core/src/ir/semantics/lambda.ts` is a 346-line
  executable reference contract covering expression-bodied closures,
  `List.map`, `List.filter`, direct closure calls, by-reference setup capture,
  and fresh callback parameter bindings.
- **VERIFIED:** `lambda.ts` combines evaluator logic with `NodeContract` and
  registry imports, so importing it from the production machine would violate
  the machine/reference ownership boundary.
- **VERIFIED:** `SemanticEnv` already implements parent-linked scopes and
  `childEnv`; the `non-root-environment` blocker is an admission policy gate,
  not a missing environment representation.
- **VERIFIED:** root machine admission rejects `env.parent`, non-empty
  `runnerFunctions`/`runnerClasses`, `runnerThis`, `runnerSuperClass`, and
  protected class state before execution.
- **VERIFIED:** `internal-effect-machine-structure.ts` is 493 lines. Lambda
  preflight logic must live in a new module, and call-site edits must keep the
  structure file below 500 lines.

The root cause is split ownership: the frozen lambda language already has an
executable semantic owner, but the canonical machine has neither a registry-
independent evaluator nor lambda-specific admission/preflight/dispatch hooks.

## Frozen Contract

| Behavior | Required M3.23 result | Tag |
|---|---|---|
| Node shape | non-empty `expr`; children limited to setup `let`/`assign` | VERIFIED |
| Expression body | expression-bodied lambdas only; block bodies reject | VERIFIED |
| Collections | `List.map` and `List.filter` over bounded owned arrays | VERIFIED |
| Calls | only closures created by the lambda runtime may be invoked | PROPOSED hardening |
| Capture | setup closures observe later writes in the same local scope | VERIFIED |
| Callback scope | each callback invocation gets fresh parameter bindings | VERIFIED |
| Setup isolation | setup `let`/`assign` remain local to the lambda wrapper | VERIFIED |
| Trace | one stdout event using the existing array comma-join projection | VERIFIED |
| Completion | normal completion only | VERIFIED |
| Deferred values | shape/binding preflight may defer value checks but never host-call admission | PROPOSED |
| Failure timing | malformed/unsupported lambda rejects before any earlier capability | PROPOSED |
| Environment | incoming non-root/helper/class state remains compatibility | VERIFIED guardrail |
| Public API | no new options, defaults, exports, or signatures | VERIFIED |

## Implementation Plan

1. Extract the evaluator and frozen preconditions from `lambda.ts` into a new
   registry-independent `lambda-runtime.ts` module. Keep `lambda.ts` as the
   semantic contract/fixtures adapter over that owner.
2. Represent closures as private runtime values, not host functions. Direct
   calls accept only those private closures. Use index-based bounded array
   traversal and captured intrinsics so an earlier capability cannot redirect
   `Array`/`Map` iteration or callback dispatch after preflight.
3. Provide two machine-facing checks:
   - exact shape and binding validation for all admitted paths;
   - value validation when referenced values are stable, with an explicit
     unknown-value path for earlier capability/conditional writes.
4. Add lambda-specific root claim, whole-tree preflight, and execution hooks.
   Keep `internal-effect-machine-structure.ts` below 500 lines by putting all
   substantive logic in the new module and tightening existing call-site
   formatting if necessary.
5. Promote `INTERNAL_EFFECT_MACHINE_DISPOSITION.lambda` to `unified`; move only
   the lambda row from deferred to owned evidence in the exact convergence
   manifest/checker/tests.
6. Add machine/source-runner parity tests for every frozen reference fixture,
   malformed rejection before effects, deferred-value execution, private-call
   enforcement, host-global poisoning, and the non-root/helper/class guardrails.

## Expected Files

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/lambda-runtime.ts` | add | canonical registry-independent lambda owner |
| `packages/core/src/ir/semantics/lambda.ts` | reduce/edit | reference contract adapter over shared owner |
| `packages/core/src/ir/semantics/internal-effect-machine-structure.ts` | edit minimally | lambda claim/preflight hook under 500 lines |
| `packages/core/src/ir/semantics/internal-effect-machine-sequence.ts` | edit | lambda execution dispatch |
| `packages/core/src/ir/semantics/internal-effect-machine-types.ts` | edit | `lambda: unified` |
| `packages/core/tests/runtime-envelope-effect-machine-lambda.test.ts` | add | machine parity, safety, failure timing |
| `packages/core/tests/source-runner-engine.test.ts` | edit | selector and compatibility guardrails |
| convergence manifest/checker/tests/policy | edit | exact owned/deferred ledger proof |
| release train/spec | edit after gates | record bounded evidence only |

## Acceptance Criteria

- [x] Every existing `lambdaContract` fixture produces an identical reference,
  sync-machine, and immediate-async-machine trace.
- [x] `List.map`/`List.filter` preserve order, exact current truthiness, and
  fresh parameter scope without invoking mutable host collection methods.
- [x] Closures observe later writes in their captured local setup scope, while
  separate closures and callback iterations do not share parameter bindings.
- [x] Direct calls execute only private lambda-runtime closures; root host
  functions and helper registries remain inadmissible.
- [x] Missing/empty expressions, unsupported setup children/targets, block-
  bodied closures, unsupported expression kinds/operators/calls, missing
  bindings, and wrong collection types fail before any earlier capability.
- [x] A lambda consuming a deferred capability result receives the runtime
  value without allowing preflight to invoke or trust an unknown callable.
- [x] A preceding capability cannot redirect Array/Map/Object iteration or
  lambda call behavior by poisoning mutable host globals/prototypes.
- [x] Valid root lambda programs select the machine in sync and immediate-async
  source APIs with no catch-and-retry path.
- [x] Incoming `env.parent`, runner functions, runner classes, `this`/`super`,
  and protected class state continue selecting compatibility.
- [x] `lambda` becomes `unified`; helper-functions, runner-classes-state,
  non-root-environment, and iteration-budget remain exact deferred blockers.
- [x] Every touched handwritten source/test file remains below 500 lines.
- [x] Focused tests, complete core tests, lint/build, `pnpm fitness:kern-5`, and
  full current-roster `agon review` pass before commit and push.

## Completion Evidence

- `pnpm fitness:kern-5` passed end-to-end after the final blocker fixes on
  2026-07-15, including workspace, conformance, native KERN, runner smoke,
  self-host, ownership, ABI, and source-runner convergence gates.
- The terminal `claude,codex,agy` review completed 3/3 with zero verified,
  needs-check, or speculative findings
  (`review-1784097336473-jyos4c-m3-23-lambda-terminal-7`).
- Review-discovered deferred callback facts, deterministic nullish/bare
  namespace failures, and recursive setup closures are covered by executable
  regression tests and reject before earlier capability effects where
  applicable.
- The largest touched handwritten source files are
  `internal-effect-machine-structure.ts` at 498 lines and
  `lambda-preflight.ts` at 482 lines.

## RED Oracles

Before implementation, focused tests must fail because:

1. A valid lambda node is rejected by machine admission and selected as legacy.
2. Machine-only execution rejects the five frozen lambda fixtures.
3. The exact disposition and convergence manifest require lambda to remain
   legacy/deferred.
4. No machine oracle proves malformed lambda rejection before a preceding
   capability.
5. No machine oracle proves incoming non-root/helper/class environments remain
   closed after lambda promotion.

The oracle must not turn green by importing `lambdaContract`, calling
`referenceRun`, installing host JavaScript functions into `SemanticEnv`,
deleting compatibility assertions, adding a public option/default, or relaxing
the incoming root-environment gate.

## Out of Scope

- Block-bodied/multi-statement lambda expressions.
- Named helper functions, modules, recursion, or call-stack/cache ownership.
- Runner classes, constructors, methods, fields, `this`, `super`, inheritance,
  or protected instance state.
- Relaxing admission for an incoming `SemanticEnv.parent`.
- Host function values or arbitrary method calls.
- Arbitrary iterables or async callbacks.
- Adding an implicit iteration budget or changing source-runner public options.
- Removing the semantic oracle/compatibility adapter.
- Claiming R2 M3 or KERN 5 complete.

## Deploy Order

M3.23 starts from the exact pushed M3.22 remote because M3.22 is not yet on
`origin/main`. Before the single push, fetch and rebase onto that exact remote
predecessor, or onto `origin/main` if the complete predecessor chain has
merged. Do not reuse or push any merged predecessor branch.

## Tribunal Corrections

| Proposal | Repository correction | Impact |
|---|---|---|
| Make non-root environments the next slice because the machine is flat. | Parent-linked `SemanticEnv` and `childEnv` already exist; only incoming-root admission is closed. | Non-root remains a guardrail, not M3.23 scope. |
| Add a machine-local duplicate lambda evaluator. | The existing frozen evaluator can be extracted from registry wiring. | One shared runtime owner avoids semantic drift. |
| Direct calls can use JavaScript functions. | Host functions are outside the bounded root value domain. | Use private closure values only. |
