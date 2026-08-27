# KERN 5 R0-ABI Executable Contract Cell

**Status:** INTEGRATED — CURRENT REVIEW AND PUSH PENDING
**Date:** 2026-08-24
**Baseline:** `origin/main` at `032f9e574673dcc1ca497458452556da49e2d4cd`
**Planning authority:** KERN 5 runtime/compiler/review replan carried by
`feat/kir-backed-review-preview` at `3ca86d45e7db816f9e2e889301761101d0d14cd4`
**Initial confidence:** 0.88
**Post-challenge confidence:** 0.93
**Contract challenge:** `nero-1787577282821-97uwyj`
**Oracle challenges:** `nero-1787578207667-a328vt`,
`nero-1787579676258-m7ux8v`
**Rejected Forge:** `forge-1787578660412-94rlls`

## Executive Summary

R0-ABI defines the first private, executable contract shared by the KERN 5
runtime and JavaScript/Python compiler lanes. It proves that one authenticated
KIR v1 program can produce deterministic ESM and Python artifacts whose
observable execution agrees for portable values, records/lists, JSON,
capability effects, errors, an asynchronous boundary, cancellation, timeout,
concurrent requests, and structured logs.

This is a nonterminal contract cell. It does not export a new public package
surface, replace the production source compiler/runtime, promote
`test:kern-compiler`, or claim KERN 5 completion. Accepted R0-ABI bytes become
read-only input to the RT, C-JS, and C-PY lanes; revisions require a new
version and skew decision.

## Grounded Current State

1. Production CLI compilation reparses source and dispatches legacy
   TypeScript code generators; neither the JavaScript nor Python target
   consumes KIR. **VERIFIED** in `packages/cli/src/commands/compile.ts` and
   `packages/cli/src/shared.ts` at the pinned baseline.
2. KIR v1 is a strict two-component artifact containing structural semantic
   bytes and diagnostic evidence bound to source catalogs. **VERIFIED** in
   `packages/core/src/kir-v1/{types,canonical}.ts`.
3. The only executable KIR path is private and default-off: it decodes
   structural KIR, inflates it to current internal nodes, and invokes the
   internal runtime. **VERIFIED** in
   `packages/core/src/runtime-envelope/kir-handler.ts`.
4. `kern.runtime.internal.r0` already defines a closed portable value, slot,
   event, completion, diagnostic, and limit vocabulary. **VERIFIED** in
   `packages/core/src/runtime-envelope/types.ts` and its contract goldens.
5. `kern.runtime.handler.v1` is a public source/callback/`AbortSignal` API. It
   is not a target-neutral KIR execution ABI and must remain unchanged.
   **VERIFIED** in `packages/core/src/runtime-handler.ts` and parity tests.
6. No current generated-artifact type binds an authenticated KIR digest,
   target, ABI version, artifact digest, or deterministic entry identity.
   **VERIFIED** in `packages/core/src/types.ts` and current CLI manifests.

## Root Problem

The compiler and runtime lanes cannot safely fan out while their common value,
effect, control, compiler-result, and target-artifact contracts are implicit.
Starting either target directly would let JavaScript host concepts leak into
Python or permit both targets to interpret the same KIR differently.

The first executable cell must therefore freeze only portable observable data
and prove it against both targets. It must not freeze current JavaScript
callbacks, promises, `AbortSignal`, timer objects, `SemanticEnv`, or inflated
runtime nodes.

## Chosen Scope and Contracts

### Contract bundle

The authenticated bundle lives under `scripts/kern-5-r0-contracts/` and has
manifest format `kern.r0.contract-bundle.1`. The manifest contains:

- exact ABI component versions;
- canonical input-fixture and expected-envelope digests;
- deterministic target artifact paths, media types, executable entrypoints,
  and SHA-256 digests;
- generator and runner commands using repository-relative paths only;
- configurable latency and peak-memory ceilings for the probe;
- an exhaustive inventory of authority, fixtures, adapters, generated
  artifacts, validation, and tests.

The manifest contains no timestamps, host paths, random identities, or
environment-dependent values. **VERIFIED design decision.**

### Compiler request and result

`kern.compiler.request.r0` is canonical JSON data with exact fields:

```text
format
kir: { format, bytesHex, sha256 }
entry: { moduleId, handlerName }
target: "javascript-esm" | "python"
runtimeAbi: "kern.runtime.kir.r0"
```

The request carries an already authenticated KIR v1 artifact. A target adapter
must verify its bytes and digest, decode KIR v1 through the accepted reference
codec, select only the validated semantic component, and reject source text or
legacy AST/IR input. Diagnostic-evidence source catalogs are fixture authority
used only by the compiler-side validation step and are never embedded or
executed by target artifacts. **VERIFIED design decision.**

