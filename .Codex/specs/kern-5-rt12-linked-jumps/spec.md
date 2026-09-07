# KERN 5 — RT-12 unlabelled `break`/`continue`: linked jumps in KIR (JS + RT-1 legs, Python leg deferred)

**Status:** SPEC — ORACLE LANDED RED
**Date:** 2026-09-08
**Confidence:** 0.91

**Depends on slice B landing at commit `ca890efb`** — `feat/kern-5-rt11-linked-while`
@ `ca890efb5ec7a36e930df8d1760b107fc179245e` (`docs(kern5): mark the rt11 linked while slice
IMPLEMENTED and log seven oracle defects`). Slice B is **IMPLEMENTED**: `while` is the eighth member
of `LinkedKernKirStatement` (`packages/core/src/kir-runtime/linked-kir-program/contracts.ts:250-279`),
RT-1 routes it (`kir-runtime/expression.ts:269-280`), the JavaScript emitter lowers it
(`compiler/kir-js-esm/emitter.ts:271-290`) and the parity ledger carries its row. **Every claim in
this document previously tagged PINNED-BY-B has been re-derived against that landed code**; the
divergences are in the Corrections Log as RT12J-TD1 through RT12J-TD15, and the three claims that
moved materially are RT12J-D2 (the `while` body scope), RT12J-C6 (the two semantic walkers collapsed
into one shared helper) and RT12J-D5 (the metering identities, which were arithmetically wrong). Slice A (`feat/kern-5-parity-ledger`) is **IMPLEMENTED**: the
deferral mechanism, `KIR_PYTHON_LEG_DEFERRED` and the exhaustive lowering tables are live in
`packages/core/src/compiler/kir-python/request.ts:25-159`.

**This slice's oracle is landed and RED** at `scripts/kern-5-rt12-linked-jumps/` — twelve files,
127 tests, **95 RED and 32 GREEN** at base `ca890efb`. The per-module single-cause table is under
RT12J-O2.

## Executive Summary

`break` and `continue` become the ninth and tenth members of `LinkedKernKirStatement` — two
zero-field union members — lowered as **native host jumps** on the RT-1 and JavaScript legs only.
Both bind to the **innermost enclosing loop at link time**; outside any loop they are a link refusal
with a stable label; a function boundary resets the loop context, so a `break` inside a helper body
called from a loop is refused rather than bound to the caller's loop. The Python leg gains two
parity-ledger rows (`blockedBy: ['while']`) and refuses through slice A's compile-entry pass.

The slice adds a **kind, not a channel**. Every walker arm is a leaf arm (no children, no owned
expressions); RT-1 keeps **exactly two** `checkAbort()` sites; the JavaScript emitter gains one
`blockSource` arm emitting `__meter.step(); __checkAbort(); break;` and nothing else. No new kernel
byte, no new host pattern, no new diagnostic code, no new limit.

The hidden deliverable is **not** the jump. It is the pair of *landing* invariants, both verified
from source in this document:

1. **The JavaScript legs already land jumps correctly and by construction** — rt10-for's `for`
   lowering puts the counter advance in the native `for(;;)` **header update**
   (`compiler/kir-js-esm/emitter.ts:264`), so a native `continue` runs it; slice B's `while(true)`
   lowering re-evaluates the condition at the top, so a native `continue` re-tests it. Neither leg
   needs a rewrite (RT12J-C6).
2. **The Python `for` lowering does not** — its counter advance is the **last line of the trip body**
   (`compiler/kir-python/emitter.ts:272, inside the trip template at :269-273`), so a bare native `continue` there would skip the step
   and spin forever. That is the tribunal's exact concern, now confirmed at source, and it is why the
   Python row's sketch (RT12J-C17) is a *restructuring* recipe rather than "emit `continue`".

## Current State / Root Cause

### F5 admits `break`/`continue` in every position — including outside a loop — so the link refusal is reachable

**[RT12J-C1 VERIFIED]** Both kinds are **bound** catalog nodes with `allowedChildren: null` and
exactly **one** property, optional `trailingComment` (`string`, disposition `included-value`):
`scripts/kir-structural/constitution.json:752-758` (`continue`), `:759-765` (`break`), properties at
`:5235`/`:5244`; generated into `packages/core/src/kir-structural/catalog.generated.ts:3028-3045`
(`continue`) and `:3046-3062` (`break`). `allowedChildren: null` means **unrestricted**, not
childless (`kir-structural/node.ts:210-214`, `childAllowed`), so F5 admits a `break` **with**
children.

**[RT12J-C2 VERIFIED — measured from `scripts/kir-structural/constitution.json`, 2026-09-07]** The
parents that admit `break`/`continue` as a direct child are exactly
`handler, while, for, with, try, catch, finally` — and `if`/`else`, whose own `allowedChildren` is
`null` and therefore unrestricted. `while`'s and `for`'s 28-member `allowedChildren` lists are
byte-identical and both contain `continue` and `break` (slice B verified the same list at
RT11W-C1). **`handler` admits them too** (33-member list), which is the load-bearing fact of this
paragraph.

**[RT12J-C3 VERIFIED — measured 2026-09-07]** A bare `break` at handler top level **projects**:
`projectKernModules({modules:[{moduleId:'route.kern', source}]})` → `status: 'projected'`,
`diagnostics: []`, for `['let name=acc value="0"', 'break', 'return value="acc"']`. The same source
put through the **legacy TypeScript parser** is rejected:
`parseWithDiagnostics(source).diagnostics` → `[{code:'BODY_LOOP_CONTROL_OUTSIDE_LOOP', severity:'error'}]`
(`packages/core/src/parser-validate-body-statements.ts:85-96`, predicate at `:121-123`, loop-depth
propagation at `:103`).

The two entries disagree because they are two frontends: F5's projection runs the **self-hosted**
F4/F5 classifier (`scripts/kern-frontend-f5-projection/worker.mjs:60-124`, an
`executeKernRuntimeHandlerSync` over `examples/kern-frontend/f5-projection-main.kern`), which does
not carry `validateBodyStatements`. Consequence, and it is the difference from slice B's RT11W-O2:
**F5 is not a fence here.** The outside-loop refusal is reachable through the public projection
entry, so `KIR_BREAK_OUTSIDE_LOOP` is a real, falsifiable oracle row and not defence in depth.

**[RT12J-C4 VERIFIED — measured 2026-09-07]** F5 **is** a fence for the property set: `break name=x`
inside a `for` body → `projectKernModules` returns `status: 'rejected'`, `['projection-rejected']`.
So the linker never sees a `break` with a foreign property, exactly as slice B found for `while`
(RT11W-C2). And `trailingComment` never reaches the linker's property map: RT-9's `trailing-comment`
fixture is `assign target="s" value=… # note`
(`scripts/kern-5-rt9-linked-assign/k0-support.mjs:299-300`) and its pinned admission is
`"admitted"` (`k0-golden.json`), while `assign`'s gate is `propertySet(properties, ['target','value'], ['op'], label)`
(`link.ts:352`) — a `trailingComment` key would have failed it. So `break # done` must link exactly
like `break`.

> **Evidence caveat, now discharged.** The measurements originally recorded here ran against a
> `packages/core/dist` built 2026-09-02, which predated rt9/rt10 and could produce no trustworthy
> link-level label. The oracle slice rebuilt `@kernlang/core` at slice-B tip `ca890efb` and
> re-measured **every** claim in this section directly. The base RED table is under RT12J-O2 and is
> no longer deferred.

### The two base refusals, and which gate wins

**[RT12J-C5 VERIFIED — from source, plus two landed oracles]** `compileBlock`
(`link.ts:513-543`) routes `for`, `while` and `if`(+`else`) and sends everything else to
`compileStatement` (`link.ts:309-388`), whose first act is `assertLeaf` (`:318`, defined `:164-166`)
and whose last line is the kind fallthrough (`:387`). So today:

| Fixture | base label | Evidence |
| --- | --- | --- |
| `break` / `continue` as a leaf, anywhere | `<label>: statement kind break is outside RT-1` | `link.ts:387`; **measured 2026-09-08 at base `ca890efb`** (RT12J-O2) and landed green at `scripts/kern-5-rt10-for/type-gate.test.mjs:110-123` (`neg-break-in-body`, `neg-continue-in-body`) and for a `while` body at `scripts/kern-5-rt11-linked-while/type-gate.test.mjs:25-26,89-103` |
| `break` **with children** | `<label>: statement must be a leaf` | `link.ts:318`; **measured** at handler top level *and* inside a `for` body, so the leaf gate demonstrably wins over any depth decision |

**The leaf gate keeps winning after this slice.** `assertLeaf` precedes every kind branch, so a
`break` carrying children is refused with `statement must be a leaf` whether or not it sits inside a
loop, and the loop-depth gate never sees it — **measured in both positions at base**. That precedence is pinned rather than reordered — it
costs no code and it is the only reading under which the two labels are unambiguous.

### Six dispatchers branch on `LinkedKernKirStatement.kind`; every one of them gets a *leaf* arm

**[RT12J-C6 VERIFIED — re-derived against `ca890efb`, RT12J-TD5]** Exhaustive inventory, **and the
count dropped from seven to six**: slice B extracted the two semantic walkers' child access into
`statementSubBlocks` (`contracts.ts:282-288`) and `statementSubExpressions` (`:290-296`), so
`statementsInvokeCapability` (`:367-379`) and `statementsCallDepth` (`:449-468`) no longer branch on
kind at all. They now share **one** fallthrough, and this slice's `contracts.ts` walker edit is
**one line**, not two arms.

| # | Function | File:line | Today | This slice's arm | Without it |
| --- | --- | --- | --- | --- | --- |
| 1 | `containsReturn` | `link.ts:152-163` | `return` / `for` / `while` / `if` (slice B added the `while` arm) | none — a jump is not a `return` and owns no block | nothing: the `.some` predicate is false for an unknown kind. **No arm needed**; the oracle pins the four-arm shape so no dead arm is added, and pins that a `void` handler with a `break` in a loop body still links |
| 2 | `compileBlock` | `link.ts:513-543` | routes `for`, `while`, `if`+`else` | none — `compileStatement` grows the two kind branches instead | a jump reaches the `:387` fallthrough (RT12J-C5) |
| 3 | `statementSubBlocks` | `contracts.ts:282-288` | `if` / `for` / `while`, else `return []` | **none — already correct**: the fallthrough is the empty list and a jump owns no block | nothing |
| 4 | `statementSubExpressions` | `contracts.ts:290-296` | `capability` / `if` / `while` / `for`, else `return [statement.value]` | one arm returning `[]` for both kinds | `[undefined]` reaches `expressionInvokesCapability` and `expressionCallDepth` → **TypeError: Cannot read properties of undefined (reading 'kind')** in *both* walkers, from one line. **Measured 2026-09-08** |
| 5 | `walkStatements` (RT-1) | `kir-runtime/expression.ts:184-294` | `let`/`assign`/`capability`/`print`/`if`/`for`/`while`, **else = the `return` arm** (`:281-291`) | two real arms (RT12J-D1) | a jump falls into the `return` arm and is treated as a value return → `statementValue(undefined, …)` throws. **Measured** |
| 6 | `blockSource` (JS) | `compiler/kir-js-esm/emitter.ts:292-320` | `return`/`assign`/`for`/`while`, else `leafSource` (`:301`) | one arm returning the jump source (RT12J-C13) | `leafSource` reaches `throw new Error('return statements are emitted by the specialized handler')` (`emitter.ts:236`) — an **emit-time TypeScript `Error`**, not a `__Fault`. **Measured** through `emitJavaScriptEsm` directly, because the public compile entry catches it and reports the generic `artifact-emission-failure` |
| 7 | `statementDeferral` (Python) | `compiler/kir-python/request.ts:101-133` | exhaustive `switch` closed by `const exhaustive: never` (`:129-132`), with slice B's `while` case at `:130` | `case 'break': case 'continue': return undefined;` | **`tsc` error** — the union-exhaustiveness tripwire slice A built, doing its job |

