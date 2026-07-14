# KERN 5 R2 M3.18 Preview App Typed Handler Cutover

**Status:** COMPLETE
**Date:** 2026-07-14
**Confidence:** 0.99

## Executive Summary

Cut the maintained KERN 5 preview answer route from the legacy
`executeKernEntrySourceAsync` stdout protocol to the M3.17 public typed handler.
The KERN entry becomes `question:string -> string[]` with the exact result
projection `[answer, status, ...sources]`; the host validates that closed list
and preserves the existing HTTP JSON response. This slice consumes the public
ABI without widening it and removes the application-specific marker parser.

## Current State / Root Cause

- **VERIFIED:** `server.mjs` imports the legacy runner entry, defines five
  marker constants, scans stdout for their positions, and reconstructs the HTTP
  result from free-form lines
  (`examples/kern-5-preview-app/server.mjs:9,23-27,124-173,245-256`).
- **VERIFIED:** `answerQuestion` has no typed arguments or result; it obtains
  the question through `app-http.queryParam`, calls helpers/classes, and prints
  the five framing markers plus result fields
  (`examples/kern-5-preview-app/answer-route.kern:16-66`).
- **VERIFIED:** the app manifest declares `app-http.queryParam` solely for the
  answer route input boundary
  (`examples/kern-5-preview-app/app.kern:3`).
- **VERIFIED:** M3.17 admits explicit `string` parameters and one-dimensional
  `string[]` results, constructs its own host environment, supports sync/async
  operation-map capabilities, and returns a closed versioned envelope
  (`packages/core/src/runtime-handler.ts:13-145,282-415`).
- **VERIFIED:** the repository example cannot resolve the package name directly
  from the root (`node --input-type=module -e
  "import('@kernlang/core/runtime/handler')"` returned
  `ERR_MODULE_NOT_FOUND` on 2026-07-14), while existing examples deliberately
  import built workspace files by relative path
  (`examples/kern-5-preview-app/server.mjs:5-14`).

The root gap has two parts. The public typed ABI exists, but the reference app
still crosses the old stdout boundary. A RED direct invocation also proved
that the effect machine accepts a literal returned list and an existing list
binding, but rejects a returned list whose top-level elements are portable
scalar expressions such as `answer`, `check.status`, or
`retrieval.sources[0]`. The typed preview cannot construct its dynamic
`string[]` result until that narrow runtime gap is closed.

## What Already Works

- The existing app manifest resolves the route source and handler identity.
- The RAG and LLM host adapters already expose operation maps compatible with
  the public handler capability types.
- The route's external happy-path and fail-closed HTTP shapes are covered by
  `scripts/check-kern-5-preview-app.mjs`.
- M3.17 already validates typed ingress/egress, suppresses failed results and
  events, enforces caller limits, and rejects malformed public options.
- The UI route remains on the compatibility runner; only the backend answer
  route is in scope.

## Contract (Verified)

> Verified against the listed source files and commands on 2026-07-14.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| handler identity | `answerQuestion` in `answer-route.kern` | `app.kern:3`; `server.mjs:42-54` | VERIFIED |
| typed argument | one `question:string` | admitted annotation logic in `runtime-handler.ts:282-299` | VERIFIED |
| typed result | `[answer, status, ...sources]` as `string[]` | list admission/result validation in `runtime-handler.ts:282-342` | VERIFIED |
| public ABI | `kern.runtime.handler.v1` request and envelope | `runtime-handler.ts:13,349-415` | VERIFIED |
| sync capabilities | `rag.promptContext`, `rag.checkAnswer` operation maps | existing adapters and calls in `server.mjs:213-252`; `answer-route.kern:54-57` | VERIFIED |
| async capabilities | `rag.retrieveAsync`, `llm.complete` operation maps | `server.mjs:207-238`; `answer-route.kern:53,56` | VERIFIED |
| limits and timeout | explicit app-owned JSON configuration | public options require both in `runtime-handler.ts:130-150,244-280` | VERIFIED |
| success projection | index 0 answer, index 1 status, remaining items sources | current HTTP fields in `server.mjs:154-173`; fixed Tribunal verdict | VERIFIED |
| failure boundary | no result/events; route converts known capability failure to safe ungrounded response | envelope contract in `runtime-handler.ts:123-136,330-360`; current 422 response in `server.mjs:282-288` | VERIFIED |
| external HTTP schema | unchanged happy/error JSON | `scripts/check-kern-5-preview-app.mjs:78-149` | VERIFIED |
| computed return list | top-level portable scalar expressions only; nested arrays remain literal-only | direct public-handler expression matrix; Nero `nero-1784027158157-g0frul` | VERIFIED |
| manifest typed-entry opt-in | exact `runtimeHandlerAbi: kern.runtime.handler.v1`; omitted option preserves legacy void-entry validation | `packages/core/src/app-descriptor.ts`; `packages/core/tests/app-descriptor.test.ts` | VERIFIED |

