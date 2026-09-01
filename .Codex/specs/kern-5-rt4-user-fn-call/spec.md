# KERN 5 RT-4: Resolved same-module user function calls

**Status:** IMPLEMENTED
**Date:** 2026-09-01
**Base:** `1324f54a` (RT-3 merged; contains RT-2 boolean `if` and RT-3 binary expressions)
**Implemented at:** `c03e11cc` (probe matrix), `af34092f` (linked program and RT-1),
`a4cd6fa0` (both emitters), `b0a89a55` (oracle suite), plus the review-fix commit below
**Confidence:** 0.94

## Executive Summary

RT-3 gave the shared linked program a computed predicate but no way to name a
piece of behavior. Every program still had to be one flat handler, so the
language could not factor anything. RT-4 adds one closed call form — a
bare-identifier callee resolved at link to a named same-module handler — to the
same shared linked representation, so RT-1, the emitted JavaScript ESM, and the
emitted Python all gain identical call semantics from one admission edge. It
adds no dynamic dispatch, no member or cross-module callee, no recursion, and
no new await point on any leg.

## Current State / Root Cause

- **VERIFIED:** F5 already projects a user call. Source `helper(flag)` projects
  to an expression node with `kind: "call"` carrying exactly `args` (a list),
  `callee`, and `optional`; a bare-identifier callee projects as
  `callee.kind === "identifier"`. The direct projection probe on this base
  emitted that artifact on 2026-08-31.
- **VERIFIED:** F5 projects an `export=false` function as a `fn` root of the
  module with `export: false`, and omits it from `module.exports`. A helper is
  therefore reachable only by walking `module.roots`, not the export list.
- **VERIFIED:** `compileLinkedExpression` at
  `linked-kir-program/expression.ts` admitted `call` only as a `Json`
  intrinsic: it required `args.length === 1` and a `Json` member callee, and
  fell through to `unsupported(...)` otherwise. A bare-identifier callee was
  additionally rejected one level earlier, because the identifier branch
  required the name to be a live value binding.
- **VERIFIED (RED):** At the declared base, a call in return, `let`, `if`
  condition, `print`, binary-operand, nested, list-literal-argument,
  zero-argument, two-argument, exported-callee, non-exported-callee and
  list-signature position each project successfully and are then rejected by
  RT-1, the JavaScript compiler, and the Python compiler with
  `handler-entry-unsupported`. The `Json.stringify` control is admitted on all
  three legs at the same base, so the RED is a missing shared semantic owner
  and not a uniformly dead pipeline.

Root cause: one intentionally closed expression admission model, plus a linker
that only ever compiled the single entry function.

## Probe Matrix (sequencing gate)

Run before any admission code existed and committed as
`scripts/kern-5-rt4-user-fn-call/probe-matrix.json`.

| Position | F5 | RT-1 / JS / Python at base |
| --- | --- | --- |
| return value, `let` initializer, `if` condition, binary operand, `print` value | projected | `handler-entry-unsupported` |
| nested call, list-literal argument, two arguments, zero arguments | projected | `handler-entry-unsupported` |
| `export=false` callee, exported callee, `list<boolean>` signature | projected | `handler-entry-unsupported` |
| member callee, optional call, recursion, callee capability, unknown callee, cross-module | projected | `handler-entry-unsupported` |
| `Json.stringify` control | projected | admitted |
| **capability input** | **rejected `FRONTEND_EXCLUDED_HOST_EXPRESSION`** | never reached |
| **integer signature** | **fatal `F5_AUTHORITY_DRIFT`** | never reached |

Two probed positions re-scoped the slice and were struck by the tribunal before
implementation began:

- **The capability-input call position does not exist.** F5 rejects
  `capability … input="…"` for *every* expression — a call, a bare identifier,
  and a literal all produce `FRONTEND_EXCLUDED_HOST_EXPRESSION`. Only the
  no-input capability form projects, so `LinkedKernKirStatement`'s
  `input` field can never be anything but `undefined` from a real projection.
  The deep-effects test is therefore built on a `capability` *statement* inside
  a transitively reached callee, not on a capability input.
- **An integer signature never reaches the linker.** `F5_AUTHORITY_DRIFT` is
  fatal at projection, so the `KIR_CALL_SIGNATURE_TYPE` gate below is
  defense in depth rather than a reachable path.

