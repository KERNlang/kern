# KERN 5 R2 M3.13 Private Effect-Machine Try Ownership

**Status:** READY TO BUILD
**Date:** 2026-07-13
**Confidence:** 0.94

## Executive Summary

Move the complete existing portable `try`/`catch`/`finally` contract into the
private resumable effect machine. Extract the pure try shape contract from the
legacy runner, add a callback-driven machine try executor, extend whole-tree
preflight with completion-aware unwind analysis, and flip `try` from `legacy`
to `unified` only after the complete RED matrix is green. Preserve catch-all
canonical errors, same-environment catch execution, post-catch tombstoning,
cleanup-only finally, completion preservation, shared loop budgets, and raw
sync/async capability parity.

This design incorporates the required tribunal and confidence-threshold
brainstorm:

- `/Users/nicolascukas/.agon/runs/tribunal-1783932718572-lyyrpe`
- `/Users/nicolascukas/.agon/runs/brainstorm-1783932956590-jy907c`

## Current State / Root Cause

- **VERIFIED:** the machine disposition is closed and still records
  `try: 'legacy'` (`packages/core/src/ir/semantics/internal-effect-machine-types.ts:8-27`).
- **VERIFIED:** root eligibility special-cases branch/for/while/array-each and
  if/else, while other body-bearing nodes fail the generic unified-node check
  (`packages/core/src/ir/semantics/internal-effect-machine-structure.ts:17-40`).
- **VERIFIED:** the machine performs whole-tree structure preflight before it
  starts the recursive generator or invokes a capability
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:34-46`).
- **VERIFIED:** the sequence dispatcher recursively owns if, branch, for,
  array each, and while frames, and capability suspension; it has no try frame
  (`packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:188-230`).
- **VERIFIED:** the legacy sync try contract calls `referenceRunSequence` for
  body, catch, and finally and enforces body-return-with-catch, tombstoning,
  cleanup-only finally, and prior-completion preservation
  (`packages/core/src/ir/semantics/try.ts:73-131`).
- **VERIFIED:** the legacy async runner duplicates that contract and imports
  `tryPreconditions`, `tryRuntimeParts`, and `UNAVAILABLE_CAUGHT_ERROR` from
  the legacy `try.ts` module (`packages/core/src/ir/semantics/async-reference-runner.ts:59-62,393-438`).
- **VERIFIED:** `try.ts` is therefore not a legal machine dependency: it
  directly imports `reference-runner.ts` (`packages/core/src/ir/semantics/try.ts:34-39`).
- **VERIFIED:** completion records are the closed set `normal | return | throw |
  break | continue` (`packages/core/src/ir/semantics/trace.ts:13-23`).
- **VERIFIED:** child scopes read through and assign through to parents, while
  `defineBinding` declares in the current scope
  (`packages/core/src/ir/semantics/index.ts:171-236`).
- **VERIFIED:** the current M3.13 manifest is explicitly routing-only and has
  14 cases; it still incorrectly says the catch binding is restored and has
  only one abrupt-finally witness
  (`packages/core/tests/fixtures/runtime-envelope-try-m3-13-contract.json:1-4,55-68,136-150`).

The root blocker is not try semantics themselves. It is ownership: importing
the current `try.ts` would make a legacy runner transitively reachable, and
inlining unwind logic into the sequence dispatcher would undo the architecture
boundary completed in M3.12.

## What Already Works

- The legacy sync and async try paths are the behavior oracle; neither is
  removed in M3.13.
- Explicit canonical throws already produce structural `throw` completions;
  literal `new Error(<string>)` throws carry the caught `.message` value
  (`packages/core/src/ir/semantics/primitives.ts:153-195`).
- The machine already preserves abrupt completions through if, branch, and all
  owned loop frames and shares one mutable iteration budget
  (`packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:115-179`).
- Sync and async drivers already consume one generator request format
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:49-79`).
- Runtime-envelope normalization remains transactional; failures expose no
  partial events (`packages/core/src/runtime-envelope/execute.ts:30-75`).
- Existing stable imports from `internal-effect-machine.js` remain unchanged.

## Contract (Verified)

> Verified against the cited source files on 2026-07-13.

