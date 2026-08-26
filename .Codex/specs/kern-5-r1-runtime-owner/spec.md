# KERN 5 RT-1 Package-Owned KIR Runtime

**Status:** READY TO BUILD
**Date:** 2026-08-26
**Stacked base:** `origin/main` `aae0a0fe44b1aaba88addcb1995cd66e2af2254d`
plus R0 ABI `89bbd360ddf39c4a3be38cf3629b319aea28e115`
**Integration head:** `96ab2a6ecf19be11011d5f83396430cd080f6795`
**Initial confidence:** 0.82
**Post-challenge confidence:** 0.91
**Agon challenge:** `brainstorm-1787757287207-dxihm4-rt1-runtime-owner`

## Executive Summary

Add the first production package-owned KIR runtime owner at
`@kernlang/core/runtime/kir`. It consumes a same-process authenticated
`VerifiedKernProjection`, selects a KERN handler from the decoded structural
KIR, and executes a closed first subset directly from canonical expression
records. Its source and built import closures must be unable to reach source
parsing, expression reparsing, structural-to-string inflation, ReferenceRunner,
or the script-local R0 adapters.

RT-1 is an additive, fail-closed shadow owner. It is the bootstrap implementation
of the runtime contract and direct KIR semantics, not final self-hosting or
canonical cutover. JavaScript remains the implementation host during this
bootstrap slice; it may not supply implicit coercion, parsing, evaluation, or
fallback semantics. Later RT slices replace the bootstrap implementation behind
the same data contract before canonical cutover.

## Current State and Root Cause

- **[VERIFIED]** Packaged F5 projection returns `ModuleKirArtifact`, canonical
  bytes, diagnostics, and a receipt; verification requires issued object
  identity, request equality, manifest identity, byte digest, decoded artifact,
  and receipt equality. Evidence:
  `packages/core/src/frontend-projection/contracts.ts:17-25,49-71` and
  `packages/core/src/frontend-projection.ts:245-350`.
- **[VERIFIED]** The verified brand is runtime-backed by a private `WeakMap`;
  cloning or reconstructing a structurally equal object does not preserve
  verification. Evidence: `packages/core/src/frontend-projection.ts:43-58,305-369`.
- **[VERIFIED]** Core exports source runtime and runtime-handler subpaths but no
  KIR runtime owner. Evidence: `packages/core/package.json:8-72`.
- **[VERIFIED]** The private KIR handler accepts raw `ModuleKir` bytes, inflates
  structural roots to legacy `IRNode`, and calls the internal handler machine.
  Evidence: `packages/core/src/runtime-envelope/kir-handler.ts:94-197`.
- **[VERIFIED]** Structural inflation renders canonical expression records back
  to source strings. Evidence:
  `packages/core/src/kir-structural/runtime-inflate.ts:46-145,171-209`.
- **[VERIFIED]** The internal effect-machine closure reparses those strings with
  `parseExpression`. Evidence:
  `packages/core/src/ir/semantics/internal-effect-machine-leaf.ts:1,143-205,281-311`
  and `internal-effect-machine-leaf-result.ts:1,27-95`.
- **[VERIFIED]** The public runtime handler requires `source`, links through the
  source handler, and cannot be the new KIR owner. Evidence:
  `packages/core/src/runtime-handler.ts:70-75,220-248,384-440` and
  `packages/core/src/runtime-envelope/source-handler.ts:1-4,79-111`.
- **[VERIFIED]** The pushed R0 cell proves a target-neutral request/envelope and
  temporary JavaScript/Python execution, but it is implemented only under
  `scripts/kern-5-r0-contracts/`. Evidence:
  `.Codex/specs/kern-5-r0-abi/spec.md:17-28,303-329,348-356` and
  `scripts/kern-5-r0-contracts/oracle.mjs:40-186`.

The root cause is therefore not missing runtime behavior in general. It is the
lack of a package-owned consumer that treats canonical structural expressions
as executable semantic data. Every current package runtime path either begins
with source or turns KIR expressions back into source before execution.

## What Already Works

- F1-F5 projection and `verifyKernProjection` remain the sole producer and
  authentication boundary; RT-1 will not add another parser or KIR encoder.
- Existing `kern.runtime.handler.v1` remains unchanged for checker, formatter,
  canonicalizer, and compatibility consumers.