`kern.compiler.result.r0` returns either a closed diagnostic failure or one
`kern.target.artifact.r0` manifest plus its artifact bytes. A successful target
manifest binds:

```text
format, target, runtimeAbi, compilerRequestSha256, kirSha256,
semanticSha256, entry, artifacts[{path, mediaType, sha256, executable}]
```

Artifacts and manifests must be byte-identical across two clean generations.
The two targets need not emit byte-identical source; their canonical execution
envelopes must agree. **VERIFIED design decision.**

### Runtime request and response

`kern.runtime.kir.r0` is a data-only JSON request/response contract. The
request has exact fields:

```text
format
requestId
artifactManifestSha256
kirSha256
entry: { moduleId, handlerName }
arguments: portable tagged values
limits: the existing six runtime-envelope limits
capabilityTranscript: ordered capability steps
control: { preCancelled, cancelAtTick, timeoutTicks }
```

Each capability step has exact namespace, operation, input slot, result slot
or portable error, and a non-negative integer `delayTicks`. A tick is a logical
probe scheduling unit, never wall-clock time. The target must cross one real
host asynchronous boundary before settling a delayed step, but the observable
winner is chosen only by logical ticks. The runner consumes a step only after
namespace/operation/input match, and mismatch fails atomically.

`preCancelled` deterministically tests cancellation before dispatch.
`cancelAtTick` and `timeoutTicks` are mutually exclusive controls. When a
capability settles at tick `S`, cancellation is requested at `C`, and timeout
expires at `T`, the priority is: pre-cancel; then timeout when `T <= S` and
`T <= C` (or C is absent); then cancellation when `C <= S`; then success. A
tie therefore has one cross-target result and never depends on microtask/event-
loop ordering. The async transcript has no live provider, acquired resource,
cleanup callback, or background operation; losing a step discards all its
uncommitted data, so cancellation cannot leave ghost host mutation.
**VERIFIED design decision.**

The response reuses the existing internal envelope payload shape and portable
value vocabulary with format `kern.runtime.kir.r0`, plus the request identity.
Structured logs are typed `stdout`/`stderr` events whose text fixture is
canonical JSON; no ad-hoc host log text is part of the ABI. All request,
response, manifest, and structured-log bytes use the contract's explicit
recursive code-point key ordering, UTF-8 encoding, decimal/integer text forms,
and terminal newline. Host `JSON.stringify`, Python dictionary order, float
rendering, and JavaScript property enumeration are not authority. Failure
before the first committed effect produces `events: []` and an absent result.

The runtime request must match the target artifact's embedded manifest and KIR
digests. The target manifest enumerates the only admitted capability
namespace/operation pairs. Transcript dispatch is exact-match data lookup and
has no dynamic host capability table. Digest, entry, or capability-seal
mismatch fails before execution. **VERIFIED design decision.**

### Representative KIR subset

The R0 fixture contains one exported KERN handler whose accepted structural
KIR semantics exercise:

- a `text[]` argument, strict JSON text argument/result, and records/lists as
  internal `Json.parse`/`Json.stringify` values;
- JSON parse and stringify behavior through the structurally accepted `Json`
  member/call expressions;
- one transcript-backed asynchronous capability call;
- one structured stdout log;
- a normal return and a capability-error path.

The fixture signature uses only currently accepted structural handler types:
`text`, `text[]`, and a `text` return. Current structural KIR has no record
handler annotation, so passing or returning a record directly is forbidden in
R0. The structured witness is strict canonical JSON text, with records/lists
created inside the handler. The initial capability node has no input because
the current structural catalog forbids `capability.input`; its sealed
transcript input slot is therefore absent. **VERIFIED** in
`packages/core/src/kir-structural/{handler-type,catalog.generated}.ts`.

The existing private KIR runtime evaluator does not implement the admitted
`Json.parse`/`Json.stringify` member calls even though structural KIR and both
legacy target generators recognize them. The R0 provisional adapters must
therefore implement this declared strict-JSON subset directly; they may use the
private binder only as a comparison for the overlapping non-JSON subset and
must not claim full current-runtime parity. JSON input is limited to null,
booleans, strings, arrays, objects with non-integer keys, and finite numbers
whose canonical decimal text agrees across targets. `undefined`, non-finite
numbers, functions, dates, duplicate object keys, and host-specific number
rendering are rejected. **VERIFIED design decision grounded in**
`packages/core/src/codegen/kern-stdlib.ts` and
`packages/core/src/ir/semantics/portable-core-evaluator.ts`.

