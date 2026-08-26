# KERN 5 R2: linked KIR-to-JavaScript ESM lowering

**Status:** READY TO BUILD — RED AT BASE
**Date:** 2026-08-26
**Initial confidence (pre-challenge):** 0.82
**Revised confidence:** 0.91

## Executive Summary

R2 adds the production compiler subpath `@kernlang/core/compiler/kir-js-esm` and an internal immutable linked-program boundary: `kern.linked-kir-program.v1`. The only compiler input is a same-process `VerifiedKernProjection`; one authenticated linker reads canonical structural KIR once and returns the linked program. RT-1 execution and R2 ESM lowering both consume it, eliminating the duplicated selector/admission path rejected by all three Agon brainstorm engines.

R2 emits deterministic self-contained JavaScript ESM specialized to that program's statements and expressions. Its target-specific KERN semantic kernel implements the v1 request/envelope contract; it is not a general KIR interpreter, does not import/call RT-1, and cannot replay fixture outputs. JavaScript and Python kernels are unavoidable separate backends because their hosts differ; cross-backend differential fixtures, not shared host behavior, are their semantic authority. This is a new public contract bound to `kern.runtime.kir.v1`, not a compatibility layer for R0.

## Current State / Root Cause

- **VERIFIED:** The pinned R2 worktree is `b501969e`; `89bbd360` is an ancestor, and the stack begins from `origin/main` commit `aae0a0fe`. Evidence: `git log --oneline --ancestry-path aae0a0fe..b501969e` and `git merge-base --is-ancestor 89bbd360 b501969e` (exit `0`), run 2026-08-26.
- **VERIFIED:** The public KIR runtime contract is `kern.runtime.kir.v1`, owned as `kern.runtime.kir.owner.v1`; its request contains entry, arguments, control, and limits, and its envelope has the same v1 format. Evidence: `packages/core/src/kir-runtime/contracts.ts:1-2`, `:30-43`, `:87-95`.
- **VERIFIED:** RT-1 executes only an authenticated, same-process `VerifiedKernProjection`; it rejects clones/reconstructions/tampered bytes before an effect. Evidence: `packages/core/src/kir-runtime/execute.ts:444-455`; behavioral proof in `scripts/kern-5-r1-runtime-owner/runtime-behavior.test.mjs:119-132`.
- **VERIFIED:** The projection carries a structural `ModuleKirArtifact`, while the non-forgeable brand is private to the projection issuer. Evidence: `packages/core/src/frontend-projection/contracts.ts:49-71`, `packages/core/src/frontend-projection.ts:67-78`, `:362-370`, and `packages/core/src/frontend-projection/verified-brand.ts:1-4`.
- **VERIFIED:** RT-1's accepted program shape is exported `fn`, zero or more typed params, exactly one `handler lang=kern`, and statements `let`, `capability`, `print`, `return` with one final return. Its expressions are canonical KIR identifiers, scalar/list/record literals, members, and one-argument `Json.parse`/`Json.stringify` calls. Evidence: `packages/core/src/kir-runtime/execute.ts:130-229`, `packages/core/src/kir-runtime/expression.ts:75-225`.
- **VERIFIED:** RT-1 currently combines module/export selection and subset admission with in-memory statement/expression evaluation. Evidence: `packages/core/src/kir-runtime/execute.ts:130-270`, `:444-465`, `packages/core/src/kir-runtime/expression.ts:228-276`.
- **VERIFIED:** R0 declares separate private ABI strings, including `kern.compiler.result.r0`, `kern.target.artifact.r0`, and `kern.runtime.kir.r0`. Evidence: `scripts/kern-5-r0-contracts/manifest.json:1`; its fixture oracle expects the `.r0` runtime format. Evidence: `scripts/kern-5-r0-contracts/r0-abi.test.mjs:106-125`, `:146-180`.
- **VERIFIED:** The old semantic `ReferenceRunner` is a TypeScript interpreter over `IRNode` contracts, not a KIR target runtime. Evidence: `packages/core/src/ir/semantics/reference-runner.ts:1-15`, `:24-44`.

