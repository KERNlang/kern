# KERN 5 — D.0 `linked-kir-program` split, c-py-1 inventory transition, try-family reservations

**Status:** SPEC — ORACLE NOT YET WRITTEN
**Date:** 2026-09-08
**Confidence:** 0.91

**Ratified by the coordinator, 2026-09-08:** OQ-2 — the 13th diagnostic code is `'uncaught-throw'`
and **no** RC-v1 amendment record is created. OQ-3 — the inventory transition stays **354 → 357**;
`kir-runtime/expression.ts` has no clean cut today (analysis under *OQ-3, decided*). OQ-1 is closed
and VERIFIED, with a finding that adds one required edit to the Blast Radius.

**Depends on slice C landing at commit `1ef72e0d`** — `feat/kern-5-rt12-linked-jumps`
@ `1ef72e0d07c749f29963164876af3d5bdc495d53` (`test(kern5): register jump Python deferrals`). This
branch (`feat/kern-5-d0-contracts-split`) is cut from that commit. Slice C is **IN PROGRESS in its
own worktree**; every line/count in this document was read from the `1ef72e0d` checkout at
`/Users/nicolascukas/KERN/.worktrees/kern-5-d0-split` and must be re-derived if slice C's head
moves before D.0 branches. D.0 **must not merge before slice C**: three of the pins it moves
(`scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs`, `.../walker-coverage.test.mjs`) do not
exist on `main`.

D.0 is the prerequisite slice ruled by the try/catch tribunal
(`tribunal-1788825104594-tszgc4-kern5-try-catch-design`, verdict §RECOMMENDATION): *"Split
contracts.ts, amend the c-py-1 354-file inventory pin. Reserve the full try-family label set (D and
D2) and the `USER_THROW` diagnostic code. Nothing else."* Its whole reason to exist is that the
compiled-core inventory pin is a **once-per-slice** artifact, so every new module slice D will need
must be created in this one transition (tribunal KEY INSIGHT 3, "amortize the amendment surface").

## Executive Summary

D.0 is behaviour-preserving. It (1) splits `contracts.ts` (535 lines) and `link.ts` (735 lines) into
five files, all under 500 lines and each with headroom for slice D's `compileTry`/`compileCatch`/
`tryDepth`; (2) moves the compiled-core inventory pin from **354 to 357** through a new head-stage
historical-transition module, the pattern the chain already uses five times; (3) adds the thirteenth
member of `KernKirDiagnosticCode`, reserving the code an uncaught user throw will carry; (4) reserves
the eight try-family link labels in a checked-in JSON registry with an oracle row proving none is
emitted; (5) pins the `__Fault` construction-site census so a future capability slice cannot quietly
make host failures catchable.

No emitter changes, no union changes to `LinkedKernKirStatement`/`LinkedKernKirExpression`, no new
limit, no kernel byte. `TARGET_KERNEL_SHA256` on both legs stays fixed. The public surface of
`linked-kir-program/index.js` is byte-for-byte the same export list.

The two findings that change the tribunal's plan are in **Contract (Verified)** rows C-6 and C-7:
the RC-v1 amendment chain **does not govern `KernKirDiagnosticCode`**, and a zero-drift amendment
record is structurally rejected by `composeAmendmentChain`. The 13th code is therefore added
*without* an RC-v1 amendment, and it is named `'uncaught-throw'` — the spelling RC-v1 already froze
for exactly this outcome — rather than a new `'user-throw'`.

## Current State / Root Cause

| Fact | Evidence | Tag |
|---|---|---|
| `linked-kir-program/contracts.ts` is 535 lines | `wc -l`, 2026-09-08 | VERIFIED |
| `linked-kir-program/link.ts` is 735 lines | `wc -l`, 2026-09-08 | VERIFIED |
| `linked-kir-program/expression.ts` 358, `index.ts` 43 | `wc -l`, 2026-09-08 | VERIFIED |
| The 500-line rule is repo doctrine and rt12 tracks the breach | `.Codex/specs/kern-5-rt12-linked-jumps/spec.md:824,858` (RT12J-TD7: *"the splits stay queued behind the 354-file inventory pin"*) | VERIFIED |
| A previous attempt at exactly this split was **withdrawn** | `git show e105f1da --stat`: `walkers.ts` −190 lines, folded back into `contracts.ts` +185, commit subject *"keep both expression walkers in contracts.ts with the tripwire"* | VERIFIED |
| `KernKirDiagnosticCode` is twelve members | `packages/core/src/kir-runtime/contracts.ts:67-78` | VERIFIED |
| Link labels are **inline string literals** inside `fault()` messages — there is no registry | `grep -n 'KIR_[A-Z_]*' link.ts` → 20 hits, all inside template literals; the single exception is `ASYNC_POSITION_LABEL` at `link.ts:284` | VERIFIED |
| `KIR_LOOP_JUMP_CROSSES_TRY` is reserved and spent nowhere | `scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs:74,155-165` asserts it is absent from `link.ts`, `linked-kir-program/contracts.ts`, `kir-runtime/contracts.ts` | VERIFIED |

The root cause of the withdrawal in `e105f1da` is **two** independent gates, not one:

1. **The inventory pin.** `reconstructCPy1LoweringCompiledCoreJavaScriptPaths(paths)` hard-fails
   unless the live `packages/core/dist` JavaScript inventory is *exactly* 354 paths hashing to
   `78ab887d…` (`scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:11-12,92-96`).
   Any new source module — **including a types-only one**, because tsc still emits a `.js` for it
   (precedent: `ir/semantics/internal-effect-machine-types.js` is a real inventory member, see
   `runtime-text-cache-historical-transition.mjs:16-21`) — breaks that gate.
2. **Source-text scrapes.** Thirteen prior-slice test files read
   `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` **by path** and slice regions out
   of it with `indexOf` markers. Five of those markers are the *walker function names*
   (`function statementSubBlocks`, `function expressionVariantUnhandled`). Moving those functions
   makes `indexOf` return `-1`, `slice(start, -1)` silently returns the whole rest of the file, and
   the assertions keep passing **vacuously**. This is the failure mode the split must not create.

## What Already Works

- **The historical-transition chain is the licensed mechanism and already has five stages.**
  `314 → 316` (text-splice) `→ 317` (runtime-text-cache) `→ 318 → 322` (frontend-projection)
  `→ 332` (r1-runtime-owner) `→ 346` (r2-js-lowering) `→ 354` (c-py-1, current head). Verified by
  reading `count:` in each `scripts/kern-canonicalizer/*historical-transition.mjs`. D.0 adds a new
  head; it does **not** rewrite c-py-1's numbers.
- **`index.ts` is the only consumed seam.** Every in-tree importer of the linked program reaches it
  through `linked-kir-program/index.js` (`kir-runtime/expression.ts:18`, `execute.ts:34`, both
  emitters, both compiler `index.ts`/`contracts.ts`), and every oracle harness imports
  `dist/kir-runtime/linked-kir-program/index.js`. **Exactly one** file reaches past it:
  `scripts/kern-5-rt6-void-fallthrough/k0-support.mjs:5` imports `LINKED_KIR_TYPE_ADMISSION` from
  `dist/.../contracts.js`. That symbol does not move.