`expressionVariantUnhandled` (`contracts.ts:299-305`) is the expression-side guard; there is still no
statement-side equivalent, which is why #4 and #5 fail as TypeErrors and why they are drivable from a
hand-built linked statement with **no linker involvement** — an independent RED cause. **The
consequence of the collapse is that rows 3 and 4 of the original inventory are no longer two
independent causes**: both walkers report the identical TypeError from `statementSubExpressions`, so
the oracle asserts them as one mechanism reached through two entry points rather than as two.

The Python `blockSource` (`compiler/kir-python/emitter.ts:289-317`) deliberately gains **nothing**;
its digest stays pinned by slice A's `frozen-surface.test.mjs`.

### RT-1's frame stack already has the shape a jump needs

**[RT12J-C7 VERIFIED — re-derived, RT12J-TD1/TD2]** `LoopState` is no longer one record: slice B
made it a **discriminated union** `ForLoopState | WhileLoopState` (`kir-runtime/expression.ts:159-172`).
`ForLoopState` carries `counter`/`kind`/`step`/`to`/`current`; `WhileLoopState` carries only
`condition`/`kind`; `loopContinues` narrowed to `ForLoopState` (`:180-182`). `WalkFrame` is
`{ readonly loop: LoopState | undefined; readonly statements: readonly LinkedKernKirStatement[]; index: number }`
(`:174-178`) held in a `frames` array; `index` is mutable. A loop body is pushed **with** `loop` set
(`:265` for `for`, `:277` for `while`), an `if` branch with `loop: undefined` (`:256`).

The re-trip and exit logic still lives in one place, the frame-exhaustion branch, now `:199-222` —
and **the `while` re-test happens inside it** (`:207-212`), not at the loop head. That is the single
fact RT12J-O1 named as the largest residual risk, and it resolves **in this spec's favour**:
`continue` expressed as "jump the loop frame to its end" re-reads the condition for the condition
form and advances the counter for the counted form, through the same branch, with no duplicated head
logic. `enterTrip` (`:192-196`) is still the only loop-head site, and its counter bind is now guarded
`if (loop.kind === 'for')`.

**Constraint this adds for the implementer:** the `break` pop and the `continue` scan must test
`frame.loop !== undefined` and must never read a loop field before narrowing on `loop.kind` — a
`WhileLoopState` has no `step`, `to` or `current`.

**[RT12J-C8 VERIFIED — re-derived, RT12J-TD3]** `walkStatements` calls `runtime.checkAbort()` at
exactly two places — the statement boundary (`:226`) and inside `enterTrip` (`:194`). The statement
charge above it is now **conditional**: `if (statement.kind !== 'return' || policy.meterReturn) meter.step();`
(`:225`), which changes nothing for a jump (a jump is not a `return`, so it is always charged) and is
why RT12J-D3's "charged as an ordinary leaf" claim survives unchanged. The three exit slots are
`:218` (failed re-test), `:267` (`for` never entered) and `:279` (`while` never entered).

`scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs:141-146` pins the total at
exactly **2**, `:146-158` isolates the statement-boundary window
`between('const statement = frame.statements[frame.index];', "if (statement.kind === 'let')")` at
exactly 1, and `:158-163` isolates the loop-head window
`between('const enterTrip = (loop: LoopState): void => {', 'while (frames.length > 0) {')` at exactly 1.
**Both marker strings survived slice B verbatim** — `LoopState` is still the union's name — and this
slice's `tick-discipline.test.mjs` re-asserts all three, GREEN at base.

### Native jumps land correctly on both JavaScript loop forms — and on neither Python one

**[RT12J-C9 VERIFIED — re-derived]** JS `for` (`compiler/kir-js-esm/emitter.ts:242-269`, the header
update `cursor+=stride` still at `:264` exactly):

```
      __meter.step();                                   // init
      cursor=__intOperand(from); bound=…; stride=…;     // bounds, read once
      if(stride===0n)throw new __Fault(…);
      for(;stride>0n?cursor<bound:cursor>bound;cursor+=stride){   // <- the advance is the header update
      __meter.step(); __checkAbort();                   // head
      counter=__intValue(cursor,__meter);
      …body…
      }
      __meter.step();                                   // exit
```

A native `continue` runs the header update `cursor+=stride` and then the (unmetered) test, which is
**exactly** the path that falling off the end of the body takes. A native `break` skips the update and
the test and lands on the trailing `__meter.step()` at `:268`. **The `continue`-lands-on-step
invariant holds by construction on this leg, with no emitter change.**

**[RT12J-C10 VERIFIED — was PINNED-BY-B, now measured against `whileSource` at
`compiler/kir-js-esm/emitter.ts:271-290`; the landed lowering is byte-for-byte what slice B's spec
promised]** It is
`__meter.step(); while(true){ local=cond; if(local.tag!=='boolean')throw…; if(local.value!==true)break; __meter.step(); __checkAbort(); …body… } __meter.step();`.
A native `continue` jumps to the top of `while(true)` and re-evaluates the condition — again exactly
the fall-off-the-end path. A user `break` and the exit `break` are both native jumps out of the same
loop; they are not confusable at the semantic level (both exit through the trailing `__meter.step()`),
and the shape row that used to assert "a `break` exists" becomes a **count**: the emitted region for a
`while` carries `1 + (number of user breaks)` native `break` tokens (RT12J-C13).

**[RT12J-C11 VERIFIED — re-derived; the Python emitter is byte-frozen at
`c37b5c0092dd712e30f49b07ae7bc0ba1bb26343bcc219e29c750457756518d8`, so every line reference here is
unchanged]** Python `for` (`compiler/kir-python/emitter.ts:252-286`):

```
        while cmp(cursor, bound):
            _meter.step()
            _check_abort()
            counter = _int_value(cursor, _meter)
            …body…
            cursor = cursor + stride        # emitter.ts:272, inside the trip template at :269-273 — the LAST line of the trip body
        _meter.step()
```

A bare native `continue` in `…body…` **skips `cursor = cursor + stride`** and spins until
`maxSteps`. A native `break` is fine (it exits and the trailing `_meter.step()` runs). So the Python
catch-up for `continue` is not "emit `continue`" — see the sketch at RT12J-C17.

### Without the outside-loop refusal the emitted JavaScript would not parse

**[RT12J-C12 VERIFIED]** The entry handler body is emitted inside
`const __runSpecialized=async(__request,__options,__meter,__deadline,__events)=>{…}`
(`compiler/kir-js-esm/emitter.ts:411`) and each helper inside
`const __f0=async(…)=>{…}` (`:359`, locals named at `:369`). A `break` emitted at either top level is
`SyntaxError: Illegal break statement` — the artifact would fail to **load**, not fail closed. So the
link-time gates in RT12J-D2 are not stylistic: they are what keeps the artifact syntactically valid,
and the helper-boundary reset is the same argument (a native jump cannot cross a JS function
boundary). The internal `try { … } catch { … }` blocks the capability lowering emits (`:181-195`) are
**not** a barrier: a native jump out of a `try` block without `finally` is well-defined in both hosts.

### The census cannot move, and nothing else in the frontend track observes this

**[RT12J-C13a VERIFIED — measured 2026-09-07 on this branch]**
`scripts/kern-5-admission-census/admission.json` carries `total: 240`, `admittedCount: 1`, and
grouping its 240 results by `(stage, code)` yields **zero rows with `stage === 'link'`**. Widening the
linker admits exactly **0** additional tracked `.kern` files; `validateReport`
(`scripts/ci/kern-5-census-sweep.mjs:17-33`) treats `ratchet.admitted.length` as a floor. Census gain
is **measured, not estimated: 0**.

## What Already Works

- **The frontend.** RT12J-C1/C2/C3: no `.kern`, catalog, constitution, closure-ledger, census or
  `scripts/kern-frontend-*` change. Both kinds already project in every position this slice needs.
- **Both target kernels.** A jump needs no kernel helper: `__meter`, `__checkAbort`, `_meter`,
  `_check_abort` are already in `KERNEL_SOURCE`. `TARGET_KERNEL_SHA256` must not move on either leg.
- **The frame machinery.** RT12J-C7: `break` and `continue` are expressible as pure frame-stack
  operations over the existing `loop`/`index` fields, with **no** new `checkAbort()` site.
- **The JavaScript loop shapes.** RT12J-C9/C10: both are native-jump-safe already.
- **The refusal channel.** Slice A's `failure()` + `KIR_PYTHON_LEG_DEFERRED`, live at
  `compiler/kir-python/index.ts` and `request.ts:145-156`. This slice adds two ledger rows and two
  table entries, not a mechanism.
- **The leaf gate.** RT12J-C5: `break` with children is already refused, with a label this slice keeps.
- **The property fence.** RT12J-C4: F5 refuses a foreign property; `trailingComment` never arrives.
- **No new limit, no new diagnostic code.** `KernKirLimits` stays at seven fields;
  `KernKirDiagnosticCode` stays at twelve members; there is still no `maxIterations` in this stack
  (slice B, RT11W-C6).
- **The evidence wiring pattern.** `test:kern-5-rt12-linked-jumps` in `package.json`, appended to
  `test:kern-5-script-family`, appended to `kern5EvidenceCommands` in
  `scripts/ci/test-tier-contract.test.mjs` (an exact, order-sensitive `deepEqual`, `:151-157`). No
  `.github/workflows/ci.yml` change.

## Contract (Verified)

> Verified against `packages/core/src/kir-runtime/**`, `packages/core/src/compiler/**`,
> `packages/core/src/kir-structural/catalog.generated.ts`, `scripts/kir-structural/constitution.json`,
> `scripts/kern-5-rt10-for/**`, `scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs`,
> `scripts/kern-5-rt11-linked-while/**`, `scripts/kern-5-rt9-linked-assign/**`,
> `scripts/kern-5-rt2-boolean-if/**`, `scripts/kern-5-parity-ledger/**`,
> `scripts/kern-5-admission-census/admission.json`, and live frontend measurement on 2026-09-07
> (evidence caveat under RT12J-C4).

