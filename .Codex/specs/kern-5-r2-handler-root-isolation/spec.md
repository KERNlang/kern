# KERN 5 R2 M3.16 Handler-Root Isolation

**Status:** COMPLETE
**Date:** 2026-07-14
**Completed:** 2026-07-14
**Branch:** `feat/kern-5-r2-m3-16-handler-root-isolation`
**Stacked on:** `feat/kern-5-r2-m3-15-envelope-isolation` at `58776357`
**Confidence:** 0.96

## Executive Summary

M3.16 makes the existing typed handler and source-handler entries machine-only.
Both sync and async handler routes must call the direct M3.15 envelope, fail
closed for legacy-only input, and have a complete emitted-runtime import closure
that excludes compatibility, reference, registry, legacy semantic owners, and
`runner.ts`. The existing explicit `execute-compat.ts` API remains available to
callers that intentionally request 4.5 fallback; this slice creates no new public
ABI or compatibility handler.

The implementation also separates parser/runtime state from the public runtime
barrel. That split is required because the source-handler imports the public
parser, whose runtime barrel currently re-exports the app descriptor and therefore
reaches `runner.ts` even though source linking never executes the runner.

## Current State / Root Cause

- **VERIFIED:** `handler-entry.ts` imports environment helpers through the registry
  barrel, record metadata through legacy `let.ts`, name validation through the
  compatibility scalar facade, and sync/async execution through
  `execute-compat.ts` (`packages/core/src/runtime-envelope/handler-entry.ts:1-17`).
- **VERIFIED:** Its public handler functions call the compatibility envelope for
  both sync and async execution
  (`packages/core/src/runtime-envelope/handler-entry.ts:159-177`).
- **VERIFIED:** `source-handler.ts` imports the registry environment facade and
  compatibility scalar facade and exposes `InternalRuntimeCompatAsyncOptions` in
  its async source signature
  (`packages/core/src/runtime-envelope/source-handler.ts:1-11,164-173`).
- **VERIFIED:** A production closure walk on 2026-07-14 reported 113 modules for
  `handler-entry.ts` and 114 for `source-handler.ts`; both reached
  `reference-runner.ts`, `async-reference-runner.ts`, `portable-scalar.ts`,
  `runner.ts`, `parser.ts`, and `schema.ts`. Command:
  `runtimeImportClosure([root], ..., new Set(['decimal.js']))`.
- **VERIFIED:** The exact source-to-runner edge is
  `source-handler.ts -> parser.ts -> runtime.ts -> app-descriptor.ts -> runner.ts`.
  The public runtime barrel defines parser state and also runtime re-exports the
  app descriptor (`packages/core/src/runtime.ts:20-180`).
- **VERIFIED:** M3.15 deliberately left the handler root on the explicit
  compatibility entry and named handler isolation as the following slice
  (`.Codex/specs/kern-5-r2-executable-envelope-isolation/spec.md:13-18,275-300`;
  `docs/kern-5-release-train.md:312-326`).
- **VERIFIED:** The runtime-envelope modules are not package subpath exports
  (`packages/core/package.json:8-64`). This is an internal ownership cutover, not
  a published ABI migration.

## What Already Works

- **VERIFIED:** M3.15 already provides machine-only sync/async entries and a
  mutation-resistant closure parser for direct, transitive, re-export,
  import-equals, dynamic import, `require`, own-package, and bare-module edges
  (`packages/core/src/runtime-envelope/execute.ts:1-70`;
  `scripts/runtime-envelope-import-closure.mjs:1-223`).
- **VERIFIED:** Handler argument inspection, normalization, fresh environment
  construction, capability interception, hostile accessor/proxy rejection, and
  sync/async byte parity already have focused tests
  (`packages/core/tests/runtime-envelope-handler-entry.test.ts`).
- **VERIFIED:** Source identity, bounded linking, schema rejection, module-edge
  rejection, and link-before-capability behavior already have focused tests
  (`packages/core/tests/runtime-envelope-source-handler.test.ts`).
- **VERIFIED:** Machine-owned environment and binding helpers already live in
  `semantic-env.ts`, and machine-owned name/value predicates already live in
  `portable-scalar-domain.ts`; no new semantic registry is needed
  (`packages/core/src/ir/semantics/semantic-env.ts:1-322`;
  `packages/core/src/ir/semantics/portable-scalar-domain.ts:1-210`).

## Contract (Verified)

