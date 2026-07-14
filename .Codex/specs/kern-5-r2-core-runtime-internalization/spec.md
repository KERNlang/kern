# KERN 5 R2 M3.19 Public Runtime Authority Quarantine

**Status:** DONE
**Date:** 2026-07-14
**Confidence:** 0.98

## Executive Summary

M3.17 and M3.18 established a machine-owned typed handler ABI and moved the
maintained preview route onto it, but the package root and the `kern-lang`
compatibility package still export the divergent `CoreRuntime` surface and its
runtime-coupled value graph. M3.19 is a prerequisite quarantine slice: remove
the entire runtime-coupled `core-runtime` module family from both public root
ABIs, retain its source and tests only as a co-maintained internal reference
implementation, extract runtime-neutral declared-shape analysis, and add an
executable packed-package boundary guard. This slice does **not** close R2 M3;
the active `executeKernSource*` compatibility paths still need migration onto
the canonical machine in later slices.

## Current State / Root Cause

- **VERIFIED:** the KERN 5 plan requires `CoreRuntime` to be retired,
  internalized, or fully adapted before M3 closes
  (`docs/kern-5-own-language-plan.md:241-260`).
- **VERIFIED:** `@kernlang/core` still re-exports the `CoreRuntime` environment,
  executor, expression evaluator, and function-call entry from its package root
  (`packages/core/src/index.ts:350-374`).
- **VERIFIED:** the current release train marks M3.1 through M3.18 complete but
  leaves the R2 M3 parent open (`docs/kern-5-release-train.md:203-378`).
- **VERIFIED:** the maintained typed handler calls the isolated internal sync or
  async handler root rather than `CoreRuntime`
  (`packages/core/src/runtime-handler.ts:405-441`).
- **VERIFIED:** the remaining production-source client is the differential
  parity probe, which imports `CoreRuntime` by its internal path
  (`packages/core/src/ir/semantics/parity-probe.ts:16-46`).
- **VERIFIED:** `KernFunctionValue` and `KernClassValue` carry
  `CoreRuntimeEnv`, so retaining public value/shape helpers would leak the
  supposedly internal runtime through the declaration graph
  (`packages/core/src/core-runtime/index.ts:34-129`).
- **VERIFIED:** `kern-lang` re-exports the complete `@kernlang/core` root, so
  every core root removal is also a compatibility-package API change
  (`packages/compat/src/index.ts:1-11`).
- **VERIFIED:** repository search on 2026-07-14 found no other workspace
  package, example, or script consuming the CoreRuntime symbols from the public
  package root; the remaining public-root consumers are core tests
  (`rg -l '\b(CoreRuntimeEnv|createCoreRuntimeEnv|runCoreRuntime|evalCoreExpression|callCoreFunction)\b' packages --glob '!**/dist/**'`).

The root cause is historical export inertia across both the value type graph and
the execution API: a former product runtime became a reference implementation,
but all of its values, adapters, shape helpers, and executors remained reachable
from two published package roots.

## What Already Works

- M3.17's `@kernlang/core/runtime/handler` subpath is the supported typed call
  boundary and must remain unchanged.
- M3.18's preview route already consumes that boundary and must remain behaviorally
  identical.
- `CoreRuntime` remains useful as an internal co-maintained reference
  implementation. Its 2,457-line implementation will not be edited, extended,
  or renamed in this slice.
- Static declared-shape fact collection is semantic IR analysis rather than
  value execution. Its public API remains available from a new runtime-neutral
  module; only value validation stays in `core-runtime`.
- `executeKernSource*` remains a compatibility API as the M3 plan explicitly
  requires. Removing or rewriting those wrappers is outside this slice.

## Contract (Verified)

> Verified against package source and repository consumers on 2026-07-14.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| Supported typed handler | `@kernlang/core/runtime/handler` | `packages/core/package.json:34-37`; `packages/core/src/runtime-handler.ts:405-441` | VERIFIED |
| Divergent execution environment | root export | `packages/core/src/index.ts:350-374` | VERIFIED |
| Divergent executor/evaluator | root export | `packages/core/src/index.ts:360-374` | VERIFIED |
| Runtime-coupled value graph | root export | `packages/core/src/index.ts:344-384`; `packages/core/src/core-runtime/index.ts:34-129` | VERIFIED |
| Compatibility package mirror | full root re-export | `packages/compat/src/index.ts:1-11` | VERIFIED |
| Differential oracle client | internal import | `packages/core/src/ir/semantics/parity-probe.ts:16-46` | VERIFIED |
| External workspace execution clients | none found | `rg` command recorded above, 2026-07-14 | VERIFIED |
| Compatibility source runners | preserved | `docs/kern-5-own-language-plan.md:252`; `packages/core/src/runner.ts:1087-1395` | VERIFIED |

