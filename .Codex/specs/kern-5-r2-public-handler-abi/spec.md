# KERN 5 R2 M3.17 Public Handler ABI

**Status:** EVIDENCE VERIFIED
**Date:** 2026-07-14
**Confidence:** 0.98

## Executive Summary

Promote the isolated M3.16 source-handler path through one additive, versioned
public package subpath: `@kernlang/core/runtime/handler`. The public call accepts
one source invocation object plus explicit host configuration and returns a
closed, tagged result envelope; callers never receive raw IR, `SemanticEnv`, or
an `Internal*` type. The first public ABI remains explicitly enabled per call
and requires caller-supplied limits, so the R2 path stays default-off while its
shape becomes testable by downstream hosts.

## Current State / Root Cause

- **VERIFIED:** the private handler entry already validates exact arity,
  binding names, hostile arrays, and every argument through the portable value
  normalizer before creating the execution environment
  (`packages/core/src/runtime-envelope/handler-entry.ts:81-115`).
- **VERIFIED:** result and event values already pass through the same tagged
  portable-value normalizer; a hostile or non-portable result transactionally
  becomes a failure with no result or events
  (`packages/core/src/runtime-envelope/normalize.ts:116-140`).
- **VERIFIED:** source identity/linking is bounded and fail-closed before the
  handler entry executes (`packages/core/src/runtime-envelope/source-handler.ts:47-61,106-150`).
- **VERIFIED:** M3.16 routes source handlers directly through the isolated
  machine-only handler root (`packages/core/src/runtime-envelope/source-handler.ts:153-173`).
- **VERIFIED:** no runtime-envelope public export exists today; the package
  exports `./runtime` but no `./runtime/handler`
  (`packages/core/package.json:8-64`; `rg -n "runtime-envelope" packages/core/package.json packages/core/src/runtime.ts` returned zero hits on 2026-07-14).
- **VERIFIED:** the existing `./runtime` surface owns app descriptors and runtime
  state, so adding handler execution there would couple two different public
  closures (`packages/core/src/runtime.ts:1-24`).

The missing M3 boundary is therefore not another execution engine. It is a
public, stable-name facade that hides the private `Internal*` contract and
constructs the handler host environment itself.

## What Already Works

- Machine-only sync and async handler execution, including capability effects.
- Transactional suppression on link, argument, scheduler, provider, execution,
  and result-normalization failure.
- Closed tagged values for null, boolean, text, integer, decimal, list, and
  record results.
- Required caller-controlled size, depth, diagnostics, event, and string limits.
- Source and handler identity bounding.
- Complete emitted-runtime import-closure enforcement for handler roots.

M3.17 must wrap these contracts, not fork or reimplement them.

## Contract (Verified)

> Verified against the listed source files and commands on 2026-07-14.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| `abi` | exact public ABI literal | new additive contract; no existing public counterpart (`packages/core/package.json:8-64`) | VERIFIED |
| `source` | bounded KERN source string | `source-handler.ts:133-150` | VERIFIED |
| `identity.handlerName` | bounded portable binding | `source-handler.ts:65-69,143-147` | VERIFIED |
| `identity.sourcePath` | bounded relative canonical path | `source-handler.ts:55-63,143-147` | VERIFIED |
| `arguments` | dense portable plain values | `handler-entry.ts:41-55,81-115` | VERIFIED |
| `enabled` | exact `true` opt-in | `handler-entry.ts:86-89`; `source-handler.ts:47-52` | VERIFIED |
| `limits` | six required positive safe-integer bounds | `runtime-envelope/types.ts:5-12`; `runtime-envelope/value.ts:29-47` | VERIFIED |
| sync capabilities/context | existing runner host ABI | `handler-entry.ts:123-131`; `runner-capabilities.ts:1-48` | VERIFIED |
| async capabilities/timeout | existing async runner host ABI | `internal-engine.ts:13-15`; `internal-effect-machine.ts:60-78` | VERIFIED |
| scheduler cancellation/timeout | optional bounded control | `runtime-envelope/types.ts:72-79`; `internal-scheduler.ts:28-77` | VERIFIED |
| result envelope | completion, diagnostics, events, outcome, tagged result | `runtime-envelope/types.ts:26-70` | VERIFIED |
| pre-effect failure | invalid link/arguments produce empty events/result | `normalize.ts:72-85`; `source-handler.ts:153-173` | VERIFIED |