## What Already Works

- **VERIFIED:** F5 needs no change. It projects multi-function modules,
  non-exported functions, zero- and multi-argument calls, nested calls, and
  list-literal arguments.
- **VERIFIED:** RT-1 already meters one step per expression node and both
  emitters already wrap every emitted expression node in its own meter step, so
  RT-4 inherits the metering model rather than inventing one.
- **VERIFIED:** RT-2's explicit frame-stack walker keeps cancellation at the
  statement boundary. RT-4 reuses that exact pattern for callee bodies, in a
  *synchronous* walker.
- **VERIFIED:** `canonicalJson` drops keys whose value is `undefined`, so an
  omitted optional field costs zero bytes in the linked digest.

## Contract

> Binding tribunal verdict for slice `rt4-user-fn-call`, as amended after the
> probe matrix.

### Form

`LinkedKernKirExpression` gains
`{ kind: 'user-call'; arguments: readonly LinkedKernKirExpression[]; handlerName: string }`.
The `handlerName` is *resolved at link*; an arbitrary callee expression is never
carried. Admitted source form is a bare-identifier callee with
`optional === false` in the same module. A non-exported helper is an admissible
callee through reachable-closure linking; the entry still requires
`export=true`.

### Closed cross-call type set

`{boolean, text, list<boolean>, list<text>}`, declared once as
`LINKED_KIR_CROSS_CALL_TYPES` in `linked-kir-program/contracts.ts` and checked
`satisfies Record<LinkedKernKirCrossCallType, LinkedKernKirCrossCallTypeContract>`,
mirroring `LINKED_KIR_BINARY_OPERATORS`. Widening the union without adding a row
is a `tsc` error. Integer and `list<integer>` signatures map to `undefined` and
are rejected; F5 rejects them first in practice.

Arity is exact at link. Every argument must carry a static cross-call type: a
boolean or text literal, a parameter, a `let` bound to an expression that itself
has one, a binary (always boolean), a homogeneous non-empty list literal, or
another user call. Capability results, member reads, `Json` intrinsic results,
decimals, empty list literals and mixed list literals have no static cross-call
type and can never be an argument. The return type is validated statically at
link and defensively by tag at run time on all three legs.

RT-3's `LinkedKernKirStaticType` is deliberately left as `boolean | integer`.
A separate resolver answers the cross-call question, so admitting text across a
call boundary does not silently admit `text == text` into the RT-3 binary gate.

### Call depth is a bounded, configurable policy

Every leg dispatches a call on its own host stack, so the reachable chain is
bounded once at the single admission edge; no leg ever executes a chain another
leg could overflow on. `LINKED_KIR_DEFAULT_CALL_POLICY` declares the default
`maxCallDepth` of 16 and is threaded through `linkVerifiedKernKirProgram` and
`linkVerifiedKernKirProgramOrThrow` as an optional argument, so a host may raise
or lower it. Exceeding it fails closed at link with `KIR_CALL_DEPTH_EXCEEDED`
under the existing closed code.

- **Measured basis for the default.** F5 stops projecting a helper chain
  somewhere between 33 and 40 functions; a 33-deep chain projects and a 32-deep
  chain executes cleanly on RT-1, emitted JavaScript, and emitted CPython. The
  default of 16 leaves roughly a 2x margin under the deepest chain measured good
  on every leg while staying inside the projectable range, so the gate is
  exercised by real fixtures rather than being theoretical.

### The closure traversal is linear

The capability closure is a memoized post-order walk: each helper is visited at
most once per walk, tracked in a `done` map alongside the active-path set that
still detects cycles exactly. A result computed while any cycle was touched is
never cached, so the answer stays exact even for a hand-built cyclic map. The
linker threads one shared walk across the whole link, so the closure check is
linear in the size of the reachable closure rather than in the number of paths
through it. `visits` is exposed on the walk so the oracle can assert the budget
directly instead of relying on wall clock.

### Recursion and the capability closure

Direct recursion, mutual recursion, and the entry calling itself are rejected at
link by cycle detection, with the label `KIR_CALL_RECURSION`. They are deferred
to a later slice.