| Behavior | M3.13 contract | Evidence | Tag |
|---|---|---|---|
| Protected body | Runs through the same resumable child-sequence callback | `internal-effect-machine-sequence.ts:188-230` | VERIFIED |
| Catch selection | One catch handles only a canonical `throw` completion | `try.ts:81-117` | VERIFIED |
| Catch value | Literal canonical error produces tagged `.message`; unavailable message produces tombstone | `portable-error.ts:30-38`; `try.ts:104-106` | VERIFIED |
| Catch scope | Catch executes in the current environment and its name is always overwritten with `UNAVAILABLE_CAUGHT_ERROR` afterward; an outer same-name value is not restored | `try.ts:94-116`; `ir-semantics-try.test.ts:126-141` | VERIFIED |
| Catch completion | Replaces the caught throw completion | `try.ts:116-117` | VERIFIED |
| Finally order | Runs after body or selected catch on every portable completion path | `try.ts:120-130` | VERIFIED |
| Finally domain | Cleanup must have only a normal possible completion; normal cleanup preserves the pending completion | `try.ts:120-130` | VERIFIED |
| Return with catch | Any possible return from the protected sequence is outside the portable domain | `try.ts:81-83`; `ir-semantics-try.test.ts:120-124` | VERIFIED |
| Loop control | Body/catch break or continue propagates through normal finally and is consumed by the nearest machine loop; finally-local loop control is valid only when consumed by a loop inside finally | `internal-effect-machine-sequence.ts:115-179`; `trace.ts:13-23` | VERIFIED |
| Provider failure | Remains an envelope failure, never a caught KERN throw; the suspended generator is unwound only to run host cleanup such as catch tombstoning | `internal-capability-interceptor.ts:160-171`; `execute.ts:30-75` | VERIFIED |
| Public surface | No public runtime/handler ABI or package export changes | `internal-effect-machine.ts:23-32`; `scripts/check-runtime-envelope.mjs:177-180` | VERIFIED |

## Selected Design

### 1. Pure try contract leaf

Add `try-runtime.ts` and move these definitions from `try.ts` without semantic
change:

- `TryParts`
- `UNAVAILABLE_CAUGHT_ERROR`
- `tryRuntimeParts`
- `tryPreconditions`

`try.ts` imports and compatibility-re-exports them. The async reference runner
imports them directly from `try-runtime.js`. The leaf imports only `IRNode` and
the `SemanticEnv` type; it must not import either reference runner or any effect
machine module.

### 2. Callback-driven try generator

Add an `InternalEffectMachineChildSequenceRunner` type to the machine contract
module. Add `internal-effect-machine-try.ts` with:

```text
runInternalEffectMachineTry(node, env, state, runChildSequence)
```

The sequence dispatcher imports this function and passes
`runInternalEffectMachineSequence` as the callback. The try module never
imports the sequence module, stable driver, structure module, legacy `try.ts`,
or either reference runner.

Runtime order is exact:

1. Run protected body and append its events.
2. On canonical throw with catch, bind caught value, run catch, always tombstone
   the binding in a generator `finally`, append catch events, and replace the
   throw completion.
3. Run finally when present, append its events, assert normal completion, and
   preserve the pending completion.
4. Return one trace through the existing generator.

### 3. Completion-aware whole-tree preflight

Refactor the structure owner so its recursive walk both validates every node
and returns the set of possible structural completion kinds. The public
`assertInternalEffectMachineStructureSupported` remains a void facade.

Sequence composition preserves prior abrupt possibilities and advances only
the still-normal path. Every later sibling is still structurally validated,
even when an earlier node makes it unreachable.

| Node/frame | Possible completion treatment |
|---|---|
| ordinary unified node/capability | normal |
| return/throw/break/continue | matching completion |
| if/else | union of both arms; missing else also admits normal |
| branch | union of every path plus conservative normal no-match |
| while/for/each | consume break/continue; propagate return/throw; admit normal |
| try with catch | body throw is replaced by catch possibilities; other body possibilities propagate |
| try finally | finally must analyze to exactly normal; body/catch possibilities are preserved |

Try-specific preflight:

- validate shape with `tryPreconditions`;
- analyze body, catch, and finally even if a clause is unselected;
- reject a try with catch when protected-body possibilities contain `return`;
- analyze finally with loop depth reset to zero, so direct break/continue are
  rejected while break/continue consumed by a loop inside finally are allowed;
- require finally possible completions to equal `{normal}`; this rejects
  unconsumed return/throw/break/continue while allowing a nested try whose throw
  is caught and completes normally;
- recurse through nested try with the same rules.

This analysis runs once before the first generator request, so invalid body,
catch, or finally structure cannot dispatch a capability or expose a trace.

### 4. Driver cleanup on provider failure

When a sync/async provider invocation rejects, inject the same error into the
suspended generator with `machine.throw(error)` before rethrowing it. This does
not turn provider errors into KERN catchable completions and does not execute a
KERN finally. It only permits JavaScript generator `finally` blocks, notably
the catch-name tombstone, to run before envelope failure normalization.

### 5. Atomic ownership flip

Keep `try: 'legacy'` while observing RED. After the leaf, preflight, generator,
and acceptance suite are green together, change it once to `try: 'unified'`.
No environment flag, legacy fallback, or partial bridge is admitted.

## Dependency Graph

```text
internal-effect-machine.ts
  -> internal-effect-machine-sequence.ts
       -> internal-effect-machine-try.ts
            -> try-runtime.ts
            -> portable-error.ts
            -> index.ts + trace.ts + internal-effect-machine-types.ts
  -> internal-effect-machine-structure.ts
       -> try-runtime.ts + shape leaves + internal-effect-machine-types.ts

try.ts -> try-runtime.ts + reference-runner.ts
async-reference-runner.ts -> try-runtime.ts + async legacy execution
```

The machine closure may reach `try-runtime.ts`; it may not reach `try.ts`,
`reference-runner.ts`, or `async-reference-runner.ts`.

## Test-First and Manifest Plan

1. Correct the routing-only manifest while it is still green:
   - rename restore to tombstone;
   - use explicit `new Error("boom")` for caught-message evidence;
   - split abrupt finally into direct return/throw/break/continue cases;
   - add return-with-catch witnesses through direct, if/else, branch, each,
     for, while, and nested-try placements;
   - add nested try in body/catch/finally;
   - add break/continue through try/finally in loops;
   - retain try-in-while/for/array-each and loops-in-try coverage.
2. Add a closed acceptance-handler map keyed by every manifest ID. Assert its
   sorted keys exactly equal the manifest IDs, so no case is prose-only.
3. Observe the complete M3.13 acceptance suite RED for missing machine try
   ownership; do not commit the red tree.
4. Extract `try-runtime.ts`, migrate legacy consumers, and run existing sync/
   async try tests to prove behavior preservation.
5. Implement completion-aware structure analysis and the callback try runner.
6. Add provider-failure tombstone regressions for sync rejection and async
   rejection/cancellation.
7. Flip disposition once and turn manifest `currentEvidence` from
   `routing-only` to `executable-machine-acceptance`.
8. Run focused tests, the runtime-envelope family gate, the complete KERN 5
   fitness wall, and terminal full-roster Agon review.

## Import and Architecture Oracle

Extend the guard from literal direct-call scanning to a small static relative
import-closure walk over the machine-family TypeScript sources. It must prove:

- the new try machine module does not directly or transitively reach `try.ts`,
  either reference runner, the sequence module, stable driver, or runtime
  envelope;
- the pure leaf does not reach any legacy runner or machine module;
- the async legacy runner imports the pure symbols from `try-runtime.js`;
- `try.ts` remains the only sync legacy owner allowed to call
  `referenceRunSequence`;
- every machine-family handwritten file remains below 500 lines;
- stable driver imports and exports remain unchanged.