**Root cause:** There is no package-owned, versioned JavaScript ESM artifact/compiler boundary for verified canonical KIR. A standalone R2 selector/admitter would also duplicate RT-1's security and semantic decision point. R0 is incompatible private fixture infrastructure, while RT-1 owns direct execution but intentionally does not emit deployable ESM.

## What Already Works

- Verified projection issuance/authentication remains the only producer of compiler input; the linker is the only permitted verified-brand authentication edge and must not recreate, serialize, or weaken the brand.
- RT-1 remains the semantic and behavior reference for the exact subset, including canonical JSON, limits, cancellation, capability events, sequential capability statements, and request isolation. Its public behavior remains unchanged after the linker extraction.
- `@kernlang/core` already publishes separate explicit subpaths, including `./runtime/kir` and `./frontend-projection`; adding a new compiler subpath follows that package pattern. Evidence: `packages/core/package.json:37-59`.
- CLI behavior and commands remain untouched. Evidence: the only core compile script is the existing CLI build/invocation in `packages/core/package.json:96-100`; no R2 CLI requirement exists.

## Clients and Producer-to-Consumer Chain

| Client / path | Status | Chain and evidence | R2 consequence |
|---|---|---|---|
| Projection issuer -> verified brand -> internal linker | LIVE | Issuance/authentication: `packages/core/src/frontend-projection.ts:240-370`; brand facade: `packages/core/src/frontend-projection/verified-brand.ts:1-4`. | The linker is the only allowed brand-auth edge. |
| Internal linker -> RT-1 executor / R2 compiler | LIVE after refactor / NEW production consumer | Current RT-1 selector begins at `packages/core/src/kir-runtime/execute.ts:232-270`; executor begins `:444-465`. | Both consumers accept immutable linked program only; R2 does not inspect raw projection KIR after link. |
| Published `@kernlang/core/runtime/kir` | LIVE public API | Export map: `packages/core/package.json:45-48`; facade exports `executeKernKir`: `packages/core/src/runtime-kir.ts:1-15`. | No breaking modification; R2 targets its v1 request/envelope semantics. |
| RT-1 behavior/import-closure/review tests | LIVE repository validation | Static import enumeration `rg -l "runtime-kir"` found only `packages/core/package.json` and the three `scripts/kern-5-r1-runtime-owner/*.test.mjs` files, run 2026-08-26. | Add old/new RT-1 linker parity before emitted-target tests. |
| `scripts/kern-5-r0-contracts/**` schemas/templates/oracles | DEAD for production; LIVE as conformance fixtures | Static enumeration for `kern.compiler.result.r0|kern.runtime.kir.r0|generateR0AbiArtifacts` returned only `scripts/kern-5-r0-contracts/**`, run 2026-08-26; R0 oracle generator is imported by its test at `scripts/kern-5-r0-contracts/r0-abi.test.mjs:7-16`. | Preserve unchanged as private fixtures. R2 neither imports nor accepts their ABI. |
| `ReferenceRunner` | DEAD for R2 execution; LIVE legacy semantic test utility | It dispatches `IRNode` registry contracts: `packages/core/src/ir/semantics/reference-runner.ts:24-44`. | No generated import/call and no compiler fallback. |
| CLI | LIVE unrelated consumer | Existing invocation is `packages/core/package.json:98-100`; no R2 export or command is present. | No CLI edit, registration, or output format change. |

## Contract (Verified)

> Verified against the files and commands cited above on 2026-08-26. New names below are deliberate R2 contract decisions; they are not claims of pre-existing APIs.