- R0 request/envelope/value/effect/cancellation/log fixtures remain the
  cross-target conformance oracle.
- KIR Review remains advisory and unchanged.
- Existing source and effect-machine runtimes remain explicit compatibility
  oracles. RT-1 neither deletes nor silently calls them.

## Contract

> Verified against the stacked integration head `96ab2a6e` on 2026-08-26.

| Boundary | Required shape or behavior | Evidence | Tag |
| --- | --- | --- | --- |
| Producer | `VerifiedKernProjection` issued by `verifyKernProjection` | `frontend-projection.ts:305-369` | VERIFIED |
| Semantic artifact | Real `ModuleKirArtifact` containing `StructuralKirNode` roots and canonical property values | `kir-structural/module-types.ts:29-50`; `kir-structural/types.ts:20-53` | VERIFIED |
| Owner export | One regular built/source pair under `packages/**`, exported as `@kernlang/core/runtime/kir` | absent from `packages/core/package.json:8-72` at base | VERIFIED negative evidence |
| Owner identity | Stable marker `kern.runtime.kir.owner.v1`, format `kern.runtime.kir.v1`, and callable `executeKernKir` | RT-1 contract decision; changing any identity requires a versioned contract migration | DECIDED |
| Request | Exact plain data `{ format, requestId, entry, arguments, control, limits }`; arguments are named tagged portable values; never source, IR, topology, transcript, or expected output | RT-1 contract decision derived from R0 `runtime-request.json:14-101` | DECIDED |
| Capabilities | Options provide one async `invoke({ namespace, operation, input, signal })` callback returning a tagged portable slot; calls/results become ordered tagged events | RT-1 contract decision derived from `runtime-handler.ts:20-68,93-102` and R0 event shape | DECIDED |
| Result | Closed `{ completion, diagnostics, events, format, outcome, requestId, result }` envelope; portable values use R0 tags `null`, `boolean`, `text`, `integer`, `decimal`, `list`, and `record` | RT-1 contract decision derived from `schema/runtime-envelope.json:5-30` and existing internal value closure | DECIDED |
| Unsupported semantic shape | Complete preflight fails before provider calls or events; a later data/runtime failure preserves every already committed capability event | KERN 5 fail-closed goal plus RT-1 auditability correction | DECIDED |

The owner marker, format, request, capability, and result shapes above are
frozen RT-1 contract decisions and become source authority in the new contracts
module before their fields are copied into a fixture. No ASSUMED or OPEN claim
may feed the final oracle. `control` contains `preCancelled` and nullable
`timeoutMs`; `limits` contains positive bounds for bytes, collection length,
depth, diagnostics, events, steps, and UTF-8 string bytes. External cancellation
is delivered only by the optional `AbortSignal` in execution options.

The admitted RT-1 executable subset is exactly: exported `fn` roots with
`param` children and one `handler lang=kern`; handler statements `let`,
`capability`, `print`, and `return`; expression kinds `identifier`, `null`,
`boolean`, `text`, `integer`, `decimal`, `list`, `record`, `member`, and `call`.
The only
admitted intrinsic calls are `Json.parse(text)` and `Json.stringify(value)`.
Capability input is absent when the node omits `input`, otherwise it is the
directly evaluated portable expression. All other roots may coexist but are not
entry candidates; every other executable node/expression/intrinsic fails during
preflight before a capability callback or observable event.

## Implementation Options

### A — Direct structural-KIR evaluator in Core (selected)

Add a focused `packages/core/src/kir-runtime/` closure and one public entry
module. Decode canonical properties without rendering strings; interpret only
explicitly admitted KIR node/expression kinds; meter every step, value, string,
event, diagnostic, and call depth; and return exact envelopes.

This is the only option that creates package ownership now while making parser
reachability mechanically impossible from the semantic evaluator. The public
owner has one read-only authentication edge to the packaged F5 producer so it
can consult the producer-private `WeakMap`; the closure oracle treats that edge
as an explicit boundary and separately proves that evaluator modules cannot
reach parsing, inflation, or legacy runners. Unsupported semantics remain
explicit and become the queue for later RT slices.

### B — Refactor or wrap the internal effect machine

Rejected for RT-1. Its current closure contains many direct `parseExpression`
calls, and the KIR handler reaches it only after structural-to-string inflation.
Making that closure expression-polymorphic is a later migration, not the
smallest ownership boundary.