### The linked statements

**[RT12J-C14 VERIFIED]** `LinkedKernKirStatement` gains exactly two zero-field members, alongside the
seven at `contracts.ts:250-274` and slice B's `while`:

```ts
| { readonly kind: 'break' }
| { readonly kind: 'continue' }
```

Two members named for the two catalog kinds, **not** one `{kind:'jump'; target:…}` member. A `jump`
kind would have no catalog counterpart, would break the parity ledger's invariant that `nodeKind` is a
member of a linked union (`scripts/kern-5-parity-ledger/ledger-support.mjs:97-125`), would need a
`Record` key the Python lowering tables cannot name, and would make the rt2/rt9 `linkedStatementKinds`
scrapes (`/readonly kind: '([a-z-]+)'/gu`) report a kind the catalog does not bind.

### Link-time decisions (all under the closed code `handler-entry-unsupported`)

**[RT12J-D2 DECIDED]** Loop depth is a **link-time scope field**, and the refusal labels are:

| Gate | Label | Rule |
| --- | --- | --- |
| `break` outside any loop | `KIR_BREAK_OUTSIDE_LOOP` | `scope.loopDepth === 0` → refuse |
| `continue` outside any loop | `KIR_CONTINUE_OUTSIDE_LOOP` | `scope.loopDepth === 0` → refuse |
| a jump carrying children | `statement must be a leaf` | existing `assertLeaf` (`link.ts:317`), which wins over the depth gate |
| property set | never reachable — F5 refuses first (RT12J-C4) | `propertySet(properties, [], ['trailingComment'], label)` as defence in depth |
| **reserved, unreachable today** | `KIR_LOOP_JUMP_CROSSES_TRY` | RT12J-N4: written now, emitted never, because `try` is not in the linked union. The compatibility test asserts the string is **absent** from `link.ts`, so it cannot be silently spent on something else |

Two labels rather than one shared `KIR_LOOP_CONTROL_OUTSIDE_LOOP`, because every landed `type-gate`
oracle discriminates fixtures by label text (`assertLinkLabel`) and a per-kind label lets a `break`
row and a `continue` row separate without parsing the label path. The naming follows `link.ts`'s
`KIR_<SUBJECT>_<REASON>` convention (`KIR_FOR_ZERO_STEP` `:473`, `KIR_FOR_BOUND_NOT_INTEGER` `:453`,
`KIR_ASSIGN_TO_LOOP_COUNTER` `:358`, `KIR_IF_COND_NOT_BOOLEAN` `:416`, `KIR_WHILE_COND_NOT_BOOLEAN`
`:504`, `KIR_VOID_HANDLER_VALUE_RETURN` `:598`; the single-return rule at `:600-605`).

**The mechanism.** `LinkScope` (`link.ts:168-175`, six fields today) gains `readonly loopDepth: number`:

- `compileHandler` builds a **fresh** `LinkScope` per function (`link.ts:560-567`, all-empty sets), so
  `loopDepth: 0` there is what makes the **function boundary reset automatic** — a helper compiled
  from inside a caller's loop body still starts at 0. VERIFIED: helpers are compiled by their own
  `compileHandler` call, never by inheriting the caller's scope.
- `branchScope` (`link.ts:187-196`) copies every field, so an `if` branch **inherits** the depth: a
  `break` inside an `if` inside a loop is admitted, and a `break` inside a loop inside an `if` is too.
- `compileFor` (`link.ts:458-489`) builds its own body scope — `const bodyScope = branchScope(scope)`
  at `:477` — so it is a one-line change there: `loopDepth: scope.loopDepth + 1` on that copy.
- **`compileWhile` (`link.ts:490-511`) does NOT build one** (RT12J-TD4). It hands the caller's
  `scope` straight to `compileBranch(node, scope, meter, …)` at `:508`, and `compileBranch`
  (`:390-400`) is what calls `branchScope` at `:399` — the same `compileBranch` that `compileIf`
  (`:401-427`) uses at `:418`/`:423` and which must **not** increment. So `compileWhile` needs a
  local `branchScope(scope)` copy of its own, mirroring `compileFor`'s at `:477`, and
  `compileBranch` stays untouched. Giving `compileBranch` a depth parameter instead would have to
  thread `0` through both `compileIf` call sites and is the strictly larger change.

This is a scope field and not a `compileBlock` parameter precisely so the copy and the reset both come
from machinery that already exists and is already tested: `branchScope` (`:187-196`) copies every
field, and `compileHandler`'s fresh scope (`:560-567`) is the function-boundary reset.

**No unreachable-code gate.** See RT12J-D4.

### Semantics

| Rule | Value | Tag |
| --- | --- | --- |
| binding | the **innermost** enclosing loop — `for` or `while` — resolved at link time, never at run time | VERIFIED (RT12J-D2) |
| labels | **none**. Unlabelled only; KIR has no label syntax and this slice introduces none | VERIFIED (RT12J-C1: the only property is `trailingComment`) |
| `break` | terminates the innermost loop: control resumes at the statement after it | VERIFIED (RT12J-D1/C9) |
| `continue` | ends the current trip and re-enters the loop head: **the counter advance / condition re-evaluation always runs** | VERIFIED (RT12J-C9/C10, RT12J-D1) |
| nested loops | an inner jump never touches an outer loop, on either leg (native semantics; RT-1 pops to the *nearest* loop frame) | VERIFIED (RT12J-D1) |
| function boundary | a jump in a helper body is a **link refusal**, never a jump in the caller's loop | VERIFIED (RT12J-D2, and RT12J-C12 for why) |
| `try` boundary | forward constraint only; `try` is not in the union (RT12J-N4) | OPEN-BY-DESIGN |
| unreachable code after a jump | **admitted and ignored** | DECIDED (RT12J-D4) |
| `return` in a loop body | unchanged: legal, ends the handler; `containsReturn` needs no jump arm | VERIFIED (RT12J-C6 row 1) |
| scope | a jump binds no name and reads no expression, so `branchScope`, `assignable` and `counters` are untouched | VERIFIED |
| a jump with a trailing comment | links exactly like a bare one | VERIFIED (RT12J-C4) |

### Metering and tick discipline

**[RT12J-D1 DECIDED — the RT-1 implementation, and it adds no checkpoint]**

- **`break`**: pop frames from the top; the first frame with `loop !== undefined` is popped too, and
  popping it charges **exactly one** `meter.step()` — the same loop-exit slot the natural exit uses
  (`expression.ts:218` on a failed re-test, `:267`/`:279` when never entered). **No `checkAbort()`, no
  head charge, no condition evaluation.**
- **`continue`**: pop frames until the top frame has `loop !== undefined` **without popping it**, then
  set `frame.index = frame.statements.length` and let the ordinary dispatch loop run. The existing
  frame-exhaustion branch (`expression.ts:199-222`) then does the whole job — for a `ForLoopState`
  advance and re-test `loopContinues`, for a `WhileLoopState` re-evaluate `loop.condition` (`:207`) —
  then either `frame.index = 0; enterTrip(loop)` (head charge + the existing `checkAbort`) or
  `meter.step(); frames.pop()` (exit charge). **Neither arm may read a loop field before narrowing on
  `loop.kind`** (RT12J-C7).

`continue` is therefore expressed as **"jump the loop frame to its end"** and not as duplicated head
logic. Three consequences, each an oracle row: the *continue-lands-on-step* invariant holds by
construction for **both** loop forms; `continue` on the final trip exits and charges the exit slot,
matching the JS fall-through byte for byte; and **RT-1 still carries exactly two `checkAbort()` sites**,
so `tick-discipline.test.mjs:141-146` stays `=== 2` and both isolation windows stay `=== 1`.

**Constraint for the implementer.** Any pop helper may live inside the loop-head isolation window
`between('const enterTrip = …', 'while (frames.length > 0) {')` **only if it contains no
`checkAbort()`**, and neither window marker string may change (`:146-163`). The jump arms belong after
`if (statement.kind === 'let')` (`expression.ts:227`), which puts them outside the statement-boundary
window by construction. All three windows are re-asserted GREEN at base by
`scripts/kern-5-rt12-linked-jumps/tick-discipline.test.mjs`.

**[RT12J-D3 DECIDED — the JavaScript leg]** One `blockSource` arm, placed **before** the
`if (statement.kind !== 'if') return leafSource(...)` fallthrough (`emitter.ts:301`), emitting exactly:

```
      __meter.step(); __checkAbort();
      break;
```

(and `continue;` respectively). No local allocated, no wrapper, no signal object. A jump is charged as
an **ordinary leaf statement** — one `__meter.step()` and one `__checkAbort()` — which is precisely
what `assignSource` (`:209-210`), the `let`/`print` arms of `leafSource` (`:222-225`, `:227-233`) and
the `if` arm (`:306-308`) each emit, and precisely what RT-1's statement boundary charges (`:225-226`).
Both legs therefore charge the jump statement itself identically, without a per-leg correction.

**[RT12J-C15 VERIFIED — the per-slot charge table]** Every metered slot on both legs, for both loop
forms, with the jump paths added. `B` is the body cost, `C` a condition evaluation, `Bounds` the
three `for` bound reads (once), `Counter` the counter materialisation. **Measured on RT-1 at base
`ca890efb`, 2026-09-08 (RT12J-TD8): `Counter` is `0`** — `integerValue(current, meter)`
(`expression.ts:195`) charges no step — **`Bounds` is `3`, one head charge and one exit slot are `1`
each, `C` for one `i < <literal>` is `3`, and one `assign acc = acc + 1` is `4`.** Nine twin atoms
are frozen from that run in `metering.test.mjs` and asserted GREEN, so every identity below is read
against the program it was derived on.

| Path | RT-1 | JavaScript | Equal? |
| --- | --- | --- | --- |
| `for`, natural, `n` trips | `1_init + Bounds + n·(1_head + Counter + B) + 1_exit` | same slots, `emitter.ts:258-268` | yes (rt10-for's landed three-leg rows) |
| `for`, `break` on trip `k` | `1_init + Bounds + (k-1)·(1_head+Counter+B) + (1_head+Counter+B_pre+1_jump) + 1_exit` | `break` skips `cursor+=stride` and the test, lands on `:268` | yes |
| `for`, `continue` on every trip | `1_init + Bounds + n·(1_head+Counter+B_pre+1_jump) + 1_exit` | `continue` runs the header update and the unmetered test | yes |
| `while`, `break` on trip `k` | as above without `Bounds`/`Counter`, with `k·C` condition charges | native `break` out of `while(true)` onto the trailing `__meter.step()` | yes (VERIFIED against `whileSource` `:271-290`) |
| `while`, `continue` on every trip | `n` extra `C` charges, because `continue` re-tests the condition | identical: `continue` → top of `while(true)` → condition | yes (VERIFIED) |
| any jump | `1_jump = 1 meter.step() + 1 checkAbort()` at the statement boundary | `__meter.step(); __checkAbort();` | yes (RT12J-D3) |
| the exit slot after a `break` | exactly one `meter.step()`, no `checkAbort()` | the trailing `__meter.step()`, no `__checkAbort()` | yes |

**[RT12J-D5 DECIDED — measured rows, never a formula]** Slice B's lesson (`A + n·P` replacing
`2 + n·(1+B)`) is that a derived formula in an oracle goes RED against a *correct* implementation.
Every metering row here is an identity between twins measured in the same run, using rt10-for's
`loopStepBudget` binary search (`scripts/kern-5-rt10-for/k0-support.mjs:100-125`):

