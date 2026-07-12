# KERN 5 R1.4a Internal Semantic KIR Reader Candidate

**Status:** IMPLEMENTED - LOCAL CLOSURE GREEN; CI WITNESS PENDING
**Date:** 2026-07-11
**Confidence:** 0.91
**Depends on:** R1.3 commit `865259bd170fa25a2f99595832c89068b4630b4d`
**Tribunal:** `tribunal-1783807287722-v7hu7w`
**Brainstorm:** `brainstorm-1783807508049-eafzlh`

**Closure evidence:** `pnpm test:kern-ir-reader-candidate` passed 36/36,
`pnpm test:kern-ir-probe` passed 20/20, the core package suite passed, and the
complete `pnpm fitness:kern-5` wall passed on 2026-07-11. Full usable-roster
Agon closure review `review-1783811534519-9yatg0` completed with the full 6/6
usable roster and returned zero verified findings. Linux CI remains the
post-push environment witness.

## Executive Summary

R1.4a promotes the proven R1.3 strict semantic-KIR reader from a release
probe into browser-safe core source without declaring KIR v1 frozen and without
adding a package export. The core candidate accepts exactly the existing
`kern.semantic-kir.probe.1` envelope, re-encodes it to canonical bytes, and is
parity-locked to the probe over valid, hostile, and mutated fixtures.

The originally planned broad R1.4 freeze is split. R1.4b must first prove a
non-circular semantic owner over this reader candidate; R1.5 may then freeze
only KIR/value/diagnostic/trace/handler/capability contracts whose ownership and
portable value spaces are proven. Existing source execution remains primary.

## Current State / Root Cause

1. R1.3 selected typed semantic KIR and implemented a strict reader under
   `scripts/kir-seam-probe/`, but that code is release tooling rather than core
   runtime source (`scripts/kir-seam-probe/model.mjs:1-417`,
   `canonical.mjs:1-30`). **VERIFIED**
2. The selected probe deliberately covers seven node kinds only: `fn`, `param`,
   `handler`, `return`, `let`, `capability`, and `print`
   (`scripts/kir-seam-probe/model.mjs:15`). **VERIFIED**
3. The runtime still consumes open `IRNode` trees and dispatches through
   `referenceRunSequence`; it has no typed KIR reader boundary
   (`packages/core/src/ir/semantics/reference-runner.ts:13-72`). **VERIFIED**
4. Current `Trace` values are a differential comparison surface containing
   `unknown`, `RegExp`, `Map`, `Set`, and `undefined`, not a frozen wire ABI
   (`packages/core/src/ir/semantics/trace.ts:15-61,81-146`). **VERIFIED**
5. Current capability values accept any finite JavaScript number, while the KIR
   probe distinguishes textual safe integers, negative zero, and decimals
   (`packages/core/src/runner-capabilities.ts:3-13,265-279`;
   `scripts/kir-seam-probe/model.mjs:3-13`). **VERIFIED**
6. `@kernlang/core` has no KIR subpath export (`packages/core/package.json`,
   `exports` object, verified 2026-07-11). **VERIFIED**

The root problem is sequencing: freezing all runtime-facing ABIs before
semantic ownership and portable value convergence would turn current host
implementation details into a public promise. R1.4a therefore creates only the
production-core reader seam needed for the ownership proof.

## What Already Works

- The probe reader rejects unknown versions, exact-shape violations, hostile
  records, unsafe numeric forms, invalid locations, graph inconsistencies, and
  non-canonical ordering. R1.3 passed 20/20 focused checks and the complete
  `fitness:kern-5` wall. **VERIFIED** by R1.3 closure evidence.
- Core package tests import internal `src` modules directly, so an unexported
  candidate can be exercised without widening the npm surface
  (`packages/core/tests/ir-semantics-capability.test.ts:1-6`). **VERIFIED**
- The browser-safe runner spine already avoids Node-only and TypeScript imports;
  the candidate can preserve that constraint by using no external imports
  (`packages/core/tests/runner-entry-import-graph.test.ts:1-24`). **VERIFIED**

## Contract

> Verified against the cited source on 2026-07-11.

| Behavior | Candidate contract | Evidence | Tag |
|---|---|---|---|
| Accepted format | Exactly `kern.semantic-kir.probe.1` | `scripts/kir-seam-probe/model.mjs:1` | VERIFIED |
| Node surface | Exactly the seven R1.3 node kinds and their closed parent/field shapes | `model.mjs:15-52` | VERIFIED |
| Value surface | Closed tagged null/bool/text/int/negative-zero/decimal/regex/list/record/expression values | `model.mjs:3-13,107-198` | VERIFIED |
| Reader behavior | Parse bytes, reject malformed/non-canonical input, return a validated immutable-by-convention value or typed error | R1.3 strict-reader behavior | VERIFIED design decision |
| Canonical bytes | Recursive code-point key order, semantic array order, UTF-8 JSON, one terminal newline | `canonical.mjs:3-30` | VERIFIED |
| Probe parity | Core and probe accept/reject the same corpus and emit byte-identical canonical output | R1.4a acceptance criterion | VERIFIED design decision |
| Runtime effects | Reader performs no execution, capability call, output, mutation of caller input, or source fallback | R1.4a acceptance criterion | VERIFIED design decision |
| Public API | No `package.json` export and no root/runner barrel export | current package surface and tribunal verdict | VERIFIED design decision |

