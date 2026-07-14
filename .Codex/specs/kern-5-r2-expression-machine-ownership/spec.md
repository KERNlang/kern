# KERN 5 R2 M3.21 `expression-v1` Machine Ownership

**Status:** DONE
**Date:** 2026-07-14
**Confidence:** 0.95
**Design challenge:** Agon tribunal `tribunal-1784059094308-wr4bjt`
(3/3 current engines completed)

## Executive Summary

M3.21 moves the existing bounded `expression-v1` runtime contract from the
source-runner compatibility path into the canonical internal effect machine.
The implementation extracts the already-tested expression evaluation and
binding effects into a registry-independent private runtime owner, then makes
both the semantic oracle contract and the machine leaf path call that owner.
Whole-tree admission remains fail-closed: malformed or unsupported expressions
must reject before any earlier capability or binding effect can execute, and a
selected machine execution is never caught and retried on the legacy runner.

This is one convergence slice, not the end of R2 M3. `lambda`, pair/entry
`each`, helper-function environments, runner class state, non-root
environments, and caller-owned iteration-budget compatibility remain explicit
deferred blockers.

## Current State / Root Cause

- **VERIFIED:** the machine disposition explicitly marks `expression-v1` as
  `legacy`, so any source tree containing it selects the compatibility runner
  (`packages/core/src/ir/semantics/internal-effect-machine-types.ts:9-28`).
- **VERIFIED:** the machine's closed leaf list does not contain
  `expression-v1`; structure preflight and execution only accept node types in
  that list (`packages/core/src/ir/semantics/internal-effect-machine-leaf.ts:48-80`;
  `internal-effect-machine-structure.ts:407-414`;
  `internal-effect-machine-sequence.ts:206-220`).
- **VERIFIED:** `expression-v1.ts` combines runtime semantics and registry
  registration in one 421-line file, importing `registerContract` through the
  semantic index (`packages/core/src/ir/semantics/expression-v1.ts:1-51,402-421`;
  `wc -l packages/core/src/ir/semantics/expression-v1.ts` -> `421`, 2026-07-14).
- **VERIFIED:** its runtime contract already covers portable scalars, arrays,
  records, Decimal operations, regex operations, binding freshness/capture,
  namespace shadowing, and fail-close errors
  (`packages/core/src/ir/semantics/expression-v1.ts:53-325`).
- **VERIFIED:** the source-runner selector chooses before execution and has no
  catch-and-retry path; unsupported machine structure selects compatibility,
  while a failure after machine selection propagates
  (`packages/core/src/runtime-envelope/source-runner-engine.ts:54-97`).
- **VERIFIED:** the convergence manifest lists `expression-v1` as a deferred
  legacy node and the guard requires that exact status
  (`scripts/source-runner-convergence-manifest.json`;
  `scripts/check-source-runner-convergence.mjs:8-22,207-222`).

The root cause is ownership coupling, not missing expression semantics. The
tested implementation lives inside a contract module that is tied to the
legacy registry, while the machine's leaf dispatcher has no expression-v1
shape, preflight, or execution path. Merely changing the disposition would let
selection claim support that machine preflight/execution cannot honor.

## What Already Works

- Parsing and the semantic oracle contract already define the accepted
  `expression-v1` surface; M3.21 does not invent a broader expression language.
- The machine already performs whole-sequence structural/value preflight on a
  cloned environment before installing capability scheduling.
- The machine already owns exact binding metadata for scalar, fresh array,
  captured array, array alias, record, Decimal, and regex-tagged values.
- Sync and async source APIs already share one pre-execution selector and one
  canonical machine; no public routing redesign is required.
- Runtime import-closure and source-runner convergence guards already provide
  the places to encode the new ownership proof.

## Contract (Verified)

> Verified against the cited source files and commands on 2026-07-14.