Every live consumer is in this repository: `server.mjs` consumes the KERN
result, `check-kern-5-preview-app.mjs` consumes the HTTP response, and `ui.kern`
consumes that response in the browser. The marker constants/parser become dead
and are deleted; no second implementation remains.

## Implementation Options

### A. Consume M3.17 with a fixed typed list (selected)

Make `answerQuestion` a straight-line typed handler with one string argument
and a `string[]` result. The host performs strict index projection only; it does
not scan text, parse JSON, or interpret embedded tags.

Pros: exercises the shipped public ABI end to end; removes stdout framing;
smallest slice that advances the M3 exit; no public ABI churn. Cons: the result
is positional and deliberately temporary.

Tribunal `tribunal-1784026135984-qo72f5` selected this option. It distinguished
typed projection from marker parsing and required a separate record-ABI slice
if the list grows beyond answer, status, and sources.

### B. Widen the public ABI to records and helper/class linking

Rejected for M3.18. This changes the published admission contract, private
linking surface, closure gates, and downstream declaration proof before the
existing ABI has one real app consumer.

### C. Defer the app cutover

Rejected. It leaves the explicit M3 binary exit unmet and provides no adoption
evidence for M3.17.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/kern-5-preview-app/answer-route.kern` | edit | typed argument/result; remove helpers/classes, query capability, prints, and markers |
| `examples/kern-5-preview-app/app.kern` | edit | remove the obsolete `app-http.queryParam` requirement |
| `examples/kern-5-preview-app/runtime-handler-config.json` | add | caller-controlled limits and capability timeout |
| `examples/kern-5-preview-app/server.mjs` | edit | call public async handler and strictly project its list result |
| `packages/core/src/app-descriptor.ts` | edit | exact host opt-in for a typed handler entry while unchanged callers stay legacy-strict |
| `packages/core/src/ir/semantics/portable-return-array.ts` | add | evaluate only top-level portable scalar expressions in a returned array |
| `packages/core/src/ir/semantics/portable-machine-shape.ts` | edit | admit computed scalars only in return-array shape validation |
| `packages/core/src/ir/semantics/internal-effect-machine-leaf.ts` | edit | route returned arrays through the dedicated evaluator |
| `packages/core/tests/app-descriptor.test.ts` | edit | prove exact ABI opt-in and legacy rejection |
| `packages/core/tests/runtime-handler-public-api.test.ts` | edit | prove computed return list plus fail-closed context and type guards |
| `scripts/check-kern-5-preview-app.mjs` | edit | RED static boundary oracle plus unchanged HTTP behavior |
| `examples/kern-5-preview-app/README.md` | edit | document the typed boundary and temporary projection honestly |
| `docs/kern-5-release-train.md` | edit | record M3.18 evidence and M3 status without overclaiming record ABI |

## Acceptance Criteria

- [x] The answer route calls the built M3.17 public handler facade, not
  `executeKernEntrySourceAsync` or another compatibility runner entry.
- [x] `answerQuestion` has exact typed signature `question:string -> string[]`;
  `app-http.queryParam`, marker literals, and `print` framing are absent.
- [x] The public request uses exact ABI, manifest-derived handler identity,
  one normalized question argument, explicit operation-map capabilities, and
  app-owned configurable limits/timeout.
- [x] The host accepts only a success envelope containing a list of at least
  three non-empty text values and projects `[answer, status, ...sources]`.
- [x] A public typed handler may construct that list from top-level portable
  scalar expressions, while computed `let` arrays, computed nested arrays, and
  non-text values under a `string[]` signature remain rejected.
- [x] No stdout scanning, marker indexing, delimiter parsing, embedded JSON,
  or version tag remains in the answer path.
- [x] The happy-path HTTP JSON is unchanged, including multiline answer,
  citations, source list, chunk count, grounding status, and diagnostics.
- [x] Missing input remains 400, deterministic unsupported/ungrounded cases
  remain safe 422 responses, and missing LLM remains 503 before execution.
- [x] Public handler failures expose no partial answer/result/events or raw
  internal exception text through HTTP.
- [x] The static oracle is RED on the M3.17 base specifically because the
  marker/legacy-runner boundary still exists, then GREEN after cutover.
- [x] `pnpm test:app-demo`, `pnpm test:runtime-abi`, full current KERN 5 fitness,
  and terminal full-roster Agon review pass.

Completion evidence: `pnpm fitness:kern-5` passed end-to-end on 2026-07-14,
including the complete workspace, 432/432 cross-target conformance fixtures,
109/109 class fixtures, 233 native KERN assertions at 100% coverage, runtime
closure, public ABI, preview smoke, and app-behavior gates. Terminal Agon review
`review-1784029943644-crvryy-m3-18-preview-typed-handler-fina` completed with
all six usable non-excluded engines, zero verified findings, and no blocker.

## Out of Scope

- Widening the public handler ABI to records, structs, nested arrays, modules,
  helper/class linking, or a new ABI version.
- Widening computed array elements in `let`, capability-input, nested-array,
  KIR/codegen, or compatibility-runner paths.
- Returning the complete HTTP response object directly from KERN.
- Migrating the UI entry from the compatibility runner.
- Changing the external HTTP response schema or policy-slot behavior.
- Claiming rollback of host effects after a capability has executed.
- Calling the positional list the final structured-response design.

## Open Questions

No OPEN or ASSUMED claim feeds the selected oracle. The kill conditions are:

1. Abort if the public handler cannot execute the existing RAG/LLM operation maps.
2. Abort if realistic demo input cannot fit explicit app-owned limits.
3. Abort if preserving the current HTTP schema requires nested result records.
4. Abort if any smoke can pass only by restoring text scanning or JSON parsing.
5. Abort and schedule record ABI if the positional result needs another field
   family beyond answer, status, and sources.

## Deploy Order

This is one repository/example slice with no external version-skew window. The
built core facade already exists on the stacked M3.17 branch. Route source,
manifest, host adapter, config, smoke oracle, and docs ship in one push. The
existing HTTP response remains compatible throughout.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Import the package subpath by name in the source checkout | Root execution cannot resolve `@kernlang/core`; examples use built workspace-relative modules | Import the built `dist/runtime-handler.js` facade while package-entry tests continue proving the public subpath |
| The route can keep its helper/class structure | M3.17 source admission deliberately does not link helpers/classes | Inline the narrow answer handler; no ABI widening in this slice |
| A `string[]` is automatically another marker protocol | Runtime-validated list projection has no delimiter scanning or embedded serialization | Permit only the fixed projection and kill the slice if it grows |
| The existing runtime can construct `[answer, status, source]` | Return array literals are literal-only even though the public ABI admits `string[]` | Add a return-only top-level scalar evaluator with explicit negative guards for every other array context |
| The app descriptor already admits the typed route | Descriptor loading resolves entries through the legacy `returns=void` contract | Add an exact host loader ABI opt-in; omitted and unknown options remain fail-closed |
| Typed opt-in could fall back through legacy resolution first | Legacy admission could bypass typed route validation and hide its original failure | Keep views on the legacy contract; validate every opted-in route directly against the shared public signature contract |
| Descriptor preflight only needed structural `handler lang=kern` shape | The public linker also rejects async/stream, unsupported annotations, and top-level module syntax | Share signature parsing/admission with the public handler and reject module syntax at descriptor load |
| App-owned JSON configuration could rely on the public facade to reject bad values later | Startup accepted malformed timeout and limit shapes until the first request | Validate exact keys and positive safe-integer bounds while loading the preview config |