A `capability` statement anywhere in the reachable callee closure is rejected at
link with `KIR_CALL_CALLEE_CAPABILITY`. Detection is a post-order traversal over
the whole reachable call graph *including argument expressions of transitive
callees*, not a statement-only walk, and that same traversal computes
`hasCapability` for the entry, which both emitters bake in as a compile-time
constant exactly as RT-2 established.

- **Rationale.** RT-1's expression evaluator is synchronous and a user call is
  an expression, so a callee that performed a capability would force an `await`
  in expression position on the emitted legs and an async evaluator in RT-1.
  Either one reintroduces the microtask divergence RT-2 exists to prevent. A
  synchronous call boundary and an awaiting callee are mutually exclusive; the
  slice keeps the synchronous boundary and fails the callee closed. An entry
  capability alongside a call is unaffected and still requires a provider.

### Semantics on all three legs

- A callee body runs on an explicit frame stack with no recursion into an
  awaited call, so no microtask boundary is crossed anywhere in a call chain.
- Arguments are evaluated left to right, exactly once each, before dispatch.
- Cancellation is checked at every callee statement boundary.
- `print` inside a callee appends to the caller's shared output buffer and
  consumes the caller's `maxEvents` budget.
- A callee links in its own scope: it sees only its parameters, never the
  caller's bindings, and its bindings never escape.
- Envelopes are byte-identical across RT-1, emitted JavaScript, and emitted
  CPython.

### Meter and tick

One step for the call node, one step per argument node left to right, one
dispatch step, and the callee's body statement steps. The callee's `return`
consumes no statement step, and returning to the caller costs nothing. Measured
against a `return value="flag"` control: one call costs exactly 3 more execution
steps, a second dispatch another 3, a two-argument call with a three-node body 6,
and a callee `let` 2.

### Format compatibility

`LinkedKernKirProgram.program` is untouched. An optional name-sorted `helpers`
field is added and is *omitted entirely* when no call is reached. All user-call
lowering lives in the specialized source of each emitter, never in the shared
target kernel, so `TARGET_KERNEL_SHA256` is unchanged.

**Blocking oracle, verified:** for five call-free fixtures (literal, ordering,
binary, branch, capability) the linked program digest, the emitted JavaScript
artifact and manifest, and the emitted Python artifact and manifest are all
byte-identical to a pristine pre-slice rebuild. This was measured by restoring
all eight production files from pristine copies, rebuilding, recording every
digest, restoring the slice, rebuilding, and diffing — the diff is empty.

The RT-2 K0 golden is byte-identical at
`aa7f116d1b5ad758f7b58f358c026f34c08232bd5311dee4d5ad1211e90afaa0`. The RT-3 K0
golden gains exactly one element, `"user-call"`, in its recomputed
`linkedExpressionKinds` inventory, which the RT-4 FORM clause makes unavoidable;
its pre-slice bytes are reproduced exactly by removing that one element, and the
compatibility suite asserts that reconstruction against
`4aa59f328e23abb9c799eb11dc7a1fbb5aa935461191f06e082816d8e2c8c6fa` rather than
merely pinning a new hash.

## Implementation Approach

One shared closed `user-call` variant, one on-demand helper resolver in the
linker, and one specialization per target. The linker builds the module's
function map lazily, so a call-free program pays no additional meter step and
its link cost is unchanged. `LinkedKernKirTypeScope` gains a `calls` resolver
and a `crossCallTypes` map; branch scopes copy both, so RT-2's branch isolation
still holds. RT-1 gains an `ExpressionRuntime` carrying the cancellation
checkpoint, the shared event buffer, the event budget, and the linked helpers,
which is what lets a callee print into the caller's buffer without RT-1
re-deriving effect semantics.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | Modified | `user-call` variant, the cross-call type contract, the helper record, the optional `helpers` field, and the post-order closure traversal. |
| `packages/core/src/kir-runtime/linked-kir-program/expression.ts` | Modified | User-call compilation, the cross-call type resolver, and bare-identifier callee admission. |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | Modified | Lazy module function map, on-demand helper linking with cycle detection, callee-capability rejection, and name-sorted helper emission. |
| `packages/core/src/kir-runtime/linked-kir-program/index.ts` | Modified | Re-export the cross-call contract and the helper accessor. |
| `packages/core/src/kir-runtime/expression.ts` | Modified | Synchronous callee frame walker, shared print buffer, argument and return tag guards. |
| `packages/core/src/kir-runtime/execute.ts` | Modified | Build the expression runtime once and pass the linked helper closure. |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | Modified | Named synchronous helper lowering in the specialized source. |
| `packages/core/src/compiler/kir-python/emitter.ts` | Modified | The Python twin of the same lowering. |
| `scripts/kern-5-rt4-user-fn-call/*` | Added | Probe matrix golden, behavior, type gate, effects, compatibility, tick discipline, K0 divergence, shared harness. |
| `scripts/kern-5-rt3-binary-expression/k0-golden.json` | Modified | One additive element in the recomputed expression-kind inventory. |
| `package.json` | Modified | Root `test:kern-5-rt4-user-fn-call` script mirroring the RT-3 script. |

