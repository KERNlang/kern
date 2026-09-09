# KERN 5 slice E — linked `each` + `do` (`with` deferred)

**Status:** READY TO BUILD
**Date:** 2026-09-09
**Confidence:** 0.88
**Base:** `2d2167564d23bcbbb417539aeb624a1309cddf60` (slice D tip, unmerged)
**Branch:** `feat/kern-5-e-linked-each-do`
**Oracle:** `scripts/kern-5-e-linked-each-do/` — 11 test files + 12 fixture, pin, golden and measurement modules, **120 rows: 88 RED at base, 32 GREEN**, plus the self-drive's own 8 rows and 1 env-gated row. Measured 2026-09-09 with `node --test --test-reporter=tap` over the ten non-self-drive files. See "Oracle Inventory".

## Executive Summary

Slice E admits two statement kinds to the linked-KIR compiler: `do` (a statement-position call whose
result is discarded) and `each` (iteration over a handler's `list<T>` parameter). `with` is
**deferred** with its design pre-recorded so the follow-on slice does not re-litigate it. The slice
opens with **E.0**, a byte-preserving extraction that buys headroom in the three saturated files
(`statements.ts` 440, `kir-js-esm/emitter.ts` 497, `kir-runtime/expression.ts` 468) and is gated on a
byte diff of emitted artifacts across a 42-program corpus rather than on "tests stay green".

The governing principle, taken from the tribunal and made testable here: **slice E invents zero new
metering shapes.** Every admitted construct's meter trace is pointwise constructible from a pre-E
shape — `do` is `print` minus the event, `each` is `for` with a cursor over a list instead of a
counter over a range. Any fixture whose GREEN requires a novel charge is a RED by construction.

E.0 has landed. E1 (`do`), E2 (`each`) and E3 (pins) are specified here and their acceptance criteria
are already written as RED oracle rows.

## Current State

Measured at base `2d216756` and re-measured after E.0.

| Fact | Evidence | Tag |
|---|---|---|
| `LinkedKernKirStatement` is 12 kinds; `do`/`each`/`with` are outside it | `linked-kir-program/contracts.ts:250-290` | VERIFIED |
| Any statement kind outside RT-1 refuses with `statement kind <kind> is outside RT-1` | `statements.ts:149` | VERIFIED |
| A node with children hits `assertLeaf` FIRST, so `each` refuses today as "statement must be a leaf" | `link-support.ts:74`; `scripts/kern-5-rt10-for/k0-support.mjs:358` (`neg-each`) | VERIFIED |
| `each` / `do` / `with` all project through F5 — every refusal today is a *link* decision | probe 2026-09-09: `ROW bare-do: projection=projected rt1=handler-entry-unsupported`, `EACH plain: projection=projected rt1=handler-entry-unsupported` | VERIFIED |
| F5 is frozen for this slice: no `schema.ts` / `catalog.generated.ts` / `kir-structural` edit | `git diff --numstat` on the E.0 commits lists none of them | VERIFIED |
| Python emitter must stay byte-identical | `git diff --stat -- packages/core/src/compiler/kir-python/emitter.ts` → empty after E.0 | VERIFIED |
| Both kernel digests are frozen pins | `JAVASCRIPT_KERNEL_SHA256 b53251fd…`, `PYTHON_KERNEL_SHA256 f79a3963…`, `scripts/kern-5-d0-contracts-split/pins.mjs:418-423`; re-asserted live by `byte-identity.test.mjs` | VERIFIED |

## What Already Works

Nothing in this slice needs a new mechanism. The parts E1/E2 stand on are all present and are **not**
to be touched:

- **Loop frames, jumps and finally-crossing.** `WalkFrame`/`LoopState` (`statement-walker.ts:70-94`),
  `enterTrip` (`:116-120`), frame-exhaustion re-test (`:143-170`), `break`/`continue` unwinding
  (`:181-197`). `each` extends `LoopState` with a third variant and reuses all of it.
- **The loop-body scope discipline.** `compileFor` builds `{...branchScope(scope), loopDepth+1,
  loopFinallyDepth: scope.finallyDepth}` and binds the counter WITHOUT adding it to `assignable`
  (`loop-statements.ts:76-82`). `each` binds its item and index the same way.
- **`KIR_LOOP_JUMP_CROSSES_TRY`** already compares `finallyDepth` against `loopFinallyDepth`
  (`statements.ts:74-77`). `each` needs no new rule and must not get one.
- **The void-call contract.** `KIR_VOID_HANDLER_NO_CALL_FORM` (`link.ts:137`) already denies void
  helpers a call form. `do` therefore discards *non-void* results and RT-6 stands untouched.
- **Async statement position.** `assertAsyncCallPosition(value, scope, label, statementValue)`
  (`link-support.ts:148`) is the one gate; `do` passes `statementValue: true` exactly as `let`,
  `print` and `return` do.
- **List parameter types.** `{kind:'list', element:'boolean'|'integer'|'text'}` is already an admitted
  parameter and return type (`contracts.ts:208`, `:225`). `each` needs no type-model change.
- **The JS loop lowering shape.** `forSource` (`statement-source.ts:183-210`) already emits header
  charge → per-trip charge+checkpoint → terminal charge inside the handler body, with no kernel
  helper. `each` copies that shape.

## Contract (Verified)

> Verified against the E.0 worktree tree and live probes on 2026-09-09. Every row below carries its
> own evidence; no ASSUMED or OPEN row feeds an oracle fixture.

### C1 — Oracle blockers the tribunal named (all resolved before fixtures)

| # | Blocker | Ruling | Evidence | Tag |
|---|---|---|---|---|
| 1 | Slice D behaviour when a `finally` body itself throws (dual fault) | **Unreachable.** `compileFinally` walks the clause subtree and refuses any `break`/`continue`/`return`/`throw` with `KIR_ABRUPT_FINALLY_UNSUPPORTED`; a helper cannot throw either (`KIR_TRY_FAMILY_IN_HELPER`). Slice D defines no dual-fault behaviour because it admits no dual fault. | `statements.ts:21` (`ABRUPT_KINDS`), `statements.ts:182-196`; probe `ROW finally-throws: projection=projected rt1=handler-entry-unsupported js=handler-entry-unsupported` | VERIFIED |
| 2 | Projected shape of `each.in` at the linker | A canonical record with exactly two keys: `form` (text) and `source` (text). Plain identifier → `{form:'binding', source:'xs'}`. One-level field → `{form:'record-array-field', …}`. `name` arrives as a separate text property; `index` likewise; an omitted `type` key is simply absent. | probe dump: `{"key":"in","value":{"tag":"record","value":[{"key":"form",…"binding"},{"key":"source",…"xs"}]}}`; producer `kir-structural/each-collection-reference.ts:26-35` | VERIFIED |
| 3 | Are `list<T>` handler parameters in `scope.assignable`? | **No — no parameter of any type is.** `link.ts:190` seeds `assignable` empty and the parameter loop only calls `bindName` (`link.ts:213-217`). An `assign` to a parameter refuses with `KIR_ASSIGN_TARGET_NOT_LET` (`statements.ts:118-120`). | probe `ROW assign-list-param: rt1=handler-entry-unsupported`, `ROW assign-int-list-param: rt1=handler-entry-unsupported` | VERIFIED |
| 4 | Does bare `do` (no value) survive F5 projection? | **Yes.** `do`, `do value="<call>"`, `do value="<literal>"`, `do value="Json.stringify(t)"` and `do value="<void call>"` all project and are refused only at link. | probe rows `bare-do`, `do-with-call`, `do-void-call`, `do-json`, `do-literal` — all `projection=projected` | VERIFIED |
| 5 | Does index materialization cost a step? | **No.** `__intValue(value, meter)` calls `meter.check()` and `meter.text(...)`, never `meter.step()` (`kir-js-esm/target-execution.ts:125-131`); RT-1's `integerValue` calls `meter.integerText(...)` only (`expression.ts:66-68`). An `index=` binding is step-free on both legs and still bounded by `maxStringBytes`. | source above | VERIFIED |
| 6 | Does the E.0 split introduce an ESM import cycle? | **Two different answers, both checked.** `linked-kir-program/` stays an acyclic DAG (`loop-statements.ts` takes the block compiler as an argument instead of importing it back) — required, because d0 pins that DAG. `kir-runtime/expression.ts ↔ statement-walker.ts` IS a two-module cycle and cannot be removed without injecting the evaluator into `ExpressionRuntime`; it is safe and proven. | DAG dump 2026-09-09 (8 files, `acyclic check done`); cycle loads in both import orders (`expression-first: function function null`, `walker-first: function function invalid-handler-result`) and drives 40 RT-1 programs to byte-identical envelopes | VERIFIED |

### C2 — Metering (the "zero new shapes" table)

Structural charges only; expression cost is whatever the pre-E expression evaluator already charges.
Measured with `directStepBudget` on 2026-09-09 (`link` / `execution` step counts):

| Program | link | execution | Derivation |
|---|---|---|---|
| `let acc=0; return acc` (baseline) | 7 | 4 | — |
| zero-trip `for i 0..0` | 14 | 9 | baseline + 3 bound expressions + **dispatch 1 + terminal 1** |
| one-trip `for i 0..1` | 14 | 14 | zero-trip + **enterTrip 1** + body (1 statement + 3 expression) |
| zero-trip `while false` | 13 | 7 | baseline + 1 condition expression + **dispatch 1 + terminal 1** |

The two measurements isolate the same constant: **a loop that runs zero trips costs 2 structural
steps** (dispatch at `statement-walker.ts:177`, terminal at `:235`/`:247`), independent of the
source expression. This is the pre-E shape `each` must reproduce.

| Construct | RT-1 charge | JS charge | Built from |
|---|---|---|---|
| bare `do` | 1 dispatch step | `__meter.step(); __checkAbort();` | `break`'s leaf shape (`statement-source.ts:288-290`) |
| `do CALL` (sync) | 1 dispatch + `statementValue` cost | 1 statement step + `statementValueSource` | `print` minus the event |
| `do CALL` (async) | 1 dispatch + async call step + argument steps | `(__meter.step(), await h(...))` | `let name=v value="afi()"` |
| zero-trip `each` | 1 dispatch + 1 identifier step + 1 terminal | same three | zero-trip `for`/`while` |
| N-trip `each` | above + N × `enterTrip` + N × body | above + N × `__meter.step(); __checkAbort();` | `for` |
| `each … index=i` | +0 | +0 | `__intValue`/`integerValue` charge no step (C1-5) |

**QE-1 (rule).** A slice-E fixture whose GREEN requires a charge not derivable from the right-hand
column is a RED by construction, and the metering rows assert exactly the differences above rather
than absolute totals.

## E-0 — Extraction (LANDED)

**E-0.1 (VERIFIED).** Three modules extracted byte-preservingly; no behaviour edit in the same
commit.

| File | Before | After | Extracted to | After |
|---|---|---|---|---|
| `kir-runtime/linked-kir-program/statements.ts` | 440 | 325 | `loop-statements.ts` (`loopBound`, `compileFor`, `compileWhile`, `LOOP_STEP_ONE`) | 120 |
| `compiler/kir-js-esm/emitter.ts` | 497 | 181 | `statement-source.ts` (`expressionSource`, `statementValueSource`, `capabilitySource`, `assignSource`, `leafSource`, `forSource`, `whileSource`, `blockSource`, `statementsContainTryFamily`, `CallLocals`) | 312 |
| `kir-runtime/expression.ts` | 468 | 210 | `statement-walker.ts` (`statementValue`, `ForLoopState`/`WhileLoopState`/`LoopState`, `TryTrap`, `WalkFrame`, `walkFrame`, `loopContinues`, `enterTrip`, `walkStatements`, the three walk policies, `WALK_SEED`) | 270 |
| `kir-runtime/linked-kir-program/link-support.ts` | 139 | 159 | received `ASYNC_POSITION_LABEL` + `assertAsyncCallPosition` | — |
| `compiler/kir-python/emitter.ts` | 483 | 483 | nothing (byte-identical) | — |

**E-0.2 (VERIFIED).** `KERNEL_SOURCE` concatenation and `TARGET_KERNEL_SHA256` stayed in
`emitter.ts:19-22` (`const KERNEL_SOURCE` / `export const TARGET_KERNEL_SHA256`), untouched; both kernel digests re-verified live.

**E-0.3 (VERIFIED).** The one shape change E.0 makes is a *signature*, not a behaviour:
`compileFor`/`compileWhile` take the block compiler as a fifth argument (`BranchCompiler`,
`loop-statements.ts:19-24`). That is what keeps `linked-kir-program/` a DAG, which d0's
`D0_IMPORT_CYCLE` row requires.

**E-0.4 (VERIFIED).** `expression.ts` re-exports the four public walk names from
`statement-walker.js`, so `execute.ts` and every downstream `dist/kir-runtime/expression.js`
consumer keeps its import list unchanged.

**E-0.5 (VERIFIED, acceptance).** Byte identity across a 42-program corpus
(`scripts/kern-5-e-linked-each-do/corpus.mjs`, 40 projectable programs + 2 spliced linked programs),
pinned at base in `emitted-digests.json` and re-verified after extraction:

- emitted JavaScript artifact sha256 — unchanged for all 40
- emitted manifest sha256 — unchanged for all 40
- `linkedProgramSha256` — unchanged for all 40
- Python compile decision (artifact sha256 or `refused:<code>`) — unchanged for all 40
- RT-1 envelope sha256 + outcome — unchanged for all 40 (37 success, 3 `uncaught-throw` failures)
- the two spliced artifacts (capability input slot; a throw payload the linker's own gate refuses,
  reachable only through a hand-built linked program) — unchanged
- `TARGET_KERNEL_SHA256` on both legs — the frozen pins

The corpus covers every JS lowering path: all 12 statement kinds, all 9 expression kinds, both loop
forms with `break`/`continue`/`step`/nesting, the whole try family (catch, finally, both, nested,
rethrow, return-crossing, try-in-loop, loop-in-try), sync and async helpers, void fallthrough, list
parameters and returns, and both `Json` intrinsics.

## E-1 — `do` (SPECIFIED)

**E-1.1 (contract).** `do` admits exactly two shapes:

1. **Absent `value`** — a semantic no-op that still charges one dispatch step. F5 makes `value`
   optional (`schema.ts:1990`) and legacy TS lowers it to nothing (`codegen/body-ts.ts:2267-2280`);
   RT-1 charges every dispatched statement (`statement-walker.ts:177`), so "no-op" cannot mean
   "free".
2. **A non-void `user-call`**, sync or async, whose result is discarded. Async is admitted because
   `do` is a statement position: `assertAsyncCallPosition(value, scope, label, true)`.

Everything else refuses. `do` is a leaf: `propertySet(properties, [], ['trailingComment','value'])`.

**E-1.2 (refusal labels, exact).** One cause per label, no compound messages:

| Shape | Label |
|---|---|
| literal / identifier / binary / unary / member / list / record value | `KIR_DO_EXPRESSION_NOT_USER_CALL` |
| `Json.parse` / `Json.stringify` value | `KIR_DO_JSON_INTRINSIC_UNSUPPORTED` |
| member call (`xs.push(v)`) | `KIR_DO_MEMBER_CALL_UNSUPPORTED` — reachable: `do value="xs.push(1)"` projects (probe) |
| `?`-propagation form | `KIR_DO_PROPAGATION_UNSUPPORTED` **reserved, not spent**: `do value="f(1)?"` never projects (probe) |
| call of a `void` helper | existing `KIR_VOID_HANDLER_NO_CALL_FORM` (`link.ts:137`), reused verbatim |
| async call in an argument position inside the `do` value | existing `KIR_ASYNC_CALL_EXPRESSION_POSITION (KIR_CALL_CALLEE_CAPABILITY)` |

**E-1.3 (linked node).** `{kind:'do', value?: LinkedKernKirExpression}` — one optional field, no
derived data. Nothing else is stored on the node; the call's void-ness and async-ness were already
decided at link time while the scope map was alive.

**E-1.4 (JS lowering sketch).** In `leafSource`, next to `print`:

```js
__meter.step(); __checkAbort();            // bare do ends here
STATEMENT_VALUE_SOURCE;                    // when value exists; result discarded
```

**E-1.5 (RT-1 mechanism).** One arm in `walkStatements`, next to `print`:
`if (statement.value !== undefined) yield* statementValue(statement.value, bindings, meter, runtime);`
— the yielded value is discarded, which is what makes an async `do` resume correctly for free.

**E-1.6 (Python lowering sketch, for the deferred leg).**
`do` → `CALL(...)` (or `await CALL(...)` when the helper is async), result discarded; absent value →
`pass`.

## E-2 — `each` (SPECIFIED)

**E-2.1 (iteration domain).** `in=` must be a bare identifier — `{form:'binding'}` — that resolves to
a **handler parameter** declared `list<boolean>`, `list<integer>` or `list<text>`. Not a `let`-bound
list literal (that would need new linker provenance tracking), not `record-array-field`, not a
literal or call (F5 walls both).

**E-2.2 (binding types).** Derived at link time from the parameter's declared element type and then
**discarded** — no `elementType` field on the linked node, because no consumer exists (RT-1 executes
values, the JS emitter emits no annotations) and a stored copy can only skew.

| Parameter | item static type | item cross-call type | Why |
|---|---|---|---|
| `list<boolean>` | `boolean` | `boolean` | `LinkedKernKirStaticType` admits it (`contracts.ts:7`) |
| `list<integer>` | `integer` | `integer` | same |
| `list<text>` | *absent* | `text` | `text` is not a static type and must not become one |

`index=` binds an `integer` with static type `integer` and cross-call type `integer`.

**E-2.3 (variants).** Admit **plain** and **`index=`** only.

| Variant | Disposition | Label |
|---|---|---|
| plain, `index=` | admitted | — |
| `pairKey=`/`pairValue=` | refused at link | `KIR_EACH_PAIR_MODE_UNSUPPORTED` |
| `entryKey=`/`entryValue=` | refused at link | `KIR_EACH_ENTRY_MODE_UNSUPPORTED` |
| `entries=true` | refused at link | `KIR_EACH_ENTRIES_UNSUPPORTED` |
| `await=true` | refused at link | `KIR_EACH_AWAIT_UNSUPPORTED` |
| `in=` a one-level field reference | refused at link | `KIR_EACH_RECORD_FIELD_UNSUPPORTED` |
| `in=` an identifier that is not a parameter | refused at link | `KIR_EACH_SOURCE_NOT_PARAMETER` |
| `in=` a parameter that is not a list | refused at link | `KIR_EACH_SOURCE_NOT_LIST` |
| `type=` | **never reaches the linker** — F5 refuses projection | `KIR_EACH_TYPE_ANNOTATION_UNSUPPORTED` reserved, not spent (see Corrections Log) |
| `in=` a list literal or a call | **never reaches the linker** — F5 refuses projection | none needed |
| assignment to the item or index binding | refused at link | `KIR_ASSIGN_TO_EACH_BINDING` |

**E-2.4 (loop semantics).** `each` is a real loop: body compiled with `loopDepth + 1` and
`loopFinallyDepth = scope.finallyDepth`, exactly as `compileFor` does (`loop-statements.ts:76-80`).
`break`/`continue` work unchanged, `KIR_LOOP_JUMP_CROSSES_TRY` is unchanged, and no new jump rule is
added.

**E-2.5 (immutability).** Both bindings enter `bindings` and never `assignable`, so RT-9's single
gate refuses an assignment to them; `counters` selects only which label the refusal carries
(`statements.ts:118-120`). This is why no snapshot-equivalence proof is needed: the source is a
parameter (not assignable, C1-3) and the item binding is not assignable either, so no admitted
program can observe a difference between "iterate the retained value" and "iterate the live value".

**E-2.6 (JS lowering sketch).** An explicit **index cursor**, not `for…of` — a KIR integer is not a
JS number, and the cursor makes the index binding and the metering isomorphism fall out for free.
Inline in the handler body; **no kernel edit**, so both kernel SHAs stay frozen.

```js
__meter.step();                                     // dispatch
__items = SOURCE;                                   // evaluated once, charges its own expression step
if(__items.tag!=='list')throw new __Fault('unsupported-runtime-input','execution');
for(__cursor=0; __cursor<__items.value.length; __cursor+=1){
  __meter.step(); __checkAbort();                   // enterTrip
  __item=__items.value[__cursor];
  __index=__intValue(BigInt(__cursor),__meter);     // only when index= is present; charges no step
  BODY
}
__meter.step();                                     // terminal
```

**E-2.7 (RT-1 mechanism).** A third `LoopState` variant, extending `statement-walker.ts:70-94`:

```ts
interface EachLoopState {
  readonly kind: 'each';
  readonly items: readonly KernKirValue[];
  readonly item: string;
  readonly indexBinding?: string;
  cursor: number;
}
```

`enterTrip` binds `items[cursor]` and, when `indexBinding` is set, `integerValue(BigInt(cursor),
meter)`. Frame exhaustion advances the cursor and re-tests `cursor < items.length`; a zero-length
list takes the existing `else { meter.step(); }` terminal arm (`statement-walker.ts:234-236`) without pushing a frame — which is
exactly how `for` and `while` reach 2 structural steps at zero trips.

**E-2.8 (linked node).** `{kind:'each', source: string, item: string, index?: string, body:
readonly LinkedKernKirStatement[]}`. `source` is the parameter name; the item's type is not stored.

**E-2.9 (Python lowering sketch, for the deferred leg).**
`each` → `_items = SOURCE; for _cursor in range(len(_items['value'])): item = _items['value'][_cursor]`
(+ `index = _intValue(_cursor)` when `index=` is present).

## `with` — DEFERRED (design recorded, labels reserved not spent)

`with` stays outside `LinkedKernKirStatement` in slice E and keeps the existing outside-RT-1 refusal.
The reason is not difficulty; it is that the only cheap admission (a flat desugar onto slice D's
try/finally) is not a desugar: it needs a `let` with different mutability, its own cleanup scope, and
its own async-mismatch rule. That is a new construct wearing a desugar's clothes, and pricing it
belongs to a finalization slice, not a loop-and-discard slice.

**The conditional design, so the follow-on slice starts from here.** Expand
`with name=N value=V cleanup=C` at link time into:

1. a `let`-shaped binding under an **unspellable** internal name, excluded from `assignable` by the
   loop-counter mechanism (bind, do not add);
2. slice D's `try` with a `finallyBody` holding the cleanup;
3. the cleanup itself lowered as a **`do`** — which is exactly why `do` lands first.

**Both gates the tribunal set are now VERIFIED, and both pass:**

| Gate | Result | Evidence |
|---|---|---|
| (a) the identifier grammar permits an unspellable namespace | **PASSES.** F5 admits `__w0` and `$w0` (so a `__` prefix is *not* unspellable), and refuses `w-0`, `w.0`, `w 0`, `#w0`, `w:0`, `w[0]`, `w@0`. Any name containing `-`, `.`, space, `#`, `:`, `[`, `@` can never be a user binding. | probe 2026-09-09, `NAME …` rows |
| (b) slice D defines behaviour when a finally statement itself throws | **PASSES by refusal.** A finally body that throws is refused at link (`KIR_ABRUPT_FINALLY_UNSUPPORTED`), and a helper cannot throw (`KIR_TRY_FAMILY_IN_HELPER`), so no dual fault is reachable and none has to be defined. | C1-1 |

So `with` is deferred by **budget**, not by blocker: both substrate facts came back clean, and the
follow-on slice may take the hygienic-expansion route without re-verifying them. What it still owes:
cleanup-failure precedence, acquisition failure, `async=true` mismatch rules, envelope-fault
behaviour, and whether `with` counts as finally-bearing for `KIR_LOOP_JUMP_CROSSES_TRY` (it should:
an outward `break`/`continue` must refuse).

**Reserved, not spent** — no slice-E source path may emit any of these, and the oracle asserts their
absence: `KIR_WITH_PROTOCOL_UNSUPPORTED`, `KIR_WITH_CLEANUP_REQUIRED`,
`KIR_WITH_PROPAGATION_UNSUPPORTED`, `KIR_WITH_ACQUIRE_UNSUPPORTED`, `KIR_WITH_CLEANUP_UNSUPPORTED`.

## Implementation Options

The decision space collapses to one real option, and the alternatives are named here only so the
follow-on slice does not re-open them.

**Chosen: parameter-backed `each` + call-only `do`, cursor lowering, `with` deferred.**

Strawmen and why:

- *`let`-bound list literal as the `each` source.* Needs linker provenance tracking of a binding's
  origin plus literal element inference — a type-system slice, not a loop slice. And `list<integer>`
  is not a cross-call type (`contracts.ts:123`), so the inferred type could not cross a call anyway.
- *`for…of` instead of a cursor.* A KIR integer is a decimal string, not a JS number, so `index=`
  would need a parallel counter regardless; and `entries()` allocates, which buys nothing.
- *`do` of any expression, evaluated and discarded.* Widens the failure surface for zero benefit:
  discarding a pure expression is observably a no-op, so the only useful `do` is a call.
- *`with` as free sugar.* Refuted above.
- *Storing the element type on the `each` node.* No consumer; invites "node says integer, value says
  text" skew and inflates the mutant budget.

## Oracle Inventory

Measured, not estimated: `node --test --test-reporter=tap --test-concurrency=1` over the ten
non-self-drive files on 2026-09-09.

| File | Rows | What it owns |
|---|---|---|
| `probe-matrix.test.mjs` | 5 | every fixture's F5 status pinned, so a RED row elsewhere is a *link* refusal and not a missing projection |
| `extraction.test.mjs` | 6 | E.0 line budgets, the declarations each extracted module received, the frozen kernel concatenation, the Python byte-identity, the linked DAG, the walker cycle in both import orders |
| `byte-identity.test.mjs` | 7 | the 42-program corpus: artifact, manifest, linked-program digest, Python decision, RT-1 envelope, both spliced artifacts, both kernel pins |
| `compatibility.test.mjs` | 7 | kernel pins, `STILL_OUTSIDE`, the exhaustiveness table, rt10's amended `neg-each`, the E.0 chain stage, F5 untouched, the spec's own shape |
| `type-gate.test.mjs` | 33 | 26 single-cause refusal rows plus the admitted set, the two-gate splits and the async statement-position split |
| `behavior.test.mjs` | 30 | 26 two-leg byte-equality rows plus length-driven iteration, event order and the integer index |
| `metering.test.mjs` | 13 | the bare-`do` step, the zero-trip constant, the per-trip slope, the free index, and 8 step-exhaustion thresholds asserted on both legs |
| `walker-coverage.test.mjs` | 8 | the 14-kind union, every walk arm, the two-checkpoint creep guard, the shared loop head, the three loop states, no derived type on the node, `statementSubBlocks` |
| `python-deferral.test.mjs` | 4 | the two ledger rows, their spec paths, the `'deferred'` request table, the live Python refusals |
| `reserved-labels.test.mjs` | 7 | label-set disjointness, one declaration site per spent label, the two unreachable labels absent from source, no `KIR_WITH_*` spent, `with` on the generic refusal |
| `commit-rows.test.mjs` | 8 + 1 gated | the commit mapping, the abort comparison, the criteria/group coverage, and the leaf/aggregate/tier-contract wiring (excluded from the measured 120: it drives them) |

Commit mapping (`commit-rows.json`, measured by the same drive): **E0 32, E1 26, E2 57, E3 5**. The
abort criterion compares the gated commit against the rest — 57 against 63 — so `cut: false` and
`each` lands as one commit.

**RED-at-base spot checks** — every RED row fails on its label, never on a crash:

- `do-literal` → `expected the KIR_DO_EXPRESSION_NOT_USER_CALL gate to fire, but the linker reported: entry.function.handler.children[0]: statement kind do is outside RT-1`
- `each-plain` (behavior) → `E_LINK_REFUSED: the JavaScript leg refused the fixture with handler-entry-unsupported`
- `each-plain` (metering) → `E_LINK_REFUSED: each-plain must link on RT-1, and the linker refused it`
- `each-await` → `expected the KIR_EACH_AWAIT_UNSUPPORTED gate to fire, but the linker reported: … statement must be a leaf`

## Commit Plan

| Commit | Content | Line budget after |
|---|---|---|
| E.0-a | pin the byte-identity corpus at base | oracle only |
| E.0-b | extract `loop-statements.ts`, `statement-source.ts`, `statement-walker.ts`; move `assertAsyncCallPosition` to `link-support.ts` | statements 325, loop-statements 120, emitter 181, statement-source 312, expression 210, statement-walker 270, link-support 159 |
| E.0-c | move the pins the extraction breaks (d0 file set / DAG / budgets / markers / fault census; rt11 and rt12 checkpoint scans; parity-ledger head count; canonicalizer chain head + digest cascade) | oracle only |
| E.0-d | the oracle: eleven files, the evidence leaf, the aggregate and tier-contract wiring, and the slice-D "last segment" row it displaces | oracle only |
| E1 | `do`: linked kind, linker arm, RT-1 arm, JS `leafSource` arm, Python `'deferred'` row | statements ≤ 360, statement-walker ≤ 300, statement-source ≤ 340 |
| E2 | `each`: linked kind, `compileEach` in `loop-statements.ts`, `EachLoopState`, `eachSource` in `statement-source.ts`, Python `'deferred'` row | loop-statements ≤ 200, statement-walker ≤ 320, statement-source ≤ 380 |
| E3 | pins and ledger: exhaustiveness 12→14, ledger 5→7 rows + SHA, `STILL_OUTSIDE` drops `each`, rt10 `neg-each` amended + a new refusal row appended | oracle only |

**QE-2 (budget).** Every hand-written file stays under **450** lines after **every** commit (the
doctrine ceiling is 500; E.0 exists to buy the margin and E1/E2 may not spend it back).
`LINE_BUDGETS` in `scripts/kern-5-e-linked-each-do/pins.mjs` pins each one.

**QE-3 (net LOC).** ≤ 360 net hand-written production lines after E.0: `each` ≤ 240, `do` ≤ 70,
plumbing ≤ 50.

**QE-4 (mutants).** ≥ 24 non-equivalent mutants (16 `each`, 8 `do`): source evaluated twice, wrong
snapshot, assignable bindings, missing `loopDepth+1`, wrong `loopFinallyDepth`, missing/doubled trip
charge, missing terminal charge, a trip charge at zero trips, `continue` cursor error, index
off-by-one, index typed decimal, `for…of` over a mutated array, arbitrary `do` expression admitted,
`Json`/member call admitted, bare `do` erased, async `do` not awaited, async `do` double-charged.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `kir-runtime/linked-kir-program/contracts.ts` | edit | two new members of the statement union + `statementSubBlocks` arm for `each` |
| `kir-runtime/linked-kir-program/statements.ts` | edit | `do` arm in `compileStatement`; `each` dispatch in `compileBlock` |
| `kir-runtime/linked-kir-program/loop-statements.ts` | edit | `compileEach` |
| `kir-runtime/statement-walker.ts` | edit | `EachLoopState`, `each`/`do` arms, `enterTrip` item+index binding |
| `compiler/kir-js-esm/statement-source.ts` | edit | `eachSource`; `do` arm in `leafSource` |
| `compiler/kir-python/request.ts` | edit | `do: 'deferred'`, `each: 'deferred'` (the exhaustive `satisfies` table forces it) |
| `compiler/kir-python/emitter.ts` | **untouched** | byte-identical; the ledger carries the deferral |
| `packages/core/src/schema.ts`, `catalog.generated.ts`, `kir-structural/*` | **untouched** | F5 frozen |
| `compiler/kir-js-esm/emitter.ts`, `target-*.ts` | **untouched** | both kernel SHAs frozen |
| `scripts/kern-5-parity-ledger/parity-ledger.json` | edit | two rows + `LEDGER_SHA256` re-pin |
| `scripts/kern-5-parity-ledger/exhaustiveness.test.mjs` | edit | `STATEMENT_KINDS` 12 → 14 |
| `scripts/kern-5-rt10-for/{k0-support,type-gate,compatibility}.mjs` | edit | `neg-each` becomes positive; a new refusal row is **appended**, not substituted; `STILL_OUTSIDE` drops `each` |
| `scripts/kern-5-rt11-linked-while/compatibility.test.mjs`, `scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs` | edit | `STILL_OUTSIDE` drops `each` only (`set` stays) |
| `scripts/kern-5-d0-contracts-split/{pins,markers,marker-locality,inventory,fault-census}` | edited by E.0 | file set, DAG, budgets, markers, fault census, chain stage |
| `scripts/kern-canonicalizer/e0-loop-extraction-historical-transition.mjs{,.test.mjs}` | added by E.0 | new head stage: the compiled-core inventory is authenticated by digest, so three new dist modules are a chain stage, never a count bump |
| `scripts/kern-canonicalizer/{coverage-dependencies,coverage-integrity.test,coverage-prerequisite.test,coverage-summary.json}` | edited by E.0 | chain head wiring, omitted list, digest cascade |

## Acceptance Criteria

Binary; each becomes an oracle row.

**E.0 — extraction (GREEN guards)**
- [ ] Every corpus program emits a byte-identical JavaScript artifact and manifest vs base.
- [ ] Every corpus program keeps its base `linkedProgramSha256`.
- [ ] Every corpus program keeps its base Python compile decision.
- [ ] Every corpus program keeps its base RT-1 envelope and outcome.
- [ ] Both spliced linked programs emit byte-identical artifacts.
- [ ] `TARGET_KERNEL_SHA256` equals the frozen pin on both legs.
- [ ] `kir-python/emitter.ts` has an empty `git diff` against base.
- [ ] Every file named in `LINE_BUDGETS` is at or under its budget and under 450 lines.
- [ ] `linked-kir-program/` remains an acyclic import DAG.
- [ ] The `kir-runtime` walker cycle loads in both import orders and exports every walk name.

**E1 — `do`**
- [ ] `do` with a non-void sync `user-call` links, runs on RT-1 and on the emitted JS leg, and both envelopes agree byte for byte.
- [ ] `do` with a non-void async `user-call` links and both legs agree; the same call in an argument position refuses with `KIR_ASYNC_CALL_EXPRESSION_POSITION`.
- [ ] Bare `do` links, is a no-op, and charges exactly one step more than the same program without it.
- [ ] `do` of a `void` helper refuses with `KIR_VOID_HANDLER_NO_CALL_FORM`.
- [ ] `do value="1"` (literal), `do value="x"` (identifier), `do value="1 + 1"` (binary), `do value="r.a"` (member) each refuse with `KIR_DO_EXPRESSION_NOT_USER_CALL`, single cause.
- [ ] `do value="Json.stringify(t)"` and `do value="Json.parse(t)"` refuse with `KIR_DO_JSON_INTRINSIC_UNSUPPORTED`.
- [ ] `do` inside a `for`, a `while`, an `each` and a `try` body all link.
- [ ] The Python leg refuses every `do` fixture with `KIR_PYTHON_LEG_DEFERRED`.

**E2 — `each`**
- [ ] `each` over a `list<text>` parameter links, runs, and both legs agree byte for byte; the item's cross-call type is `text` and it may be passed to a `text` helper.
- [ ] `each` over `list<boolean>` and `list<integer>` parameters link, and the item's static type is `boolean` / `integer` respectively (a `boolean` item is accepted as an `if` condition; an `integer` item is accepted as a `for` bound).
- [ ] `each … index=i` binds `i` as `integer` (accepted as a `for` bound; **rejected** where a decimal would be accepted) and costs zero extra steps.
- [ ] A zero-length list runs zero trips and charges exactly 2 structural steps plus the source expression — the same constant a zero-trip `for` and `while` charge.
- [ ] An N-element list charges exactly N `enterTrip` steps, verified at the exact step-exhaustion boundary (succeeds at RT-1's count, fails one below it) on both legs.
- [ ] `break` and `continue` inside an `each` body behave as in `for`, including inside a nested `for`/`while` and an `each` nested in an `each`.
- [ ] An `each` inside a `try` body links; a `try`/`finally` inside an `each` body links; a `break` crossing a finally-bearing `try` inside an `each` refuses with `KIR_LOOP_JUMP_CROSSES_TRY`.
- [ ] `assign` to the item binding and to the index binding each refuse with `KIR_ASSIGN_TO_EACH_BINDING`, single cause.
- [ ] `in=` naming a `let` binding refuses `KIR_EACH_SOURCE_NOT_PARAMETER`; `in=` naming a scalar parameter refuses `KIR_EACH_SOURCE_NOT_LIST`; a one-level field reference refuses `KIR_EACH_RECORD_FIELD_UNSUPPORTED`.
- [ ] `pairKey`/`pairValue`, `entryKey`/`entryValue`, `entries=true`, `await=true` each refuse with their own label, single cause.
- [ ] `each … type=…` and `each … in="[1,2]"` and `each … in="mk()"` stay **not projected**: the F5 wall is asserted, and no link label is spent on them.
- [ ] The Python leg refuses every `each` fixture with `KIR_PYTHON_LEG_DEFERRED`.

**E3 — pins and ledger**
- [ ] The linked statement union is exactly 14 kinds and the parity-ledger exhaustiveness table covers all 14.
- [ ] `parity-ledger.json` carries `do` and `each` rows with `since: 'kern-5-e'`, this spec's path, `label: KIR_PYTHON_LEG_DEFERRED`, and `blockedBy` validated by ledger support; `LEDGER_SHA256` is re-pinned.
- [ ] `STILL_OUTSIDE` in rt10/rt11/rt12 drops `each` and keeps `set`.
- [ ] rt10's `neg-each` row is amended to a positive admission row and a **new** refusal row is appended.
- [ ] No slice-E source path emits any `KIR_WITH_*` label.

## Out of Scope

`with`; record-array-field `each`; `let`-bound list literals as an `each` source; `list<integer>` as
a cross-call type; `pair`/`entry`/`entries`/`await` modes; `type=` annotations; mutable collections
(`xs.push`, `Map.set`); `set`; the Python lowering of `do`/`each`; any F5 edit; any kernel edit.

## Queued

| Item | Blocked on |
|---|---|
| `with` (finalization slice) | cleanup-failure precedence, acquisition failure, async mismatch, envelope-fault behaviour |
| `each` over `record-array-field` | a record-typed parameter model |
| `let`-bound list literals as an `each` source | linker binding provenance + literal element inference |
| `list<integer>` as a cross-call type | `LinkedKernKirCrossCallType` widening (`contracts.ts:123`) |
| Python catch-up batch D2 | `throw`, `try`, `break`, `continue`, `while`, `do`, `each` deferral rows |

## Open Questions

All four questions this spec opened were probed and closed before the fixtures were written. They
are kept here with their answers, because each one decided a row.

- **OQ-E1 - CLOSED.** `each` shadowing. Every variant projects and is therefore a link decision:
  `name=` equal to a parameter, `name=` equal to an enclosing `let`, and `index=` equal to `name=`.
  E2 mirrors `for`'s `duplicate binding <name>` refusal (`loop-statements.ts:67`) for all three; the
  oracle carries `each-shadow-parameter`, `each-shadow-let` and `each-index-shadows-item`.
- **OQ-E2 - CLOSED.** `do value="xs.push(1)"` **projects**, so `KIR_DO_MEMBER_CALL_UNSUPPORTED` is
  reachable and is spent. Member calls are refused as *expressions* at
  `linked-kir-program/expression.ts:357`, but `do`'s own gate must name the member call rather than
  fall through to the generic not-a-user-call label.
- **OQ-E3 - CLOSED.** `do value="bump(1)?"` does **not** project, so
  `KIR_DO_PROPAGATION_UNSUPPORTED` is reserved-not-spent and the oracle asserts it appears in no
  source file.
- **OQ-E4 - CLOSED, and the answer is the opposite of the `for` precedent.** An `each` body
  containing only a bare `print` **does** project, where the same body under `for` does not: F5
  gives `each` no `allowedChildren` restriction while `for`/`while` have one. The fixture keeps the
  `if cond="true"` wrapper so the row tests iteration rather than F5's child policy, and the
  asymmetry is recorded here rather than "fixed" later.

What remains genuinely open is only the E2 linker arm itself: specified and RED-pinned, not written.
That is what holds confidence at 0.88.

## Deploy Order

Single repository, no version skew — but the digest cascade has one legal order, and running it out
of order produces a green local gate on stale pins.

1. Edit `packages/core/src` (and, for E3, `scripts/kern-5-parity-ledger/parity-ledger.json`).
2. `pnpm --filter @kernlang/core build` — tsc must be clean before any digest is measured.
3. Re-pin `LEDGER_SHA256` from the new ledger bytes, then the exhaustiveness `STATEMENT_KINDS`.
4. Move the prior-slice scans: rt10/rt11/rt12 `STILL_OUTSIDE`, rt10 `neg-each`, the rt12 checkpoint
   scan, d0's file set / DAG / budgets / markers / fault census.
5. If a new `packages/core/src` module is added, add a canonicalizer chain stage FIRST (a new
   `*-historical-transition.mjs` + its oracle + the `coverage-dependencies.mjs` head wiring + the
   `coverage-integrity.test.mjs` omitted list). The inventory is authenticated by digest, so a new
   dist path without a stage fails the chain rather than the count.
6. `pnpm write:kern-canonicalizer-coverage`, then re-pin `compiledCoreDigest` in
   `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` by hand from
   `coverage-summary.json`.
7. Full local gate:

```
pnpm --filter @kernlang/core build && pnpm lint \
  && pnpm test:kern-5-e-linked-each-do \
  && pnpm test:kern-5-d-linked-try && pnpm test:kern-5-d0-contracts-split \
  && pnpm test:kern-5-rt12-linked-jumps && pnpm test:kern-5-rt11-linked-while \
  && pnpm test:kern-5-rt10-for && pnpm test:kern-5-rt9-linked-assign \
  && pnpm test:kern-5-rt2-boolean-if && pnpm test:kern-5-parity-ledger \
  && pnpm test:kern-canonicalizer && pnpm check:kern-5-contract
```

`pnpm test:infra` runs separately and alone (its RSS caps make it hostile to a parallel run).

**The evidence leaf is RED on this branch by design.** `test:kern-5-e-linked-each-do` is wired into
`test:kern-5-script-family` and into the CI tier contract now, because `commit-rows.json` asserts
that wiring and a leaf added later is a leaf nobody notices is missing. Its first three files pass at
base (`probe-matrix`, `extraction`, `byte-identity`); the run then stops on the 88 RED rows E1..E3
own. **This branch must not merge before E1, E2 and E3 land** — the RED leaf is the gate that says
so, and turning it green by deleting rows is the one repair that is not allowed.

## Corrections Log

| Original claim | Reality | Impact |
|---|---|---|
| Tribunal: "slice D's dual-fault behaviour when a finally statement itself throws is unverified and gates `with`" | Slice D refuses a throwing finally at link (`KIR_ABRUPT_FINALLY_UNSUPPORTED`, `statements.ts:195`); no dual fault is reachable | `with` gate (b) resolves clean; `with` is deferred on budget, not on a blocker |
| Tribunal: `KIR_EACH_TYPE_ANNOTATION_UNSUPPORTED` is a link refusal `each` should spend | `each … type=…` never projects — probed with `integer`, `text`, `string`, `number`, `boolean`, `integer[]`, bare and quoted; all `not-projected` | Label reserved, not spent. The oracle row becomes a projection-wall row, and E2's linker arm must NOT carry a `type=` branch (dead code with a single-cause label nobody can reach) |
| Tribunal (codex OPEN): "whether list parameters are assignable at all — the snapshot fixture's linkability depends on it" | **No parameter of any type is assignable**: `link.ts:190` seeds `assignable` empty and the parameter loop never adds to it | The snapshot-divergence fixture is unbuildable, which is the *reason* it is unnecessary: neither the source nor the item binding can be rebound, so `for…of` and cursor lowering are observationally identical for every admitted program |
| Tribunal: "E.0 must have no ESM import cycle" | Achievable in `linked-kir-program/` (and required there by d0's pinned DAG), but **not** for the RT-1 walker: `evaluateExpression` and `walkStatements` are mutually recursive, and removing the cycle would mean injecting the evaluator into `ExpressionRuntime` — a public record built at five sites | Adopted the narrower ruling: DAG where it is pinned, a proven-safe two-module cycle where the recursion is inherent. Both modules export only hoisted declarations and read nothing cross-module at evaluation time; verified by loading in both orders and by 40 byte-identical RT-1 envelopes |
| Tribunal: "`pairKey`/`entryKey` modes refuse at link" | True, but only when `name=` is also present: F5 makes `name` required, so `each pairKey=k pairValue=v in="xs"` is `not-projected` while `each name=x in="xs" pairKey=k pairValue=v` projects and refuses at link | Every pair/entry RED fixture must carry `name=`, or the row proves the F5 wall instead of the label |
| Tribunal: `KIR_DO_MEMBER_CALL_UNSUPPORTED` and `KIR_DO_PROPAGATION_UNSUPPORTED` are both spendable `do` labels | `do value="xs.push(1)"` projects (reachable, spent); `do value="bump(1)?"` does not project (unreachable, reserved) | One label spent, one reserved; the oracle asserts the reserved one appears in no source file |
| Assumed from rt10's `print-in-loop` finding: an `each` body needs an `if cond="true"` wrapper around a bare `print`, as `for` does | A bare `print` inside an `each` body **projects**; F5 restricts `for`/`while` children but not `each`'s | The wrapper is kept so the row tests iteration, not F5's child policy, and the asymmetry is recorded rather than silently relied on |
| Facts file: "kir-js-esm/emitter.ts 497/500 (AT CAP)" and `statements.ts` 440/440 | Both true at base; after E.0 they are 181 and 325 | E1/E2 have real headroom; `LINE_BUDGETS` pins it at 450, not 500 |
| Facts file: "pins to move when `each` is admitted" listed `STILL_OUTSIDE`, exhaustiveness, ledger, rt10 `neg-each` | Incomplete for E.0: the **extraction alone** moves d0's file set, import-edge DAG, line budgets, marker locality, the runtime and JavaScript fault censuses, rt12's checkpoint scan, and the whole canonicalizer inventory chain (new head stage + omitted list + `compiledCoreDigest`) | E.0 is three commits, not one; the pin moves are enumerated in the Commit Plan and the Blast Radius |
| Verdict: "ledger 5→7 rows + SHA recompute" | Confirmed: `parity-ledger.json` carries exactly 5 rows today (`break`, `continue`, `throw`, `try`, `while`) and `LEDGER_SHA256` is `2329d569…` (`ledger-support.mjs:40`) | E3 appends `do` and `each` in sorted order and re-pins the digest |
| Behavior table: `do-async-call` emits no events | Its async helper contains a capability statement, and both RT-1 and emitted JS preserve that capability event even though `do` discards the helper's return value | Narrowed the row's `events` field to the exact existing capability event; result and admission expectations are unchanged |

## Confidence

**0.88.** The contract rests on eight verified probes and a landed, byte-diffed extraction; the
metering model is measured, not argued. It is not higher because four refusal-surface questions
(OQ-E1..E4) are still open — each can only move a RED row, never the admitted set — and because the
`each` linker arm and its cursor lowering have not been written yet, only specified and RED-pinned.