## Implementation Options

### A - Broad ABI freeze before ownership

Freeze KIR, runtime value, diagnostic, trace, handler, and capability v1 now.
Rejected: current trace/capability values conflict with the selected KIR value
model, and semantic ownership remains unresolved. Tribunal confidence favored
rejection.

### B - Internal reader candidate, then ownership, then eligible freezes

Port only the strict reader/canonicalizer into core, parity-lock it to the probe,
and keep it unexported. R1.4b consumes this seam for the ownership proof; R1.5
freezes only proven contracts. Recommended by the tribunal and all six
brainstorm engines.

### C - Combine reader, ownership, and runtime convergence

Rejected: it couples contract shape and execution semantics into one rollback
unit and makes failure attribution ambiguous.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/kir-reader-candidate/types.ts` | add | Closed candidate types and constants |
| `packages/core/src/kir-reader-candidate/reader.ts` | add | Strict validation and reader |
| `packages/core/src/kir-reader-candidate/canonical.ts` | add | Deterministic canonical bytes |
| `packages/core/tests/kir-reader-candidate.test.ts` | add | Valid, hostile, mutation, atomicity, and no-export tests |
| `scripts/check-kir-reader-candidate.mjs` | add | Probe/core parity gate against built core |
| `package.json` | modify | Add internal release gate command only |
| fitness policy/tests | modify | Promote the candidate gate without claiming KIR v1 |
| release train/support matrix | modify | Record the split sequence and truthful status |

No handwritten file may exceed 500 lines. `packages/core/package.json` exports,
`packages/core/src/index.ts`, and `runner.ts` remain unchanged.

## Acceptance Criteria

- [x] Core accepts every valid R1.3 probe fixture and emits byte-identical
      canonical bytes.
- [x] Core and probe reject the same mutation corpus, including unknown format,
      missing/extra fields, unknown tags/node kinds, unsafe integers,
      noncanonical decimals/regex flags, hostile records, invalid locations,
      duplicate bindings/exports, graph cycles, and missing exports.
- [x] Reader rejects non-canonical input bytes after validation and never
      silently normalizes caller input.
- [x] Rejection occurs before any callback, capability, output, or runtime
      execution surface can be invoked; the reader accepts no such dependency.
- [x] Locale/timezone subprocesses produce identical canonical bytes.
- [x] Candidate source and its complete static graph import no Node builtin,
      TypeScript, parser, runner, capability, or runtime module.
- [x] `@kernlang/core` root, runner, browser, and package subpath exports do not
      expose the candidate.
- [x] `pnpm test:kern-ir-reader-candidate`, `pnpm test:kern-ir-probe`, core
      build/tests, lint, and the complete `pnpm fitness:kern-5` wall pass.

## Out of Scope

- Renaming the probe format to `kir.v1` or making compatibility promises.
- A public `@kernlang/core/kir-v1` export.
- Producing KIR from arbitrary source beyond the R1.3 probe writer.
- Executing KIR or changing `executeKernSource*` behavior.
- Freezing runtime value, diagnostic identity, trace, handler, capability,
  timeout, cancellation, or error ABIs.
- Proving semantic ownership; that is R1.4b.
- Production resource ceilings for arbitrarily deep valid candidate trees. The
  probe and candidate currently share recursive validation; R1.5 must replace
  that inherited behavior with a deterministic, config-governed resource
  policy before any public freeze.

## Deploy Order

R1.4a stacks on R1.3 and ships only as repository-internal source and release
gates. No npm consumer sees a new export, so mixed 4.5/R1.4a installations have
no API skew. R1.4b may revise the candidate only by updating the core/probe
parity corpus atomically. Public export remains blocked until the post-ownership
freeze passes.

Rollback is deletion of the internal candidate and its gate. The R1.3 probe and
all 4.5 source runtime paths remain intact.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| R1.4 can freeze KIR/runtime/handler/capability contracts before R1.5 | The selected KIR is partial, trace and capability value models diverge, and ownership is unresolved | Split reader candidate, ownership proof, and ABI freeze into R1.4a/R1.4b/R1.5 |
| A shadow-only public `kir-v1` export is harmless | A public export becomes a compatibility promise even if no runtime consumes it | Keep the candidate internal and unexported |
