# KERN 5 R2/M3.6 Private Effect-Machine Convergence

**Status:** DONE
**Date:** 2026-07-13
**Confidence:** 0.98

## Executive Summary

M3.6 introduces the first real single-engine slice for the private runtime
envelope. A closed flat-statement corpus will execute through one resumable
semantic/effect machine with separate sync and async drivers; capability calls
are yielded as explicit effect requests and resumed with provider results. Raw
pre-normalization traces prove convergence. Existing runners remain only as an
explicit whole-program fallback for nodes outside this first corpus.

This is spec-first because the change crosses semantic dispatch, capability
dispatch, scheduler behavior, and release-containment contracts. Tribunal
`tribunal-1783898644869-bfj413-kern5-m3-6-next-slice` selected this slice before
bounded module linking, value widening, or public ABI promotion. **VERIFIED**

## Current State / Root Cause

- The sync internal envelope invokes `referenceRunSequence`, while the async
  envelope invokes `asyncReferenceRunSequence`.
  (`packages/core/src/runtime-envelope/execute.ts:27-67`) **VERIFIED**
- The async runner documents itself as a mirror, duplicates handlers for
  multiple statement/control types, and silently calls `referenceRun` for its
  remaining node path.
  (`packages/core/src/ir/semantics/async-reference-runner.ts:74-117`) **VERIFIED**
- Envelope normalization keeps stdout, stderr, and capability events but drops
  assign, call, iteration, enter, and exit events. Envelope-byte equality alone
  therefore cannot prove raw semantic-trace equality.
  (`packages/core/src/runtime-envelope/normalize.ts:88-139`) **VERIFIED**
- The current capability contract combines request preparation, sync provider
  dispatch, result binding, and trace production in one effect function.
  (`packages/core/src/ir/semantics/capability.ts:111-160`) **VERIFIED**
- Typed handler calls already create a fresh root environment with no linked
  functions or classes and a fresh `runnerCallCache`.
  (`packages/core/src/runtime-envelope/handler-entry.ts:110-138`) **VERIFIED**
- The complete KERN 5 fitness wall, including the 45-test focused runtime wall,
  passed at `305761e7` on 2026-07-13. (`pnpm fitness:kern-5`) **VERIFIED**

## What Already Works

- M3.1-M3.5 already provide transactional normalization, typed arguments,
  bounded source-handler identity, capability interception, and scheduler
  cancellation/timeout. None of those contracts needs redesign. **VERIFIED**
- The contract registry remains the semantic authority for synchronous pure
  node effects; the new machine may dispatch eligible non-capability nodes
  directly through registered contracts without calling either sequence
  runner. (`packages/core/src/ir/semantics/reference-runner.ts:24-71`)
  **VERIFIED**
- `Trace` already represents ordered events plus completion and provides
  structural equality before envelope normalization.
  (`packages/core/src/ir/semantics/trace.ts:45-151`) **VERIFIED**
- The M3.5 scheduler already races async provider/interceptor waits and must be
  reused rather than replaced. (`packages/core/src/runtime-envelope/execute.ts:48-67`)
  **VERIFIED**

## Contract

> Verified against the cited source files at `305761e7` on 2026-07-13.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Machine format | Private constant `kern.runtime.effect-machine.internal.r0` | Tribunal verdict; no existing public format | DECIDED |
| Eligible node set | `let`, `assign`, `fmt`, `print`, `return`, `throw`, `capability` | These are registered contracts; capability is the first yielded effect | DECIDED |
| Eligible shape | One root flat sequence; every node has no children; root env has no parent, runner functions/classes, or active class instance | Current typed handler environment satisfies these bounds (`handler-entry.ts:110-138`) | DECIDED |
| Routing preflight | Inspect the entire sequence's structural eligibility before executing any node; if any node is ineligible, route the whole sequence to the legacy lane | Prevents machine effects before fallback | DECIDED |
| Semantic preconditions | Registered contract preconditions execute in source order because later nodes may depend on earlier bindings; this slice does not dry-run or roll back a caller-supplied raw `SemanticEnv` | M3.1 defines transactional behavior as closed envelope output, not evaluator/host rollback (`kern-5-r2-runtime-envelope/spec.md:55-57`) | VERIFIED |
| Pure node dispatch | Call the registered contract precondition/effect directly; never call `referenceRun`, `referenceRunSequence`, or either async runner from the machine | Registry is current semantic authority (`reference-runner.ts:24-44`) | DECIDED |
| Effect request | Capability request contains namespace, operation, optional portable input, and optional result binding identity | Existing capability shape (`capability.ts:111-151`) | VERIFIED |
| Resumption | Sync driver uses the existing sync capability interceptor/provider; async driver uses the existing async interceptor/provider and scheduler wait | `internal-capability-interceptor.ts:157-208` | VERIFIED |
| Trace | Both drivers return the same raw `Trace`; normalization remains downstream and unchanged | `trace.ts:45-151`; `execute.ts:38-62` | VERIFIED |
| Completion | Stop on the first non-normal completion exactly as sequence execution does today | `reference-runner.ts:47-71` | VERIFIED |
| Fallback | Ineligible sync and async programs use their respective current runners from the start; fallback is selected before effects and never occurs inside the machine | Existing behavior remains available | DECIDED |
| Public status | No root/browser/package export, public runner option, ABI version, or `test:runtime-abi` promotion | `scripts/check-runtime-envelope.mjs:28-80` | VERIFIED |

### Required runner-contract disposition

| Contract | M3.6 disposition |
|---|---|
| `assign`, `capability`, `fmt`, `let`, `print`, `return`, `throw` | Unified flat-machine corpus |
| `branch`, `do`, `each`, `expression-v1`, `for`, `if`, `lambda`, `try`, `while` | Explicit legacy fallback; later machine-expansion slices |