Public names will be `KernRuntimeHandler*`; no public declaration contains an
`Internal*` name. The request carries exact `abi` and the public envelope carries
exact `format`, both `kern.runtime.handler.v1`. One facade validation point
rejects an ABI mismatch before source parsing; the private r0 format is never
exposed.

The admitted source type subset is deliberately small and executable on the
current machine: `string`, `boolean`, `number`, `void`, and one-dimensional
arrays of the first three scalar types. `number` admits only the private
integer tag in M3.17 because decimal arguments remain deferred; the same rule
is applied to results. Missing or unsupported annotations fail during linking,
argument mismatches fail before execution, and result mismatches become
`invalid-handler-result` with no public result/events.

Public capability types are handler-owned structural types. They expose
operation maps only—no runner-branded names and no namespace-level provider
shortcut. The implementation may rely on structural assignability to the
existing internal dispatch functions, but the emitted public declaration graph
must not import `runner-capabilities`.

## Implementation Options

### A. Dedicated source-handler facade (recommended)

Add `packages/core/src/runtime-handler.ts` and export it only through
`@kernlang/core/runtime/handler`. It owns public types, ABI validation, host
environment construction, private-to-public envelope conversion, and sync/async
entry points. It delegates all parsing, linking, value normalization, scheduling,
and execution to the M3.16 root. Source linking also preserves the narrow
parameter/return annotations needed for public admission.

Pros: additive; smallest public surface; keeps raw IR and environment private;
preserves the handler-root closure; independently versionable. Cons: the public
facade has a small conversion layer and a new package export to maintain.

### B. Re-export private functions from `@kernlang/core/runtime`

Rejected. It exposes `Internal*` names and `SemanticEnv`, and it couples the
handler closure to an app-descriptor/runtime-state barrel.

### C. Replace `@kernlang/core/runner` source APIs