| Field / Behavior | Required M3.21 behavior | Evidence | Tag |
|---|---|---|---|
| Node disposition | `expression-v1` is machine `unified` after this slice | `internal-effect-machine-types.ts:9-28` current legacy owner | VERIFIED |
| Node shape | Portable output name, no own redeclaration, present non-empty `expr`, no body | `expression-v1.ts:53-75,127-139`; `internal-effect-machine-leaf.ts:66-80` | VERIFIED |
| Expression surface | Preserve the existing accepted scalar, array, record, Decimal, and regex subset exactly | `expression-v1.ts:127-325` | VERIFIED |
| Binding effects | Preserve scalar binding, fresh/captured/alias array metadata, record-array fields, and tagged Decimal/regex storage | `expression-v1.ts:231-325` | VERIFIED |
| Observable trace | One `assign` event with the current plain observable value and normal completion | `expression-v1.ts:254-325` | VERIFIED |
| Namespace shadowing | User bindings named `Decimal` or `RegExp` prevent native namespace routing | `expression-v1.ts:77-125` | VERIFIED |
| Pre-execution failure | Unsupported/malformed expressions or redeclarations reject during whole-tree preflight, before earlier effects | `internal-effect-machine-structure.ts:423-430`; `source-runner-engine.ts:54-63` | VERIFIED pattern |
| Selected execution | No catch-and-fallback from machine to compatibility | `source-runner-engine.ts:78-97` | VERIFIED |
| Public API | No new or changed source-runner option, export, or signature | `source-runner-engine.ts:24-33`; `packages/core/src/runner.ts` | VERIFIED |
| Loop safety | Loop programs still require an explicit caller-supplied positive iteration budget | `source-runner-engine.ts:36-63` | VERIFIED |

## Implementation Options

### A. Flip the disposition and call the legacy contract registry

Smallest diff, but it would make the canonical machine depend on global
registry initialization and the compatibility ownership graph. It also leaves
preflight unable to reason directly about expression outputs. Rejected.

### B. Reimplement a machine-only scalar subset

This avoids registry coupling but creates two semantic owners and would
silently narrow existing Decimal, regex, array, and record behavior. A
`unified` label would be dishonest while the compatibility contract retained a
different accepted surface. Rejected.

### C. Extract one registry-independent runtime owner (selected)

Move expression-v1 shape/evaluation/binding behavior into a private module
that imports concrete semantic environment/evaluator modules, not
`index.ts`, `register-all.ts`, reference runners, or source-runner legacy.
Keep `expression-v1.ts` as the registry-facing contract adapter and make the
machine leaf use the same private owner for shape preflight, value preflight,
and execution. This preserves the contract while establishing canonical
ownership and one implementation.