| Field / behavior | Type | Evidence | Tag |
|---|---|---|---|
| Compiler input | `VerifiedKernProjection` object identity in the same JS process | Brand definition `packages/core/src/frontend-projection/contracts.ts:67-71`; authentication `packages/core/src/frontend-projection.ts:362-370` | VERIFIED |
| Semantic input | Direct `projection.artifact` canonical structural KIR; no source text or parser result | RT-1 links `projection.artifact` `packages/core/src/kir-runtime/execute.ts:232-262` | VERIFIED |
| Runtime semantic boundary | `KernKirRequest` -> `KernKirEnvelope`, format `kern.runtime.kir.v1` | `packages/core/src/kir-runtime/contracts.ts:30-43`, `:87-95` | VERIFIED |
| Subset | Exact RT-1 statement/expression admission; unsupported canonical KIR is rejected at compile time | `packages/core/src/kir-runtime/execute.ts:130-229`; `packages/core/src/kir-runtime/expression.ts:75-225` | VERIFIED |
| Linked program | Immutable internal `kern.linked-kir-program.v1` consumed by RT-1 and R2 | R2 decision after the verified Agon brainstorm | DECISION |
| New compiler format | `kern.compiler.kir-js-esm.v1` | R2 decision | DECISION |
| New target artifact format | `kern.target.kir-js-esm.v1` | R2 decision | DECISION |
| Runtime ABI field | Literal `kern.runtime.kir.v1` | Existing public runtime constant `packages/core/src/kir-runtime/contracts.ts:2` | VERIFIED |
| Target | Literal `javascript-esm` | R2 decision; R0 used the target label only as a private fixture `scripts/kern-5-r0-contracts/r0-abi.test.mjs:140-143` | DECISION |
| Host profile | `kern.javascript-esm.node.v1` | R2 decision | DECISION |

### Internal linker contract

The linker is internal, has no package-export-map subpath, and is the sole consumer of the read-only verified-brand facade. It exports only to RT-1 and the R2 compiler implementation:

```ts
export const KERN_LINKED_KIR_PROGRAM_FORMAT = 'kern.linked-kir-program.v1';
export interface LinkedKernKirProgram {
  readonly format: 'kern.linked-kir-program.v1';
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly program: Readonly<...>; // exact frozen RT-1 admitted statements/expressions
  readonly projectionArtifactSha256: string;
  readonly sha256: string;
}
export type LinkKernKirProgramResult =
  | { readonly outcome: 'success'; readonly program: LinkedKernKirProgram }
  | { readonly outcome: 'failure'; readonly code: KernKirLinkCode };
export function linkVerifiedKernKirProgram(
  projection: VerifiedKernProjection,
  entry: { readonly moduleId: string; readonly handlerName: string },
  limits: KernKirLimits,
): LinkKernKirProgramResult;
```

`KernKirLinkCode` is a closed stable union of current link-time v1 codes: `projection-authentication-error`, `handler-entry-not-found`, `handler-entry-ambiguous`, `handler-entry-unsupported`, and `handler-link-error`. It carries no source text, parser AST, or raw KIR bytes. The linker authenticates before every projection property read, then performs exact present RT-1 selection/admission once. It deeply freezes success; `sha256` is canonical serialization of format, entry, admitted program, and projection artifact digest.

### Proposed public compiler surface

`@kernlang/core/compiler/kir-js-esm` exports these values and no CLI entrypoint:

```ts
export const KERN_KIR_JS_ESM_COMPILER_OWNER = 'kern.compiler.kir-js-esm.owner.v1';
export const KERN_KIR_JS_ESM_COMPILER_FORMAT = 'kern.compiler.kir-js-esm.v1';
export const KERN_KIR_JS_ESM_ARTIFACT_FORMAT = 'kern.target.kir-js-esm.v1';
export const KERN_KIR_JS_ESM_HOST_PROFILE = 'kern.javascript-esm.node.v1';

export interface KernKirJavaScriptEsmCompileRequest {
  readonly format: 'kern.compiler.kir-js-esm.v1';
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly limits: KernKirLimits;
}

export type KernKirJavaScriptEsmCompileResult =
  | { readonly format: 'kern.compiler.kir-js-esm.v1'; readonly outcome: 'success'; readonly target: 'javascript-esm';
      readonly artifact: { readonly path: 'entry.mjs'; readonly bytes: Uint8Array; readonly sha256: string };
      readonly manifest: { readonly path: 'manifest.json'; readonly bytes: Uint8Array; readonly sha256: string } }
  | { readonly format: 'kern.compiler.kir-js-esm.v1'; readonly outcome: 'failure';
      readonly code: KernKirJavaScriptEsmCompileFailureCode };
export type KernKirJavaScriptEsmCompileFailureCode = KernKirLinkCode | 'invalid-compiler-request' | 'artifact-emission-failure';

export function compileKernKirToJavaScriptEsm(
  projection: VerifiedKernProjection,
  request: KernKirJavaScriptEsmCompileRequest,
): KernKirJavaScriptEsmCompileResult;
```

