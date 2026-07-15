# KERN 5 R2 M3.20 Source-Runner Convergence Bridge

**Status:** DONE
**Date:** 2026-07-14
**Confidence:** 0.98
**Design challenge:** Agon tribunal
`tribunal-1784048661115-hg0jhl-m3-20-source-runner-convergence` (4/4 usable
engines completed; the requested six-engine roster was passed to Agon, which
resolved four as usable for this run)
**Budget challenge:** `tribunal-1784056555849-1x6a6i` (3/3 current engines)
**Final review:** `review-1784058369015-oomdka` (3/3; zero verified findings)

## Executive Summary

M3.19 quarantined the divergent public `CoreRuntime` ABI, but the four shipped
`executeKernSource*` compatibility APIs still invoke the sync or async
reference runner directly. M3.20 is the first production cutover slice: move
the exact existing portable `do` contract into the canonical effect machine,
then route all four source-runner APIs through one pre-execution engine selector.
Machine-eligible programs execute canonically; programs outside the current
machine corpus take one explicit compatibility branch. The selector must never
catch a canonical execution failure and retry it on the reference runner.

This slice advances real runtime ownership without claiming the whole source
runner is converged. The executable blocker ledger keeps `expression-v1`,
`lambda`, partial `each`, helper functions, and runner classes visible as named
follow-up debt. R2 M3 remains open.

## Current State / Root Cause

- **VERIFIED:** the release train leaves R2 M3 open until active
  `executeKernSource*` compatibility runners migrate to the canonical machine
  (`docs/kern-5-release-train.md:379-389`).
- **VERIFIED:** the release contract requires preserving the old APIs as
  compatibility wrappers, not deleting them
  (`docs/kern-5-own-language-plan.md:241-260`).
- **VERIFIED:** sync source and descriptor entries call
  `referenceRunSequence` directly (`packages/core/src/runner.ts:1096-1150`).
- **VERIFIED:** async source and descriptor entries call
  `asyncReferenceRunSequence` directly when the async boundary is required
  (`packages/core/src/runner.ts:1170-1325`).
- **VERIFIED:** the canonical effect-machine disposition marks `do`,
  `expression-v1`, and `lambda` legacy and `each` partial
  (`packages/core/src/ir/semantics/internal-effect-machine-types.ts:9-28`).
- **VERIFIED:** the exact existing `do` runtime contract is already narrow:
  empty value is a no-op, portable array push and `Map.set` functionally rebind,
  no trace event is emitted, and every other discarded expression abstains
  (`packages/core/src/ir/semantics/do.ts:1-38,88-184`).
- **VERIFIED:** direct machine admission rejects non-empty helper-function and
  class registries plus class receiver/super state
  (`packages/core/src/ir/semantics/internal-effect-machine-admission.ts:135-159`).
- **VERIFIED:** a pre-execution compatibility selector pattern already exists:
  `execute-compat.ts` calls `isInternalEffectMachineEligible` before choosing a
  machine or legacy engine; it does not catch a machine rejection and retry the
  legacy runner (`packages/core/src/runtime-envelope/execute-compat.ts:34-83`).
- **VERIFIED:** `runner.ts` is already far beyond the 500-line handwritten-file
  guideline, so new selection and execution logic must live in extracted
  modules (`wc -l packages/core/src/runner.ts` on 2026-07-14).

The root cause is not merely an import location. Production source execution
has no single selector owned by the convergence plan, and `do` keeps common
array-building programs outside the canonical corpus. Moving reference imports
without changing which engine executes would be cosmetic; flipping every
program to the machine would break the documented 4.5 surface.

## What Already Works

- Parsing, module linking, entry resolution, capability preflight, and public
  stdout/error formatting already have extensive compatibility coverage and do
  not need redesign in M3.20.
- The effect machine already owns `assign`, branch/control frames, capability
  effects, `fmt`, `let`, `print`, `return`, `throw`, and structured unwind.
- The typed `kern.runtime.handler.v1` path already uses the machine-only handler
  root and remains unchanged.
- The reference runners remain a required differential oracle and explicit
  compatibility implementation; M3.20 does not delete them or remove the
  public direct-IR oracle exports.

## Contract (Verified)

> Verified against the cited source files on 2026-07-14.