## Implementation Options

### A. Fully adapt CoreRuntime to the effect machine

Large blast radius and no release value: it duplicates the already-supported
typed handler boundary and would require reconciling thousands of lines of
divergent semantics. Rejected for M3.19.

### B. Quarantine the complete CoreRuntime ABI; retain source internally (selected)

Remove every runtime-coupled `core-runtime` re-export—including execution,
value, adapter, and value-validation symbols—from the public root. Extract
static declared-shape facts to `core-shape-facts.ts`, point internal tests at
internal runtime modules, and add a packed-package guard proving neither
`@kernlang/core` nor `kern-lang` exposes the runtime module family in any
JavaScript/declaration import graph or nested export-map target. This is the
narrowest complete public-ABI quarantine; it deliberately leaves semantic
convergence to later M3 slices.

### C. Delete CoreRuntime

This would discard a valuable divergence corpus and parity oracle while forcing
unrelated test migration. Rejected until the later self-hosted interpreter makes
that oracle redundant.

## 5.0 Root-ABI Migration Table

All removals below are from the `@kernlang/core` and mirrored `kern-lang`
package roots. They remain internal implementation details; downstream code
must not deep-import `dist/core-runtime`.

| Removed root symbols | Migration |
|---|---|
| `runCoreRuntime`, `evalCoreExpression`, `callCoreFunction` | Use `@kernlang/core/runtime/handler` for the supported typed handler boundary; retain `executeKernSource*` only where compatibility behavior is explicitly required. |
| `createCoreRuntimeEnv`, `CoreRuntimeEnv`, `CreateCoreRuntimeEnvOptions`, `CoreRuntimeResult`, `CoreCompletion`, `RuntimeParam` | No public environment replacement; execution state is owned by the canonical handler/effect-machine boundary. |
| `KernValue`, `KernBuiltinValue`, `KernFunctionValue`, `kBoolean`, `kNull`, `kNumber`, `kString`, `kUndefined`, `kernTruthy`, `fromHostValue`, `toHostValue` | Use handler request/result contracts or application-owned values; the reference runtime value graph is internal. |
| `CoreRuntimeContractAdapterError`, `coreFixtureValueToKernValue`, `kernValueToCoreFixtureValue`, `roundTripKernContractDataValue` | No public replacement; these adapters serve the internal differential oracle only. |
| `assertCoreShape`, `validateCoreShape` | Runtime value validation is internal. Use the public semantic validation APIs for source declarations. |
| `collectCoreShapeFacts`, `CoreShapeDiagnostic`, `CoreShapeDiagnosticCode`, `CoreShapeFacts`, `CoreShapeFieldFact`, `CoreShapeIndexerFact`, `CoreShapeInterfaceFact`, `CoreShapeValidationResult` | Preserved at the package root from runtime-neutral `core-shape-facts`; no consumer change required. |

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/index.ts` | edit | remove the complete CoreRuntime module-family ABI |
| `packages/core/src/core-shape-facts.ts` | add | own runtime-neutral shape facts outside CoreRuntime |
| `packages/core/src/core-runtime/shape-validator.ts` | edit | retain only value validation and consume static shape facts |
| `packages/core/src/semantic-substrate.ts` and `semantic-validator.ts` | edit | remove transitive public declaration edges into CoreRuntime |
| `packages/compat/src/index.ts` | verify | its root mirror must no longer expose the removed ABI |
| `packages/core/tests/core-runtime*.test.ts` and direct root-consuming tests | edit | import the retained oracle through internal paths |
| `scripts/check-core-runtime-internalization.mjs` | add | pack and inspect both public packages; fail closed |
| `scripts/core-runtime-internalization.test.mjs` | add | mutation-test export-map, JS, and declaration guards |
| `package.json` | edit | add the focused gate and include it in infra |
| `scripts/kern-5-fitness-policy.json` | edit | promote the focused gate into the fitness wall and ownership ledger |
| `docs/kern-5-support-matrix.md` | edit | record the internal-oracle status and command |
| `docs/kern-5-release-train.md` | edit after evidence | close M3.19 while leaving R2 M3 open |

## Acceptance Criteria

- [x] Packed `@kernlang/core` and `kern-lang` public declaration/runtime graphs
  contain no `core-runtime` module references or runtime-coupled symbols
  formerly re-exported from that module family.
- [x] Runtime-neutral shape facts remain public without referencing
  `core-runtime`; runtime value validation remains internal.
- [x] No exported package subpath exposes any `core-runtime` module.
- [x] The internal parity probe and full CoreRuntime oracle suite still run.
- [x] The new guard fails when a forbidden symbol, direct/transitive module
  reference, aliased/nested conditional export, missing target, or exported
  deep subpath is restored.
- [x] `pnpm test:core-runtime-internalization` passes and is a current
  `fitness:kern-5` gate.
- [x] `pnpm test:runtime-abi`, `pnpm test:kern-runtime-envelope`, and
  `pnpm test:app-demo` remain green.
- [x] `pnpm fitness:kern-5` and the full-roster Agon review pass before M3.19 is
  marked complete; the R2 M3 parent remains open.

## Verification Evidence

- `pnpm fitness:kern-5` passed twice after the runtime-neutral extraction and
  complete packed-public-graph guard landed. The final full wall included
  432/432 cross-target fixtures, 109/109 class fixtures, 233 native KERN
  assertions at 100% coverage, runtime-envelope and public-handler closure
  gates, and the packed core/compat quarantine.
- `pnpm test:core-runtime-internalization` passes with 47 tests, including
  mutations for direct, transitive, namespace, bare/self, aliased, conditional,
  wildcard, JavaScript-only, declaration-only, renamed, and default exports.
- Full-roster Agon review iterations are recorded under
  `review-1784042168220-rvnaqc-m3-19-core-runtime-quarantine-r2`,
  `review-1784043915975-eneod4-m3-19-core-runtime-quarantine-fi`,
  `review-1784044583036-q9pcvx-m3-19-core-runtime-quarantine-te`, and
  `review-1784045637761-cgrtmo-m3-19-core-runtime-quarantine-te`. The completed
  tree then passed the terminal 6/6 review with zero verified findings at
  `review-1784046314688-nq5wd4-m3-19-core-runtime-quarantine-co`. Every earlier
  verified guard bypass was fixed and mutation-locked.

## Out of Scope

- Deleting or semantically changing the internal CoreRuntime oracle.
- Removing or changing `executeKernSource*` compatibility wrappers; their
  machine migration is required before the R2 M3 parent can close.
- Rewriting the legacy async compatibility runner.
- Widening the typed handler ABI or preview application behavior.
- Beginning the M4 canonicalizer/frontend.

## Open Questions

None blocking. This is an intentional 5.0 root-ABI break on the stacked release
train, and it makes no semantic-convergence claim.

## Deploy Order

This changes two published root ABIs: `@kernlang/core` first and the `kern-lang`
compatibility package simultaneously through its `workspace:*` dependency and
full root re-export (`packages/compat/package.json:39`; `packages/compat/src/index.ts:10`).
Both packages must be released together at 5.0.0 after the later packed-release
proof. During repository branch skew, M3.18 continues to work because it imports
only `@kernlang/core/runtime/handler`; published 4.5 consumers remain on the
unchanged 4.5 artifacts.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M3.18 might complete all of M3 | `CoreRuntime` remains a divergent public execution authority | Add M3.19 before closing the parent |
| The legacy async wrapper alone blocks M3 | `executeKernSource*` is explicitly preserved as compatibility API; the supported typed path already shares one effect machine | Do not rewrite compatibility execution in this slice |
| Removing five executor exports internalizes CoreRuntime | Public value/shape declarations carry `CoreRuntimeEnv`, and `kern-lang` mirrors the root | Quarantine the entire module-family ABI in both packages |
| M3.19 can close the R2 M3 parent | Active compatibility runners still execute through legacy reference runners | Close only the prerequisite slice; keep M3 open |
| Direct root-entry inspection proves quarantine | The first full-roster review found `semantic-substrate` and `semantic-validator` declarations still reached `core-runtime/shape-validator` transitively | Extract static shape facts and traverse every packed public entry's complete local module graph |
| TypeScript preprocessing covers every public module edge | Namespace re-exports are absent from `preProcessFile().importedFiles` | Traverse import, export, import-type, import-equals, dynamic-import, and require AST nodes directly |
| Named-export checks cover all symbol restoration | Aliased and default exports can expose a forbidden binding without the forbidden public name | Inspect both sides of export specifiers and identifiers in default-export expressions |
