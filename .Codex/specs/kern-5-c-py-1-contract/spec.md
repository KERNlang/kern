# C-PY-1 Package-Owned KIR-to-Python Lowering

**Status:** READY TO BUILD — OWNER RED AT BASE
**Date:** 2026-08-27
**Confidence:** 0.92

## Executive Summary

C-PY-1 adds a production-owned Python target after the linked-KIR predecessor
stack lands. The owner is proposed as the Core package subpath
`@kernlang/core/compiler/kir-python`; it accepts the same authenticated
projection and bounded compile request as the JavaScript v1 lowerer, links one
RT-1 program, and deterministically returns `entry.py` and `manifest.json`.
The emitted Python exposes the Python-native asynchronous boundary
`async def execute(input, execution_options=None)`; C-PY-1 owns neither
stdin/stdout framing nor scheduler/semantic authority beyond its emitted KERN
kernel.

## Current State / Root Cause

- **VERIFIED:** this worktree is exactly `origin/main` at
  `aae0a0fe44b1aaba88addcb1995cd66e2af2254d` (`git rev-parse HEAD` and
  `git rev-parse origin/main`, 2026-08-27).
- **VERIFIED:** Core has no `./compiler/kir-python` export, source facade,
  built facade, or internal `compiler/kir-python` directory (the base owner
  oracle below and `test -e` checks, 2026-08-27).
- **VERIFIED:** this base also lacks the R1/R2 package files
  `compiler-kir-js-esm.ts`, `compiler/kir-js-esm/`,
  `runtime-kir.ts`, and `kir-runtime/linked-kir-program/` (`test -e` checks,
  2026-08-27). They are predecessor-stack inputs, not claims about
  current `origin/main`.
- **VERIFIED (candidate, not this base):** the parent reviewed the R1/R2
  candidate at `fa143aaebbb08bc99f15bf2fc8a4125e53aab679` and its JS owner sources
  `packages/core/src/compiler-kir-js-esm.ts` and
  `packages/core/src/compiler/kir-js-esm/{contracts,request,index,emitter}.ts`.
  The full-roster capability-ABI brainstorm is recorded at
  `/Users/nicolascukas/.agon/runs/brainstorm-1787829557988-oouihx-c-py-1-capability-abi`
  (6/6). Those are decision evidence only; they do not change this base's
  absence facts.

## What Already Works

- **VERIFIED:** `packages/core/package.json` already uses package subpath
  export pairs with `types` and `default` targets (`packages/core/package.json:8-61`).
- **VERIFIED:** Core already distinguishes Python as a target family, but this
  is source-transpiler/capability metadata, not a KIR artifact owner
  (`packages/core/src/generated/utils/import-metadata.ts:5-38`).

## Contract