**Correction applied before any of these became fixtures (RT12J-TD9).** The J-rows as first drafted
compared a jump fixture against "one metered leaf" — but **no statement in RT-1 costs exactly one
step**: every leaf carries a value expression and `evaluateExpression` charges at least one on top of
the statement boundary. The cheapest measured body statement is `assign acc = acc + 1` at **four**.
So each row below is instead a **difference between a jump fixture and a hand-counted twin that
carries the jump fixture's body minus exactly the jump statements**, with the statement counts written
into the assertion message. Rows are as landed in
`scripts/kern-5-rt12-linked-jumps/metering.test.mjs`.

| Row | Identity (as landed) | What it falsifies |
| --- | --- | --- |
| **J1** break exits | `ticks(for 0..N { assign; break })` is **independent of `N`** for `N ∈ {1,3,10}` — identical two-statement bodies, integer-literal bounds throughout | a `break` that does not actually leave the loop (would scale with `N`) |
| **J2** break is an ordinary statement landing on the shared exit slot | `ticks(for 0..1 { assign; break }) − ticks(for 0..1 { assign }) == 1` — body **2 statements vs 1**, one trip each, the twin exiting by failed re-test and the fixture by the break | a `break` charged 0 or 2; one that re-charges the head (2); one that skips the exit slot (0) |
| **J3** continue lands on the step | `ticks(for 0..3 { assign; continue }) − ticks(for 0..3 { assign }) == 3` — body **2 vs 1**, three trips each — and the run terminates returning 3 | a `continue` that skips the counter advance (no threshold exists at all); one that charges the head twice (6) |
| **J4** continue and break skip the rest of the trip | `ticks(for 0..3 { continue; assign }) == ticks(for 0..3 { continue })` and `ticks(for 0..3 { break; assign }) == ticks(for 0..3 { break })` — body **2 vs 1**, the extra statement unreachable | a jump that falls through to the trailing statement |
| **J5a** the `while` form agrees on `continue` | `ticks(while i<3 { assign; incr; continue }) − ticks(while i<3 { assign; incr }) == 3` — body **3 vs 2**, three trips each, both returning 3 | a condition-form `continue` that skips the condition re-read (diverges) or double-charges it |
| **J5b** the `while` form agrees on `break` | `ticks(while i<1 { assign; incr }) − ticks(while i<1 { assign; incr; break }) == C − 1`, body **2 vs 3**, one trip each, with `C` measured independently from the never-entered path | a `break` that re-tests on its way out (`−1`); one that skips the exit slot (`C`) |
| **J6a** inner break is loop-local | `ticks(for o 0..3 { for n 0..5 { assign; break } }) − ticks(for o 0..3 { for n 0..1 { assign } }) == 3` — inner body **2 vs 1**, one inner trip either way, three outer passes | an inner `break` that pops the **outer** loop (run ends after one outer pass, far fewer ticks) or pops nothing (five inner trips, far more) |
| **J6b** inner continue is loop-local | `ticks(for o 0..3 { for n 0..2 { assign; continue } }) − ticks(for o 0..3 { for n 0..2 { assign } }) == 6` — inner body **2 vs 1**, identical bound | a `continue` that escaped its inner loop, or one charged per outer pass rather than per inner trip |
| **J7** leg identity | for each jump family, the emitted artifact's own step threshold equals RT-1's execution count exactly, pinned from both sides; one budget below the threshold fails on both legs. Seven families: both kinds, both loop forms, a nested pair, a jump-only body, and the `while(true)` importer shape | any single slot charged differently on one leg |
| **J8** checkpoint census | RT-1 total `=== 2` with both isolations `=== 1`; and a jump adds **exactly one** emitted `__checkAbort()` — measured against a control twin that adds one ordinary statement to the same loop body, so the claim is "a jump costs an ordinary leaf's census", not an absolute count | a third RT-1 site; a jump lowered without the ordinary statement checkpoint (0) or with a head checkpoint of its own (2) |
| **J9** cancellation latency never widens | every jump fixture carries **at least as many** emitted checkpoints as the jump-free twin of the same loop shape — six pairs | a lowering that hoisted a jump above the loop head, or replaced the head checkpoint with the jump's own |
| **J10** divergence agrees | a `continue` that skips its own increment exhausts `maxSteps` **byte-identically on both legs** at every budget in `{16, 64, 512}` | a leg on which a divergent `continue` terminates, or one that reports a different fault |

### Emitted-shape rows

**[RT12J-C13 VERIFIED — design; region extraction re-derived and reused verbatim from
`scripts/kern-5-rt11-linked-while/tick-discipline.test.mjs:24-36`: artifact → `__runSpecialized` →
the `try {`/`} finally {` statement region. All four marker strings survive slice B]**

| Rule | Value |
| --- | --- |
| host construct | a native JS `break;` / `continue;` — a keyword, never a host global |
| `for` body with one user `break` | the region carries exactly **one** `break` token for that loop |
| `while` body with one user `break` | exactly **two** `break` tokens: the lowering's exit break plus the user's |
| signal objects | zero. No `__Break`, no `__Continue`, no `throw` added — the tribunal's ruling, and the reason the rt4 fault channel is untouched |
| function boundaries | the region from the loop head onward contains **no** `function` and no `=>` token beyond what the same body carries under a jump-free twin (a native jump cannot cross a function boundary), asserted as a token equality against that twin rather than as an absolute census |
| new host patterns | zero. `scripts/kern-5-r2-js-lowering/closure.test.mjs:17`'s `FORBIDDEN_EMITTED` matches none of the added text; no `JSON`, `process`, `eval`, `Function`, `import`, `require`, no `node:` specifier |
| new kernel bytes | zero; both `TARGET_KERNEL_SHA256` values unchanged |
| suspension points | zero new `await`/`Promise`/`queueMicrotask`/`setImmediate` |
| dead code after a jump | emitted verbatim and never executed (RT12J-D4) — legal JS, and the metering row J4 proves it costs nothing |

### The single-return rule and unreachable code

**[RT12J-D4 DECIDED — ignore, with precedent from `if` and `for`]** A `return` (or any statement)
after an unconditional `break`/`continue` inside a loop body is **admitted and not analysed**. Three
pieces of precedent, all from source:

1. **The linker performs no reachability analysis anywhere.** `compileBlock` (`link.ts:513-543`)
   compiles children in order and tracks nothing about completion; `containsReturn` (`:152-163`) exists
   solely to feed the void-handler gate (`:598`), never a reachability decision.
2. **The single-return rule filters the top-level list only** (`link.ts:600-605`:
   `statements.at(-1)?.kind !== 'return'` and `statements.filter(...).length !== 1` over the handler's
   own statement array), which is exactly why rt10-for's `for-early-return` fixture
   (a `return` inside a `for` body plus a final top-level `return`) is admitted today, and is
   re-asserted admitted by this slice's `type-gate.test.mjs`. A loop body is never inspected for completion, so a `break`
   in one cannot change that rule's answer.
3. **The `if` precedent**: statements after a `return` inside an `if` branch are admitted for the same
   reason. Refusing unreachable code after a jump would be the **first** reachability rule in the
   linker, and it would have to be written for `return` too, or it would be inconsistent.

Rows this decision implies: `for { break; let z }` links, runs, and never binds `z` (J4 plus a
behaviour row on the returned value); `for { break; return v }` links and never returns `v`; a
top-level `[return v, break]` is refused with **`KIR_BREAK_OUTSIDE_LOOP`** and *not* with
`expected exactly one final return`, because `compileBlock` compiles every child before
`compileHandler` reaches its return check — a sharp ordering discriminator.

### Python leg — two ledger rows