> Verified against current source, the M3.15 spec, and the M3.16 tribunal on 2026-07-14.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Existing handler sync/async | Direct machine execution only; legacy-only bodies fail with `unsupported-runtime-input`, no effects | M3.15 direct API in `execute.ts:22-70`; M3.16 tribunal | VERIFIED |
| Existing source-handler sync/async | Link first, then delegate to the direct handler; link failure occurs before capability execution and machine preflight occurs before admitted effects | `source-handler.ts:106-173`; `runtime-envelope-source-handler.test.ts`; M3.16 tribunal | VERIFIED |
| Async option | Machine-owned `InternalRuntimeAsyncOptions`, not compatibility/reference naming | `execute.ts:3-7,49-57`; M3.16 tribunal | VERIFIED |
| Compatibility | Existing `execute-compat.ts` remains the only explicit fallback path; no new handler/source compat entry is added | M3.15 spec `Out of Scope` and M3.16 tribunal | VERIFIED |
| Handler/source runtime closure | Excludes compatibility modules, registry facade/registration, reference runners/hosts, legacy leaf owners, and `runner.ts` | M3.16 tribunal; existing M3.15 forbidden set in `runtime-envelope-import-closure.mjs:177-223` | VERIFIED |
| Public package ABI | No new runtime-envelope export and no removal/rename of package exports | `packages/core/package.json:8-64` | VERIFIED |
| Parser behavior | Public parser/schema behavior and singleton identity stay unchanged; only state ownership moves behind the existing runtime barrel | `runtime.ts:20-180`; parser consumers enumerated by `rg "from './runtime.js'" packages/core/src` on 2026-07-14 | VERIFIED |

## Implementation Options

### Option A — Cut existing roots over and enforce the full closure (selected)

1. Point handler environment/name imports at machine-owned modules, keep record
   array metadata logic local and descriptor-safe, and call direct `execute.ts`.
2. Expose the machine-owned async option in handler and source-handler signatures.
3. Extract `KernRuntime`, `defaultRuntime`, and parser hint state to a side-effect
   neutral owner; retain the public `runtime.ts` re-export surface. Redirect the
   parser/schema/spec internals to that neutral owner so importing `parser.ts` no
   longer instantiates app/runner ownership.
4. Extend the shared closure policy with handler/source roots and make it mandatory
   in the runtime checker, with production and mutation tests.

- Pros: completes the exact ownership cutover, preserves source compatibility, and
  keeps compatibility explicit.
- Cons: the source-root proof requires a small parser/runtime ownership refactor in
  addition to the handler edit.
- Confidence: 0.96. Selected.

### Option B — Isolate only `handler-entry.ts`

- Pros: smaller patch.
- Cons: leaves the source-handler as a hidden runner/reference root and does not
  satisfy the agreed M3.16 contract.
- Confidence: 0.20. Rejected.

### Option C — Add new compat handler/source entrypoints

- Pros: lets callers retain the old implicit fallback under another name.
- Cons: expands an internal compatibility ABI without a live client requirement;
  the tribunal explicitly rejected it. Existing callers can import
  `execute-compat.ts` when fallback is intentional.