| Field / Behavior | Required M3.20 behavior | Evidence | Tag |
|---|---|---|---|
| Public API signatures | No signature or export change to the four `executeKernSource*` functions | `packages/core/src/runner.ts:1096-1175` | VERIFIED |
| Sync result | Preserve exact stdout bytes and current `KernRunnerError` mapping | `packages/core/src/runner.ts:1071-1087,1114-1150` | VERIFIED |
| Async result | Preserve capability preflight, timeout/provider behavior, stdout, and error prefixes | `packages/core/src/runner.ts:1178-1340` | VERIFIED |
| `do` empty | Normal completion, no events | `packages/core/src/ir/semantics/do.ts:69-70,164-173` | VERIFIED |
| `do` array push | Functional frozen-array rebind; preserve freshness rules; no event | `packages/core/src/ir/semantics/do.ts:93-114,164-173` | VERIFIED |
| `do` `Map.set` | Functional map rebind; no event | `packages/core/src/ir/semantics/do.ts:116-119,164-173` | VERIFIED |
| Other `do` expressions | Fail closed; never silently no-op | `packages/core/src/ir/semantics/do.ts:119,180-184` | VERIFIED |
| Engine choice | Decide before effects; machine rejection after selection is terminal | `packages/core/src/runtime-envelope/execute-compat.ts:39-53,63-83` | VERIFIED pattern |
| Remaining blockers | At minimum: `expression-v1`, `lambda`, partial `each`, non-empty helper/class registries | `internal-effect-machine-types.ts:15-21`; `internal-effect-machine-admission.ts:140-146` | VERIFIED |
| Compatibility-only context | Non-root environments and loop programs without an explicit iteration budget stay on the compatibility runner | `packages/core/src/runtime-envelope/source-runner-engine.ts`; `scripts/source-runner-convergence-manifest.json` | VERIFIED |

## Implementation Options

### A. Immediate full cutover

Transfer `do`, `expression-v1`, `lambda`, partial `each`, helper calls, classes,
and every source-runner edge before changing production routing. This reaches
the end state in one change but creates an unreviewable blast radius across the
entire shipped 4.5 runner contract. Rejected for M3.20.

### B. Machine-only `do`, leave production source routing unchanged

This is semantically safe and moves one surface, but production
`executeKernSource*` would still never exercise the new ownership boundary.
Rejected as insufficient movement toward the explicit M3 exit.

### C. Bounded production convergence bridge (selected)

Transfer `do`, add a single selector that chooses before execution, and make
all four public source APIs use it. Machine-eligible programs run canonically;
ineligible programs use the explicit compatibility engine. Add an internal
`machine-only` policy for executable proof, not a process environment flag or
new public option. Publish and guard the remaining blocker ledger. M3 stays open
until the ledger is empty and compatibility selection can be removed.