The compiler exports exactly the constants, request/result types, failure-code type, and function above; no CLI entrypoint. It returns the closed structured union rather than throws for expected auth/malformed/unsupported inputs so consumers have stable binary outcomes and no partial artifact can resemble success. Unexpected implementation bugs still throw. The compiler has no file-system side effect.

`manifest.json` is canonical UTF-8 JSON with exact keys `artifact`, `artifactFormat`, `canonicalization`, `compilerFormat`, `compilerRequestSha256`, `entry`, `hashAlgorithm`, `hostProfile`, `kernelSha256`, `linkedProgramSha256`, `projectionArtifactSha256`, and `runtimeFormat`. It binds exact output artifact bytes, `kern.target.kir-js-esm.v1`, `kern.canonical-json.v1`, `kern.compiler.kir-js-esm.v1`, the canonical compile-request digest, entry, `sha256`, `kern.javascript-esm.node.v1`, kernel digest, linked-program digest, original projection artifact digest, and `kern.runtime.kir.v1`. Manifest SHA-256 is computed over these exact canonical bytes.

The compile request is exact plain data with `format`, `entry`, and all seven positive `KernKirLimits` fields. Those limits meter authentication-adjacent request inspection and linking only; they are caller policy and never hardcoded. They do not replace the independently supplied runtime limits in each emitted-module execution request. Unknown/accessor/symbol fields fail with `invalid-compiler-request` before linking. `compilerRequestSha256` covers the canonical inspected request, so admission policy and entry selection remain auditable even when two requests produce the same target bytes.

`entry.mjs` is self-contained ESM with empty static and dynamic import graph. It exports exactly `format`, `manifest`, and async `execute(input, executionOptions?)`; `execute` accepts the exact RT-1 v1 request shape and returns the exact v1 envelope shape. The emitted statements/expressions are specialized to the linked program. The fixed target kernel provides v1 request inspection, tagged values, KERN JSON, limits, deadline/cancellation, sequential capability calls, and envelopes; it does not select/link arbitrary KIR, parse source, dispatch a KIR/IR registry, or interpret a general program, so it is not an interpreter.

The compiler validates the verified brand only through the linker before inspecting KIR. It lowers only canonical nodes already admitted by RT-1, uses stable `__k` plus base-36 ordinal local names rather than raw KIR identifiers, and canonically escapes all emitted string text. KERN records are null-prototype records (`Object.create(null)`) with entry arrays, KERN JSON is tagged-record based and must reject duplicate/dangerous host-object paths, and host `JSON.parse`/`JSON.stringify` are forbidden for KERN semantics. The profile permits only Node ESM standard operations plus `AbortController`, `TextEncoder`, and required timers; it forbids import/require/eval/Function/process/I-O/network, parser/emitter/ReferenceRunner/runtime imports, R0 identifiers, and prototype-bearing KERN records.

This slice is acyclic: no loops, recursion, regex, or concurrent-capability scheduler. Capability statements execute sequentially. Synchronous work is statically bounded by linked-program size and step checks at the same RT-1 statement/expression boundaries. Neither RT-1 nor emitted JavaScript can preempt synchronous work; cancellation is guaranteed only at those boundaries and while a capability remains unresolved. Each `execute` call has isolated bindings, meters, deadline state, and event buffer. Self-contained artifacts cannot be package-hot-patched: a kernel security revision requires recompilation/revocation, and `kernelSha256` is part of manifest and telemetry identity.

