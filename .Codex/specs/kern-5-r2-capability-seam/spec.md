# KERN 5 R2/M3.4 Internal Capability Interception Seam

**Status:** DONE
**Date:** 2026-07-12
**Confidence:** 0.98

## Executive Summary

M3.4 adds one private, default-off, versioned interception point around KERN
capability dispatch. The internal handler runtime may install an interceptor for
one call; both synchronous capability contracts and both asynchronous runner
capability lanes must consult it before provider lookup. The slice proves
synthetic return, proceed, and reject behavior without publishing a runtime ABI,
adding a global switch, or claiming scheduler/cancellation completion.

## Current State / Root Cause

- M3.3 is remotely verified at `6da7d673`, and the release train records M3.1,
  M3.2, and M3.3 complete (`docs/kern-5-release-train.md:203-221`). **VERIFIED**
- The synchronous capability contract directly calls `invokeRunnerCapability`
  (`packages/core/src/ir/semantics/capability.ts:126-151`). **VERIFIED**
- The asynchronous runner has two distinct direct dispatch lanes: async
  providers call `invokeRunnerCapabilityAsync`, while sync providers call
  `invokeRunnerCapability` (`packages/core/src/ir/semantics/async-reference-runner.ts:569-653`).
  **VERIFIED**
- `AsyncReferenceRunnerOptions` exposes provider and timeout configuration but
  no interception point (`packages/core/src/ir/semantics/async-reference-runner.ts:61-70`).
  **VERIFIED**
- `SemanticEnv` is a public contract and currently contains capabilities and
  context only (`packages/core/src/ir/semantics/index.ts:18-63`; exported from
  `packages/core/src/index.ts:471-481`). Adding a seam field there would widen a
  public type. **VERIFIED**
- The package export map exposes only named built entrypoints and no internal
  runtime-envelope or semantics subpath (`packages/core/package.json:8-62`).
  **VERIFIED**
- Agon tribunal `tribunal-1783889084003-08ggx1-kern5-m3-4-next-slice` selected
  the capability interception seam unanimously before module linking, value
  widening, or runner-contract promotion. **VERIFIED**

## What Already Works

- Provider calls already validate portable input and output, reject missing
  providers, reject Promise results in the sync lane, and bound async waits with
  a configurable timeout (`packages/core/src/runner-capabilities.ts:71-229`).
  **VERIFIED**
- M3.1 normalizes capability errors into a failure envelope with no exposed
  events or result (`packages/core/src/runtime-envelope/normalize.ts:119-160`).
  **VERIFIED**
- M3.2 creates a fresh environment for every handler call, inheriting only the
  host capability facts, context, time, and seed
  (`packages/core/src/runtime-envelope/handler-entry.ts:109-129`). **VERIFIED**
- Child semantic environments retain an explicit parent chain
  (`packages/core/src/ir/semantics/index.ts:177-202`). The private seam can walk
  that chain without changing `SemanticEnv`. **VERIFIED**

## Contract (Verified)

> Verified against the cited sources on 2026-07-12.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Installation | Private `WeakMap<object, interceptor>` keyed by the fresh per-handler `runnerCallCache`; parent traversal remains a fallback | Public `SemanticEnv` cannot widen; rebuilt function/class environments retain the same per-call cache | DECIDED |
| Request | Closed internal format, per-call sequence, `sync`/`async` mode, namespace, operation, and normalized portable input | Current dispatch inputs at `capability.ts:135-139` and `async-reference-runner.ts:587-603` | DECIDED |
| Decision | Exactly `proceed`, `return` with a portable value or absence, or `reject`; unknown fields/kinds fail closed | M3 oracle requires no fallback; current portable validator at `runner-capabilities.ts:244-317` | DECIDED |
| Sync interceptor | Must settle synchronously; Promise-like decisions fail before provider lookup | Sync provider already rejects Promise-like output at `runner-capabilities.ts:94-110` | DECIDED |
| Async interceptor | May settle immediately or asynchronously before provider lookup | Existing async lane is Promise-based at `runner-capabilities.ts:181-229` | DECIDED |
| Proceed | Calls the selected provider exactly once through the existing validated dispatcher | Existing dispatchers remain the provider authority | GUARD |
| Return | Bypasses provider lookup and supplies the normalized result to the existing capability event/binding path | Existing trace construction remains at the cited sync/async call sites | GUARD |
| Reject / invalid interceptor | Bypasses provider lookup and becomes the closed `capability-error` envelope | `normalizeInternalRuntimeFailure`, `normalize.ts:150-160` | GUARD |
| Default | No installed interceptor preserves current behavior byte-for-byte | Private lookup returns direct dispatch | GUARD |
| Surface | No root, runner-option, public browser-entry, package-export, or `SemanticEnv` change | `packages/core/package.json:8-62`; `index.ts:471-481` | GUARD |

## Implementation Choice

Create a private semantics module that owns the request/decision types, the
per-handler-cache-keyed installation, strict decision validation, and sync/async
dispatch helpers. The sync capability contract and the two async-runner
capability lanes route through those helpers. M3.2 installs the interceptor from
the internal envelope options only after argument validation and only on its
fresh environment.