Rejected as a strawman. The 4.x runner is a compatibility surface returning
stdout strings; replacing it would violate the additive R2/default-off policy.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/runtime-handler.ts` | add | public ABI facade and stable public names |
| `packages/core/src/runtime-envelope/source-handler.ts` | edit | preserve source parameter/return annotations for public admission |
| `packages/core/src/runtime-envelope/types.ts` | edit | add stable invalid-result diagnostic code |
| `packages/core/package.json` | edit | additive `./runtime/handler` export |
| `packages/core/tests/runtime-handler-public-api.test.ts` | add | runtime behavior and failure atomicity |
| `packages/core/tests/runtime-handler-public-entry.test.ts` | add | built public export and declaration-surface proof |
| `scripts/runtime-envelope-import-closure.mjs` | edit | share the public facade closure and reject Node builtins |
| `scripts/runtime-handler-public-import-closure.test.mjs` | add | prove the production public root and kill closure bypasses |
| `scripts/check-runtime-envelope.mjs` | edit | require public ABI surface and public-name hygiene |
| `scripts/kern-5-fitness-policy.json` and `scripts/kern-5-fitness.test.mjs` | edit | promote and bind the exact public ABI gate |
| `scripts/check-kir-evidence.mjs` | edit | preserve the KIR no-promotion guard while allowing the independently owned M3 runtime ABI |
| `docs/kern-5-release-train.md` | edit | record M3.17 evidence after gates pass |

No existing package consumer changes in this slice. `@kernlang/core/runner` and
`@kernlang/core/runtime` retain their exact current APIs.

## Acceptance Criteria

- [x] `@kernlang/core/runtime/handler` exports only stable `KernRuntimeHandler*`
  names plus public ABI constants/functions; no `Internal*`, raw IR, or
  `SemanticEnv` type is reachable from its declarations.
- [x] Request `abi` and envelope `format` both equal
  `kern.runtime.handler.v1`; an ABI mismatch throws before parsing.
- [x] Sync and immediately-resolved async calls produce byte-identical public
  envelopes for the same source, identity, arguments, capabilities, and limits.
- [x] The public envelope carries exact format `kern.runtime.handler.v1`; the
  private `kern.runtime.internal.r0` literal is not exposed.
- [x] Every public source parameter and return annotation is present and belongs
  to the admitted primitive/list subset; unsupported annotations fail at link,
  argument type mismatches fail before effects, and result mismatches yield
  `invalid-handler-result` with an empty result/event envelope.
- [x] Invalid ABI, disabled call, invalid limits, malformed top-level host
  options, and an impossible failure-envelope byte budget throw sanitized
  public `KernRuntimeHandlerError` values. Malformed link, invalid arguments,
  unsupported machine input, provider error, cancellation, timeout, and hostile
  result return failure envelopes. No raw internal exception or stack is placed
  inside an envelope.
- [x] Every envelope failure has `outcome=failure`, `completion=error`, empty
  events, and an absent result; no host capability runs for failures detected
  before execution.
- [x] Caller-supplied limits remain mandatory; no public hardcoded quotas or
  thresholds are introduced.
- [x] Existing runner/runtime exports and behavior are unchanged.
- [x] Public declarations expose handler-owned operation-map capability types,
  not `KernRunner*` names or namespace-level provider functions.
- [x] The public emitted-runtime closure excludes compatibility, registry,
  reference runner/evaluator, app descriptor, runner, Node builtin, and
  TypeScript modules; mutation tests kill each forbidden edge.
- [x] Focused runtime-envelope tests, core build/typecheck, full KERN 5 fitness,
  and terminal `claude,codex,agy` Agon review pass.

## Out of Scope

- Replacing `executeKernSource*` or changing its stdout-string contract.
- Publishing raw IR handler entries or accepting caller-created environments.
- Modules, helper/class linking, async/stream source functions, or the remaining
  unsupported machine corpus.
- Freezing a new capability-policy/interceptor ABI. Public handler capability
  types are deliberately narrower structural adapters over existing dispatch.
- Enforcing arbitrary TypeScript-like source annotations. Only the admitted
  primitive/list subset is part of M3.17.
- Decimal arguments and nested record/list shapes still rejected by the private
  executable-domain decoder.
- M4 formatter/frontend work and application-host cutover.

## Open Questions

No unresolved product decision blocks the corrected additive facade. Tribunal
`tribunal-1784014368984-hbbv0b` accepted Option A after requiring versioning on
both request/envelope, handler-owned capability types, source annotation
enforcement, the exact throw boundary, and envelope-only atomicity.

## Deploy Order

Publish `@kernlang/core` with the additive subpath first. Downstream hosts may
then opt into the exact new version and call it with `enabled: true`. During
version skew, old consumers remain on `./runner`/`./runtime`; attempting to
import `./runtime/handler` from an older package fails at module resolution
rather than silently selecting a compatibility engine.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M3.17 needs a new result normalizer | M3.1 already normalizes arguments and results into the same tagged domain | Scope reduced to a public facade and public-format conversion |
| The existing `./runtime` barrel is the natural export | It owns app descriptors and mutable runtime state | Use a dedicated `./runtime/handler` subpath to preserve closure ownership |
| Portable tagging alone is sufficient to call the public ABI typed | Source annotations were discarded and therefore could disagree with runtime values | Preserve and enforce the admitted primitive/list annotation subset |
| Failure atomicity includes host effects | Capability calls may already have executed before a result mismatch or later failure | Promise only that no partial public result/events escape; host effects are not rolled back |
| Re-exporting runner capability types is harmless | It would publicly bless a broader authority vocabulary and contaminate declarations | Publish narrower handler-owned operation-map types and prove declaration/runtime closure |
| Capability and print source fixtures were already linkable | The body validator documented both as native statements, but `handler.allowedChildren` omitted them | Admit both in the handler schema and regenerate the structural constitution/catalog |
| Reusing the scheduler installer was sufficient for the public throw boundary | A malformed scheduler control could be converted into a private failure envelope after entering the source-handler path | Reuse the scheduler inspector at the public facade and throw a sanitized `KernRuntimeHandlerError` before parsing |
| TypeScript request types were sufficient top-level validation | JavaScript callers could supply malformed `source`, `arguments`, or `identity` shapes and reach private helpers | Validate the complete request shell and exact plain identity before delegating |
| An object-valued capability namespace implied an operation map | Namespace-level functions, accessors, and non-function operation values were still structurally reachable at runtime | Validate sync and async capabilities as own enumerable data-property operation maps before execution |
| Exact limit keys alone made the public limits object inspectable | Accessor-backed limit values could execute getters during validation | Inspect the limits object and its data-property descriptors before reading any bound |
| `Array.isArray` plus downstream normalization protected argument preflight | The public signature check used array mapping before the private hostile-array guard and could invoke an indexed getter | Clone dense enumerable argument data properties by descriptor before public normalization |