The disposition is closed and executable. Adding or removing a required
contract without updating the table/oracle must fail the containment gate.

## Implementation Options

### A. Private generator machine with two drivers — selected

Create one generator that executes eligible registered contracts and yields a
typed capability effect. Thin sync/async drivers supply the result and resume
the same generator. This is the smallest implementation that makes suspension
and resumption real while avoiding a third semantic implementation.

### B. Link modules before engine convergence — rejected

This would prove helpers/classes/import scopes across both current engines and
increase the later convergence surface. Source linking remains the next major
slice after the machine expands over control flow.

### C. Synthetic yield-only probe — rejected

A synthetic instruction would prove a harness invention rather than execute a
real KERN capability node. It would leave the dual-engine product path intact.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/capability.ts` | Refactor | Share pure request preparation and result resumption with the contract and machine |
| `packages/core/src/ir/semantics/internal-effect-machine.ts` | Add | Closed eligibility/disposition, generator, sync and async drivers |
| `packages/core/src/runtime-envelope/internal-engine.ts` | Add | Select machine or whole-program legacy lane before execution |
| `packages/core/src/runtime-envelope/execute.ts` | Modify | Route both envelope entrypoints through the internal engine adapter |
| `packages/core/tests/runtime-envelope-effect-machine.test.ts` | Add | Raw-trace, routing, fallback, ordering, and scheduler oracles |
| `scripts/check-runtime-envelope.mjs` | Modify | Bind machine format, imports, disposition, containment, and public deferral |
| Fitness policy/support matrix/release train | Modify after proof | Record M3.6 as an internal oracle without ABI promotion |

## Acceptance Criteria

- [x] Machine eligibility is true only for the exact flat seven-node corpus and
      the bounded root environment; every other required runner contract has an
      explicit legacy disposition.
- [x] Structural routing preflight scans the complete sequence before effects.
      An eligible prefix followed by an ineligible node reaches the legacy lane
      from the start and never partially runs the machine. State-dependent
      contract preconditions remain ordered execution, not a semantic dry-run.
- [x] Both envelope entrypoints select the same machine format for eligible
      input; neither entrypoint directly imports a sequence runner.
- [x] The machine module imports/calls neither `referenceRun`,
      `referenceRunSequence`, `asyncReferenceRun`, nor
      `asyncReferenceRunSequence`.
- [x] Sync and immediately resolved async providers produce structurally equal
      raw traces for a sequence containing let/assign, capability result
      binding, print, and return.
- [x] The raw-trace witness includes at least one `assign` event that envelope
      normalization drops, proving the oracle is not normalized-byte-only.
- [x] Effect/provider order is exact and one-shot; capability result binding is
      resumed before the following print/return node.
- [x] Missing, throwing, malformed, or Promise-returning sync providers fail
      closed without switching to the async or legacy runner.
- [x] Existing pre-abort, mid-wait cancellation, timeout, late settlement, and
      scheduler cleanup tests pass unchanged for the machine lane.
- [x] Unsupported/control-flow programs preserve current legacy behavior and
      never enter the machine; there is no fallback from inside a started
      machine generation.
- [x] Root/browser/package exports are unchanged, `runtime-handler-abi` remains
      planned, and `test:runtime-abi` remains absent.
- [x] Every handwritten source file remains below 500 lines unless it was
      already oversized; no new logic is added to the 933-line async mirror.
- [x] `pnpm test:kern-runtime-envelope` and `pnpm fitness:kern-5` pass.
- [x] Final Agon review with `claude,codex,agy` has zero verified findings.

## Out of Scope

Control-flow/function/class machine expansion, removal of the async mirror,
multi-source linking, Decimal/nested-record/map/class value symmetry, provider
abort propagation, public runtime/handler/capability ABI promotion, public
`executeKernSource*` rewrites, KERN-authored interpreter cutover, and formatter,
frontend, compiler, bootstrap, policy, or emitted-target work are deferred.
Rollback of a caller-supplied raw semantic environment or an already-invoked
host effect also remains outside the M3.1/M3.6 transactional-output contract.

## Open Questions

None. The selected corpus and fallback boundary are closed for this slice.

## Deploy Order

Ship the new private machine, routing adapter, containment oracle, and tests in
one internal commit. There is no public skew window because no package export
or public option changes. Subsequent slices expand the disposition table over
control flow, then add bounded linking and value symmetry before ABI promotion.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M3.6 should immediately delete the async mirror | A bounded first machine slice cannot truthfully cover every control-flow/function/class path | Keep explicit whole-program legacy fallback and prove the first real effect path without claiming M3 exit |
| Envelope byte parity proves engine parity | Normalization drops internal events | Raw `Trace` equality is the primary convergence oracle |
| Capability effects can be added only in the new machine | The current sync contract already owns preparation/result semantics | Extract shared pure preparation/resumption so there is one capability meaning |
| Whole-sequence preflight could be read as semantic validation and rollback | Later contract preconditions depend on bindings created by earlier nodes, and M3.1 excludes evaluator/host rollback | Define preflight as structural engine routing; retain closed failure envelopes and fresh typed-handler environments |

## Completion Evidence

- `pnpm fitness:kern-5` passed on 2026-07-13, including 51 focused runtime
  envelope tests and the complete workspace/release wall. **VERIFIED**
- Browser containment remained within budget at 75 modules and 290,674 gzip
  bytes. **VERIFIED**
- Agon review
  `review-1783900921784-xzz3ki-kern5-m3-6-effect-machine-final` completed with
  all three engines and zero findings in every classification. **VERIFIED**