Alternatives are rejected for this slice:

- A field on `SemanticEnv` or `AsyncReferenceRunnerOptions` changes a public
  contract before M3 closes.
- An environment-variable kill switch creates global process behavior and is
  unavailable in the browser-safe graph.
- Wrapping the public `invokeRunnerCapability*` APIs would affect non-handler
  consumers and overstate the slice's containment.
- A full scheduler adds deadlines, cancellation, quotas, and result observation
  before the common request seam is proven.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/internal-capability-interceptor.ts` | Add | Private protocol, installation, validation, and dispatch |
| `packages/core/src/ir/semantics/capability.ts` | Modify | Route sync contract through the private seam |
| `packages/core/src/ir/semantics/async-reference-runner.ts` | Modify | Route async-provider and sync-provider lanes through the same seam |
| `packages/core/src/runtime-envelope/types.ts` | Modify | Add optional internal interceptor to default-off options |
| `packages/core/src/runtime-envelope/handler-entry.ts` | Modify | Install interceptor on the fresh call environment |
| `packages/core/tests/runtime-envelope-capability-seam.test.ts` | Add | Binary request/decision/parity/containment oracle |
| `scripts/check-runtime-envelope.mjs` | Modify | Bind private surface and planned public ABI status |
| Support matrix, policy, release train | Modify after proof | Record M3.4 as an internal oracle without promoting the public gate |

## Acceptance Criteria

- [x] With no interceptor installed, sync and immediately resolved async source
      handlers retain byte-identical legacy provider behavior.
- [x] One handler call receives deterministic request sequences starting at
      zero; a later call restarts at zero and cannot observe the prior seam.
- [x] Nested control flow, child scopes, and rebuilt function/class environments
      resolve the root call's interceptor through the shared per-call cache.
- [x] `proceed` invokes the provider exactly once and preserves the existing
      capability event followed by assignment ordering.
- [x] `return` bypasses provider lookup, validates the synthetic portable value,
      and produces the same envelope bytes in sync and immediately resolved
      async lanes.
- [x] `reject`, thrown interceptors, unknown decisions, extra fields,
      non-portable synthetic values, and Promise-like sync decisions invoke no
      provider and expose no events or result.
- [x] Async interceptors may settle before dispatch; existing async provider
      timeout behavior remains unchanged and fail-closed.
- [x] The host environment is not mutated, and the interceptor cannot leak to a
      sibling or later handler call.
- [x] No public barrel, runner option, browser entry, package export, production
      source executor, or planned `runtime-handler-abi` gate changes.
- [x] `pnpm test:kern-runtime-envelope` and the full `pnpm fitness:kern-5` wall
      pass.
- [x] Final Agon review with `claude,codex,agy` has zero verified findings.

## Out of Scope

Provider result observation, deadlines, cancellation, quotas, retry, rollback,
stdout commit scheduling, module/helper/class linking, Decimal/map/class value
symmetry, runner-contract promotion, public ABI, KIR v1 freeze, and semantic
cutover remain deferred.

## Open Questions

None. The recommended option has no `ASSUMED` or `OPEN` claim feeding its
acceptance oracle.

## Deploy Order

Ship this private default-off slice first. Then add scheduler timeout and
cancellation semantics, collapse duplicated sync/async control flow, add bounded
module linking, widen typed values, promote runner contracts, and only then
freeze the public runtime/handler ABI. Mixed versions are irrelevant because no
public or packed contract changes in M3.4.

## Kill Switches

- Omit the interceptor from `InternalRuntimeEnvelopeOptions` (the default).
- Remove the internal M3.4 ownership row and private routing calls; existing
  provider dispatchers remain unchanged.
- Any public export, global switch, production runner adoption, or provider call
  before decision validation kills the slice.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Tribunal suggested environment-variable bypass and CI strict-mode switches | Global process switches would violate browser containment and create behavior outside the internal per-call seam | Replaced with omission-based default-off containment and executable surface guards |
| Tribunal placed the seam directly in public `runner-capabilities.ts` | Public runner capability functions have non-handler consumers | Private semantics dispatcher wraps existing public provider dispatch only for semantic handler execution |
| The first oracle used a source-linked handler containing `capability` | Current schema rejects `capability` as a direct `handler` child before M3.4 dispatch | The oracle now executes a typed M3.2 handler entry containing capability IR; source-schema widening remains deferred |
| Initial interceptor state lookup depended on `SemanticEnv.parent` | Function and class execution rebuild environments without retaining that parent, but do retain the handler's `runnerCallCache` | State is keyed by the fresh per-handler cache with parent traversal fallback; rebuilt-environment and rejected-Promise regressions are covered |
| Review questioned cache reuse across calls and unbounded async decisions | The handler entry creates a fresh cache for every invocation; async interceptor deadlines belong to the explicitly deferred scheduler slice | Final 3/3 review recorded zero verified findings; scheduler timeout and cancellation remain the next runtime concern |