## Implementation Options

### A. Shared internal linker plus specialized target kernel — recommended

Extract one authenticated immutable linked program from RT-1, make RT-1 execute it, and make R2 emit specialized ESM plus the constrained JavaScript target kernel. This offers a public artifact ABI while preserving R0 only as evidence and preserves one security/semantic selector.

**Confidence:** 0.87. Current authority/subset evidence is verified; linker refactor, kernel, and differential obligations are intentionally explicit.

### B. Promote R0 `kern.compiler.result.r0` and templates

Reject. R0's compiler/runtime/target strings are explicitly `.r0`, are script-scoped, and R0 creates fixture KIR from parser/source for oracle use (`scripts/kern-5-r0-contracts/r0-abi-test-kir.mjs:142-160`). Promotion would make a private test ABI public and violate same-process verified input plus direct-canonical-KIR requirements.

**Confidence:** 0.99 that this is incompatible with the requested contract.

### C. Call RT-1 or expose a source/TypeScript transpilation route

Reject. RT-1 import violates self-contained target isolation; a source route duplicates frontend/parser authority and cannot prove it lowered the authenticated canonical artifact. A general generated interpreter would reintroduce an unbounded selector/dispatcher.

**Confidence:** 0.99.

## Implementation Plan

1. Extract exact RT-1 selection/admission into internal immutable `linked-kir-program` modules, auth-before-read, with old/new RT-1 parity; keep every handwritten file below 500 lines.
2. Refactor RT-1 executor to consume linked programs while preserving public request/envelope/diagnostic/effect behavior and its import closure.
3. Add compiler export, closed result union, canonical digest-bound manifest, and pure no-I/O deterministic emitter.
4. Emit specialized acyclic statements/expressions plus constrained JavaScript KERN kernel: null-prototype tagged records, no host JSON, stable identifier escaping, sequential capabilities, and boundary-only charging/cancellation.
5. Build RED-at-base anti-fake/differential gates; pass RT-1 old/new parity, R0 gates, typecheck, build, and independent review before release.

## Blast Radius

| File / area | Action | Reason |
|---|---|---|
| `packages/core/package.json` | Modify | Add only `./compiler/kir-js-esm` export. |
| `packages/core/src/kir-runtime/linked-kir-program/**` | Add | One internal authenticated selector/admitter and immutable digest-bound program. |
| `packages/core/src/kir-runtime/execute.ts` and expression support | Refactor | RT-1 consumes linked program while preserving public behavior. |
| `packages/core/src/compiler/kir-js-esm/**` | Add | Public contract, manifest, specialized lowering, and target kernel; each handwritten file under 500 lines. |
| `packages/core/tests/{linked-kir-program,kir-js-esm}*.test.*` | Add | Parity, auth, determinism, differential, and anti-fake oracle. |
| `scripts/kern-5-r2-js-lowering/**` | Add only if needed for independent black-box ESM loading | Avoid coupling oracle to R0 internals. |
| `packages/core/src/kir-runtime/**` | Targeted refactor | Preserve RT-1 public behavior while extracting its linker. |
| `scripts/kern-5-r0-contracts/**` | No change | Private R0 formats remain conformance fixtures, not ABI. |
| `packages/cli/**` | No change | CLI is explicitly out of scope. |

## Acceptance Criteria

These are binary RED-oracle criteria. Every fixture is constructed from a verified projection and dynamic request/provider values; none relies on an ASSUMED or OPEN claim.