The selected option is not catch-and-fallback: once the selector returns
`machine`, any machine failure propagates through the current public error
mapping. There is no second execution attempt and therefore no duplicated
effects.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/internal-effect-machine-do.ts` | add | machine-owned exact `do` resolver/executor, independent of legacy contracts |
| `packages/core/src/ir/semantics/internal-effect-machine-types.ts` | edit | promote `do` from legacy to unified |
| `packages/core/src/ir/semantics/internal-effect-machine-leaf.ts` | edit | preflight and execute `do` as a machine leaf |
| `packages/core/src/ir/semantics/deferred-expression-preflight.ts` | edit | reject non-portable deferred `do` values and shadowed namespaces before effects |
| `packages/core/src/ir/semantics/portable-map.ts` | edit | share parsed `Map.set` evaluation without reparsing source text |
| `packages/core/src/runtime-envelope/source-runner-engine.ts` | add | own pre-execution sync/async machine-versus-compat selection and internal machine-only proof policy |
| `packages/core/src/runtime-envelope/source-runner-legacy.ts` | add | isolate compatibility registry recovery and reference-runner invocation |
| `packages/core/src/runner.ts` | edit | replace direct sequence calls with the extracted engine; do not add new logic inline |
| `packages/core/tests/runtime-envelope-effect-machine-do.test.ts` | add | root/nested sync/async parity and fail-closed `do` matrix |
| `packages/core/tests/source-runner-engine.test.ts` | add | selection, no-retry, machine-only, public compatibility, and remaining-blocker proof |
| `scripts/source-runner-convergence-manifest.json` | add | executable owned/deferred ledger with evidence IDs |
| `scripts/check-source-runner-convergence.mjs` and test | add | validate manifest, call-site isolation, no catch-fallback, and blocker non-growth |
| `scripts/runner-browser-budget-policy.json` and policy module/test | add | bind the intentional transition graph measurement and force ceiling rollback when legacy leaves the graph |
| `scripts/check-runner-browser-budget.mjs` | edit | consume configurable limits and enforce the transition lifecycle |
| package fitness policy/support matrix/release train | edit after evidence | make the gate current and record scoped M3.20 completion |

Exact filenames may be collapsed where an existing sub-500-line owner already
fits, but no new logic may increase the oversized `runner.ts` beyond the small
call-site replacement.

## Acceptance Criteria

- [x] The existing `do` contract is machine-owned for sync and async execution:
  empty, push, nested-array push, `Map.set`, freshness/capture rules, and
  evaluate-once behavior match the reference oracle with zero synthetic events.
- [x] Unsupported, optional, wrong-arity, wrong-target, alias-unsafe, and
  non-portable `do` inputs fail during whole-tree preflight before any preceding
  capability/provider effect can run.
- [x] `INTERNAL_EFFECT_MACHINE_DISPOSITION.do` is `unified`; `expression-v1`
  and `lambda` stay `legacy`, while `each` stays honestly `partial`.
- [x] A source-runner engine selector chooses exactly once before execution.
  It never catches a machine execution error and retries the legacy runner.
- [x] All four public source-runner APIs execute through the selector. Their
  signatures, browser-safe import budget, module behavior, stdout bytes,
  capability behavior, and `KernRunnerError` text remain compatible.
- [x] Representative simple sync, descriptor sync, async capability, and
  descriptor async programs execute under the internal machine-only policy;
  the same policy rejects every manifest-deferred blocker.
- [x] The executable manifest names at least the current node blockers
  (`expression-v1`, `lambda`, partial `each`) and environment blockers
  (helper-function registry and class registry/state). A new fallback reason or
  widened legacy path fails the guard until it receives a named milestone.
- [x] Static source and emitted-JS closure guards prove the selected machine
  path cannot import or invoke reference runners, global contract registration,
  or the compatibility envelope.
- [x] The direct public reference-oracle exports may remain, but AST call-site
  analysis proves `executeParsedKernHandler` and the async source execution
  branch no longer invoke `referenceRunSequence` or
  `asyncReferenceRunSequence` directly.
- [x] Focused gates, `pnpm fitness:kern-5`, and a full usable-roster Agon review
  pass before M3.20 is marked done. R2 M3 remains open.

## RED Oracle

Before implementation, the focused oracle must fail for the right reasons:

1. `do` is classified legacy and direct machine execution rejects the corpus.
2. `runner.ts` directly invokes both reference sequence runners.
3. No executable source-runner convergence manifest or guard exists.
4. No internal machine-only source-runner proof exists.

The oracle must not be satisfied by renaming imports, by catching a machine
error and retrying legacy, or by deleting legacy fixtures.

## Completion Evidence

- `pnpm fitness:kern-5` passed the complete current release wall on
  2026-07-14, including build, all workspace tests, 432/432 cross-target
  fixtures, 109/109 class fixtures, native KERN tests, runtime closure gates,
  and source-runner convergence.
- The required browser measurement passed with 110 modules, 1,310,717 raw
  bytes, 294,834 gzip bytes, 50 ms cold import/execute, and 74 ms median browser
  import/execute. The policy keeps a fixed 5% transition margin and fails when
  `source-runner-legacy.js` leaves the graph unless the former ceilings are
  restored.
- Final Agon review completed with the current `claude,codex,agy` roster. The
  only needs-check claim assumed `ValueIR.numLit.raw` was optional; the source
  type requires it and the expression parser always supplies it
  (`packages/core/src/value-ir.ts:34`, `parser-expression.ts:1448`).

## Out of Scope

- Claiming R2 M3 or the full source-runner cutover complete.
- Canonical ownership of `expression-v1`, `lambda`, pair/entry `each`, helper
  function calls, recursion, classes, inheritance, constructors, or `super`.
- Deleting reference runners, differential fixtures, or direct-IR oracle
  exports.
- Changing public API options, adding a `process.env` fallback switch, or
  introducing Node-only dependencies into the browser runner.
- Reworking parser, linker, async capability analysis, or typed handler ABI.

## Open Questions

None block M3.20. Follow-up slice order is determined by the executable blocker
ledger after this change; it must not be guessed in this spec.

## Deploy Order

M3.19 merged to `main` as #525. M3.20 was built from its exact pre-merge remote
commit and must rebase onto current `origin/main` immediately before push.
During version skew, existing consumers see unchanged public APIs
and behavior; only machine-eligible programs change internal semantic owner.
The compatibility branch remains the default for manifest-deferred inputs.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Tribunal verdict listed only `expression-v1` and `lambda` as remaining legacy shapes. | `each` is partial, and direct admission also rejects non-empty helper/class registries plus class state. | The manifest must include structural and environment blockers; M3.20 cannot claim a two-shape remainder. |
| Tribunal proposed `KERN_SOURCE_RUNNER_FALLBACK=deny`. | `@kernlang/core/runner` is browser-safe and has no process/global environment dependency. | Use an internal explicit machine-only policy exercised by tests, not a process environment variable or public option. |
| Tribunal proposed banning every reference-runner import from `runner.ts`. | The runner subpath intentionally re-exports direct reference-oracle APIs. | Guard active source-execution call sites and canonical import closure, not legitimate public oracle re-exports. |
| Moving imports alone would close the source-runner defect. | Ownership changes only when production programs are selected onto the canonical machine. | M3.20 must execute an admitted production corpus canonically and prove it with machine-only tests. |
| The extracted engine could live directly under `packages/core/src`. | Runtime ownership modules are grouped under `runtime-envelope`, and the compatibility registry/reference calls require an explicit sibling boundary. | The implementation uses `runtime-envelope/source-runner-engine.ts` plus `source-runner-legacy.ts`; guards distinguish canonical and compatibility closures. |
| Recognizing the literal `Map.set(...)` call was sufficient. | Portable namespace calls must reject when the environment shadows `Map`, including deferred whole-tree preflight. | One shared namespace guard now runs before both direct execution and deferred evaluation; regression coverage proves rejection occurs before an earlier capability effect. |
| The existing browser byte ceiling could remain unchanged after statically linking both transition engines. | The intentional M3.20 graph is 1,310,717 raw bytes, above the old raw ceiling but below the old gzip ceiling; no removable accidental dependency was identified. | A three-engine tribunal selected an exact measured 5% rebaseline plus an executable rollback trigger, with all limits moved into checked-in policy configuration. |