**[RT12J-C16 VERIFIED]** Two rows, key-set exactly slice A's `ROW_KEYS`
(`scripts/kern-5-parity-ledger/ledger-support.mjs:43` = `['blockedBy','label','nodeKind','since','spec','surface']`, asserted through slice A's own constant rather than copied),
sorted with slice B's `while` row (`break` < `continue` < `while`):

| Field | `break` | `continue` | Why |
| --- | --- | --- | --- |
| `nodeKind` | `'break'` | `'continue'` | the stable ID; never a source path |
| `surface` | `'statement'` | `'statement'` | slice A's disambiguator |
| `blockedBy` | `['while']` | `['while']` | see below |
| `label` | `'KIR_PYTHON_LEG_DEFERRED'` | same | `= ledger.label`; the redundancy is the drift gate |
| `since` | `'kern-5-rt12-linked-jumps'` | same | matches slice A's `/^kern-5-[a-z0-9]+(-[a-z0-9]+)*$/` |
| `spec` | `.Codex/specs/kern-5-rt12-linked-jumps/spec.md` | same | asserted to **exist on disk** by `validateLedger` |

**Why `blockedBy: ['while']`, and what `blockedBy` means.** It is a **catch-up ordering** column and
gates nothing at compile time (slice A, RT11W-C16). The ordering here is not "the code cannot be
written": a Python `break` inside a `for` body is expressible without `while`. It is that the **row
cannot be repaid** before `while` is: step 5 of slice A's catch-up procedure requires
"three-leg byte-identical envelopes for the node kind", and one of the catalog-permitted positions for
a jump is a `while` body — a program in that position still refuses on the `while` row, so the
repayment evidence is unobtainable until `while` lands. `validateLedger`
(`ledger-support.mjs:120-125`) enforces that a `blockedBy` entry names an existing row, so these rows
are only valid **after** slice B's row exists, and slice A's catch-up step 3 already prescribes
deleting the reference when the `while` row goes. Slice B's row is landed
(`scripts/kern-5-parity-ledger/parity-ledger.json`, `blockedBy: []`), so the ordering constraint is
satisfied and `validateLedger` accepts the three-row document.

| Refusal rule | Value |
| --- | --- |
| what refuses | slice A's compile-entry pass, after `linkVerifiedKernKirProgramOrThrow` succeeds and before `emitPython` |
| the result | exactly `{format:'kern.compiler.kir-python.v1', outcome:'failure', code:'KIR_PYTHON_LEG_DEFERRED'}` — three keys, no `artifact`, no `manifest` |
| **which kind is reported** | `pythonLoweringDeferral` returns the **first** deferred kind in pre-order (`request.ts:148-159`, over `statementsDeferral` `:135-146`). A `for` body containing a `break` reports `'break'` (the `for` is `lowered`, so the walk descends); a `while` body containing a `break` reports `'while'` (the `while` row fires at `:104` before the walk reaches the body). Same code either way — but a row that asserts the reported kind must expect `'break'` only from the `for` position. **Both halves are oracle rows** |
| coverage | every catalog-permitted position reachable through the linker: `for` body, `while` body, `if`-then/`if`-else inside a loop body, nested loops |
| `compiler/kir-python/emitter.ts` | **byte-identical**; slice A's frozen digest must not move |

**[RT12J-C17 VERIFIED — Python lowering sketch, so the catch-up is cheap]**

- **`break`** is a bare native `break` in both Python loop forms. In the `for` lowering it exits the
  `while cmp(cursor,bound):` head and the trailing `_meter.step()` runs — the same landing as JS
  (RT12J-C11). Nothing to restructure.
- **`continue` in the `while` form** (slice B's `while True:` sketch, RT11W-C17) is a bare native
  `continue`: the condition is re-evaluated at the top of the loop, so the invariant holds.
- **`continue` in the `for` form must not be a bare `continue`.** The counter advance is the last line
  of the trip body (`emitter.ts:272`, inside the trip template at `:269-273`). Two admissible repairs, in preference order:
  1. **Advance-then-continue**: emit `cursor = cursor + stride` immediately before every `continue`
     that targets that loop. Purely local, no head restructuring, no new host pattern, and the emitted
     text still contains exactly one arithmetic form the artifact already uses. Cost: the advance
     expression is duplicated once per `continue`.
  2. **Head-advance restructuring**: move the advance to the top of the trip behind a first-trip flag.
     Rejected as the default because it changes the emitted shape of **every** existing `for` program
     and would move `emission-golden.json` for positions this slice never touched.
  - **`try/finally` per trip is rejected**: it is a new host pattern in the emitted artifact, and
    `continue` inside `finally` was a syntax error before Python 3.8.
- **No loop-`else`** in either form (slice B, RT11W-C17): `while … else` runs only on non-`break` exit,
  which reintroduces the two-exit ambiguity native jumps remove.
- Forbidden in the catch-up as always: no `int(`, no `float(`, no `range(`, no chained comparison.

## Implementation Plan

One option; the decision space genuinely collapses once RT12J-D1 is chosen. Ordered so that no
intermediate state fails to compile:

1. **`kir-runtime/linked-kir-program/contracts.ts`** — the two union members (RT12J-C14) and **one
   line** in `statementSubExpressions` (`:290-296`): slice B did land the
   `statementSubBlocks`/`statementSubExpressions` extraction, `statementSubBlocks`'s `return []`
   fallthrough is already correct for a childless kind, and the single edit is an arm returning `[]`
   for both jump kinds ahead of the `return [statement.value]` fallthrough (RT12J-C6, RT12J-TD5).
2. **`kir-runtime/linked-kir-program/link.ts`** — `loopDepth` on `LinkScope` (`:168-175`), `0` in
   `compileHandler` (`:560-567`), `+1` on `compileFor`'s existing `bodyScope` (`:477`) and on a **new**
   `branchScope` copy inside `compileWhile` (`:508`, which today passes the caller's scope straight
   through — RT12J-TD4), and the two `compileStatement` kind branches with the labels of RT12J-D2.
3. **`kir-runtime/expression.ts`** — the two RT-1 arms of RT12J-D1, with `checkAbort()` untouched.
4. **`compiler/kir-js-esm/emitter.ts`** — one `blockSource` arm (RT12J-D3), placed before the
   `leafSource` fallthrough.
5. **`compiler/kir-python/request.ts`** — `break: 'deferred'`, `continue: 'deferred'` in
   `KIR_PYTHON_STATEMENT_LOWERING` (`:25-33`) **and** the `case 'break': case 'continue':` arm in
   `statementDeferral` (`:100-131`), whose `never` guard makes step 5 non-optional.
6. **`scripts/kern-5-parity-ledger/parity-ledger.json`** — the two rows, plus the `LEDGER_SHA256`
   re-pin in `ledger-support.mjs:40`.
7. **The licensed golden moves and the derived digest cascade** (Blast Radius), in the order given
   under Deploy Order.
8. **`compiledCoreDigest` re-pin, then `pnpm write:kern-canonicalizer-coverage`**, in that order.

### Two file-size facts, and neither may be answered with a new file

`packages/core/src/kir-runtime/linked-kir-program/contracts.ts` is **532 lines** and `link.ts` is
**723** (re-measured on the landed slice-B base, 2026-09-08; slice B's walker extraction shrank
`contracts.ts` by four lines and its `while` compiler grew `link.ts` by twenty-eight) — both already
past the 500-line rule. The 354-file compiled inventory pin
(`scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:11`) forbids a **new file under
`packages/core/src`**, and history confirms the pin bites: a `linked-kir-program/walkers.ts` was
created and then withdrawn (`e105f1da refactor(kern5): keep both expression walkers in contracts.ts
with the tripwire`). So this slice adds the smallest possible arms — every one of them is a *leaf*
arm, which is the cheapest arm shape there is — and the `contracts.ts` / `link.ts` splits stay
**queued** until the inventory pin is renegotiated.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-rt12-linked-jumps/spec.md` | add | this document |
| `scripts/kern-5-rt12-linked-jumps/**` | add | the oracle: probe-matrix, type-gate, behaviour, metering, tick-discipline, walker-coverage, python-deferral, compatibility, plus a harness and a fixture catalogue split so no hand-written module passes 500 lines |
| `package.json` | edit | `test:kern-5-rt12-linked-jumps`; appended to `test:kern-5-script-family` |
| `scripts/ci/test-tier-contract.test.mjs` | edit | `kern5EvidenceCommands` gains one entry; the `deepEqual` is exact and order-sensitive |
| `.github/workflows/ci.yml` | **no edit** | the `kern-5-evidence` job runs the aggregate once |
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | edit | two union members; **one** arm in `statementSubExpressions` (RT12J-TD5) — not two walker arms |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | edit | `LinkScope.loopDepth`; the depth increments in `compileFor`/`compileWhile`; two `compileStatement` branches |
| `packages/core/src/kir-runtime/expression.ts` | edit | the two RT-1 arms (RT12J-D1); **no new `checkAbort()`** |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | edit | one `blockSource` arm before the `leafSource` fallthrough |
| `packages/core/src/compiler/kir-python/emitter.ts` | **no edit** | byte-frozen; slice A pins its digest |
| `packages/core/src/compiler/kir-python/request.ts` | edit | two `'deferred'` table entries + the `never`-guarded switch arm |
| `packages/core/src/kir-runtime/contracts.ts` (`KernKirLimits`, `KernKirDiagnosticCode`) | **no edit** | no new limit, no new code; `maxIterations` is still not a field of this stack |
| `packages/core/src/parser-core.ts`, `parser-validate-body-statements.ts`, `kir-structural/**`, the constitution, the closure ledger, any `.kern` | **no edit** | RT12J-C1/C3: F5 already projects both kinds in every needed position. `BODY_LOOP_CONTROL_OUTSIDE_LOOP` belongs to the legacy TS parser and is not this stack's gate |
| `scripts/kern-5-parity-ledger/parity-ledger.json` | **edit — licensed** | the `break` and `continue` rows (RT12J-C16) |
| `scripts/kern-5-parity-ledger/ledger-support.mjs` | **edit — licensed** | `LEDGER_SHA256` re-pin (`:40`); the only digest a row move touches |
| `scripts/kern-5-parity-ledger/ledger-schema.test.mjs` | **no edit** | re-measured: its row-count assertions (`:69`, `:72`) run against synthetic documents it builds itself, never against the checked-in ledger |
| `scripts/kern-5-parity-ledger/ledger-aware-gates.test.mjs:61-79` | **edit — licensed** | asserts `loadParityLedger().rows` deepEquals the single `while` row and `[...kinds.statement]` deepEquals `['while']` (`:76`); becomes three rows and three kinds (RT12J-TD10) |
| `scripts/kern-5-parity-ledger/exhaustiveness.test.mjs:70-77` | **edit — licensed** | `STATEMENT_KINDS` gains `break`/`continue`, and `assert.deepEqual(deferred, ['while'])` becomes `['break','continue','while']` (RT12J-TD10) |
| `scripts/kern-5-parity-ledger/ledger-support.mjs:268-289` (`WHILE_ROW_POSITIONS`) | **edit — licensed, and NOT optional** | slice B's `while`-shaped mirror is selected by `row.nodeKind === 'while' ? … : STATEMENT_POSITIONS` in **two** dispatchers (`parent-positions.test.mjs:69-75`, `refusal-golden.test.mjs:77-84`). A `break` or `continue` row falls through those ternaries to the `for`-shaped `STATEMENT_POSITIONS`, which carry **no jump node at all**, so the Python compile succeeds and `assertNoPythonArtifact` fails. Two jump-shaped mirrors — or one `Record<nodeKind, positions>` replacing both ternaries — are required (RT12J-TD11) |
| `scripts/kern-5-parity-ledger/parent-positions.test.mjs:69-75` and `refusal-golden.test.mjs:77-84` | **edit — licensed** | the two `nodeKind === 'while'` ternaries become a per-kind lookup (RT12J-TD11) |
| `scripts/kern-5-parity-ledger/frozen-surface.test.mjs` (`NEIGHBOUR_GOLDENS`) | **edit — licensed** | slice B re-pinned rt2/rt3/rt9 there to their post-rt11-cascade digests; this slice's cascade moves all three again (RT11W-TD4's successor) |
| `scripts/kern-5-parity-ledger/support.mjs` | **no edit** | re-measured: `linkedProgramKinds` adds `statement.kind` unconditionally and probes only `[value, input, condition, from, to, step]` and `[body, thenBranch, elseBranch]`, all `undefined` on a zero-field jump, so `pythonDeferral` and `pythonLegAdmissionColumn` handle jumps with no change (RT12J-TD12) |
| `scripts/kern-5-rt2-boolean-if/k0-golden.{json,test.mjs}` | **edit — licensed** | `linkedStatementKinds` gains `"break"` and `"continue"`; the golden's **second** test (`:121-129`) requires `STATEMENT_PROBES.filter(admission === 'admitted')` to `deepEqual` that union, so `PROBE_BODIES` (`:17-28`) and `STATEMENT_PROBES` (`:30-40`) each gain a `break` and a `continue` entry whose body wraps the jump in a `for` — e.g. `['let name=x value="0"', 'for name=i from="0" to="1"', '  break']` (a bare jump would be `handler-entry-unsupported` and the two lists would disagree) |
| `scripts/kern-5-rt9-linked-assign/k0-golden.{json,test.mjs}` | **edit — licensed** | re-measured: the hardcoded list at `:102` is `['assign','capability','for','if','let','print','return','while']` and gains both kinds; the loop at `:103` is already `['each','set']` (slice B dropped `'while'`) and needs no change; the test title at `:100` names the kinds and should too |
| `scripts/kern-5-rt3-binary-expression/k0-golden.json` | **edit — licensed** | its `rt2GoldenSha256` field is derived from the RT-2 golden |
| `scripts/kern-5-rt4-user-fn-call/probe-matrix.json` | **edit — licensed** | carries both `rt2GoldenSha256` and `rt3GoldenSha256` |
| `RT2_GOLDEN_SHA256` literals in rt4, rt5, rt6, rt9, rt10-pre, rt10-X `compatibility.test.mjs` | **edit — licensed** | **6 files** (measured: `grep -rln RT2_GOLDEN_SHA256 scripts`) |
| `RT3_GOLDEN_SHA256` literals in rt6, rt9, rt10-for, rt10-X, rt10-pre, rt11 `compatibility.test.mjs` | **edit — licensed** | **6 files** (measured) |
| `RT9_GOLDEN_SHA256` literals in rt10-for, rt10-X `compatibility.test.mjs` | **edit — licensed** | **2 files** (measured) |
| the historical pre-image literals in rt9 and rt10-pre `compatibility.test.mjs` | **verify, do not assume** | slice B's RT11W-O5 applies unchanged: the reconstructions `{...golden, rt2GoldenSha256: <historical>}` survive only while that is the single RT-3 field the cascade moves |
| `scripts/kern-5-rt10-for/type-gate.test.mjs:110-123` | **edit — licensed** | the test *`break` and `continue` reach the ordinary statement refusal inside a loop body* is exactly what this slice invalidates: both fixtures become **admitted**. Move them to rt10-for's admitted set or delete them and let this slice's suite own them |
| `scripts/kern-5-rt10-for/compatibility.test.mjs:63` | **edit — licensed** | `STILL_OUTSIDE` is `['break','continue','each','set']` today and drops both kinds → `['each','set']` |
| `scripts/kern-5-rt11-linked-while/type-gate.test.mjs:25-26,89-103` | **edit — licensed** | slice B's two `REFUSALS` rows (`:25-26`) and its *break and continue reach the ordinary statement refusal inside a while body* test (`:89-103`) flip to admitted |
| `scripts/kern-5-rt11-linked-while/compatibility.test.mjs:75` | **edit — licensed** | `STILL_OUTSIDE` → `['each','set']` |
| `scripts/kern-5-rt11-linked-while/fixtures.mjs:282-283,318-319` | keep | `neg-while-break-in-body` / `neg-while-continue-in-body` stay valid fixtures; only their expected verdict moves. Note both use `while cond="false"`, so as admitted rows they run zero trips |
| `scripts/kern-5-rt12-linked-jumps/**` | **added by this slice** | twelve files: `fixtures.mjs` (66 fixtures), `k0-support.mjs`, `behavior-table.json` (25 frozen rows), `probe-matrix.json`, and eight test modules. Every hand-written module is under 500 lines |
| `scripts/kern-5-rt11-linked-while/probe-matrix.{json,test.mjs}` | **no edit** | the 28-child list and the catalog schema are unchanged catalog facts |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` (`compiledCoreDigest`) | **edit — licensed** | any content change under `packages/core/src` moves it. Slice B re-pinned it at `1eb312e4`; re-pin again, then `pnpm write:kern-canonicalizer-coverage` |
| `scripts/kern-canonicalizer/*.json` coverage receipts | regenerate | `pnpm write:kern-canonicalizer-coverage`; `coverageImplementationDigest` moves because the re-pin edits a `.mjs` under `scripts/kern-canonicalizer` |
| the 354-file inventory count and path digest | **no edit** | five existing files are edited; none added or removed. **No new file under `packages/core/src` is permitted** |
| `TARGET_KERNEL_SHA256` (both kernels), every emitted-artifact digest, every manifest digest, `projectionArtifactSha256` | **no edit** | if one moves, a `KERNEL_SOURCE` byte was touched, which is forbidden. `linkedProgramSha256` changes per *program*, which is not a re-pin |
| `scripts/runtime-contract-v1/**`, `scripts/kir-v1/alpha-receipt-policy.json` | **no edit** | slice A PL-C7: RC-v1 declares only the `KernRuntimeHandler*` surface. **No amendment record required** |
| `scripts/kern-5-admission-census/**` | **no edit** | RT12J-C13a: zero tracked files are rejected at `link`, so the admission gain is exactly **0** and the ratchet is a floor |
| `scripts/kir-v1/eligibility.json`, `coverage-witness-ledger.json`, `scripts/kern-canonicalizer/coverage-family-registry.json` | **no edit** | slice B's negative grep stands: these are the F5/static-catalog track and do not observe linker admission |
| `scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs:141-163` | **no edit** | RT12J-D1 is chosen precisely so `=== 2` and both `=== 1` isolations hold, and both window marker strings survived slice B verbatim. Re-asserted GREEN by this slice's own `tick-discipline.test.mjs`. If a builder needs a third site, the decision has changed and this spec is wrong |
| `scripts/kern-5-runtime-envelope-max-steps/**`, `scripts/kern-frontend-*`, `scripts/conformance.mjs` | **no edit** | the legacy IRNode runner is a different execution stack |

## Acceptance Criteria

Each **is** a test in `scripts/kern-5-rt12-linked-jumps/`, landed RED at base `ca890efb`. Every
criterion rests on a VERIFIED claim: no PINNED-BY-B tag survived the re-derivation, and no ASSUMED or
OPEN claim fed a fixture. The one residual is RT12J-O6 — the frozen values and identities are derived
from the re-measured RT-1 charge model and cannot be confirmed against a running jump implementation
until one exists.

- [ ] `break` and `continue` are members of `LinkedKernKirStatement` with **no fields**, and `each` and
      `set` stay outside it.
- [ ] Every projectable in-loop position links and runs on RT-1 and JavaScript with byte-identical
      envelopes: `for` body, `while` body, `if`-then and `if`-else inside a loop body, inner and outer
      of a nested pair, a loop inside a helper body.
- [ ] A bare `break` at handler top level is refused with `KIR_BREAK_OUTSIDE_LOOP`, and a bare
      `continue` with `KIR_CONTINUE_OUTSIDE_LOOP`, on all three legs — and F5 **projects** both, so the
      refusal is the linker's and not the frontend's.
- [ ] A jump inside an `if` that is **not** inside a loop is refused with the same labels; a jump
      inside an `if` that **is** inside a loop links.
- [ ] A jump in a helper body is refused even when the helper is called from inside the caller's loop,
      and the label is the outside-loop one — the function boundary resets loop depth.
- [ ] A jump carrying children is refused with `statement must be a leaf`, inside a loop and outside
      one: the leaf gate wins over the depth gate.
- [ ] `break # done` and `continue # done` link exactly like the bare forms.
- [ ] Trip counts: `for 0..3 { if i==1 { break } }` runs 2 trips; `for 0..3 { continue }` runs 3 trips
      and terminates; `while` equivalents agree.
- [ ] An inner `break` leaves the outer loop running, on both legs, with byte-identical envelopes.
- [ ] `for { break; let z }` and `for { break; return v }` link and run, and neither trailing statement
      takes effect (RT12J-D4); a top-level `[return v, break]` is refused with
      `KIR_BREAK_OUTSIDE_LOOP` and **not** `expected exactly one final return`.
- [ ] A `void` handler with a `break` in a loop body links (no `containsReturn` arm is needed) while
      one with a `return` there is still refused with `KIR_VOID_HANDLER_VALUE_RETURN`.
- [ ] Every dispatcher sees a jump: a `capability` after a `break` still reaches the closure walk, a
      call in a jump-carrying body still counts against call depth, a jump-only body answers
      `false`/`0` rather than throwing, RT-1's own walk runs the jump instead of mistaking it for a
      value return, and `emitJavaScriptEsm` lowers it to the host keyword instead of throwing. All
      five are driven from hand-built linked programs, independent of the linker.
- [ ] RT-1 carries exactly **two** `checkAbort()` calls, one in each isolation window (J8), and no
      jump lowering removes an emitted checkpoint from the region it sits in (J9).
- [ ] The emitted JavaScript region carries a native `break;`/`continue;` preceded by
      `__meter.step(); __checkAbort();`, no `__Break`/`__Continue`, no new `function`/`=>` token, no new
      `await`/`Promise`/`queueMicrotask`/`setImmediate`, and no new kernel line; a `while` with one user
      break carries exactly two `break` tokens and a `for` exactly one.
- [ ] The metering identities **J1-J10** hold as measured twin differences, every twin hand-counted
      statement-by-statement against its jump fixture with the count in the assertion message, and the
      two legs' step thresholds agree exactly across seven fixture families (J7).
- [ ] The parity ledger carries the `break` and `continue` rows with the pinned values, key-set
      identical to slice A's `ROW_KEYS`, sorted before `while`, each with `blockedBy: ['while']`, and
      the three-row document validates under slice A's `validateLedger`.
- [ ] Slice A's two row-position dispatchers select a jump-shaped mirror catalogue for a jump row
      rather than falling through to the `for`-shaped `STATEMENT_POSITIONS` (RT12J-TD11).
- [ ] The Python compile of a jump-containing program returns exactly
      `{format, outcome:'failure', code:'KIR_PYTHON_LEG_DEFERRED'}` — three keys, no `artifact`, no
      `manifest` — in every linker-reachable jump position, while the JavaScript leg of the same
      program is `admitted`; and `pythonLoweringDeferral` reports `'break'` for the `for` position and
      `'while'` for the `while` position (first-in-pre-order, `request.ts:145-156`).
- [ ] `KernKirLimits` stays at seven fields and `KernKirDiagnosticCode` at twelve members; both target
      kernels are byte-unchanged; the F5 projection policy digest is unchanged.
- [ ] `KIR_LOOP_JUMP_CROSSES_TRY` appears in **no** source file: the label is reserved, not spent.
- [ ] `pnpm test:ci-contract` passes with the new evidence leaf wired; `pnpm lint` is clean.

## Out of Scope

- **Labelled jumps.** No label syntax exists in the catalog (RT12J-C1) and none is added.
- **`each`, `do`, `set`, `try`/`catch`, `with`.** Outside the linked union, asserted.
- **The Python `break`/`continue` lowering.** Deferred by ledger row; RT12J-C17 is the design.
- **Any restructuring of the Python `for` lowering.** RT12J-C17's repair belongs to the catch-up slice;
  `compiler/kir-python/emitter.ts` stays byte-frozen here.
- **`break`/`continue` inside a `try`.** Forward constraint RT12J-N4 with a reserved label.
- **Any reachability or dead-code analysis** (RT12J-D4).
- **Any `maxIterations` / iteration-budget field.**
- **Any `link.ts` target parameter.** Link stays target-neutral (slice A PL-C10).
- **The `contracts.ts` / `link.ts` splits.** Blocked by the 354 inventory pin; queued.
- **Any push, merge, release-gate promotion or deployment.**

## Notes pinned now for later slices

- **[RT12J-N4]** `break`/`continue` **never cross a KIR `try` boundary**. When `try` enters the linked
  union, a jump whose innermost enclosing construct chain crosses a `try`/`catch`/`finally` node before
  reaching its loop is a link refusal with the reserved label `KIR_LOOP_JUMP_CROSSES_TRY`. Written now
  because the try/catch slice would otherwise relitigate it, and because both hosts make the naive
  lowering *look* correct: a native jump out of a `try` block is legal JS and legal Python 3.8+, so
  nothing would fail loudly if the constraint were forgotten.
- **[RT12J-N5]** Loop depth is a **link-time** notion. No leg may carry a runtime loop-depth counter:
  the frame stack (RT-1) and the host's own loop nesting (JS) already are the answer.
- **[RT12J-N6]** When a future slice introduces an iteration budget, per-loop-instance-reset-at-entry
  stays the pinned intent (slice B, RT11W-N6) — it is the only choice compatible with both the
  `continue`-lands-on-step invariant and a `range()`-shaped Python `for`.
- **[RT12J-N7]** When closures arrive, a jump must not be admitted across a lambda body: the same
  argument as RT12J-C12 (a native jump cannot cross a function boundary) plus the same link-time reset
  (`compileHandler`'s fresh scope) is the mechanism to reuse.

## Open Questions

- **[RT12J-O1 RESOLVED — 2026-09-08, against `ca890efb`]** Every PINNED-BY-B claim was re-derived
  against the landed slice-B implementation. The largest named risk — how a condition loop re-enters
  its head on frame exhaustion — resolved **in this spec's favour**: the `while` re-test lives inside
  the frame-exhaustion branch (`expression.ts:207-212`), so RT12J-D1's `continue` formulation ("jump
  the loop frame to its end") works unchanged for both loop forms. RT12J-C10 landed byte-for-byte as
  promised. Four claims moved: RT12J-C7 (`LoopState` is now a discriminated union), RT12J-C6 (the two
  semantic walkers collapsed into one shared helper, so the edit is one line and the two REDs are one
  cause), RT12J-D2 (`compileWhile` builds no body scope and needs one), and RT12J-D5 (the J-rows had
  to be rewritten as twin differences). All four are in the Corrections Log.
- **[RT12J-O2 RESOLVED — measured 2026-09-08 on `@kernlang/core` built at `ca890efb`]** The base RED
  table, and the single-cause table the oracle design gate requires:

  | Oracle module | RED | GREEN | The one cause every RED reports |
  | --- | --- | --- | --- |
  | `probe-matrix.test.mjs` | 0 | 7 | — (all GREEN: every fixture projects, so no link RED is a projection gap) |
  | `compatibility.test.mjs` | 0 | 11 | — (all GREEN: kernels, emitter, policy, goldens, limits, census, the reserved label, and the F5-projects-a-bare-jump fence) |
  | `walker-coverage.test.mjs` | 15 | 1 | `TypeError: Cannot read properties of undefined (reading 'kind')` (rows 1-9, from `statementSubExpressions`); `Error: return statements are emitted by the specialized handler` (rows 10-11, from `leafSource`); the mapping/union/switch absences (rows 12-13, 16); the link refusal (row 14) |
  | `type-gate.test.mjs` | 21 | 6 | `entry.…: statement kind <break\|continue> is outside RT-1` — the `link.ts:387` kind fallthrough, in every one |
  | `behavior.test.mjs` | 33 | 2 | `RT12J_LINK_REFUSED: javascript compile failed: handler-entry-unsupported` |
  | `metering.test.mjs` | 16 | 1 | `linking does not succeed inside the scanned step range` — the same link refusal surfacing through `loopStepBudget`'s search |
  | `tick-discipline.test.mjs` | 7 | 3 | `RT12J_LINK_REFUSED` (the three RT-1 checkpoint rows are GREEN and must stay GREEN) |
  | `python-deferral.test.mjs` | 3 | 1 | the ledger's missing rows, then the link refusal |
  | **total** | **95** | **32** | |

  Measured base labels, by position: a jump **as a leaf** anywhere reports
  `statement kind <kind> is outside RT-1` (`link.ts:387`) — at handler top level
  (`children[1]`), inside an `if` (`children[1].then.children[0]`), inside an `else`
  (`children[1].else.children[0]`), in a `for` body (`children[1].body.children[0]`), in a `while`
  body, after a loop (`children[2]`), after the final return (`children[2]`), and inside a helper
  (`helper.jb.handler.children[0]`). A jump **with children** reports `statement must be a leaf`
  (`link.ts:318`) both inside a loop and at handler top level — so the leaf gate's precedence over the
  depth gate is measured, not argued.
- **[RT12J-O3 DECIDED — 2026-09-07]** Unreachable code after a jump is admitted and ignored
  (RT12J-D4). Recorded as a decision rather than an open question because the alternative would
  introduce the linker's first reachability rule, which `return` would immediately make inconsistent.
- **[RT12J-O4 OPEN — routing, inherited]** Slice B's RT11W-O1 (RT-9's `admissionRow` asserting
  `rt1 === javascript` **and** `javascript === python`) is unresolved. It fires on any per-leg
  divergence, and this slice adds two more diverging kinds. Partially mitigated by re-derivation:
  slice A's `pythonLegAdmissionColumn` (`scripts/kern-5-rt4-user-fn-call/k0-support.mjs:145-159`) is
  ledger-aware and returns the JavaScript code once a kind is deferred, and it needs no change for
  jumps (RT12J-TD12). No acceptance criterion here depends on the answer.
- **[RT12J-O6 OPEN — technical, for the implementation slice]** The twenty-five frozen behaviour
  values and the eleven metering identities were hand-derived against the RT-1 charge model
  re-measured at RT12J-C15 (`Counter = 0`, `Bounds = 3`, head and exit `1` each, `C = 3`, one
  `assign acc = acc + 1` `= 4`); the model reproduces all nine measured twin atoms exactly. They have
  **not** been confirmed against a running jump implementation, because none exists. If a row fails at
  GREEN time the first question is whether the fixture's hand-count or RT12J-D1's charge decision is
  wrong — the assertion messages carry the statement counts precisely so that question is answerable
  without re-deriving the model.
- **[RT12J-O5 OPEN — advisory]** RT12J-C17's preference between advance-then-`continue` and
  head-advance restructuring for the Python `for` form is a *catch-up* decision. It is recorded with a
  recommendation and a rejected option so the catch-up slice inherits the reasoning; nothing in this
  slice depends on it.

## Deploy Order

1. **Slice B's implementation must land first.** A `break` bound to a `while` cannot be tested — or
   even typed — before `while` is in the union, and `blockedBy: ['while']` is invalid until slice B's
   ledger row exists (`validateLedger`, `ledger-support.mjs:117-124`).
2. **This slice: spec + RED oracle + wiring.** Nothing under `packages/core/src` moves, so no digest is
   re-pinned here.
3. **This slice's implementation, in one commit for the core edits**: union members + walker arms +
   `loopDepth` + link branches + RT-1 arms + JS arm. A union member without the `never`-guarded Python
   switch arm does not compile; arms without a link branch are dead.
4. **The ledger rows + the two mapping flips, together.** Either alone fails slice A's bidirectional
   staleness gate — the whole reason that gate is bidirectional.
5. **The licensed golden moves and the derived digest cascade**, in dependency order: rt2 golden
   (union + two new probe bodies) → rt3 golden's `rt2GoldenSha256` → rt4 probe matrix → the six
   `RT2_GOLDEN_SHA256` literals → the six `RT3_GOLDEN_SHA256` literals → rt9 golden → the two
   `RT9_GOLDEN_SHA256` literals. Then re-verify the historical pre-images (slice B's RT11W-O5).
6. **The rt10-for and rt11 refusal-row flips**, in the same commit as the cascade so no suite is
   transiently RED.
7. **`compiledCoreDigest` re-pin, then `pnpm write:kern-canonicalizer-coverage`**, in that order.

No version skew window: every consumer is in this repository and ships in the same commit.

## Queued follow-ups

- **The `each` slice.** Needs the collection model; `each` carries nine properties against `while`'s
  one. A jump inside an `each` body inherits RT12J-D2 for free once `each` increments `loopDepth`.
- **The `try`/`catch` slice.** RT12J-N4 is its contract, and `KIR_LOOP_JUMP_CROSSES_TRY` is reserved
  for it.
- **The Python catch-up batch** (`while` + `break` + `continue`, in that order per `blockedBy`).
  RT11W-C17 and RT12J-C17 are the designs; slice A's seven-step catch-up procedure is the recipe, and
  step 3 requires deleting `'while'` from these rows' `blockedBy` when the `while` row goes.
- **The closures slice.** RT12J-N7.
- **The `contracts.ts` and `link.ts` splits.** Both files are already past the 500-line rule (536 and
  695); both are blocked by the 354-file compiled inventory pin, and the withdrawn `walkers.ts`
  (`e105f1da`) is the precedent for why a new file is not an option today.
- **RT12J-O1** (re-measure the PINNED-BY-B claims), **RT12J-O2** (measure the base RED table on a built
  slice-B base), **RT12J-O4** (RT-9's third cross-leg tripwire), **RT12J-O5** (the Python `for` repair
  choice).

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| Base link labels for `break`/`continue` can be measured directly, the way slice B measured `while` | The available `packages/core/dist` was built 2026-09-02 and predates rt9/rt10: rt10-for's own `accumulate(0,3)` fixture **fails to link** on it, and every `for` fixture reports the misleading `statement must be a leaf`. The frontend half of the same dist is current (no `parser*`/`frontend-projection*`/`kir-structural` change since 2026-08-26) | All link-level claims are re-sourced to `link.ts` line numbers plus landed green assertions in rt10-for (`type-gate.test.mjs:117-129`) and rt11 (`type-gate.test.mjs:83-99`); the base RED table is explicitly deferred to the oracle slice as RT12J-O2 rather than quoted from a stale run |
| F5 rejects a bare `break` at handler top level, so the outside-loop refusal is defence in depth | F5 **projects** it (`status:'projected'`, zero diagnostics). The `BODY_LOOP_CONTROL_OUTSIDE_LOOP` check lives only in the legacy TypeScript parser (`parser-validate-body-statements.ts:85-96`); F5's projection runs the self-hosted F4/F5 classifier, which does not carry it | `KIR_BREAK_OUTSIDE_LOOP` / `KIR_CONTINUE_OUTSIDE_LOOP` become **real, falsifiable** oracle rows rather than an unreachable runtime path — the opposite of slice B's RT11W-O2 posture (RT12J-C3) |
| The Python leg can lower `continue` as a bare native `continue`, mirroring the JS leg | The Python `for` lowering advances the cursor on the **last line of the trip body** (`kir-python/emitter.ts:272, inside the trip template at :269-273`), so a bare `continue` skips the step and spins to `maxSteps`. The JS leg is safe only because rt10-for put the advance in the native `for` **header update** (`kir-js-esm/emitter.ts:264`) | The Python sketch became a *restructuring* recipe with a preferred repair, a rejected repair and a rejected `try/finally` (RT12J-C17), which is exactly what makes the catch-up cheap instead of a redesign |
| The rt2 golden only needs `linkedStatementKinds` extended | Its second test (`k0-golden.test.mjs:120-129`) asserts `STATEMENT_PROBES.filter(admission==='admitted')` **deepEquals** that union, so a kind added to the union without an *admitted* probe body breaks the golden's second test rather than its first | `PROBE_BODIES` and `STATEMENT_PROBES` each gain a `break` and a `continue` entry whose body wraps the jump in a `for` — the same class of edit slice B needed for `PROBE_BODIES.while`, and now named in Blast Radius rather than discovered mid-implementation |
| A `break` needs a `containsReturn` arm, like `for` and `if` | `containsReturn` is a `.some` predicate over three kinds; an unrecognised kind is simply `false`, and a jump owns no block that could hide a `return`. The void-handler gate is unaffected | One fewer edit, and an acceptance criterion that pins it: a `void` handler with a `break` in a loop body links, while one with a `return` there is still refused |
| `trailingComment` must be allowed through the link-time property gate | RT-9's `assign … # note` fixture is pinned `"admitted"` while `assign`'s gate is `propertySet(properties,['target','value'],['op'],label)` — a `trailingComment` key would have failed it, so the property never reaches the linker | The gate stays `propertySet(properties, [], ['trailingComment'], label)` as pure defence in depth, and `break # done` becomes a positive link row that settles it either way |
| The union could carry one `{kind:'jump'; target:'break'\|'continue'}` member | The parity ledger keys rows on a linked-union kind that must also be a catalog kind (`validateLedger`), the Python lowering tables are `Record<LinkedKernKirStatement['kind'],…>`, and the rt2/rt9 goldens scrape `readonly kind: '…'` literals | Two zero-field members named for the catalog kinds (RT12J-C14) |
| A new `linked-kir-program/walkers.ts` could absorb the walker arms and keep `contracts.ts` under 500 lines | That file was created and **withdrawn** (`e105f1da`), and the 354-file compiled inventory pin forbids a new file under `packages/core/src` | The splits stay queued; this slice adds only leaf arms, the cheapest arm shape available, and says so explicitly rather than silently growing an over-long file |

### Re-derivation against the landed slice B (`ca890efb`), 2026-09-08

Every row here is a claim this document made against slice B's *spec* and that the oracle slice
re-measured against slice B's *code*. RT12J-O1 named this as the largest residual risk; these twelve
rows are the answer.

| ID | Original Claim | Reality at `ca890efb` | Impact |
| --- | --- | --- | --- |
| **RT12J-TD1** | `LoopState` is one record with `counter`/`step`/`to`/`current`, and `loopContinues(loop)` takes it | Slice B split it into a discriminated union `ForLoopState \| WhileLoopState` (`expression.ts:159-172`); `WhileLoopState` carries only `condition`/`kind`, and `loopContinues` narrowed to `ForLoopState` (`:180-182`) | RT12J-D1 gains an explicit constraint: the `break` pop and the `continue` scan must test `frame.loop !== undefined` and must never read a loop field before narrowing on `loop.kind`. Neither arm needs one, so the decision itself is unchanged |
| **RT12J-TD2** | The frame-exhaustion branch is `expression.ts:182-197`, and a condition loop's re-entry is unspecified | It is `:199-222`, and the `while` re-test is **inside** it (`:207-212`): the branch evaluates `loop.condition` on exhaustion, exactly as it advances a `for` counter | The single largest RT12J-O1 risk resolves in this spec's favour. `continue` as "jump the loop frame to its end" re-tests the condition for free, with no duplicated head logic, on both loop forms |
| **RT12J-TD3** | `enterTrip` is `:184-188`; the statement `meter.step()` is unconditional at `:207`; `checkAbort` at `:186` and `:208` | `enterTrip` is `:192-196` with its counter bind guarded `if (loop.kind === 'for')`; the statement charge is conditional — `if (statement.kind !== 'return' \|\| policy.meterReturn) meter.step();` (`:225`) — and `checkAbort` is at `:194` and `:226`. Both rt10-pre window marker strings survived verbatim | Nothing for a jump: a jump is never a `return`, so it is always charged. The `LoopState` type name survived, so the loop-head window still resolves; this slice re-asserts all three checkpoint rows GREEN |
| **RT12J-TD4** | "`compileFor` and slice B's `compileWhile` pass `loopDepth: scope.loopDepth + 1` into the body scope they already build with `branchScope`" | `compileFor` does build one (`link.ts:477`). **`compileWhile` does not** — it hands the caller's `scope` straight to `compileBranch(node, scope, …)` (`:508`), and `compileBranch` (`:390-400`) is what calls `branchScope` (`:399`) — the same `compileBranch` `compileIf` uses and which must not increment | The implementation plan gains a real step: `compileWhile` needs its own `branchScope(scope)` copy, mirroring `compileFor`. A `compileBranch` depth parameter would have to thread `0` through both `compileIf` call sites and is strictly larger |
| **RT12J-TD5** | Seven dispatchers; `statementsInvokeCapability` and `statementsCallDepth` each branch on kind and each need a leaf arm, giving two independent RED causes | Slice B extracted `statementSubBlocks` (`contracts.ts:282-288`) and `statementSubExpressions` (`:290-296`); both walkers now go through them and branch on kind nowhere. `statementSubBlocks`'s `return []` fallthrough is already correct; `statementSubExpressions`'s `return [statement.value]` is the single source of both TypeErrors (measured identical) | The `contracts.ts` walker edit is **one line, not two arms**, and the two walker REDs are one mechanism reached through two entry points. The oracle says so rather than claiming two independent causes |
| **RT12J-TD6** | `containsReturn` has three arms (`return`/`for`/`if`) | Four: slice B added `while` (`link.ts:152-163`) | Conclusion unchanged — a jump owns no block, so still no arm. The oracle now pins the **four**-arm shape, so an added dead arm is caught |
| **RT12J-TD7** | `contracts.ts` is 536 lines and `link.ts` 695 | 532 and 723: the walker extraction shrank `contracts.ts`, the `while` compiler grew `link.ts` | Both still past the 500-line rule; the splits stay queued behind the 354-file inventory pin |
| **RT12J-TD8** | The RT-1 charge table's `Counter` term (counter materialisation) is an unmeasured cost | Measured `0`: `integerValue(current, meter)` (`expression.ts:195`) charges no step. `Bounds = 3`, head `= 1`, exit `= 1`, one `i < <literal>` `= 3`, one `assign acc = acc + 1` `= 4`, and the model reproduces all nine twin atoms exactly | RT12J-C15 became a measured table, and the nine atoms are frozen GREEN in `metering.test.mjs` so no identity can be read against a program it was not derived on |
| **RT12J-TD9** | The J-rows can compare a jump fixture against "one metered leaf" — e.g. `ticks(for 0..1 { break }) == ticks(for 0..1 { <one metered leaf> })` | **No RT-1 statement costs one step.** Every leaf carries a value expression and `evaluateExpression` charges at least one on top of the statement boundary; the cheapest measured body statement is four. All five such rows were arithmetically wrong and would have gone RED against a correct implementation — RT11W-TD1's defect class, caught before it became a fixture | Every J-row was rewritten as a **difference against a hand-counted twin** that carries the jump fixture's body minus exactly the jump statements, with the statement counts written into the assertion message. J5 split into a `continue` half and a `break` half whose identity is `C - 1`; J9 became "no checkpoint is removed"; J10 was added for divergence |
| **RT12J-TD10** | Slice A's ledger tests need at most a row-count edit | Three of them assert the ledger's exact contents, not its size: `ledger-aware-gates.test.mjs:61-79` deepEquals the single `while` row and `[...kinds.statement]` against `['while']` (`:76`); `exhaustiveness.test.mjs:70-77` deepEquals the deferred set against `['while']`. `ledger-schema.test.mjs` needs **no** edit — its row counts are over synthetic documents | Three named licensed edits in Blast Radius instead of one speculative one, and one file moved to "no edit" with the reason |
| **RT12J-TD11** | Slice B's ledger widening shows how a new row registers, so `break`/`continue` rows slot in without further slice-A edits | They do **not**. Slice B's `WHILE_ROW_POSITIONS` mirror is selected by `row.nodeKind === 'while' ? … : STATEMENT_POSITIONS` in two dispatchers (`parent-positions.test.mjs:69-75`, `refusal-golden.test.mjs:77-84`). A jump row falls through to the `for`-shaped `STATEMENT_POSITIONS`, which carry no jump node, so the Python compile **succeeds** and `assertNoPythonArtifact` fails | A required licensed slice-A edit, now named: two jump-shaped mirrors, or one `Record<nodeKind, positions>` replacing both ternaries. Discovering this at implementation time would have looked like a jump defect |
| **RT12J-TD12** | Unstated: slice A's `pythonDeferral` walk might need a jump arm | It does not. `linkedProgramKinds` (`scripts/kern-5-parity-ledger/support.mjs:34-44`) adds `statement.kind` unconditionally and probes only `[value, input, condition, from, to, step]` and `[body, thenBranch, elseBranch]`, all `undefined` on a zero-field jump | `support.mjs` and `pythonLegAdmissionColumn` are "no edit" rows with evidence, and the type-gate rows that route through them are GREEN once the linker admits |

### Measured directly, superseding argued evidence

| ID | Original Claim | Reality (measured 2026-09-08) | Impact |
| --- | --- | --- | --- |
| **RT12J-TD13** | `trailingComment` never reaches the linker, argued from RT-9's `assign … # note` fixture being pinned `"admitted"` against a `propertySet` that would have rejected the key | F5 **drops the comment entirely**: `break # done` inside a `for` body projects with `properties: {}`, byte-identical to a bare `break`. The projected shapes are equal node-for-node | RT12J-D2's property gate is unreachable by construction, not merely fenced. `probe-matrix.test.mjs` asserts the two projected shapes are `deepEqual`, which settles it without an inference chain |
| **RT12J-TD14** | `break name=x` inside a `for` body → `projectKernModules` returns `status: 'rejected'`, `['projection-rejected']` | `status: 'rejected'` with `diagnostics: []` — the status is right, the diagnostic code list is empty | The two F5 fences assert `status === 'rejected'` only, and the probe matrix freezes the empty diagnostic list rather than a code that does not appear |
| **RT12J-TD15** | Unstated: the JavaScript emit-time `Error` is observable through the public compile entry | `compileJavaScript` catches every emit throw and returns the generic code `artifact-emission-failure` (`compiler/kir-js-esm/index.ts:70-73`), which masks the cause | `walker-coverage.test.mjs` drives `emitJavaScriptEsm` directly with a hand-built linked program, so the RED reports `Error: return statements are emitted by the specialized handler` and names its own cause |