### C — Move R0 templates into Core

Rejected. R0 templates are generated target-probe programs with transcript
semantics. Copying them would make a test harness look like a live package
runtime and would not establish an authenticated package producer/consumer
chain.

### D — Make the first owner KERN-authored immediately

Deferred, not rejected. It is the required direction for self-hosting, but it
currently requires the source/legacy runtime to execute the runtime itself.
RT-1 first freezes the KIR-native data contract and removes textual semantic
selection; later slices replace the bootstrap evaluator behind the same oracle.

## Planned Ownership Layout

| Path | Action | Purpose |
| --- | --- | --- |
| `packages/core/src/runtime-kir.ts` | add | Public subpath entry and owner marker |
| `packages/core/src/kir-runtime/contracts.ts` | add | Closed request/options/envelope ABI |
| `packages/core/src/kir-runtime/inspect.ts` | add | Getter-free canonical KIR/request inspection |
| `packages/core/src/kir-runtime/expression.ts` | add | Direct canonical expression evaluation |
| `packages/core/src/kir-runtime/execute.ts` | add | Link function, execute statements/capabilities, meter limits |
| `packages/core/src/frontend-projection/verified-brand.ts` | add | Shared issuance/brand primitive without producer adapter reachability |
| `packages/core/src/frontend-projection.ts` | modify | Delegate existing brand issue/check without changing public behavior |
| `packages/core/package.json` | modify | Add the single runtime/KIR export |
| `scripts/kern-5-r1-runtime-owner/**` | add | RED oracle, closure checker, fixture, manifest |
| `package.json` | modify | Add the focused RT-1 sub-gate |

Every handwritten source file remains below 500 lines. New logic is not added
to already oversized legacy runtime files.

### Authentication and JavaScript module boundary

RT-1 keeps verified projection issuance inside `frontend-projection.ts`'s
lexical scope. The emitted authentication facade is read-only: it can check the
producer-private `WeakMap`, but it cannot issue, mint, or register an object.
The runtime's authenticated import closure therefore reaches the packaged F5
producer module solely for this private identity check. Its semantic evaluator
closure stops at that facade and remains unable to reach or call a parser,
structural inflater, runner, compatibility engine, or fallback.

This boundary rejects ordinary same-process clones, reconstructions, detached
bytes, and direct-file imports attempting to find an issuance API. JavaScript
module encapsulation does not defend against a caller that can rewrite installed
package files, replace the module loader, or otherwise execute code inside the
producer module's lexical scope; those are package/process integrity threats,
not supported runtime inputs. No claim of resistance to such host compromise is
made.

## Acceptance Criteria

- [ ] A semantic owner-discovery oracle finds exactly one `packages/**` package
      export with a regular source/built pair and stable owner marker. It ignores
      R0 scripts and fails on zero or multiple owners.
- [ ] Current stacked base is RED with `KIR_RUNTIME_OWNER_MISSING`, not a
      hardcoded future-module `ERR_MODULE_NOT_FOUND`.
- [ ] The test projects and verifies real `.kern` source through the packaged
      F1-F5 boundary and passes only the resulting branded projection to RT-1.
- [ ] Cloned, reconstructed, detached, or tampered projection inputs fail before
      execution and emit no events.
- [ ] The owner request is exact plain data and has no source, AST, legacy IR,
      topology, transcript, or expected-output field.
- [ ] The projected R0 convergence function executes with at least two dynamic
      argument sets, one live async capability callback, structured JSON,
      ordered capability/stdout events, and an exact tagged return.
- [ ] Provider call counts and inputs are exact; hardcoded output, ignored KIR,
      ignored arguments, and ignored capability results are red.
- [ ] Unsupported KIR node/expression/capability shapes fail atomically with one
      bounded diagnostic and no partial events or result.
- [ ] Pre-cancellation, wall timeout, event/string/collection/depth/step limits,
      and concurrent request isolation have exact regression coverage.
- [ ] Source and built import-closure traversal rejects parser modules,
      `parseExpression`, `parseDocument`, runtime inflation,
      ReferenceRunner/async ReferenceRunner, source handlers/runners, legacy or
      compatibility engines, scripts/test adapters, dynamic imports, `eval`, and
      `Function`.