The same KIR bytes drive both target generators. The target adapters may
support only a declared closed node/expression subset, but the oracle varies
topology within that subset: nested records/lists, zero/one/two capability
steps, success/error branches, and changed event/order shape. Adapters must
dispatch generically over the declared subset and fail on every unsupported
kind rather than ignore or synthesize behavior. The probe claims conformance
only for this representative subset; it unlocks broader lane implementation
and does not claim general compiler readiness. No target-specific field may be
added to KIR. **VERIFIED design decision.**

## Alternatives Rejected

### Freeze the public source handler as the cross-target ABI

Rejected because callbacks, promises, `AbortSignal`, and JavaScript timers are
host APIs, not portable wire data. It would also couple KERN 5 work to the 4.x
public source path.

### Use static handwritten target programs unrelated to KIR

Rejected because matching outputs would not prove KIR-to-target semantics and
could pass with hardcoded fixtures.

### Build complete general-purpose KIR compilers in R0

Rejected because R0 is the contract feasibility cell. General lowering and
runtime ownership belong to the unlocked C-JS, C-PY, and RT lanes after the
representative probe freezes the seam.

## Blast Radius

| Path | Action | Purpose |
| --- | --- | --- |
| `.Codex/specs/kern-5-r0-abi/spec.md` | add | Claim-tagged satellite authority |
| `scripts/kern-5-r0-contracts/manifest.json` | add | Versioned bundle and digest authority |
| `scripts/kern-5-r0-contracts/schema/*.json` | add | Exact request/result/artifact/runtime shapes |
| `scripts/kern-5-r0-contracts/fixtures/*` | add | Authenticated KIR, requests, and expected envelopes |
| `scripts/kern-5-r0-contracts/adapters/*` | add | Provisional deterministic JS/Python generation |
| `scripts/kern-5-r0-contracts/generated/*` | add | Checked target artifacts used by the probe |
| `scripts/kern-5-r0-contracts/*.mjs` | add | Validator, generator, runner, and binary oracle |
| `scripts/kern-5-r0-contracts/*.test.mjs` | add | RED, hostile, mutation, parity, budget tests |
| `package.json` | modify | Add only `test:kern-5-r0-contracts` |

Production CLI target routing, public package exports, runtime handler v1,
terminal fitness rows, release version, and publication configuration remain
unchanged.

No handwritten source file may exceed 500 lines. Generated fixture/artifact
files are exempt but should remain reviewable.

## Binary Acceptance Criteria

- [x] The new root command is absent and the focused oracle fails at the pinned
      base specifically because the R0 contract bundle is missing.
- [x] The manifest and every inventoried authority/fixture/artifact digest
      validate; omitted, extra, reordered, path-escaping, symlink, stale, or
      unauthenticated entries fail closed.
- [x] Two clean generations produce byte-identical compiler results,
      JavaScript artifacts, Python artifacts, and target manifests.
- [x] Both target artifacts consume the same authenticated KIR fixture and
      produce byte-identical canonical runtime envelopes for internal
      records/lists, strict JSON text input/output, normal return, structured
      log, and capability error without inventing a record handler type.
- [x] Changing the semantic KIR return/log/capability input changes both target
      results or causes an explicit unsupported/fingerprint failure; a
      hardcoded target output cannot pass.
- [x] Source/AST/legacy-IR input, KIR digest mismatch, evidence/source mismatch,
      invalid entry identity, unsupported KIR, transcript mismatch, invalid
      portable value, and configured limit overflow fail closed.
- [x] Pre-cancel, logical cancellation during a delayed capability, logical
      timeout, and completion/cancel/timeout tie cases agree across targets and
      expose no partial event or result; host event-loop ordering cannot change
      canonical bytes.
- [x] Two requests executing concurrently with distinct request IDs,
      arguments, transcripts, and results remain isolated on each target.
- [x] Configured probe latency and peak-memory ceilings are enforced with
      environment-stable margins and reported without entering canonical
      response bytes.
- [x] Static closure checks prove target artifacts cannot import the parser,
      source handler, legacy runner, `SemanticEnv`, dynamic loaders, network,
      filesystem writes, or target-specific KIR variants.
- [x] Existing `pnpm test:kern-kir-runtime-binding`,
      `pnpm test:kern-runtime-contract-v1`, core tests/typecheck, lint, and
      build remain green; public declarations and handler-v1 goldens remain
      unchanged.
- [x] `pnpm test:kern-5-r0-contracts` passes from the repository root and is an
      authenticated sub-gate only; no terminal KERN 5 gate is promoted.

## Mutation Controls

The oracle must demonstrate that it rejects at least these deliberate faults:

1. generator ignores KIR bytes, fingerprints the fixture, or only substitutes
   literals into one fixed topology;