Eight production files, 475 net production lines. No `packages/core/src` file
is added or removed, so the canonicalizer historical-transition gate does not
apply.

## Acceptance Criteria

- [x] A real F5 projection containing a user call is admitted by RT-1 and both
  package compiler exports in every probed position.
- [x] Return, `let`, `if` condition, binary operand, `print`, nested, zero- and
  two-argument, list-argument and list-return calls agree byte-identically on
  RT-1, emitted JavaScript, and emitted CPython.
- [x] Arguments evaluate left to right exactly once; a nested call dispatches
  exactly once per occurrence.
- [x] Exact arity, the closed cross-call type set, an argument without a static
  cross-call type, a member callee, an optional call, an unknown callee, a
  callee shadowed by a value binding, a cross-module callee, direct and mutual
  recursion, and any capability in the reachable callee closure all fail closed
  at link with `handler-entry-unsupported` on all three legs.
- [x] A callee `print` lands in the caller's buffer in dispatch order and
  consumes the caller's event budget on all three legs.
- [x] The metering model is exact and the callee return costs no statement step.
- [x] A capability-free call chain emits no `await` on either target; a
  queued-microtask abort at depths 0-4 is never observable mid-chain and RT-1
  and the emitted JavaScript agree; an already-aborted signal is refused before
  any call runs.
- [x] Every call-free linked digest, artifact and manifest is byte-identical to
  the pre-slice build, the `helpers` field is absent for call-free programs, and
  helper declaration order does not change the linked shape.
- [x] RT-2 (35/35), RT-3 (142/142) and the r1/r2/c-py-1/cli-shadow neighborhood
  (83/83) stay green.

## RED Oracle

`scripts/kern-5-rt4-user-fn-call/` runs entirely on the real F5 projection and
the built package exports. At base `1324f54a`:

| Suite | Tests | Failing at base |
| --- | --- | --- |
| `probe-matrix.test.mjs` | 4 | 3 |
| `behavior.test.mjs` | 8 | 8 |
| `type-gate.test.mjs` | 8 | 6 |
| `effects.test.mjs` | 5 | 4 |
| `compatibility.test.mjs` | 6 | 2 |
| `tick-discipline.test.mjs` | 5 | 5 |
| `k0-divergence.test.mjs` | 7 | 7 |

`compatibility.test.mjs` is partly green at base by construction: it pins the
byte identity that must survive the change, so those rows are a regression fence
rather than a RED gate.

## Verified Result

| Gate | Result |
| --- | --- |
| `scripts/kern-5-rt4-user-fn-call/probe-matrix.test.mjs` | 4/4 |
| `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs` | 6/6 |
| `scripts/kern-5-rt4-user-fn-call/behavior.test.mjs` | 8/8 |
| `scripts/kern-5-rt4-user-fn-call/type-gate.test.mjs` | 11/11 |
| `scripts/kern-5-rt4-user-fn-call/effects.test.mjs` | 7/7 |
| `scripts/kern-5-rt4-user-fn-call/tick-discipline.test.mjs` | 7/7 |
| `scripts/kern-5-rt4-user-fn-call/k0-divergence.test.mjs` | 7/7 |
| `pnpm test:kern-5-rt2-boolean-if` | 35/35 |
| `pnpm test:kern-5-rt3-binary-expression` | 142/142 |
| kern-5 r1 / r2 / c-py-1 / cli-shadow neighborhood | 83/83 |
| `packages/core` KIR unit tests | 185 assertions, exit 0 |
| `pnpm test:kern-canonicalizer` | see receipts below |
| `biome check` | clean on every touched file |

