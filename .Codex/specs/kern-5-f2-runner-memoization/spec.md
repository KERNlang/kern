# KERN 5 F2 Runner Memoization Opt-Out

**Status:** REJECTED BY FULL F2 GATE
**Date:** 2026-08-17
**Confidence:** 0.93

## Executive Summary

KERN runner functions are currently memoized unconditionally. F2's pure `f2readitem(tape, cursor)` helper has no repeated arguments, so memoization cannot produce hits, while cache-key construction serializes the complete token tape for every cursor. Add an authenticated `memoize=false` function declaration that preserves evaluation semantics but skips cache-key construction, lookup, and retention in both the internal effect machine and compatibility evaluator. Mark only `f2readitem` non-memoized and keep its signature and body unchanged.

## Current State / Root Cause

- **VERIFIED:** the effect machine constructs every helper key with `JSON.stringify(values...)` before executing the helper (`packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts:40-45,89-124`).
- **VERIFIED:** the compatibility evaluator independently constructs a value key and performs lookup/retention for every runner function (`packages/core/src/ir/semantics/portable-reference-evaluator.ts:78-90,358-390`).
- **VERIFIED:** function bindings expose no memoization policy (`packages/core/src/ir/semantics/semantic-env-ownership.ts:35-42`), and the source linker does not read one (`packages/core/src/runner-runtime-scope.ts:143-157`).
- **VERIFIED:** the hostile unary RED oracle records `f2readitem` key characters growing from 25,987,427 at depth 512 to 104,619,676 at depth 1024, while every other helper remains below the 2.5x guard (`node --test --test-name-pattern='hostile unary framing has no shared helper replay or quadratic cache-key boundary' scripts/kern-frontend-f2-expression/scaling.test.mjs`, 2026-08-17).

## What Already Works

- `f2readitem` returns deterministic portable data and its current body correctly validates framing, widths, bounds, and next offsets. Its algorithm and wire format do not need to change.
- The cache entry cap, key format for memoized helpers, recursion limit, observer schema, work charging, and text code-point cache do not need to change.
- Existing bindings without `memoize=false` must remain memoized by default.

## Contract (Verified)

> Verified against the current worktree sources on 2026-08-17.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| `fn memoize=false` | optional boolean source property | `packages/core/src/schema.ts:251-268`; new property is absent today | VERIFIED |
| `RunnerFunctionBinding.memoize` | optional boolean, default-on | `packages/core/src/ir/semantics/semantic-env-ownership.ts:35-42` | VERIFIED |
| Source-to-binding propagation | preserve explicit false | `packages/core/src/runner-runtime-scope.ts:143-157` | VERIFIED |
| Machine graph cloning | preserve explicit false | `packages/core/src/ir/semantics/internal-effect-machine-module-graph.ts:62-74` | VERIFIED |
| Effect-machine opt-out | no key, lookup, or retention when false | `packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts:40-45,113-124,161-180` | VERIFIED |
| Compatibility opt-out | no key, lookup, or retention when false | `packages/core/src/ir/semantics/portable-reference-evaluator.ts:78-90,358-390` | VERIFIED |
| Default behavior | bindings without false continue current memoization | all current bindings omit the field; `rg -n "memoize" packages/core/src examples` returned no runner hits on 2026-08-17 | VERIFIED |

## Implementation Options

### A. Parser-local reader object

Own the tape on a class instance and call `reader.read(cursor)`. This avoids the string argument but changes many authenticated call sites, depends on class-method execution details, and consumes scarce fragment line budget.

### B. Size-based cache admission

Refuse large keys or arguments. This changes shared policy parametrically, needs a threshold, and either traverses containers or leaves smaller quadratic cases. Rejected.

### C. Declaration-driven non-memoization (selected)

Add `memoize=false`, propagate it through the existing binding graph, and skip the cache path in both evaluators. This is categorical source policy for a helper with provably zero repeated argument pairs, not a runtime size heuristic.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/schema.ts` | add optional boolean `memoize` on `fn` | admit authenticated syntax |
| `packages/core/src/node-props.ts` | type the property | keep IR props typed |
| `packages/core/src/runner-runtime-scope.ts` | parse explicit false into the binding | source-to-runtime contract |
| `packages/core/src/ir/semantics/semantic-env-ownership.ts` | extend binding shape | shared evaluator contract |
| `packages/core/src/ir/semantics/internal-effect-machine-module-graph.ts` | clone the field | preserve linked metadata |
| `packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts` | bypass key/cache for opt-out bindings | effect-machine behavior |
| `packages/core/src/ir/semantics/portable-reference-evaluator.ts` | bypass key/cache for opt-out bindings | compatibility parity |
| `packages/core/tests/*runner*` | add default-on, explicit-off, and parity tests | shared-contract proof |
| `examples/kern-frontend/f2-expression-catalog.kern` | declare `f2readitem memoize=false` | remove the proven quadratic path |
| `scripts/kern-frontend-f2-expression/*` | retain RED/GREEN diagnostics and refresh source hashes | promotion oracle/authentication |

## Acceptance Criteria

- [ ] Existing functions without `memoize=false` still produce cache hits in both evaluators.
- [ ] A `memoize=false` helper still executes and returns byte-identical values but emits no effect-machine cache key or lookup event and retains no cached result.
- [ ] Compatibility and effect-machine outcomes remain byte-identical for default-on and explicit-off fixtures.
- [ ] `f2readitem` keeps its signature/body and is the only F2 helper declared non-memoized.
- [ ] At unary depths 512 and 1024, `f2readitem` key characters and cache lookups are zero, its execute count grows no faster than `2.1x + 32`, and every remaining helper satisfies `K(1024) <= 2.5 * K(512) + 4096`.
- [ ] F2 ASTs remain structurally identical with exactly `depth + 1` nodes, and the complete F2 corpus, mutation, scaling, parity, and authentication gates pass.
- [ ] All hand-written `.kern`, `.kernpart`, `.ts`, and `.mjs` files touched remain under 500 lines.

## Out of Scope

- Changing cache capacity, eviction order, key serialization, text caching, parser grammar, wire format, or work-unit policy.
- Automatically inferring whether a helper should be memoized.
- Publishing packages, tags, or registry artifacts.

## Open Questions

None. The selected option has no ASSUMED or OPEN acceptance dependency.

## Deploy Order

The syntax, binding propagation, both evaluator implementations, F2 declaration, tests, and authenticated hashes ship atomically in one repository commit series. There is no supported mixed-version window because the catalog and runtime are built and gated from the same tree; older runtimes reject the new property at schema validation rather than silently applying divergent behavior.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| `f2item` cache thrash caused the runtime cliff. | Removing it produced zero executions but did not improve the 1024-depth runtime. | Rejected the first remedy and added byte-growth diagnostics. |
| The byte-budgeted text code-point cache had no matching entry cliff, so key work was probably linear. | `f2readitem` serialized the whole tape per cursor, producing 4.03x key characters for a 2x input. | Root cause moved to helper cache-key construction. |
| A reader object or global size admission were the only remaining choices. | A declaration-driven non-memoization contract targets a helper with no possible repeated argument pairs. | Selected the smaller categorical contract after tribunal. |
| Disabling memoization preserves practical evaluation behavior for this pure helper. | Grouped arithmetic changed from 30 cached executions to 99,974 uncached executions and exhausted a 100,000-step budget; the full F2 gate failed 13/32. | Rejected the design and reverted every runtime/source change. Cache hits are required for resumable packrat evaluation. |