- [ ] No normal CLI compile/run/review route changes in RT-1; later shadow
      routing consumes this package owner rather than duplicating semantics.
- [ ] Focused RT-1, R0 ABI, KIR runtime binding, runtime-handler, Core build,
      typecheck, lint, and diff/file-size gates pass.
- [ ] Risk-routed independent Agon review and mechanical/semantic mutation have
      no unresolved verified blocker.
- [ ] Granular commits use the required Agon identity/footer; one complete
      feature-branch push is remotely SHA-verified.

## RED Oracle Design

The first test enumerates package manifests and exports, resolves each candidate
to its built and source twin, and requires the owner marker plus executable API.
This makes the current base fail because ownership is absent, while preventing
a copied script/test adapter or empty future filename from satisfying RED.

After the owner appears, the same gate projects the real convergence fixture,
verifies it, executes two dynamic requests, checks exact capability calls and
envelopes, and traverses the actual built dependency closure. A wrong
implementation must fail at least one behavioral, authentication, atomicity,
limit, concurrency, or closure assertion.

## Challenge Delta

Initial approach A was retained, but the full-roster grounded brainstorm and
fresh-context audits changed four details:

1. owner discovery is semantic across package exports rather than a hardcoded
   import of a planned filename;
2. input is the real same-process verified F5 projection, not an invented brand
   or raw unauthenticated KIR bytes;
3. the new owner does not wrap or modify `runtime-envelope/kir-handler.ts`,
   because that closure still inflates and reparses expressions;
4. the real R0 convergence fixture and envelope semantics are reused, while
   generated R0 target adapters remain test-only.

Agon proposed automatic side-by-side wiring and telemetry inside the legacy KIR
handler. That is rejected for this slice because no such production selector or
telemetry contract exists, and coupling the new owner to that handler would
weaken the import-closure boundary. No unresolved technical dependency remains
for the RED oracle or the direct admitted subset. Revised confidence: 0.91.

## Out of Scope

- Normal CLI shadow routing, default cutover, or terminal gate promotion.
- JavaScript/Python target compilation.
- General functions/classes/closures/streams or the complete language surface.
- Locked npm/PyPI imports, service wire contracts, or microservices.
- Deleting legacy runtimes or claiming KERN-authored self-hosting.
- Version/tag/publication/deployment or direct main integration.

## Deploy and Skew Order

1. F5 producer is already present and remains unchanged.
2. Ship the additive runtime/KIR owner and exact sub-gate; no current consumer
   changes, so old/new package skew preserves existing behavior.
3. JavaScript and Python compiler owners consume the frozen request/envelope
   contract and add artifacts without changing RT-1 semantics.
4. CLI shadow routing calls the owner explicitly and compares against the
   compatibility oracle; unsupported KIR fails closed and never falls back.
5. Only a later combined gate may promote compiler/runtime ownership and normal
   routing.

Any incompatible request/envelope correction requires a new format value and a
producer-first/consumer-second migration. Silent mutation is forbidden.

## Corrections Log

| Original claim | Verified reality | Impact |
| --- | --- | --- |
| Existing private KIR handler could be promoted directly. | It inflates canonical expressions to strings and reaches `parseExpression`. | Direct promotion is rejected; RT-1 gets an isolated closure. |
| A new branded projection shape was needed. | `verifyKernProjection` already issues a non-forgeable same-process brand. | Consume the existing verified type and runtime check. |
| R0 adapters could become the package runtime. | They are generated test targets using sealed transcripts. | Reuse their contracts/fixtures, not their ownership model. |
| A separately emitted shared brand module could safely expose issuance. | Direct file-URL imports bypass package exports and could call the issuer. | Issuance is producer-private; the runtime imports a read-only authentication facade and the closure oracle distinguishes authentication from semantic reachability. |

## Mutation follow-up

The RT-1 regression gate covers the surviving negative-zero integer, UTF-8 byte
count, extended-array property, zero-limit, bare `Json`, exact depth and
collection boundaries, malformed surrogate/control character, missing required
property, and one-child leaf mutations. Manifest-rotation mutation is not
directly injected: the live manifest is package asset state and adding a public
or test-only rotation hook would weaken the exact authentication boundary this
slice repairs. The production equality check remains in place; rotation is
covered when the package asset lifecycle gains an isolated asset-root harness.