Mutation tests must demonstrate that adding a forbidden `.js` import edge to
the analyzed graph fails the closure oracle; checking only for a source literal
is insufficient.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `try-runtime.ts` | add | legacy-free shape/tombstone contract leaf |
| `try.ts` | modify | consume/re-export pure leaf; preserve sync legacy oracle |
| `async-reference-runner.ts` | modify | import pure helpers without traversing sync legacy owner |
| `internal-effect-machine-types.ts` | modify | callback type and final disposition flip |
| `internal-effect-machine-structure.ts` | modify | completion-aware try preflight |
| `internal-effect-machine-try.ts` | add | resumable try/catch/finally executor |
| `internal-effect-machine-sequence.ts` | modify | dispatch try through callback runner |
| `internal-effect-machine.ts` | modify | unwind suspended generator on provider failures |
| M3.13 manifest/test and focused try test | modify/add | complete executable acceptance matrix |
| architecture test + runtime guard | modify | direct/transitive legacy-edge oracle |
| fitness policy/support matrix/release train | modify | publish internal M3.13 evidence only after gates |

## Acceptance Criteria

- [ ] Pure helper extraction leaves all existing sync/async reference try tests
  byte-equivalent and green.
- [ ] Root and nested portable try nodes select and remain in the effect machine;
  no machine execution path can reach a legacy runner.
- [ ] Unsupported nodes anywhere in body, catch, or finally fail before provider
  calls and before trace events.
- [ ] Body return with catch rejects during preflight for direct, if/else,
  branch, while, for, array-each, and nested-try placements.
- [ ] Cleanup-only finally rejects every possible unconsumed return, throw,
  break, or continue before effects, while allowing loop-consumed control and
  a normal-completing nested caught throw.
- [ ] Catch observes a literal canonical error message, replaces the throw
  completion, and tombstones its name on normal, abrupt, sync-provider-error,
  and async-provider-error exits without restoring an outer binding.
- [ ] Finally preserves normal, return, uncaught throw, caught-throw, break, and
  continue completions and emits events in body/catch then finally order.
- [ ] Capabilities suspend and resume in body, catch, and finally with byte-equal
  raw sync/immediate-async traces.
- [ ] Try inside while, counted for, and array each shares the caller iteration
  budget; loops inside body, catch, and finally remain machine-owned.
- [ ] Nested try works in body, catch, and normal finally without fallback.
- [ ] Every manifest ID has exactly one executable acceptance handler; the
  manifest is unique, categorized, and contains no skip/todo/only/disabled key.
- [ ] Import mutation tests fail forbidden direct and transitive legacy edges.
- [ ] Focused try/core/runtime-envelope tests and `pnpm fitness:kern-5` pass.
- [ ] Terminal `agon review` with `claude,codex,agy` passes with no unresolved
  verified or needs-check finding.

## Out of Scope

Typed or multiple catches, implicit host/provider errors as catchable KERN
throws, raw error objects, finally-overrides-completion semantics, labeled loop
control, pair/entry/pseudo-async each ownership, linking/modules, value-format
widening, public runtime or handler ABI promotion, legacy runner removal,
public exports, package versions, and release tags.

## Open Questions

None. Every selected-path claim is source-verified or fixed by the tribunal and
brainstorm evidence above.

## Deploy Order

One internal branch commit ships the leaf extraction, legacy-consumer migration,
preflight, generator, disposition flip, guards, tests, and receipts together.
The private envelope remains default-off, so there is no external version-skew
window. Rollback is one commit and returns static try routing to legacy.

## Corrections Log

| Original claim | Reality | Impact |
|---|---|---|
| The machine try module can import pure helpers from `try.ts`. | `try.ts` imports `referenceRunSequence`; that makes the legacy runner transitively reachable. | Extract `try-runtime.ts`; machine code never imports `try.ts`. |
| Catch restores a prior same-name binding. | Existing sync and async contracts deliberately tombstone it because cross-target restoration is non-portable. | Correct manifest and assert tombstoning on every exit. |
| Reject every abrupt descendant anywhere in finally. | Loop-local break/continue may be consumed, and a nested caught throw may complete normally. | Use completion-aware analysis and require finally's resulting set to be exactly normal. |
| A callback creates serialized frame indirection. | Current machine state contains only the shared iteration budget, and every existing frame already delegates via `yield*`. | Callback-driven module split is non-circular generator delegation. |
| Provider rejection automatically unwinds generator cleanup. | Drivers invoke providers while the generator is suspended and currently abandon it on throw. | Inject the error with `machine.throw` solely to run host cleanup, then preserve envelope failure. |