2. JavaScript or Python drops/reorders a capability or structured-log event;
3. artifact manifest retains an old input or output digest;
4. cancellation/timeout is returned as success or retains a partial event;
5. concurrent requests share transcript position or result state;
6. compiler adapter accepts source text or an unvalidated semantic component;
7. unsupported KIR node/expression is silently ignored.

## Implementation Evidence

The accepted cell is implemented by seven commits from `d4f401c1` through
`cc3dc353` on `feat/kern-5-r0-abi`. The final sealed bundle contains
27 digest-bound files and has manifest SHA-256
`085201ff726ef2260a0df65df59c54c125fb40006290f89ad57b564a6cf3cb5b`.

On 2026-08-24, the final candidate passed:

- `pnpm test:kern-5-r0-contracts`: 39 tests plus the authenticated checker;
- `pnpm test:kern-kir-runtime-binding`: 5 tests;
- `pnpm test:kern-runtime-contract-v1`: 82 tests and its contract checker;
- the complete `@kernlang/core` test suite after `tsc -b`;
- `pnpm lint`: 1,377 files checked with no findings;
- `git diff --check` and the 500-line handwritten-source ceiling.

The final live resource probe measured a 44.15 ms JavaScript median with
45,776,896 peak RSS bytes and an 86.28 ms Python median with 28,098,560 peak
RSS bytes. The high-risk post-implementation mutation pass killed 25 of 25
executed mutants. Review-driven fixes received targeted independent Agon
review in `review-1787586745046-ewj8tu`: no blocking or important findings;
its single path-normalization nit was fixed in `cc3dc353` and the full R0 gate
was rerun green.

This evidence promotes only the private R0-ABI contract cell. It does not
promote a production compiler/runtime route, terminal KERN 5 fitness, release,
publication, or merge authority.

## Deploy, Integration, and Skew Order

1. Merge R0-ABI only after the executable cross-target oracle and independent
   review pass on the final candidate.
2. Treat all R0-ABI component versions and fixtures as read-only inputs to the
   RT, C-JS, and C-PY branches.
3. Those lanes may proceed independently but must pin the exact bundle manifest
   digest in their own evidence.
4. Integrate only compatible lane versions at the walking-skeleton milestone.
5. Any ABI correction increments the affected component version and records a
   producer-first/consumer-second skew plan; silent in-place revision is
   forbidden.

Rollback removes the private sub-gate and contract directory. No 4.x public API
or production compiler route changes, so mixed installations have no runtime
skew.

## Out of Scope

- General KIR lowering beyond the representative executable subset.
- Production CLI compiler/runtime cutover or a terminal compiler gate.
- Public KIR/runtime/compiler package exports.
- External npm/PyPI import contracts, microservice HTTP schemas, health probes,
  or deployment.
- Stream handlers, classes, generators, and complete async language semantics.
- Release version, tag, publication, deployment, or merge to `main`.

## Challenge Delta and Remaining Dependencies

The first draft used millisecond delay/cancellation controls. Agon Nero found
that Node microtask/macrotask ordering and Python cancellation delivery could
produce different winners and leave host cleanup running. It also identified
implicit host-JSON ordering, shallow fixture substitution, and insufficient
runtime binding of authenticated KIR/capability identity.

The accepted design replaces wall time with a logical scheduler and explicit
tie-break; prohibits live provider/background state; defines canonical bytes;
requires topology mutations inside the declared subset; narrows the claim to
subset conformance; and binds runtime requests to manifest/KIR digests plus a
sealed capability inventory. No unresolved product or host dependency remains
before implementation. **VERIFIED design decision.**

The first RED oracle draft could have returned two in-memory envelopes without
generating or executing either target. The hardened oracle independently
executes real generated ESM and Python files in Node 22 and CPython, verifies
raw canonical stdout bytes and target-manifest/artifact digests, rejects
fixture answers embedded in source, and creates a novel topology/identity not
stored in the fixture file. It fails at the pinned base with
`ERR_MODULE_NOT_FOUND` for the deliberately absent `oracle.mjs`, which is the
intended missing implementation seam. **VERIFIED** on 2026-08-24.

The first Forge winner was rejected even though its focused test passed: it
invented `kern.structural-kir.r0-subset.1` and emitted synthetic KIR beside the
target program. A second challenge showed that merely validating sidecar KIR
still did not prove causality. The final RED boundary is test-owned: the test
constructs and independently inspects the complete accepted structural-KIR
handler, evidence, and KIR v1 bytes, then passes the generator only those bytes,
their source-evidence catalog, and the selected entry. Topology descriptions,
source plans, runtime arguments, transcripts, controls, and expected outputs
never cross the compiler call. Valid KIR mutations must change generated target
digests and target behavior. **VERIFIED design correction.**