- [ ] An auth-before-read proxy proves linker authentication precedes every projection property get, iteration, byte read, or artifact-digest work; clones/reconstructions/tampering return `projection-authentication-error`, no artifact bytes, and no effects.
- [ ] For every RT-1 fixture, old RT-1 and extracted-linker/new-RT-1 paths yield byte-identical v1 envelopes, diagnostics, event order, provider calls, cancellation effects, and rejection codes; existing RT-1 behavior/import-closure/review gates remain green.
- [ ] The linker yields a deeply frozen `kern.linked-kir-program.v1` only for the exact current RT-1 acyclic subset, with reproducible canonical digest and no source/AST/raw-KIR/brand-issuance capability.
- [ ] Two compilations of one verified projection/exact request produce byte-identical `entry.mjs` and `manifest.json`; compiler-request, artifact, manifest, projection-artifact, linked-program, and kernel SHA-256 bindings independently recompute from returned bytes/canonical data.
- [ ] A fresh isolated Node process loads emitted ESM with empty import graph and executes fresh runtime values, fresh provider replies, and novel valid KIR; output varies by semantics rather than fixture strings/transcripts.
- [ ] Differential fixtures compare emitted ESM with refactored RT-1 for exact subset success and errors, malformed request, provider/result failure, tagged KERN JSON edge cases, every limit family, pre-cancel, external abort, timeout, and out-of-order concurrent `execute` calls.
- [ ] Generated code uses null-prototype tagged records/entry arrays and rejects duplicate/dangerous KERN JSON host-object paths; it contains no host `JSON.parse`/`JSON.stringify`, raw KIR identifiers, import/require/eval/Function/process/I-O/network, parser/emitter/ReferenceRunner/runtime/R0 dependency, KIR-authored loop/recursion/regex, or concurrent-capability scheduler. Bounded loops inside the fixed JSON/value/inspection kernel are permitted and metered.
- [ ] Synchronous work is bounded by linked-program size and charged at the same RT-1 statement/expression boundaries. Tests establish that cancellation cannot preempt synchronous JavaScript in either backend, but is delivered at those boundaries and while a capability is unresolved; capabilities execute sequentially and every `execute` call is isolated.
- [ ] Mutation tests fail for RT-1 fallback, generic dispatcher, fixture output, skipped auth, source/parser fallback, host JSON, prototype-bearing records, omitted limit/cancellation charge, missing manifest binding, kernel-digest mismatch, and cross-request state leakage.
- [ ] R0 compiler/result/target/runtime formats are rejected at R2 ingress and unchanged R0 conformance gates pass. Compiler result union is exhaustive and has exact code/field behavior; it writes no files and creates no CLI command.

## Mutation Traps

| Mutation | Oracle that must fail |
|---|---|
| Duplicate RT-1 selection/admission in the emitter | Linked-program consumer-only test and old/new RT-1 parity gate. |
| Replace generated `execute` with an import/call to `executeKernKir` | Empty isolated-process import graph and monkey-patched RT-1 test. |
| Add a generic KIR/IR dispatcher to the artifact | Static forbidden-construct test plus specialized-program shape test. |
| Embed known `expectedJsonText` or capability replies | Novel KIR/input/provider test and forbidden-fixture-string scan. |
| Lower source or call a parser before reading KIR | Projection-only compile input and forbidden-import test. |
| Accept a cloned/raw reconstructed projection | Brand clone/tamper rejection test. |
| Treat R0 `.r0` manifest/request as compatible | Negative R0-format admission test. |
| Sort or escape generated output nondeterministically | Twin-compile byte/SHA and exact-manifest test. |
| Use host `JSON.parse`/`JSON.stringify` or prototype-bearing records | Tagged KERN JSON/canonical edge differential and null-prototype assertion. |
| Omit projection/link/kernel manifest binding | Independent canonical manifest recomputation and telemetry-identity test. |
| Delay validation until after capability invocation | Unsupported-KIR/no-provider-call test. |
| Reuse request state across generated executions | Out-of-order concurrent capability completion test. |
| Drop one limit/cancellation path | Parameterized limit, timeout, pre-cancel, and external-signal witnesses. |
| Add loop/recursion/regex/concurrent capability execution | Static constrained-slice scan and sequential-capability oracle. |

## Out of Scope

