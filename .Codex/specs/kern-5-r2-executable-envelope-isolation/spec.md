# KERN 5 R2 M3.15 Executable-Envelope Isolation

**Status:** COMPLETE
**Date:** 2026-07-13
**Completed:** 2026-07-14
**Branch:** `feat/kern-5-r2-m3-15-envelope-isolation`
**Base:** `d6634f1d`
**Confidence:** 0.98

## Executive Summary

M3.15 turns the direct sync/async internal runtime envelope into a machine-only,
fail-closed execution boundary. The direct entry must not register semantic
contracts, dispatch through the mutable global contract registry, import either
reference runner, or fall back after a machine failure. Existing reference-runner
behavior remains available only through explicitly named compatibility entries,
which the still-unisolated handler root may use until the following release slice.

The selected implementation extracts the semantic environment from the registry
barrel, adds machine-owned evaluator-injected operational leaves, separates direct
and compatibility engines/normalizers, and proves the complete production import
closure with mutation-resistant tests.

## Current State / Root Cause

- **VERIFIED:** Direct sync and async envelope execution calls
  `registerAllContracts()` before dispatch (`packages/core/src/runtime-envelope/execute.ts:1-2`,
  `packages/core/src/runtime-envelope/execute.ts:30-43`,
  `packages/core/src/runtime-envelope/execute.ts:51-68`). The direct path therefore
  mutates and depends on process-global compatibility state.
- **VERIFIED:** `internal-engine.ts` imports both reference runners and selects the
  legacy path whenever machine eligibility is false
  (`packages/core/src/runtime-envelope/internal-engine.ts:1-9`,
  `packages/core/src/runtime-envelope/internal-engine.ts:19-43`). A direct entry is
  consequently not a fail-closed machine boundary.
- **VERIFIED:** The effect-machine sequence dispatches the eight operational leaves
  `assign`, `break`, `continue`, `fmt`, `let`, `print`, `return`, and `throw` through
  `CONTRACT_REGISTRY` (`packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:11-18`,
  `packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:32-38`,
  `packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:220-232`).
- **VERIFIED:** The semantic environment, global registry, registration function,
  and documentation exports share one runtime barrel
  (`packages/core/src/ir/semantics/index.ts:15-151`,
  `packages/core/src/ir/semantics/index.ts:453-493`). Importing environment helpers
  therefore also reaches registry/documentation ownership.
- **VERIFIED:** Direct normalization imports `ReferenceRunnerError`, and value
  normalization imports the compatibility scalar facade
  (`packages/core/src/runtime-envelope/normalize.ts:1-3`,
  `packages/core/src/runtime-envelope/normalize.ts:144-152`,
  `packages/core/src/runtime-envelope/value.ts:1-3`). These edges keep otherwise
  direct infrastructure in the reference closure.
- **VERIFIED:** The current production runtime closure from `execute.ts` plus
  `internal-engine.ts` contains 101 TypeScript modules and reaches
  `async-reference-runner.ts`, `reference-runner.ts`, all registration contracts,
  `runner.ts`, `portable-scalar.ts`, and `doc-generator.ts`. Evidence: on
  2026-07-13, `runtimeImportClosure([execute.ts, internal-engine.ts], ..., new
  Set(['decimal.js']))` printed `101` and those paths.