> The linked-KIR and JS-v1 APIs are intentionally post-predecessor inputs. No
> table row below represents an already-present R1/R2 owner on this base.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Public owner | `@kernlang/core/compiler/kir-python`, exported from Core rather than `@kernlang/python` | User scope; Core subpath pattern | DECISION |
| Facade targets | `src/compiler-kir-python.ts` → `dist/compiler-kir-python.{js,d.ts}` | Existing Core export-pair pattern | DECISION |
| Constants | `kern.compiler.kir-python.owner.v1`, `kern.compiler.kir-python.v1`, `kern.target.kir-python.v1`, and host profile `kern.python.asyncio.v1` | Parent capability-ABI decision from R1/R2 candidate and 6/6 brainstorm | DECISION |
| Compiler call | `compileKernKirToPython(projection, request)` accepts `VerifiedKernProjection` and the linked-KIR predecessor | Parent decision; absent predecessor paths on base | DECISION |
| Exact request | `{ format, entry, limits }`; entry has `moduleId` and `handlerName`; limits are exactly `maxBytes`, `maxCollectionLength`, `maxDepth`, `maxDiagnostics`, `maxEvents`, `maxSteps`, `maxStringBytes`, each positive safe integers | User scope | DECISION |
| Link/auth | Inspect the exact compiler request first; the linked-KIR linker then authenticates the projection before any projection read. Preserve link failures rather than parse or interpret generic KIR | Parent capability-ABI decision | DECISION |
| Success result | Deterministic `target: 'python'`, `entry.py`, `manifest.json`; manifest keys exactly mirror JS v1: `artifact`, `artifactFormat`, `canonicalization`, `compilerFormat`, `compilerRequestSha256`, `entry`, `hashAlgorithm`, `hostProfile`, `kernelSha256`, `linkedProgramSha256`, `projectionArtifactSha256`, `runtimeFormat` | Parent decision from JS-v1 candidate | DECISION |
| Artifact boundary | Python source exports `async def execute(input, execution_options=None)`. Exact options keys are `invoke` and `signal`; signal is `asyncio.Event` | Parent capability-ABI decision | DECISION |
| Runtime request | Exact `kern.runtime.kir.v1` request includes `control: { preCancelled, timeoutMs }`; `timeoutMs` is `null` or a positive safe timer delay | R1/R2 candidate parity | DECISION |
| Provider call | `invoke` receives an exact mapping with keys `namespace`, `operation`, `input`, and `signal`; `signal` is the internal `asyncio.Event`; the provider may return a slot or awaitable slot | Parent capability-ABI decision | DECISION |
| Differential driver | A trusted temporary test driver imports `entry.py` and calls native `execute`; C-PY-1 defines no stdio protocol or harness | Parent decision | DECISION |
| Dependency closure | `entry.py` runs from a clean temporary root with Python standard-library imports only; no Core/package/repository-relative import | User scope | DECISION |
| CI proof floor | CPython 3.12 proves this slice; the host-profile string intentionally contains no interpreter version and makes no other-version claim | Parent capability-ABI decision | DECISION |

## Required RT-1 Semantics

The first executable witness is one exported handler with `text: text` and
`labels: list<text>` parameters. It must: parse `text` using KERN JSON rules,
invoke one absent-input capability (`fixture.resolve`), create a record with
`labels`, parsed payload, and reply, stringify it canonically, emit one stdout
event, and return the string. This single witness requires the post-predecessor
linked expressions (identifier, literal, list, record, JSON call) and
statements (let, capability, print, return), ordered effects, type validation,
and exact envelope-byte accounting. **DECISION:** expansion beyond that linked
RT-1 set is a later slice, never a generic KIR interpreter fallback.

## Execution and Cancellation Contract

- **DECISION:** `execute(input, execution_options=None)` admits exactly the
  `invoke` and `signal` option keys. The latter is an `asyncio.Event`; the
  emitted kernel creates a distinct internal event for providers.
- **DECISION:** exact request inspection occurs first. The compiler-side linker
  authenticates projection before any projection read. At execution time,
  `preCancelled` is checked after inspection/link and before any provider
  effect; a missing provider for a capability yields `capability-error` with no
  fabricated capability event.
- **DECISION:** cancellation/deadline checks are cooperative before every
  statement, immediately before provider invocation, immediately after a
  provider result, before each event append, before success-envelope byte
  measurement, and before return.
- **DECISION:** an already-set external signal fails before any provider
  effect. Otherwise a watcher propagates it to the internal event. Each
  checkpoint tests the monotonic deadline first, so an expired deadline is
  `execution-timeout`; only a still-live deadline can report
  `execution-cancelled` from the external signal.
- **DECISION:** append a capability event only after provider-result validation;
  append stdout only after text validation. Events remain in authored statement
  order and failed statements do not append a prospective event.
- **DECISION:** for an awaitable provider, race its task against the internal
  signal. On cancellation/timeout, best-effort cancel the provider task without
  awaiting a non-cooperative task, return the failure envelope, and append no
  post-cancel event. A synchronous/blocking provider cannot be preempted; check
  cancellation immediately after it returns. The emitted target claims no
  scheduler or semantic authority beyond the emitted KERN kernel.

## Implementation Plan

Implement only after the linked-KIR/JS-v1 predecessor stack is available:

1. Add the full semantic, cancellation, manifest, and clean-root oracles first;
   prove they fail on the stacked predecessor for the intended missing Python
   owner/behavior, not for a stale build or missing dependency.