For control-flow values that are genuinely unavailable during preflight, the
machine may fail closed for that program shape in this slice; it may not guess,
execute early effects, or defer an unsupported expression to runtime.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/expression-v1-runtime.ts` | add | registry-independent shape, evaluation, binding, and trace owner |
| `packages/core/src/ir/semantics/expression-v1.ts` | edit/split | retain fixtures and registration as a thin oracle adapter; stay below 500 lines |
| `packages/core/src/ir/semantics/internal-effect-machine-types.ts` | edit | promote `expression-v1` to unified |
| `packages/core/src/ir/semantics/internal-effect-machine-leaf.ts` | edit | add expression-v1 shape/preflight/output/execution dispatch |
| `packages/core/src/ir/semantics/deferred-expression-preflight.ts` | edit only if required | fail closed for deferred expression-v1 inputs without widening evaluator semantics |
| `packages/core/tests/runtime-envelope-effect-machine-expression-v1.test.ts` | add | machine execution, parity, nested use, and fail-before-effect oracles |
| `packages/core/tests/source-runner-engine.test.ts` | edit | prove selection moves expression-v1 to machine and remaining blockers stay compatibility |
| `scripts/source-runner-convergence-manifest.json` | edit | move expression-v1 from deferred to evidenced owned |
| `scripts/check-source-runner-convergence.mjs` and test | edit | enforce new exact manifest/disposition status and blocker non-growth |
| `scripts/runtime-envelope-import-closure.mjs` and test | edit only if required | prove expression runtime closure excludes registry/reference/legacy owners |
| release support matrix/train/spec | edit after gates | record scoped M3.21 evidence without closing R2 M3 |

## Acceptance Criteria

- [x] `INTERNAL_EFFECT_MACHINE_DISPOSITION['expression-v1']` is `unified`, and
  the machine leaf owns its shape, preflight, execution, and output binding.
- [x] One registry-independent runtime module is the implementation used by
  both the semantic oracle adapter and effect machine; the machine closure does
  not import `index`, `register-all`, reference runners, or source-runner legacy.
- [x] Existing expression-v1 positive fixtures and precondition-rejection tests
  continue passing byte-for-byte.
- [x] Machine-only sync and immediate-async execution match the reference trace
  for representative scalar, array, record, Decimal, regex scalar, regex list,
  array alias, and captured-record-array cases.
- [x] Machine preflight rejects malformed props, a duplicate output binding,
  unknown/unsupported input, shadowed native namespaces, and illegal bodies.
- [x] A sequence with an earlier capability and a later rejected expression-v1
  performs zero provider calls and zero earlier binding effects.
- [x] Nested if/branch/try/loop expression-v1 uses either execute correctly or
  reject during preflight; no unsupported deferred value reaches runtime.
- [x] Source-runner selection chooses the machine for admitted expression-v1
  programs in both sync and async lanes; `machine-only` rejects unsupported
  expression-v1 shapes without compatibility retry.
- [x] The convergence manifest moves only `expression-v1` from deferred to an
  evidenced owned entry. Every other M3.20 blocker and the caller-owned
  iteration-budget rule remains unchanged.
- [x] Focused tests, typecheck/build, complete `pnpm fitness:kern-5`, and a full
  current-roster `agon review` pass before commit and push.

## Completion Evidence

- `pnpm lint` passed on 2026-07-14.
- `pnpm test:source-runner-convergence` passed with the new expression-v1
  machine suite and exact manifest guard.
- Runtime-envelope import closure passed 38/38 production-policy cases.
- `pnpm fitness:kern-5` passed end-to-end on 2026-07-14, including the complete
  workspace test wall, KERN infrastructure/constitution gates, native KERN
  suites, app behavior, cross-backend drift showcase, browser budget, runtime
  handler ABI, public-ABI quarantine, and source-runner convergence.
- Full current-roster Agon review completed 3/3 with zero verified,
  needs-check, or speculative findings
  (`review-1784062012773-h9ch34`). One non-blocking repeated-parse performance
  nit was adjudicated as out-of-scope optimization: the separate parse points
  correspond to admission, precondition, and execution guarantees and do not
  alter correctness.

## RED Oracle

Before implementation, the focused oracle must fail because:

1. `expression-v1` is classified legacy and source selection returns legacy.
2. The machine leaf type list and dispatcher reject `expression-v1`.
3. The manifest/guard require expression-v1 to remain deferred.
4. No machine test proves fail-before-effect or registry-independent ownership.

The oracle must not pass from a disposition-only edit, a registry call inside
the machine, deleting legacy fixtures, or catch-and-fallback execution.

## Out of Scope

- `lambda`, helper-function calls/registries, recursion, classes,
  constructors, inheritance, `this`, or `super`.
- Pair/entry iteration or any change to array-only `each` ownership.
- A default iteration threshold, public iteration-budget option, environment
  flag, or other policy/API expansion.
- Expanding the expression language beyond the existing expression-v1 contract.
- Deleting the semantic oracle contract, reference runners, or compatibility
  runner.
- Claiming R2 M3 or KERN 5 complete.

## Open Questions

None. Unsupported deferred expression dependencies are explicitly allowed to
fail closed during whole-tree admission in M3.21; widening that domain is a
future scoped slice.

## Deploy Order

M3.21 is stacked from the exact pushed M3.20 remote branch because M3.20 is not
yet on `origin/main`. Before the single push, fetch and rebase onto the latest
remote predecessor (or `origin/main` if M3.20 has merged), then push the new
feature branch. During version skew, public APIs and compatibility behavior are
unchanged; only admitted expression-v1 programs gain the canonical internal
owner. The compatibility runner remains present for every named deferred
blocker.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| `expression-v1` could be promoted by changing its disposition. | The machine leaf list, structure preflight, dispatcher, deferred binding analysis, and registry-independent runtime owner all need an explicit path. | M3.21 requires a real shared-runtime extraction and fail-before-effect tests. |
| Pair/entry `each` might be the smallest next convergence win. | It remains gated by the unchanged explicit iteration-budget requirement and has lower source-runner leverage. | The 3/3 tribunal selected expression-v1; pair/entry stays deferred. |
| A machine-only scalar implementation would be enough. | The current contract also owns array/record freshness plus Decimal/regex tagged values and fail-close behavior. | The implementation must share the existing full contract boundary rather than fork semantics. |