- **VERIFIED:** Whole-tree structure checking runs before generator execution, but
  currently validates control frames and generic unified-node shape only; leaf
  dispatch still defers each contract's shape check until execution
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:45-57`,
  `packages/core/src/ir/semantics/internal-effect-machine-structure.ts:101-159`).
- **VERIFIED:** No non-test source outside `packages/core/src/runtime-envelope/**`
  calls the direct envelope/handler/source-handler APIs. Evidence: `rg -n
  "executeInternalRuntime" packages -g '*.ts' -g '!packages/core/tests/**'
  -g '!packages/core/src/runtime-envelope/**'` returned zero hits on 2026-07-13.
- **VERIFIED:** The release train requires a machine-only direct route, machine-owned
  evaluator-injected leaves, complete direct import-closure exclusion, and a
  separately named compatibility entry until handler-root isolation
  (`docs/kern-5-release-train.md:312-319`).

## What Already Works

- **VERIFIED:** The stable machine already has one sync generator driver and one
  async generator driver, with a pre-execution eligibility/structure phase
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:45-101`). These
  drivers remain the sole direct engine.
- **VERIFIED:** Branch, `if`, `for`, `each`, `while`, `try`, and capability frames
  already use runtime helpers and the machine evaluator rather than their legacy
  contracts (`packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:2-10`,
  `packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:40-45`,
  `packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:65-190`).
- **VERIFIED:** The import-closure parser already covers runtime imports, runtime
  re-exports, TypeScript import-equals, literal dynamic imports, literal `require`,
  own-package aliases, unknown bare imports, and peer-dependency bypass attempts
  (`scripts/runtime-envelope-import-closure.mjs:9-107`,
  `scripts/runtime-envelope-import-closure.test.mjs:31-203`). M3.15 extends this
  oracle rather than replacing it.
- **VERIFIED:** Capability results are normalized into a closed portable data
  shape before the machine resumes (`packages/core/src/runner-capabilities.ts:210-228`,
  `packages/core/src/runner-capabilities.ts:244-300`). The M3.15 regressions must
  prove class-shaped provider data still cannot activate reference semantics.
- **VERIFIED:** Runtime envelope APIs are internal source modules and are not listed
  as package subpath exports (`packages/core/package.json:8-64`). No published ABI
  rename is required in this slice.

## Contract (Verified)

> Verified against current source on 2026-07-13.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Direct sync entry | Selects and runs only the machine; outside corpus returns `unsupported-runtime-input` | `docs/kern-5-release-train.md:312-317` | VERIFIED |
| Direct async entry | Same selection and failure contract as sync; async capability scheduling remains supported | `packages/core/src/runtime-envelope/execute.ts:51-75`; `packages/core/src/ir/semantics/internal-effect-machine.ts:79-101` | VERIFIED |
| Machine leaf dispatch | Exhaustive, immutable, evaluator-injected ownership for eight unified operational leaves | `packages/core/src/ir/semantics/internal-effect-machine-types.ts:9-28`; `docs/kern-5-release-train.md:313-315` | VERIFIED |
| Compatibility sync/async entries | Preserve pre-M3.15 machine-or-reference selection behind names containing `Compat` | `docs/kern-5-release-train.md:317-319` | VERIFIED |
| Selection timing | Compatibility selects exactly once before execution; it never retries reference execution after a selected-machine error | Required to preserve fail-closed machine ownership in `docs/kern-5-release-train.md:312-319` | VERIFIED |
| Handler root | Continues through explicit compatibility entry until the following handler-isolation slice | `docs/kern-5-release-train.md:318-319` | VERIFIED |
| Direct closure | Excludes compatibility modules, registry/registration, reference hosts/runners, and `runner.ts` | `docs/kern-5-release-train.md:315-317`; current closure evidence above | VERIFIED |
| Environment | Direct machine uses a registry-free semantic-environment module; legacy imports retain source compatibility through `index.ts` re-exports | `packages/core/src/ir/semantics/index.ts:15-413` | VERIFIED |
| Failure normalization | Direct machine errors map without importing reference error classes; compat maps reference abstention to `unsupported-runtime-input` | `packages/core/src/runtime-envelope/normalize.ts:144-152` | VERIFIED |

## Implementation Options

### Option A — Facade-only direct wrapper

Add a new direct function that calls `runInternalEffectMachine*`, but leave
registry leaf dispatch and the shared normalizer/value/index closures intact.

- Pros: smallest diff.
- Cons: contradicts the required complete closure and machine-owned leaf claims;
  registry poisoning can still alter direct execution.
- Confidence: 0.18. Rejected.

### Option B — Clean direct core plus explicit compatibility shell (selected)

1. Extract semantic environment types/helpers into `semantic-env.ts`; re-export
   them from `index.ts` for source compatibility and redirect every module in the
   stable machine closure to the clean owner.
2. Add machine-owned evaluator-injected leaf shape validation and execution.
   The structure pass validates every leaf shape before any effect. The sequence
   dispatcher calls the new immutable leaf dispatcher, never `CONTRACT_REGISTRY`.
3. Make `internal-engine.ts` machine-only and make `execute.ts` direct-only. Replace
   the reference-named async option with a machine-owned async option type.
4. Add explicitly named dirty compatibility execution/normalization modules plus a
   reference-only `internal-legacy-engine.ts`. `execute-compat.ts` is the sole owner
   of compatibility selection: it chooses machine or legacy once before execution,
   calls the direct machine engine unchanged for a machine selection, and calls the
   reference-only legacy engine for a legacy selection. Contract registration occurs
   only inside the selected legacy branch. The handler root temporarily imports the
   compatibility entry.
5. Move direct Decimal discrimination to the clean scalar domain and remove the
   reference error class from direct normalization.
6. Extend the production closure oracle and mutation suite for the two direct entry
   roots and the complete forbidden set.

- Pros: satisfies all M3.15 ownership claims without deleting 4.5 compatibility;
  produces a mechanically enforceable boundary for the handler-root slice.
- Cons: touches the semantic-environment import seam across roughly twenty internal
  modules and requires parity tests for every operational leaf.
- Confidence: 0.92. Selected.

### Option C — Delete legacy fallback and isolate handler root together

Remove compatibility and migrate every handler caller now.

- Pros: shortest final architecture.
- Cons: expands scope into the explicitly following handler-root slice and removes
  the compatibility window required by the release train.
- Confidence: 0.31. Rejected.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/semantic-env.ts` | Add | Clean owner for environment types and lexical-binding helpers |
| `packages/core/src/ir/semantics/index.ts` | Refactor | Re-export environment surface; retain registry/contracts only |
| Stable machine closure modules importing `index.ts` | Modify | Point runtime imports at `semantic-env.ts` |
| `packages/core/src/ir/semantics/internal-effect-machine-leaf.ts` | Add | Exhaustive machine-owned operational leaf validation/execution |
| `packages/core/src/ir/semantics/internal-effect-machine-sequence.ts` | Modify | Remove registry dispatch and call the machine leaf dispatcher |
| `packages/core/src/ir/semantics/internal-effect-machine-structure.ts` | Modify | Whole-tree leaf-shape preflight and bounded environment validation |
| `packages/core/src/runtime-envelope/internal-engine.ts` | Refactor | Machine-only direct selection and execution |
| `packages/core/src/runtime-envelope/execute.ts` | Refactor | Remove registration/fallback from direct lifecycle |
| `packages/core/src/runtime-envelope/internal-legacy-engine.ts` | Add | Dirty reference-only runner and legacy-only contract registration |
| `packages/core/src/runtime-envelope/execute-compat.ts` | Add | Sole compatibility selector plus explicit `Compat` sync/async entries |
| `packages/core/src/runtime-envelope/normalize.ts` | Modify | Reference-free direct normalization |
| `packages/core/src/runtime-envelope/normalize-compat.ts` | Add | Compatibility-only reference error mapping |
| `packages/core/src/runtime-envelope/value.ts` | Modify | Import Decimal predicate from clean scalar domain |
| `packages/core/src/runtime-envelope/handler-entry.ts` | Modify | Temporarily use explicit compatibility execution |
| Runtime envelope tests | Modify/Add | Direct-vs-compat, registry poisoning, preflight, no-retry, hostile-value parity |
| `scripts/runtime-envelope-import-closure.mjs` | Modify | Add complete executable-envelope production closure policy |
| `scripts/runtime-envelope-import-closure.test.mjs` | Modify | Mutation-proof all direct forbidden edges and aliases |
| `docs/kern-5-release-train.md` | Modify after green review | Record M3.15 evidence and closure |

## Acceptance Criteria

- [x] Direct sync and async envelope entries return
  `unsupported-runtime-input` for a root `do`, `lambda`, non-array `each`, or any
  other out-of-machine corpus without invoking a reference runner.
- [x] Explicit `*Compat*` sync and async entries preserve the old fallback for an
  admitted legacy example such as `do xs.push(2)`, including the expected mutation,
  trace, and normalized result.
- [x] Compatibility selection occurs once before execution. A machine-eligible
  input that fails during machine validation/execution never retries via reference
  execution.
- [x] `execute-compat.ts` is the sole owner of machine-vs-legacy selection;
  `internal-legacy-engine.ts` is reference-only and cannot select or call the
  machine. A compat call selected for the machine does not register contracts,
  import a reference runner through its executed branch, or touch the registry.
- [x] Direct async execution exposes a machine-owned async options type and no
  exported/direct source signature names `AsyncReferenceRunnerOptions`.
- [x] Direct execution succeeds when `CONTRACT_REGISTRY` is empty and leaves it
  empty.
- [x] Replacing every one of the eight registry leaf contracts with poison
  implementations cannot affect or observe direct machine execution.
- [x] Every supported operational leaf has sync/async direct parity and raw-trace
  parity with the legacy contract for the frozen machine corpus.
- [x] A later malformed operational leaf is rejected by whole-tree preflight before
  an earlier capability provider or stdout event executes, and the supplied
  environment's bindings and provenance metadata remain byte-for-byte unchanged.
- [x] Root environment bindings containing a runner-class instance shape,
  accessor-backed class fields, callable host objects, or non-plain executable
  state fail closed without invoking getters or reference functions.
- [x] A capability-produced class-shaped/plain record cannot activate class or
  reference semantics and remains only portable data or fails normalization.
- [x] Handler-entry and source-handler sync/async calls have explicit legacy-only
  witnesses proving they route through the `Compat` entries during this slice. The
  current hidden-class/getter compatibility witness retains its pre-M3.15 dirty
  result, while the same input through the direct entry fails without invoking the
  getter.
- [x] A direct call and a compat call selected for the machine each install and
  dispose the scheduler exactly once and preserve cancellation, timeout, and
  immediate-async parity.
- [x] `execute.ts` and `internal-engine.ts` have a shared production closure policy
  that excludes at least: `execute-compat.ts`, `internal-legacy-engine.ts`,
  `normalize-compat.ts`, `index.ts`, `doc-generator.ts`, `register-all.ts`, all
  registration contract modules, `reference-runner.ts`,
  `async-reference-runner.ts`, `portable-scalar.ts`, `async-portable-scalar.ts`,
  every `portable-reference-*` host/evaluator/body module, `runner.ts`, and the
  legacy leaf owners `assign.ts`, `fmt.ts`, `let.ts`, `print.ts`, and
  `primitives.ts`.
- [x] Closure mutation tests fail for direct, transitive, runtime re-export,
  import-equals, literal/non-literal dynamic import, `require`, own-package import,
  arbitrary bare alias, and peer-dependency bypasses.
- [x] The direct closure uses an explicit, reviewable bare-module allowlist (only
  the exact package(s) its clean value substrate requires), never an allowlist
  derived from all manifest dependencies or peer dependencies.
- [x] The closure checker is part of `test:kern-runtime-envelope` and the KERN 5
  fitness policy; no acceptance test is skipped.
- [x] Focused tests, typecheck/build, lint, full KERN 5 fitness wall, and
  `git diff --check` pass.
- [x] A full-roster Agon review using exactly `claude,codex,agy` reports no verified
  or needs-check findings after all fixes.
- [x] Every new or materially rewritten handwritten source file remains below 500
  lines, including `semantic-env.ts`, the machine leaf dispatcher, and compatibility
  modules.
- [x] M3.14's terminal review evidence and release-train checkbox are closed before
  M3.15 is marked complete; M3.15 must not build a completed release claim on an
  open predecessor.
- [x] M3.15 release-train evidence names the exact gate and terminal review run.

## Completion Evidence

- Local release wall: `pnpm fitness:kern-5` passed on 2026-07-14. It included
  repository consistency, lint, production build, every workspace test,
  release/infra/KIR proofs, 432/432 cross-target fixtures, 109/109 class
  fixtures, 233 native KERN tests at 100% coverage, browser budget,
  self-host/capstone checks, app behavior, drift showcase, and final diff
  hygiene.
- Focused boundary wall: `pnpm test:kern-runtime-envelope` passed the complete
  runtime-envelope/evaluator suite, all 29 import-closure tests, and the direct
  runtime checker.
- Deferred-expression adjudication: the full roster selected bounded
  non-deferred subtree partitioning at
  `/Users/nicolascukas/.agon/runs/tribunal-1783981922640-sbxioy-m3-15-r32-deferred-expression-ad`.
- Terminal review: full roster `claude,codex,agy` completed 3/3 at
  `/Users/nicolascukas/.agon/runs/review-1783989797752-hnsl4k-m3-15-envelope-isolation-r36-fin`.
  It produced zero verified findings. Every needs-check/speculative candidate
  was adjudicated against the structural shape pass, capability interceptor,
  and the intentionally parent-scoped `if` runtime; none required a code
  change.
- Predecessor closure: M3.14 terminal review and scoped completion tribunal are
  recorded in its spec and in the release train before this milestone is
  marked complete.
- Scope boundary: handler/source-handler roots intentionally remain on explicit
  compatibility entries. Their isolation is the following release slice, not
  an unclosed M3.15 acceptance item.

## Out of Scope

- Publishing a new public runtime-envelope package subpath.
- Isolating the source/handler entry import closure; that is the following slice.
- Expanding the effect-machine node corpus (`do`, functions, classes, lambda,
  expression-v1, pair/entry iteration).
- Removing reference runners, contract registration, or 4.5 compatibility from the
  repository.
- Changing envelope wire format, diagnostic codes, scheduler semantics, capability
  policy, or parser/schema behavior.

## Open Questions

None on the selected path. All selected-path claims above are source-verified; the
tribunal may tighten acceptance or split files without changing the contract.

## Deploy Order

1. Ship the clean direct engine and closure oracle together with the explicitly
   named compatibility shell.
2. Keep the current handler root on the compatibility entry during version skew.
3. In the following slice, switch the handler root to the direct entry only after
   its own import-closure and behavior oracles are green.

Because no runtime-envelope entry is a published package subpath and no non-test
source outside the runtime-envelope directory calls it, mixed published 4.5/5.0
consumers see no ABI skew in M3.15. Internal source callers retain old behavior only
when they import the explicit compatibility entry.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The stable machine closure was already fully isolated after M3.14. | It excludes reference evaluators but still reaches `index.ts` and `doc-generator.ts`, and operational leaves still dispatch through `CONTRACT_REGISTRY`; the full direct closure reaches 101 modules. | M3.15 must extract environment ownership and leaf execution, not only split `internal-engine.ts`. |
| Direct normalization was already reference-neutral. | `normalize.ts` imports `ReferenceRunnerError`, and `value.ts` imports `portable-scalar.ts`. | Direct and compatibility normalization/value edges must be separated before the closure claim is valid. |
| A dirty compatibility engine could own both selection and reference execution. | That makes double-selection or catch-and-retry hard to exclude. `execute-compat.ts` must own the one selection; `internal-legacy-engine.ts` must be reference-only and register only after legacy selection. | Added single-owner, no-retry, and machine-compat-no-registration acceptance criteria. |
| Runtime import closure was enough to prove async API ownership. | Type-only imports are intentionally erased by the closure checker, so a direct signature could still expose `AsyncReferenceRunnerOptions` while the runtime graph appears clean. | Added a source/type assertion for a machine-owned direct async option. |
| Manifest runtime dependencies were a safe closure allowlist. | A future dependency could become an uninspected side-effect bridge and pass automatically. | Direct closure now requires a literal bare-package allowlist plus mutation coverage. |
| Deferring one binding made it safe to skip the entire expression or capability input during preflight. | A known invalid sibling or operand could survive until after an earlier provider ran. | Partition deferred expressions, validate every reachable fully known scalar subtree and every known capability field, and preserve dynamic short-circuit semantics. |

## Tribunal Evidence

- **VERIFIED:** Full-roster red-team tribunal `claude,codex,agy` completed 3/3 on
  2026-07-13 at
  `/Users/nicolascukas/.agon/runs/tribunal-1783954022481-qvtz19-m3-15-spec-boundary`.
- **VERIFIED:** The tribunal selected Option B after requiring: immutable machine
  leaf dispatch, direct-only engine ownership, a dual-root closure oracle, clean
  semantic-environment extraction, whole-tree leaf validation, hostile root-env
  rejection, literal bare-import allowlisting, explicit `Compat` exports, and raw
  trace parity. These requirements are promoted into the acceptance criteria above.
- **VERIFIED:** An independent delegated audit on `d6634f1d` reproduced all key RED
  failures: direct registry population `0 -> 21`, poisoned `return` dispatch changing
  the result to `99`, an earlier capability firing before a malformed later `let`,
  and a hidden runner-class instance invoking a reference getter. Those exact shapes
  seed the regression suite.