2. Add the Core subpath facade, contracts, bounded request inspector, and
   compile entry point.
3. Consume the authenticated linked program and emit specialized Python source,
   never a parser, projection issuer, or generic KIR dispatch loop.
4. Add a trusted temporary Python driver that imports `entry.py` and calls its
   native `execute`; do not add any stdio protocol or harness in C-PY-1.
5. Prove clean-root execution, no package imports, deterministic bytes and
   manifest bindings, provider/error/cancellation behavior, and RT-1 parity.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/package.json` | Modify later | Public Core subpath |
| `packages/core/src/compiler-kir-python.ts` | Add later | Narrow package facade |
| `packages/core/src/compiler/kir-python/*` | Add later | Contract, validation, specialized Python emitter/runtime kernel |
| `scripts/kern-5-c-py-1-contract/*` | Add | Owner, behavior, closure, and harness oracles |
| `.Codex/specs/kern-5-c-py-1-contract/spec.md` | Add now | Claim-tagged predecessor-aware contract |

## Acceptance Criteria

- [x] The boundary-only RED-at-base oracle permanently asserts the exact
  missing-owner error, requires the unique export and source facade, and fails
  current main with
  `KIR_PYTHON_OWNER_MISSING: @kernlang/core does not export ./compiler/kir-python`.
- [ ] Before production code, stacked semantic oracles fail for the intended
  missing Python owner/behavior and cannot pass from an export-map/source stub.
- [ ] Core exports exactly one Python KIR owner after build, with matching source
  and built facades.
- [ ] The compiler accepts only the exact seven-limit request shape; its linker
  authenticates projection before any projection read.
- [ ] A deterministic compilation produces only `entry.py` and `manifest.json`
  with bound digests and Python target identity.
- [ ] The representative RT-1 program preserves return value, ordered
  capability/stdout events, result validation, and envelope byte boundary.
- [ ] Pre-cancellation after inspection/link and cancellation at every
  cooperative checkpoint produce no later provider/event effect; missing
  provider yields `capability-error`; an awaitable provider is best-effort
  cancelled without awaiting a non-cooperative task.
- [ ] Emitted Python executes from a clean root without package/repository
  imports through a trusted temporary native-execute driver.

## Out of Scope

No compiler implementation, package export, current Core build, R1/R2 changes,
generic KIR interpreter, any stdin/stdout protocol or harness, commit, push, or
merge belongs in this design-only slice. A later CLI-shadow slice must
claim-tag and version any stdio framing.

## Open Questions

None for C-PY-1. A later CLI-shadow slice owns any versioned stdio framing.

## Pre-implementation Challenge

**Initial confidence:** 0.80. The initial draft left host identity,
cancellation representation, and a separate harness protocol open.

**Challenge evidence:** parent decisions were grounded in the R1/R2 candidate
at `fa143aae` and full-roster capability-ABI brainstorm
`brainstorm-1787829557988-oouihx-c-py-1-capability-abi` (6/6).

**Plan delta:** select Python-native `asyncio.Event` options/provider signals,
the exact Python constants and CPython 3.12 proof floor, and option A: native
temporary-driver execution with no C-PY-1 stdio harness. The resolved boundary
removes an artifact-wire concern rather than deferring it into implementation.

**Final confidence:** 0.92. The predecessor landing order remains a known
dependency, not an implementation-contract OPEN.

## Deploy Order

Land the linked-KIR/JS-v1 predecessors first, then this Core Python owner and
its public export in one compatible change. Before that export exists, consumers
receive the explicit missing-owner condition; no mixed-version fallback to the
legacy Python source transpiler is permitted.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Current `origin/main` already has R1/R2 package paths | The requested base predates all of them | Mark predecessor-dependent rows DECISION; do not cite absent files as live APIs |
| C-PY-1 must define a versioned stdio harness | Native artifact execution has a complete `asyncio` ABI; a temporary trusted driver suffices | Move stdio framing to later CLI-shadow scope and remove the blocking OPEN |
| Projection must authenticate before compiler request inspection | Request admission is projection-independent; linker auth protects all projection reads | Correct ordering and pre-cancel checkpoint in the execution contract |