- Confidence: 0.12. Rejected.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/runtime-envelope/handler-entry.ts` | Modify | Clean imports, local record metadata, direct execution |
| `packages/core/src/runtime-envelope/source-handler.ts` | Modify | Clean types/name predicate and machine async option |
| `packages/core/src/runtime-state.ts` | Add | Side-effect-neutral owner of runtime/parser state |
| `packages/core/src/runtime.ts` | Refactor | Preserve public runtime and app-descriptor re-exports |
| `parser.ts`, `parser-core.ts`, `parser-diagnostics.ts`, `schema.ts`, `spec.ts` | Modify imports | Keep parser/source closure out of app/runner ownership |
| `scripts/runtime-envelope-import-closure.mjs` | Modify | Add handler/source production closure policy |
| `scripts/runtime-envelope-import-closure.test.mjs` | Modify | RED production proof and full mutation suite |
| Runtime handler/source/executable tests | Modify | Fail-closed behavior, parity, atomicity, explicit ownership |
| `scripts/check-runtime-envelope.mjs` | Modify | Mandatory handler/source closure gate |
| `docs/kern-5-release-train.md` | Modify after terminal review | Record M3.16 evidence |

## Acceptance Criteria

- [x] Existing handler sync and async calls return byte-identical
  `unsupported-runtime-input` failures with no events for legacy-only
  `xs.push(2)` input.
- [x] Existing source-handler sync and async calls return the same byte-identical
  fail-closed result for the equivalent source program.
- [x] Supported machine programs and typed arguments retain sync/async equality,
  record-array iteration provenance, scheduler behavior, and async capabilities.
- [x] Invalid/hostile parameter arrays, arguments, metadata, accessors, and proxies
  fail closed without invoking host getters or capability providers.
- [x] Source link failure occurs before capability execution; after a successful
  link, machine whole-tree preflight occurs before any earlier admitted effect.
  The direct handler root separately proves capability preflight atomicity and
  supplied host state remains unchanged.
- [x] Handler and source-handler signatures use the machine-owned async option and
  source contains no compatibility/reference option names.
- [x] The complete runtime import closure rooted at both `handler-entry.ts` and
  `source-handler.ts` excludes the full M3.15 forbidden set, including
  `execute-compat.ts`, `normalize-compat.ts`, `internal-legacy-engine.ts`,
  `index.ts`, registration/reference modules, legacy leaf owners, and `runner.ts`.
- [x] The new policy rejects direct, transitive, runtime re-export, import-equals,
  literal/non-literal dynamic import, `require`, own-package, unapproved bare
  alias, and dependency/peer-dependency bypass mutations.
- [x] Public parser/runtime/schema behavior and the identity of `defaultRuntime`
  remain regression-covered after state extraction.
- [x] No new package export or compatibility handler/source ABI is introduced.
- [x] `pnpm test:kern-runtime-envelope`, the direct checker, focused handler/source
  tests, build/typecheck/lint, `pnpm fitness:kern-5`, and `git diff --check` pass.
- [x] A terminal `agon review` using exactly `claude,codex,agy` has no verified or
  needs-check findings after every candidate is adjudicated.
- [x] New/materially rewritten handwritten source files remain below 500 lines.

## Completion Evidence

- `pnpm fitness:kern-5` passed the complete current wall on 2026-07-14,
  including workspace tests, infra/release/KIR proofs, 432/432 cross-target
  fixtures, 109/109 class fixtures, 233 native KERN tests at 100% coverage,
  browser budget, self-host/capstone checks, app behavior, drift showcase, and
  diff hygiene.
- `pnpm test:kern-runtime-envelope` passed after every review fix. The combined
  closure suite contains 36 passing cases, including the handler/source production
  closure and mutation coverage derived from the same exported forbidden policy.
- Full-roster terminal review `claude,codex,agy` completed 3/3 with zero verified,
  needs-check, speculative, or nit findings at
  `/Users/nicolascukas/.agon/runs/review-1784011660440-0jp6lw-m3-16-handler-root-isolation-ter`.
- The review-discovered test-barrel edge and forbidden-policy duplication were
  fixed before the terminal review. No production or public compatibility issue
  remained.

## Out of Scope

- Expanding the machine corpus to `do`, functions/classes, lambdas, or the legacy
  expression evaluator.
- Removing `execute-compat.ts`, reference runners, or 4.5 behavior from the repo.
- Publishing runtime-envelope subpaths or the planned public runtime-handler ABI.
- Changing envelope wire format, diagnostics, parser syntax/schema, capability
  policy, scheduler policy, or source identity rules.

## Open Questions

None on the selected path. The full-roster tribunal resolved the compatibility,
flag, ABI, closure, and source-parser boundary decisions.

## Deploy Order

1. While M3.15 is not in `origin/main`, M3.16 remains stacked on the exact M3.15
   feature tip and must target that predecessor for review.
2. If M3.15 merges before M3.16 is pushed, fetch and rebase M3.16 cleanly onto
   `origin/main`, removing the already-landed predecessor commits from the slice.
3. Push M3.16 once after the full local gate and terminal review. Never push the
   old M3.15 branch again after it merges.

There is no published mixed-version ABI window: the changed entries are internal
source modules and are absent from package exports. Explicit compatibility remains
available in-repo under its existing name.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Switching the handler import from compat to direct would complete M3.16. | `handler-entry.ts` also imports the registry facade and legacy scalar/let owners. | Clean every runtime helper edge before claiming the handler closure. |
| `source-handler.ts` only adds parser/schema modules to the clean handler graph. | The public `runtime.ts` barrel re-exports `app-descriptor.ts`, which imports `runner.ts`. | Extract neutral runtime/parser state and prove the full source-root closure. |
| A strict-isolation feature flag might preserve compatibility. | The tribunal found no client or rollout need and selected unconditional machine-only existing roots. | No flag and no dual behavior in existing handler APIs. |
| A source-linked capability could prove machine-preflight atomicity. | The current source schema rejects `capability` and `print` as direct KERN handler children before execution. | Keep the existing link-before-capability oracle; use an admitted assignment effect for source machine-preflight atomicity and prove capability atomicity at the typed handler root. |

## Tribunal Evidence

- **VERIFIED:** Full-roster `claude,codex,agy` tribunal completed at
  `/Users/nicolascukas/.agon/runs/tribunal-1783992582038-j9hvri-m3-16-handler-root-isolation-des`.
- **VERIFIED:** The verdict selected unconditional machine-only existing handler
  and source roots, no new compat ABI, no isolation flag, full emitted-runtime
  closure enforcement, hostile-input fail-closed tests, and link/preflight
  atomicity. Claude exhausted its external quota; Codex and agy supplied the
  substantive rounds and the synthesized verdict retained the full-roster run
  record.