- **The c-py-1 Python closure gate is unaffected.** It polices the *stdlib import allowlist of
  emitted Python* (`.Codex/specs/kern-5-c-py-1-threading-import-contract/spec.md:9`). D.0 changes no
  emitter, so no emitted import moves.
- **`uncaught-throw` is already a frozen public diagnostic code** with a golden behaviour
  (`scripts/runtime-contract-v1/constitution.json:96`,
  `public-declaration-schema.json:18`, `goldens.json:83-90,306,320` `failure-uncaught-throw`).
  Nothing needs inventing.
- **RT-1, both emitters, both kernels, the F5 policy, the 240-file census** are all out of scope and
  must be byte-identical.

## Contract (Verified)

> Verified against the `1ef72e0d` checkout at `/Users/nicolascukas/KERN/.worktrees/kern-5-d0-split`
> on 2026-09-08, plus the commands quoted inline.

| # | Claim | Evidence | Tag |
|---|---|---|---|
| C-1 | The inventory head pin is `{count: 354, digest: 78ab887d…}` and the gate is exact-equality on both | `scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:11-12`; gate at `:92-96` `fail('C-PY-1 lowering historical membership requires the authenticated current inventory')` | VERIFIED |
| C-2 | The chain is wired in one place, head-first | `scripts/kern-canonicalizer/coverage-dependencies.mjs:337-340` — `reconstructCPy1Lowering…(paths)` is called with the **live** paths, its result feeds r2-js-lowering, then r1-runtime-owner, then frontend-projection | VERIFIED |
| C-3 | A new dist file also moves `compiledCoreDigest`, which is hard-pinned as a literal in one test | `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:97` `compiledCoreDigest: '9f6fcf18ec2dfcf2a3ffd2d22d39fd05cca9c7b537b03f7b56c0726c3fde346e'`; same value in `coverage-summary.json:138`; regenerable via `pnpm write:kern-canonicalizer-coverage` (`package.json:130`) | VERIFIED |
| C-4 | `coverageImplementationDigest` path-frames every executed module under `scripts/kern-canonicalizer/`, so the new transition module moves it too | `coverage-dependencies.mjs:93` `IMPLEMENTATION_ROOT = scripts/kern-canonicalizer`; `coverage-integrity.test.mjs:552` *"the implementation digest path-frames every executed local dependency"*; it is **self-referential** in the prerequisite test (`coverage-prerequisite.test.mjs:99`), so it needs no hand re-pin | VERIFIED |
| C-5 | **Three** rt suites pin `KernKirDiagnosticCode` at twelve, not one | `scripts/kern-5-rt10-for/compatibility.test.mjs:46-58,142-151` (`RT10F_CODE_CREEP`), `kern-5-rt11-linked-while/compatibility.test.mjs:58-70,175-184` (`RT11W_CODE_CREEP`), `kern-5-rt12-linked-jumps/compatibility.test.mjs:54-66,184-193` (`RT12J_CODE_CREEP`) | VERIFIED |
| C-6 | **The RC-v1 amendment chain does not govern `KernKirDiagnosticCode`.** The four governed artifacts are `constitution.json`, `public-declaration-schema.json`, `goldens.json`, `proof-inventory.json` | `scripts/runtime-contract-v1/amendment-chain.mjs:8-13` `AMENDMENT_DIGEST_KEYS`. Proof of non-governance: `KernKirDiagnosticCode` already carries `projection-authentication-error` and `runtime-limit-exceeded` (`kir-runtime/contracts.ts:67-78`), **neither of which appears** in `constitution.json:82-98`; conversely the constitution carries `encoded-limit`, `escaped-control`, `internal-runner-error`, `non-portable-value`, `uncaught-throw`, which the KIR union does not. The two sets are siblings, not sub/superset | VERIFIED |
| C-7 | **A zero-drift amendment record is structurally impossible.** If `resultDigests === parentDigests`, `composeAmendmentChain`'s `next` filter matches the record itself and the walk fails `'amendment chain cycles'`; and a record authored *without* `resultDigests` fails `'pending amendment names no artifact drift'` unless a live artifact really moved | `amendment-chain.mjs:88-97`; `amend.mjs:46-58` | VERIFIED |
| C-8 | `constitution.diagnostics.codes` must equal the **built public handler ABI** union exactly, so widening the constitution widens a public type | `scripts/runtime-handler-public-declaration.mjs:147-152` compares `stringLiteralUnion(sourceFile,'KernRuntimeHandlerDiagnosticCode')` to `constitution.diagnostics.codes` and fails `'diagnostic code inventory drifted'`; the mutation row at `scripts/runtime-contract-v1/declaration.test.mjs:38-41` pins that behaviour. `validate-runtime-contract-v1.mjs:15-31,140` holds the same list a second time as `EXPECTED.diagnosticCodes` | VERIFIED |
| C-9 | Every file under `scripts/runtime-contract-v1/` is listed in the alpha-receipt policy `bindings` array (125 entries today, paths only, no digests) | `scripts/kir-v1/alpha-receipt-policy.json` `bindings[90..118]`; consumed by `scripts/kir-v1/alpha-receipt.mjs:10` and pinned by `scripts/kern-5-parity-ledger/frozen-surface.test.mjs:23` | VERIFIED |
| C-10 | `__Fault`/`_Fault`/`KernKirFault` construction sites, by file (2026-09-08) | JS kernel **39**: `kir-js-esm/emitter.ts` 24, `target-base.ts` 6, `target-json.ts` 5, `target-execution.ts` 4, across **10** distinct codes. Python kernel **40**: `kir-python/emitter.ts` 21, `target-base.ts` 7, `target-json.ts` 6, `target-execution.ts` 6. TS runtime `new KernKirFault(` **53**: `kir-runtime/expression.ts` 20, `inspect.ts` 12, `execute.ts` 11, `json.ts` 3, `linked-kir-program/expression.ts` 2, `link.ts` 2, `deadline.ts` 1, `envelope.ts` 1, `linked-kir-program/contracts.ts` 1 | VERIFIED |
| C-11 | **`capability-error` is raised as a `__Fault` today**, so the tribunal's phrasing "capability/host failures never raise `__Fault`" is not a description of the present code | `kir-js-esm/emitter.ts:187,421`; `kir-python/emitter.ts:180,415` | VERIFIED |
| C-12 | Nothing catches a `KernKirFault` and resumes handler execution; the only catch is the request boundary | `kir-runtime/execute.ts:234-247`; mirrored in the JS emitter at `emitter.ts:434-445` | VERIFIED (facts pack §4, re-checked) |
| C-14 | **`coverage-integrity.test.mjs` has a second exact-inventory assertion that D.0 must edit.** The list at `:336-392` is a pure *sensitivity fixture* (each named path's bytes are perturbed and the digest asserted to move) and is unaffected by new files. The list at `:404-454` is **not**: `omitted = currentPaths.filter(p => !historicalPaths.includes(p))` is `deepEqual`'d against a hard-coded 50-entry list, so each new dist path lands in `omitted` and fails it | `coverage-integrity.test.mjs:336-392` vs `:394-404` + the 50-entry literal at `:404-454`. `POST_M4145_COMPILED_CORE_PATHS` (`coverage-dependencies.mjs:97-107`) does **not** need them: it filters the already-stripped 317-path set (`reconstructM4145CompiledCoreJavaScriptPaths` gates its input on `M4145_SUCCESSOR_COMPILED_CORE_INVENTORY` = `{317, …}` at `:280-286,93-95`) | VERIFIED |
| C-15 | There is **one** head insertion point for both apparent chains. `reconstructRunnerCallCacheCompiledCoreJavaScriptPaths` is itself the composite that runs c-py-1 → r2-js → r1-runtime-owner → frontend-projection internally, so the test's chain and the coverage chain share the same first call | `coverage-dependencies.mjs:336-346` — the function body's first statement is `reconstructCPy1LoweringCompiledCoreJavaScriptPaths(paths)` at `:337` | VERIFIED |
| C-16 | The repo already owns a fail-loud extraction helper, built for exactly the vacuity trap in C-13 | `scripts/kern-5-rt6-void-fallthrough/k0-support.mjs:86-96` `between(source, start, end, label)` — asserts both markers present and the slice non-empty; its own comment names the `indexOf` `-1` tautology. Used by rt10-pre and rt12 tick-discipline; **not** used by any of the 13 `contracts.ts` scrapes | VERIFIED |

### C-13 — the complete `contracts.ts` / `link.ts` text-scrape surface

Thirteen files read `linked-kir-program/contracts.ts` by path; two read `link.ts`. Two marker
families, with different fragility:

**Family 1 — end marker `'\nexport '` (survives any non-`export` extraction).** Requires only that
`export type LinkedKernKirStatement =` / `export type LinkedKernKirExpression =` stay in
`contracts.ts` followed by some later `export`.

| File | Scrapes |
|---|---|
| `scripts/kern-5-parity-ledger/ledger-support.mjs:131-146` | both unions (`unionKinds`) |
| `scripts/kern-5-rt2-boolean-if/k0-golden.test.mjs:43-45` | statement union |
| `scripts/kern-5-rt9-linked-assign/k0-golden.test.mjs:38-40` | statement union |
| `scripts/kern-5-rt3-binary-expression/k0-golden.test.mjs:33-35` | expression union |
| `scripts/kern-5-rt4-user-fn-call/probe-matrix.test.mjs:125-127` | expression union |
| `scripts/kern-5-rt10-pre-linked-arithmetic/k0-golden.test.mjs:26-36` | expression union **and** `export type LinkedKernKirUnaryOperator =` → `;` |
| `scripts/kern-5-rt10-cross-call-integer/k0-golden.test.mjs:32-35` | expression union |

**Family 2 — end marker is a *function name* (breaks silently into a vacuous pass if that function
leaves `contracts.ts`).**

| File | Start marker | End marker |
|---|---|---|
| `scripts/kern-5-rt10-for/compatibility.test.mjs:111-112` | `export type LinkedKernKirStatement =` | `function expressionVariantUnhandled` |
| `scripts/kern-5-rt10-for/walker-coverage.test.mjs:129-130` | same | `function expressionVariantUnhandled` |
| `scripts/kern-5-rt11-linked-while/compatibility.test.mjs:143-144` | same | `function expressionVariantUnhandled` |
| `scripts/kern-5-rt11-linked-while/walker-coverage.test.mjs:119-120` | same | `function expressionVariantUnhandled` |
| `scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs:141-142` | same | `function statementSubBlocks` |
| `scripts/kern-5-rt12-linked-jumps/walker-coverage.test.mjs:196-198` | same | `function statementSubBlocks` |

**`link.ts` scrapes (rt12 only).** `compatibility.test.mjs:158` — negative scan: `KIR_LOOP_JUMP_CROSSES_TRY`
absent from `link.ts`, `linked-kir-program/contracts.ts`, `kir-runtime/contracts.ts`.
`walker-coverage.test.mjs:235-238` — `link.indexOf('function containsReturn')` →
`link.indexOf('function assertLeaf')`, then asserts the sliced body names exactly
`['for','if','return','while']`. **These two functions must stay adjacent, in that order, in one
file**, and this scrape breaks *loudly* (extra kinds leak in) rather than vacuously if they separate
— so it is the one scrape that must be re-pointed explicitly.

Not scraped, therefore free to move: `expressionInvokesCapability`, `statementsInvokeCapability`,
`linkedStatementsInvokeCapability`, `expressionCallDepth`, `calleeDepth`, `statementsCallDepth`,
`linkedStatementsCallDepth`, `CapabilityClosure`, `LinkedKernKirClosureWalk`,
`createLinkedKirClosureWalk` (`contracts.ts:310-477`), and all of `link.ts` except the
`containsReturn`/`assertLeaf` pair.

## Implementation Plan

Four invariants bind every cut; the exact boundary lines are the implementer's, these are not.

- **INV-1 marker locality.** `export type LinkedKernKirStatement =`, `export type
  LinkedKernKirExpression =`, `export type LinkedKernKirUnaryOperator =`, `function
  statementSubBlocks`, `function statementSubExpressions` and `function
  expressionVariantUnhandled` all stay in `contracts.ts`, in that relative order. The three
  traversal primitives gain the `export` keyword (`export function statementSubBlocks` still
  *contains* `function statementSubBlocks`, so every Family-2 marker survives as a substring).
  `containsReturn` and `assertLeaf` stay adjacent, in that order, in whichever file they land in.
- **INV-2 acyclic module graph.** No import cycle among the five files.
  `link.ts → {statements.ts, link-support.ts}`, `statements.ts → link-support.ts`,
  `walkers.ts → contracts.ts`, `contracts.ts → ∅` (within the directory).
- **INV-3 identical public surface.** `linked-kir-program/index.ts` exports the same 39 names, and
  `dist/.../contracts.js` keeps `LINKED_KIR_TYPE_ADMISSION` (rt6's only direct reach-past).
- **INV-4 zero behaviour change.** No union member, no label string, no diagnostic message, no
  emitter byte, no kernel byte, no golden content.

### The split — file → contents → line estimate

| File | Status | Contents | Now | After |
|---|---|---|---|---|
| `contracts.ts` | edit | format const; binary/unary/cross-call operator tables and resolvers; call policy + scopes; **both unions**; parameter/return/type-kind types; `LINKED_KIR_TYPE_ADMISSION` + the two admits helpers; `LINKED_KIR_VOID_RETURN_TYPE`; the three now-exported traversal primitives; program/handler/helper/entry/result contracts; `KernKirLinkCode` | 535 | **~367** |
| `walkers.ts` | **NEW** | `contracts.ts:310-477` verbatim: `CapabilityClosure`, `LinkedKernKirClosureWalk`, `createLinkedKirClosureWalk`, `expressionInvokesCapability`, `statementsInvokeCapability`, `linkedStatementsInvokeCapability`, `expressionCallDepth`, `calleeDepth`, `statementsCallDepth`, `linkedStatementsCallDepth` | — | **~182** |
| `link-support.ts` | **NEW** | from `link.ts`: `fault`, `nodeKind`, `propertyText`, `propertyBool`, `propertySet`, `containsReturn`, `assertLeaf` (adjacent pair), `LinkScope`, `ModuleContext`, `branchScope`, `bindName`, `assignTargetName` | — | **~140** |
| `statements.ts` | **NEW** | from `link.ts:281-555`: `ASYNC_POSITION_LABEL`, `assertAsyncCallPosition`, `compileStatement`, `compileBranch`, `compileIf`, `LOOP_STEP_ONE`, `loopBound`, `compileFor`, `compileWhile`, `compileBlock` | — | **~285** |
| `link.ts` | edit | `authenticateLinkedKernKirProjectionOrThrow`, `parameterType`, `handlerReturnType`, `AMBIGUOUS`, `moduleFunctions`, `resolveHelper`, `helperIsAsync`, `callScope`, `compileHandler`, `selectHandler`, `linkVerifiedKernKirProgram{,OrThrow}` | 735 | **~365** |
| `index.ts` | edit | same export list; four names re-sourced to `./walkers.js` | 43 | 45 |

Dependency check done by reading the call graph: `assertAsyncCallPosition` needs only `fault` and
`containsAsyncCall` (`./expression.js`) — **not** `helperIsAsync` — so the statement layer does not
reach back into the helper layer, and INV-2 holds. `compileHandler` (link.ts) calls `compileBlock`
and `containsReturn`; both point downward.

**Slice D headroom after D.0:** `contracts.ts` +~40 (four union members and three walker arms) →
~407. `statements.ts` +~130 (`compileTry`, `compileCatch`, `compileFinally`) → ~415.
`link-support.ts` +3 (`tryDepth` on `LinkScope`, propagated in `branchScope`) → ~143. Nothing
approaches 500.

### Why `link.ts` is split **now**, not deferred to D

The inventory transition is the expensive, once-only artifact (C-1, C-2, C-3). Leaving `link.ts` at
735 forces slice D to either break the 500-line rule at ~885 lines or author a **second** head-stage
transition mid-slice — the exact waste the tribunal's amortization insight names. The cost of doing
it here is three new dist paths instead of one, in one transition.

**Rejected alternative:** split `contracts.ts` only (`walkers.ts`, N=1, 354→355). Cheaper diff,
but it re-opens the pin in D. Rejected on the tribunal's own reasoning.

### OQ-3, decided: `kir-runtime/expression.ts` is **not** split, transition stays 354 → 357

The ruling was: fold the RT-1 executor's split in if a clean behaviour-preserving cut exists now,
since the transition is once-only. Decided from the code — **no clean cut exists.** Three candidates,
all blocked:

| Candidate | Lines | Blocker |
|---|---|---|
| Leaf operand/evaluator layer — `operandFault`, `booleanOperand`, `integerOperand`, `operandsEqual`, `booleanValue`, `integerValue`, `BINARY_EVALUATORS`, `UNARY_EVALUATORS` | `68-125`, ~58 | **The only acyclic cut, and it is marker-blocked.** `scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs:124-127` does `between(source, 'const BINARY_EVALUATORS = Object.freeze({', 'export function calleeBindings', …)`, and `between` **asserts** both markers are present in the same text (C-16). `calleeBindings` cannot follow the tables out — it is called by `callHelper`, which is inside the walk cycle. Extracting the tables makes rt10-pre RED |
| `evaluateExpression` (± `callHelper`) | `310-402`, ~93 | **Cycle.** `walkStatements` → `evaluateExpression` → `callHelper` → `walkStatements` (`expression.ts:207,263,282,317,352`). Any boundary drawn here is a runtime import cycle |
| Loop/frame machinery — `ForLoopState`, `WhileLoopState`, `LoopState`, `WalkFrame`, `loopContinues` | `159-183`, ~25 | Type-only and acyclic, but 25 lines does not justify a dist path, and `loopContinues` is called from inside `walkStatements` |

Two further whole-file pins narrow it further: `source.split('checkAbort()').length - 1 === 2`
(`rt10-pre:141-144`) and the same census in `rt12/tick-discipline.test.mjs:51-57` are **whole-file**
counts, so any extraction that carried a `checkAbort()` site out would move them.

So the file stays at **402 lines with ~98 lines of headroom**, and the transition stays at three
added paths, **354 → 357**.

**Constraint handed to slice D:** `kir-runtime/expression.ts` must finish slice D under 500 lines.
If D's RT-1 arms (a try frame in `WalkFrame`, a `__UserThrow` walk-completion variant on
`StatementWalkResult`, the `catch` dispatch) exceed ~95 lines, D must open its own second head-stage
transition — and the honest cut is then the operand layer *plus* a licensed re-pointing of
rt10-pre's `between` end marker. That cost belongs to D, not to D.0: paying it here would buy 58
lines of headroom on top of 98 already-free lines, at the price of a prior-slice test edit.

### The c-py-1 inventory transition: 354 → 357

Follow the five-stage precedent exactly. New head module
`scripts/kern-canonicalizer/d0-contracts-split-historical-transition.mjs`, modelled line-for-line on
`c-py-1-lowering-historical-transition.mjs`:

```
export const D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  claim: 'kern.kir-runtime.linked-kir-program.split.v1',
  predecessorCommit: '<c-py-1 successor commit 7a45f489…>',
  successorCommit: '<D.0 merge commit, filled at land>',
  currentInventory:     { count: 357, digest: '<recompute>' },
  predecessorInventory: { count: 354, digest: '78ab887dbbf137326046a27fcabe4da3cc0adead7586005ce4b5987773a21ecb' },
  addedPaths: Object.freeze([
    'kir-runtime/linked-kir-program/link-support.js',
    'kir-runtime/linked-kir-program/statements.js',
    'kir-runtime/linked-kir-program/walkers.js',
  ]),
});
export function reconstructD0ContractsSplitCompiledCoreJavaScriptPaths(paths) { … }
export function validateD0ContractsSplitHistoricalTransition(candidate) { … }
```

plus its `.test.mjs` sibling, mirroring `c-py-1-lowering-historical-transition.test.mjs`.

Wiring, one line at `scripts/kern-canonicalizer/coverage-dependencies.mjs:337`: the live `paths` go
to the **new** reconstructor first, and its 354-path result is what reaches
`reconstructCPy1LoweringCompiledCoreJavaScriptPaths`. `c-py-1-lowering-historical-transition.mjs`
itself is **not edited** — its `currentInventory` stays `{354, 78ab887d…}` and becomes a
predecessor pin, which is why the chain is append-only.

Then, in order: `pnpm --filter @kernlang/core build` → `pnpm write:kern-canonicalizer-coverage`
(re-pins `coverage-summary.json` `compiledCoreDigest` + `coverageImplementationDigest`) → hand-update
the one literal at `coverage-prerequisite.test.mjs:97`.

`TARGET_KERNEL_SHA256` on both legs, the F5 policy digest, the 240-file census, the RT-2/RT-3/RT-6/
RT-9/RT-10-pre/RT-10-X goldens and every `k0-golden.json` are all **byte-identical**: no union
member, no emitted string and no scraped kind list moves. This is what makes D.0 a *pin* slice.

### Reservation 1 — the thirteenth diagnostic code

**Add `'uncaught-throw'` as the thirteenth member of `KernKirDiagnosticCode`**
(`packages/core/src/kir-runtime/contracts.ts:67-78`), alphabetically between `runtime-limit-exceeded`
and `unsupported-runtime-input`. Nothing emits it in D.0; slice D spends it on the uncaught-user-throw
envelope.

This departs from the tribunal's literal `USER_THROW`, and the departure is **ratified by the
coordinator (2026-09-08)**. The reasoning, all from C-6/C-7/C-8:

- The tribunal's mechanism — *"via RC-v1 amendment #4"* — **cannot be executed as stated**. RC-v1
  governs four artifacts, none of which contains the KIR code set (C-6), so adding any KIR member
  produces zero artifact drift, and a zero-drift record is rejected by the chain walker (C-7).
- Forcing drift by adding a code to `constitution.json` would require adding the same code to the
  **built public handler ABI** `KernRuntimeHandlerDiagnosticCode` (C-8) — widening a public type
  with a code the handler runtime never emits. That is a strictly worse contract than the one being
  fixed.
- `uncaught-throw` is already the frozen RC-v1 code for precisely this outcome, with a golden
  behaviour `failure-uncaught-throw`. Choosing it makes the KIR envelope *converge* on the frozen
  public vocabulary instead of forking a second spelling for one concept.
- Style corroborates: all twelve existing members are kebab-case; `USER_THROW` is `KIR_*`-label
  shaped, not code shaped.

`USER_THROW` therefore survives in this document and in slice D's spec as the *name of the
reservation*; the string literal is `'uncaught-throw'`.

**Amendment record design — Option B, rejected, kept for the record.** Retained so a later slice
does not re-derive it. If the ratification is ever reversed and a governed record is required, the
artifact is
`scripts/runtime-contract-v1/amendments/kern-5-user-throw-diagnostic-v1.json`:

```json
{
  "format": "kern.runtime.contract.amendment.v1",
  "slice": "kern-5-user-throw-diagnostic-v1",
  "disposition": "additive",
  "parentDigests": { "constitutionSha256": "…", "declarationSchemaSha256": "…",
                     "goldensSha256": "…", "proofInventorySha256": "…" },
  "rowsChanged": ["diagnostics.codes"]
}
```

authored **without** `resultDigests` (pending), the four parents copied from the live
`scripts/runtime-contract-v1/lineage.json` pin, then `node scripts/runtime-contract-v1/amend.mjs
--write` fills `resultDigests` and re-pins lineage. It additionally requires: `constitution.json`
`diagnostics.codes` 15→16; `EXPECTED.diagnosticCodes` in `validate-runtime-contract-v1.mjs:15-31`;
the `KernRuntimeHandlerDiagnosticCode` declaration in `public-declaration-schema.json:18` **and** the
source that builds `dist/runtime-handler.d.ts`; and a sorted insert of the new path into
`alpha-receipt-policy.json` `bindings` (126 entries). Amendment #4 would consume, making the chain
`chain-anchor → max-iterations → max-iterations-optional-v1 → user-throw` — consumed length 3.
**This option is not recommended.**

### Reservation 2 — the eight try-family labels

Reserved means: present in a checked-in registry, absent from every code path that can emit a
diagnostic. Because labels are string literals today (C-13) and a new `.ts` const list would cost a
fourth inventory slot **and** falsify rt12's acceptance sentence *"`KIR_LOOP_JUMP_CROSSES_TRY`
appears in no source file"* (`.Codex/specs/kern-5-rt12-linked-jumps/spec.md:702`), the cheapest
honest mechanism is a **JSON registry outside `packages/`**:

`scripts/kern-5-d0-contracts-split/reserved-labels.json`

```json
{ "format": "kern.kir.reserved-link-labels.v1",
  "labels": [
    "KIR_ABRUPT_FINALLY_UNSUPPORTED",
    "KIR_CATCH_AFTER_FINALLY",
    "KIR_CATCH_WITHOUT_TRY",
    "KIR_DUPLICATE_CATCH",
    "KIR_DUPLICATE_FINALLY",
    "KIR_LOOP_JUMP_CROSSES_TRY",
    "KIR_TRY_REQUIRES_CATCH",
    "KIR_TRY_REQUIRES_CATCH_OR_FINALLY"
  ],
  "spentBy": {} }
```

Eight labels: the seven named by the tribunal (three D structural refusals, four D2 finally
refusals) plus `KIR_LOOP_JUMP_CROSSES_TRY`, **confirmed already reserved by rt12** and re-homed here
so one file is the whole reservation. `spentBy` is the forward slot: slice D adds
`"KIR_TRY_REQUIRES_CATCH": "kern-5-d"` when it spends one, and the oracle only forbids emission of
labels with no `spentBy` entry.

Rejected: a frozen exported const in `contracts.ts` or a new `labels.ts`. The const buys
compile-time reachability the linker does not need (it builds label strings by interpolation), and
costs a dist path plus the rt12 wording conflict. Recorded so a later slice does not re-litigate.

Because the statement compilers move to `statements.ts`, rt12's three-file negative scan
(`compatibility.test.mjs:155-165`) would no longer cover the file where a try label will actually be
spent. D.0's oracle replaces it with a **directory-wide** scan of
`packages/core/src/kir-runtime/**`, which strictly strengthens it.

### Reservation 3 — the vacuous-now fault-model pin

**Claim D0-F1 (normative, vacuously true today).** `__Fault` / `_Fault` / `KernKirFault` denote
**VM-invariant collapse only**. They are constructed at exactly the census in C-10, over exactly the
ten codes listed there, and none of those sites is reachable by a user `catch`: nothing catches a
fault and resumes handler execution (C-12). A future capability slice that wants
`try { await api.get() } catch` **must not** make a `__Fault` catchable; it must surface the host
failure as a result record or as a synthesized user throw, and it must consciously extend the census
in this spec to do anything else.

The tribunal's phrasing — *"capability/host failures never raise `__Fault`"* — is **not** a
description of today's code: `capability-error` is raised as a `__Fault` at four sites (C-11). The
claim is therefore stated as a *catchability* invariant plus a census, not as a code-set exclusion,
which is the only form of it that is true at base and falsifiable by a test.

**The tribunal pin is not dropped — it is handed forward as an open design item.** D.0 pins the
census; it does **not** decide what `catch` does about `capability-error`, because deciding that
requires the catch semantics D introduces. Recorded in *Queued for slice D* as QD-1, which slice D's
spec must answer explicitly rather than inherit by silence.

## Queued for slice D

- **QD-1 — `capability-error` catchability. OPEN, must be answered explicitly in slice D's spec.**
  The tribunal pinned *"`__Fault` is reserved for VM-invariant collapse; capability failures surface
  as result records or synthesized user throws, never `__Fault`"*, but the census proves
  `capability-error` **is** a `__Fault` today at `kir-js-esm/emitter.ts:187,421` and
  `kir-python/emitter.ts:180,415` (C-11), and no `__Fault` is catchable (C-12). So slice D must
  choose, in writing, one of: (a) `capability-error` stays an uncatchable `__Fault` and the future
  capability slice owes a result-record channel before `try { await api.get() } catch` can be
  represented — the tribunal's stated intent, and the option that keeps D's diff smallest; (b) the
  four sites are re-classified now, which is a capability-seam change and outside D. D.0's oracle
  makes either choice observable by pinning the exact census, so option (b) cannot happen silently.
- **QD-2 — `expression.ts` headroom.** See *OQ-3, decided*: D must land under 500 lines in
  `kir-runtime/expression.ts` or open its own head-stage inventory transition.
- **QD-3 — the label registry's `spentBy`.** Each label D spends must gain a `spentBy` entry in
  `scripts/kern-5-d0-contracts-split/reserved-labels.json` in the same commit that emits it;
  otherwise D.0's not-emitted row goes RED, which is the intended interlock.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | edit | 535 → ~367; export the three traversal primitives; walkers extracted |
| `packages/core/src/kir-runtime/linked-kir-program/walkers.ts` | **new** | capability-closure + call-depth walkers (~182) |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | edit | 735 → ~365 |
| `packages/core/src/kir-runtime/linked-kir-program/link-support.ts` | **new** | KIR-node readers, scope helpers, `containsReturn`/`assertLeaf` (~140) |
| `packages/core/src/kir-runtime/linked-kir-program/statements.ts` | **new** | statement-compilation visitors (~285) |
| `packages/core/src/kir-runtime/linked-kir-program/index.ts` | edit | four names re-sourced; export list byte-equivalent |
| `packages/core/src/kir-runtime/contracts.ts` | edit | `KernKirDiagnosticCode` 12 → 13 members (`uncaught-throw`) |
| `scripts/kern-canonicalizer/d0-contracts-split-historical-transition.mjs` | **new** | inventory head stage 354 → 357 |
| `scripts/kern-canonicalizer/d0-contracts-split-historical-transition.test.mjs` | **new** | its immutability/reconstruction oracle |
| `scripts/kern-canonicalizer/coverage-dependencies.mjs` | edit | one import + one call at `:337`, new head |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | `compiledCoreDigest`, `coverageImplementationDigest` |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` | edit | literal `compiledCoreDigest` at `:97` |
| `scripts/kern-canonicalizer/coverage-integrity.test.mjs` | **edit (required)** | the `omitted` `deepEqual` at `:404-454` gains the three new dist paths, sorted (C-14). The other list, `:336-392`, is a sensitivity fixture and stays unchanged |
| `scripts/kern-5-rt10-for/compatibility.test.mjs` | edit | `DIAGNOSTIC_CODES` 12 → 13; message `twelve` → `thirteen` |
| `scripts/kern-5-rt11-linked-while/compatibility.test.mjs` | edit | same |
| `scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs` | edit | same; **and** three-file label scan → directory scan |
| `scripts/kern-5-rt12-linked-jumps/walker-coverage.test.mjs` | edit | `containsReturn`/`assertLeaf` scrape re-pointed from `link.ts` to `link-support.ts`; assertion content unchanged |
| `scripts/kern-5-d0-contracts-split/reserved-labels.json` | **new** | the eight-label registry |
| `scripts/kern-5-d0-contracts-split/*.test.mjs` | **new** | this slice's oracle |
| `package.json` | edit | `test:kern-5-d0-contracts-split` script; append to `test:kern-5-script-family` |
| **Unchanged, and asserted so** | — | both emitters, both kernels + `TARGET_KERNEL_SHA256`, `kir-runtime/expression.ts`, `kir-runtime/execute.ts`, F5 policy digest, the 240-file census, every `k0-golden.json`, `scripts/runtime-contract-v1/**` (no amendment), `scripts/kir-v1/alpha-receipt-policy.json` (no new binding), the Python stdlib allowlist |

Suites that must be green: `test:kern-5-rt2-boolean-if`, `rt3`, `rt4`, `rt5`, `rt6`, `rt8`, `rt9`,
`rt10-pre`, `rt10-cross-call-integer`, `rt10-for`, `rt11-linked-while`, `rt12-linked-jumps`,
`test:kern-5-parity-ledger`, `test:kern-5-admission-census`, `test:kern-canonicalizer`,
`test:kern-runtime-contract-v1`, `test:kern-alpha-receipt`, `test:infra:contracts`, plus the new
`test:kern-5-d0-contracts-split`.

## Acceptance Criteria

Oracle rows the next worker writes, at `scripts/kern-5-d0-contracts-split/`.

**Size and shape**
- [ ] Every `.ts` under `packages/core/src/kir-runtime/linked-kir-program/` is `< 500` lines, and
      `contracts.ts ≤ 420`, `link.ts ≤ 420`, `statements.ts ≤ 340`, `walkers.ts ≤ 220`,
      `link-support.ts ≤ 200` (headroom rows, not just the rule).
- [ ] The directory contains exactly seven `.ts` files — the sorted set `contracts`, `expression`,
      `index`, `link`, `link-support`, `statements`, `walkers` and nothing else.
- [ ] Import-graph row: no cycle among those files (parse `from './x.js'` specifiers, assert the
      DAG matches INV-2 exactly).

**Behaviour preservation**
- [ ] The sorted export-name set of `dist/kir-runtime/linked-kir-program/index.js` equals the pinned
      39-name list captured at base `1ef72e0d`, and `dist/.../contracts.js` still exports
      `LINKED_KIR_TYPE_ADMISSION`.
- [ ] `TARGET_KERNEL_SHA256` for both legs equals the rt12 pins
      (`b53251fd…`, `f79a3963…`); the F5 policy digest equals `0f62f6c9…`; the census total is 240
      with zero link-stage rows.
- [ ] Every `k0-golden.json` under `scripts/kern-5-rt*/` is byte-identical to base.
- [ ] Both `LinkedKernKirStatement` and `LinkedKernKirExpression` carry exactly their base kind sets
      (10 and 9 members).

**Marker locality (the anti-vacuity rows — these are the ones that catch the `e105f1da` failure)**
- [ ] For each Family-2 marker (`function statementSubBlocks`, `function expressionVariantUnhandled`)
      and each Family-1 anchor (the three `export type … =` declarations): the marker occurs in
      `contracts.ts`, exactly once, **after** the corresponding union start.
- [ ] Re-run of every Family-1/Family-2 scrape returns a slice **shorter than the remainder of the
      file** — i.e. `indexOf(endMarker) > start`, never `-1`. A row that asserts the scrapes are
      still *bounded*, not merely still passing.
- [ ] `containsReturn` and `assertLeaf` occur in the same file, `containsReturn` first, with no
      other `function ` declaration between them.
- [ ] Every extraction in D.0's **own** oracle goes through `between` from
      `scripts/kern-5-rt6-void-fallthrough/k0-support.mjs` (C-16), never raw `indexOf` — the helper
      whose absence from the thirteen `contracts.ts` scrapes is what makes them vacuum-prone.

**Diagnostic code**
- [ ] `KernKirDiagnosticCode` has exactly 13 members, sorted, ending
      `runtime-limit-exceeded | uncaught-throw | unsupported-runtime-input`.
- [ ] `uncaught-throw` is emitted by **no** code path: it appears in no `new KernKirFault(`,
      `new __Fault(`, `raise _Fault(` argument anywhere in `packages/core/src`.
- [ ] `uncaught-throw` ∈ `scripts/runtime-contract-v1/constitution.json` `diagnostics.codes`
      (already true) — the convergence row that says the KIR union did not fork a new spelling.
- [ ] The four RC-v1 artifact digests are **unchanged** from base, `amendments/` still holds exactly
      3 files, `verifyRuntimeContractAmendmentChain()` reports consumed length 2 and 0 pending, and
      `alpha-receipt-policy.json` `bindings` still has 125 entries.

**Reserved labels**
- [ ] `reserved-labels.json` parses, is frozen-shaped, and its `labels` array is exactly the eight
      strings above, sorted, with `spentBy` empty.
- [ ] For every label with no `spentBy` entry: the string occurs in **no** file under
      `packages/core/src/` (directory-wide scan, superseding rt12's three-file scan).
- [ ] Cross-check: every `KIR_[A-Z_0-9]+` literal reachable in a `fault(...)` message under
      `packages/core/src/kir-runtime/` is disjoint from the unspent reserved set (39 emitted labels
      at base; assert the emitted set too, so a rename is caught).

**Fault census (claim D0-F1)**
- [ ] `new __Fault(` sites: `kir-js-esm/emitter.ts` 24, `target-base.ts` 6, `target-json.ts` 5,
      `target-execution.ts` 4 — and nowhere else; the distinct code set is exactly the ten in C-10.
- [ ] `raise _Fault(` sites: `kir-python/emitter.ts` 21, `target-base.ts` 7, `target-json.ts` 6,
      `target-execution.ts` 6 — and nowhere else.
- [ ] `new KernKirFault(` sites: the nine-file distribution in C-10, total 53.
- [ ] No `class` in either kernel extends `__Fault`/`_Fault`, and no `catch`/`except` inside a
      handler body catches one (`kir-runtime/execute.ts` and the emitter's outer boundary are the
      only two).

**Inventory transition**
- [ ] The live dist inventory is 357 paths; `reconstructD0ContractsSplitCompiledCoreJavaScriptPaths`
      returns exactly 354 paths hashing to `78ab887d…`; the c-py-1 module's own literals are
      unchanged from base (byte-compare the file).
- [ ] `addedPaths` is exactly the three new `.js` paths, each present in the live inventory.
- [ ] `validateD0ContractsSplitHistoricalTransition` rejects any mutation of the frozen record
      (mirror c-py-1's immutability row), and rejects an inventory with an extra, missing,
      duplicated, escaping or backslashed path (mirror `coverage-integrity.test.mjs:536-551`).
- [ ] `reconstructM4145CompiledCoreJavaScriptPaths` still receives exactly 317 paths through the
      composite chain, and the `omitted` set is exactly the base 50 entries **plus** the three new
      paths (C-14) — no fourth path leaked into the compiled core.
- [ ] Full-gate row: `pnpm test:kern-canonicalizer` and `pnpm test:infra:contracts` green.

## Out of Scope

Every statement/expression union member (`try`, `catch`, `finally`, `throw`); `__UserThrow` /
`_UserThrow`; `tryDepth`; `compileTry`/`compileCatch`; any RT-1 or emitter change; any kernel byte;
any new limit; the throw payload type; metering; the finally abort gate; Python parity rows; the
`KIR_LOOP_JUMP_CROSSES_TRY` refusal itself. All of that is slice D or D2.

Also out of scope: splitting `packages/core/src/kir-runtime/expression.ts` (402) or
`linked-kir-program/expression.ts` (358). Decided, not deferred: see *OQ-3, decided* — no clean cut
exists, and the 500-line constraint passes to slice D as QD-2.

## Open Questions

- **OQ-1 — CLOSED, VERIFIED, and it was not benign.** My ASSUMED reading was half wrong. The list at
  `coverage-integrity.test.mjs:336-392` *is* a pure sensitivity fixture and is unaffected; but the
  one at `:404-454` is an exact `deepEqual` on `omitted = live − M4.145-historical`, so the three new
  dist paths land in it and fail it. See C-14 and the new Blast Radius row. Closed by reading
  `:394-454` against `reconstructM4145CompiledCoreJavaScriptPaths` (`coverage-dependencies.mjs:280-327`)
  and `POST_M4145_COMPILED_CORE_PATHS` (`:97-107`), not by running the suite: `packages/core/dist`
  does not exist in this worktree and the brief forbids a build. The intended command,
  `node --test scripts/kern-canonicalizer/coverage-integrity.test.mjs`, must still be run by the
  implementing worker after step 3 of the Deploy Order — it is the natural RED-at-base check for
  this row.
- **OQ-2 — CLOSED, RATIFIED.** `'uncaught-throw'`, no amendment record. Option B retained above as
  the rejected alternative; the departure is logged in the Corrections Log.
- **OQ-3 — CLOSED, DECIDED.** No clean cut of `kir-runtime/expression.ts` exists today; the
  transition stays 354 → 357. Full analysis and the constraint handed to slice D are under
  *OQ-3, decided*.
- **OQ-4 (technical, low risk — still open).** `predecessorCommit`/`successorCommit` in the new transition record
  — the five precedents carry real 40-char SHAs. `successorCommit` cannot be known before D.0's own
  merge commit exists. Check how `r2-js-lowering` handled the same chicken-and-egg (likely: the
  field names the *predecessor* stage's successor, and the record is finalized in a follow-up
  commit). **ASSUMED** that the c-py-1 pattern is copyable verbatim.
- **OQ-5 (technical — still open).** Whether `check-kir-module-graph.mjs` (`pnpm test:kern-kir-module-graph`)
  enforces a module allowlist that must learn the three new paths. Not read. **OPEN**; cheap to
  close by running the suite.

## Deploy Order

D.0 is internal to the repo; there is no producer/consumer skew window. Merge order is strict and
one-way: **slice C (`feat/kern-5-rt12-linked-jumps`) → D.0 → slice D**. D.0 edits four rt12/rt10/rt11
test files, so it cannot precede C, and slice D's `compileTry` lands in `statements.ts`, which does
not exist before D.0.

Within D.0 the commit order is forced by the digest chain: (1) source split; (2) diagnostic code +
reserved-label registry; (3) build; (4) new transition module + wiring; (5)
`write:kern-canonicalizer-coverage` + the one literal re-pin; (6) prior-slice pin edits; (7) oracle.
Steps 4-5 cannot be authored before step 3's build exists.

## Corrections Log

| Original claim | Reality | Impact |
|---|---|---|
| The 354 pin lives at `scripts/kern-5-c-py-1-contract/c-py-1-lowering-historical-transition.mjs:11` (task brief) | It lives at `scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:11`. `scripts/kern-5-c-py-1-contract/` holds only the owner oracle (8 files, no inventory pin) | None once located; the transition module belongs in `scripts/kern-canonicalizer/`, which is also why `coverageImplementationDigest` moves (C-4) |
| Only rt11's compatibility test pins `KernKirDiagnosticCode` at twelve | **Three** do: rt10-for, rt11, rt12 (C-5) | Three pin edits, not one; a worker who fixed only rt11 would ship a red gate |
| `USER_THROW` is added via RC-v1 amendment record #4 (tribunal) | RC-v1 governs four artifacts, none containing the KIR code set (C-6); a zero-drift record self-cycles and is rejected (C-7); forcing drift widens the public handler ABI (C-8) | The whole reservation design changed: no amendment, and the literal becomes `'uncaught-throw'`. OQ-2 |
| `uncaught-throw` would be a new name to invent | It has been a frozen RC-v1 public code with a golden behaviour since RC-v1 (`constitution.json:96`, `goldens.json:83-90`) | Turned a fork into a convergence; removed an entire amendment surface |
| `capability/host failures never raise __Fault` is a current-state pin (tribunal) | `capability-error` is raised as a `__Fault` at four kernel sites (C-11) | Claim D0-F1 restated as a *catchability* invariant + census, which is true at base and testable |
| `walkers.ts` was withdrawn in `e105f1da` because of the inventory pin | Two independent gates: the inventory pin **and** five Family-2 source-text scrapes whose end markers are the walker function names (C-13) | Added INV-1 and the three anti-vacuity oracle rows; a split that only solved the inventory pin would have silently gutted five prior-slice assertions |
| A types-only module would be free of inventory cost | tsc emits a `.js` for it and it is a real inventory member (`ir/semantics/internal-effect-machine-types.js`) | Killed the "put the unions in a free types.ts" option; every new module costs one slot |
| The union scrapes all bound on `'\nexport '` | Two families with different end markers and different failure modes; the `link.ts` `containsReturn` scrape fails *loudly*, the `contracts.ts` ones fail *vacuously* | Only one test edit is strictly forced (`rt12 walker-coverage`); the rest are protected by INV-1 |
| A frozen exported const list is the natural label registry | Labels have never been TS constants — they are interpolated literals (C-13) — and a new `.ts` costs a slot plus a conflict with rt12's "no source file" wording | Registry is JSON under `scripts/`, with `spentBy` as the forward slot |
| **Tribunal wording departure (ratified 2026-09-08).** The verdict says *"13th diagnostic code `USER_THROW` via RC-v1 amendment #4"* | Three source reads say that mechanism cannot be executed: (1) RC-v1's amendment chain governs `constitution.json`, `public-declaration-schema.json`, `goldens.json`, `proof-inventory.json` — **not** the KIR union, proven by the union already carrying `projection-authentication-error` and `runtime-limit-exceeded` which the constitution lacks (C-6); (2) a zero-drift record is structurally rejected — `resultDigests === parentDigests` self-cycles at `amendment-chain.mjs:88-97`, and a pending record with no drift fails at `amend.mjs:46-58` (C-7); (3) forcing drift through `constitution.json` would widen the **built public handler ABI**, because `runtime-handler-public-declaration.mjs:147-152` requires the two code sets to be equal (C-8) | The concept survives, the mechanism and the spelling change: 13th member is `'uncaught-throw'` — already a frozen RC-v1 public code with golden `failure-uncaught-throw` — and **no amendment record is created**. Coordinator ratified. Option B kept as the rejected alternative |
| The two hard-coded dist path lists in `coverage-integrity.test.mjs` are both sensitivity fixtures (OQ-1, ASSUMED) | Only `:336-392` is. `:404-454` is an exact `deepEqual` on `live − M4.145-historical`, which every new dist path enters (C-14) | One more required edit in the Blast Radius; a worker who trusted the ASSUMED reading would have shipped a red `test:kern-canonicalizer` |
| There are two independent inventory chains to teach (the coverage one and the test's) | One. `reconstructRunnerCallCacheCompiledCoreJavaScriptPaths` internally runs c-py-1 → r2-js → r1-runtime-owner → frontend-projection, so both share the single head call at `coverage-dependencies.mjs:337` (C-15) | Confirmed the one-line wiring; no second insertion point |
| `kir-runtime/expression.ts` could join this transition if slice D needs the room (OQ-3) | No clean cut exists: the only acyclic candidate (the operand/evaluator layer) is the start marker of rt10-pre's `between(BINARY_EVALUATORS, calleeBindings)` scrape, and `between` **asserts** both markers share one file (C-16); everything else sits inside `walkStatements → evaluateExpression → callHelper → walkStatements` | Transition stays 354 → 357; the 500-line constraint is handed to slice D as QD-2 |
| The tribunal's `__Fault`/capability pin can be settled inside D.0 | Settling it needs the catch semantics D introduces, and today's census contradicts the pin's wording (C-11) | Recorded as QD-1, an explicit OPEN item slice D must answer in writing; D.0's census makes a silent re-classification impossible |

## Confidence

**0.91**, up from 0.87. The three items that moved it: OQ-2 ratified, so the only OPEN tag on the
recommended path is gone; OQ-3 decided from the code rather than deferred to a guess; OQ-1 promoted
to VERIFIED — and it found a required edit I had tagged ASSUMED-benign, which is exactly the churn
the tag exists to catch, so closing it is worth more than the row it corrected.

The split plan, the marker constraints (C-13, C-16), the inventory-transition pattern and wiring
point (C-15), the pin list and the fault census (C-10) are all read from source; I hold them at
~0.95. The remaining deduction is OQ-4 and OQ-5 — the transition record's `successorCommit`
chicken-and-egg and whether `check-kir-module-graph.mjs` keeps a module allowlist. Both are one
command away from closed and neither can change the split or the pin list; they can only add a file
to the Blast Radius. Nothing above 0.95 is claimable for a spec whose oracle has not been written
and never run RED at base.