## Out of Scope

- Recursion and mutual recursion, deferred to a later slice with an explicit
  depth and budget contract.
- Capability effects inside a callee, which require an asynchronous call
  boundary and therefore a separate tick-discipline contract.
- Cross-module calls, member and dynamic callees, closures, and higher-order
  functions.
- Integer signatures and integer arguments across a call boundary, which F5
  rejects upstream today.
- Corpus clearance. This slice does **not** claim the four F5-clearing corpus
  files: they need more than calls.
- Any KIR schema or version change, release-gate promotion, push, merge, or
  deployment.

## Open Questions

None blocking.

## Deploy Order

1. Land the shared linked-program `user-call` variant, its type gate, the helper
   closure linker, and RT-1 execution.
2. Land both emitters in the same compatible change; neither target may accept a
   linked shape the other or RT-1 rejects.
3. Run the suite through the root `test:kern-5-rt4-user-fn-call` script. It needs
   Node 22 (`KERN_NODE22`) for the emitted-ESM leg and CPython 3.12
   (`KERN_PYTHON312`) for the emitted-Python leg, matching RT-2 and RT-3.

During an incomplete deployment a user call continues to fail closed as
unsupported; it must never fall back to source or host semantics.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| A call is admissible in capability-input position. | F5 rejects every `capability … input=` expression with `FRONTEND_EXCLUDED_HOST_EXPRESSION`, so the position does not exist. | The position was struck from the contract; the deep-effects test moved to a `capability` statement inside a transitively reached callee. |
| A capability anywhere in the reachable closure is executed and merely requires a provider. | A user call is a synchronous expression and RT-1's evaluator is synchronous, so an awaiting callee cannot exist without reintroducing the RT-2 microtask divergence. | A callee capability is rejected at link; the post-order closure traversal is both the rejecting mechanism and the entry's `hasCapability` computation. |
| The RT-3 K0 golden can stay byte-identical. | Its `linkedExpressionKinds` is recomputed from the `LinkedKernKirExpression` union, which the FORM clause requires to gain `user-call`. | The golden changes additively by exactly one element, and the compatibility suite proves it by reconstructing the pre-slice bytes rather than pinning an opaque new hash. |
| Helper-order invariance can be asserted on `LinkedKernKirProgram.sha256`. | That digest also covers `projectionArtifactSha256`, which legitimately tracks the source text, so reordering declarations changes it. | Invariance is asserted on the linked shape the slice owns, with a companion assertion that the two fixtures really are different source texts. |
| The capability closure traversal was linear. | It cycle-guarded with an active-path set deleted after each path, so a capability-free helper DAG was re-traversed once per path - exponential, unmetered and non-interruptible at link time. Found by high-risk review. | The walk is memoized with an exact cycle-taint rule, the linker shares one walk, and a 24-helper diamond ladder asserts exactly 24 visits. |
| An acyclic chain was safe because cycles are rejected. | A deep acyclic chain still recurses on the host stack in RT-1, the linker, and both emitted targets, so legs could diverge on where they overflow. Found by high-risk review. | A configurable link-time `maxCallDepth` policy rejects deeper reachable chains before any leg runs one. |
| A capability could never reach helper emission. | Link rejects it, but `helperSource` still routed a capability statement through `capabilitySource`, an invalid-code emission path that would have written `await` into a synchronous helper. Found by high-risk review. | Both emitters throw before emitting such a helper, which the compilers map to the closed `artifact-emission-failure` code. |
| Any duplicate function name in the module is ambiguous. | That widened rejection beyond the reachable closure. F5 in fact rejects a duplicate function name outright, so no such projection exists, but the linker rule was still wrong. Found by high-risk review. | Duplicates are recorded as ambiguous and only fault when a call actually resolves to one; the frontend fact is pinned as a fixture. |
| `matchesType` belongs to `execute.ts`. | The callee frame walker needs it too. | It moved to `kir-runtime/expression.ts` and `execute.ts` imports it, keeping one definition. |