- A source-to-JavaScript compiler, parser changes, TypeScript codegen reuse, CLI command, file writer, package release, or deployment automation.
- Any KIR surface beyond the exact RT-1 acyclic subset, including loops, recursion, regex, branches, classes, imports, arbitrary calls, optional calls, extra intrinsics, or concurrent-capability scheduling.
- Changing RT-1 public behavior, claiming synchronous cancellation preemption, or treating its implementation as an emitted-runtime dependency.
- Publishing, migrating, or accepting R0 ABI formats; private R0 files remain conformance fixtures only.
- A generic multi-target artifact framework. Python remains an independent backend only when cross-backend differential fixtures are added; it is not an R2 implementation dependency.

## Deploy Order

1. **RT-1 linker refactor first:** validate/ship internal old/new linker parity while preserving the published v1 runtime and `VerifiedKernProjection` producer contract. No R2 artifact is authoritative before this gate is green.
2. **R2 second:** publish the new compiler subpath with a distinct v1 compiler/target format. Existing consumers are unaffected because this adds a subpath and R0 has no supported production ABI.
3. **Consumers third:** compile verified projections with R2 and deploy emitted modules. During skew, pre-R2 consumers continue RT-1; emitted R2 modules carry the v1 runtime binding but do not import a skewed runtime package. A kernel security revision requires artifact recompilation/revocation, not a package hot patch. R0 remains fixture-only.

## Open Questions

None. API/module names, exact manifest fields, host profile, closed result policy, and slice constraints are deliberate R2 decisions, not unverified claims. There are no ASSUMED or OPEN blockers.

## Pre-implementation Challenge

The parent ran Agon brainstorm `/Users/nicolascukas/.agon/runs/brainstorm-1787766446314-ntkjcr-kern5-r2-js-lowering`; all three usable engines rejected duplicated selector/admission and converged on one authenticated versioned linked-program boundary consumed by RT-1 and R2. Nero then constrained the slice in `/Users/nicolascukas/.agon/runs/nero-1787766636417-qcq741`.

**Challenge delta:** replace independent R2 admission with internal `kern.linked-kir-program.v1`; make old/new RT-1 parity a gate; separate specialized emitted operations from fixed target semantic kernel; bind projection/link/kernel hashes and telemetry identity; prohibit cycles/regex/concurrent scheduling; state boundary-only cancellation and recompilation/revocation for kernel revisions. R0 remains private evidence only.

The focused gate was then executed on the exact stacked base under Node 22. Core built successfully and the first semantic owner-discovery test failed with `KIR_JS_ESM_OWNER_MISSING`, before any future module import or behavior suite. This is RED for the intended missing production-owner reason.

**Revised confidence:** 0.91. The full-roster brainstorm, focused Nero challenge, source verification, and discriminating RED-at-base oracle resolved the architectural dependencies. No OPEN/ASSUMED blocker remains; implementation may proceed only with the stated differential and parity gates.

## Corrections Log

| Original claim | Reality | Impact |
|---|---|---|
| R0 could be the production artifact ABI to extend. | R0 uses `kern.compiler.result.r0`, `kern.target.artifact.r0`, and `kern.runtime.kir.r0` only under `scripts/kern-5-r0-contracts`. | New independent R2 formats; R0 is negative/conformance evidence only. |
| A lowerer could accept decoded KIR bytes. | RT-1's authority boundary is a same-process authenticated `VerifiedKernProjection`, and raw/reconstructed objects are intentionally rejected. | Compiler input is branded projection identity, never raw bytes. |
| Calling RT-1 from generated ESM would be a valid shortcut. | RT-1 is a direct interpreter and the R2 requirement is generated semantic implementation without runtime fallback. | Generated code must be self-contained and static closure is an acceptance gate. |
| R2 could keep a second selector/admitter. | Agon brainstorm found selector divergence is the primary semantic/auth risk. | One authenticated internal linked program feeds both RT-1 and R2. |
| Cancellation could interrupt arbitrary synchronous JavaScript. | Nero confirmed neither RT-1 nor emitted JS can preempt synchronous work. | Bound/charge sync work at RT-1 boundaries; deliver cancellation there or during unresolved capability only. |
| A security fix to the package would patch deployed artifacts. | Self-contained ESM embeds its kernel. | Kernel digest is manifest/telemetry identity; security revisions require recompilation/revocation. |
