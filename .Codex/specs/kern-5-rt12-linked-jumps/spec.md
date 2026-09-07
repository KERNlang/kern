# KERN 5 — RT-12 unlabelled `break`/`continue`: linked jumps in KIR (JS + RT-1 legs, Python leg deferred)

**Status:** SPEC — ORACLE NOT YET WRITTEN
**Date:** 2026-09-07
**Confidence:** 0.87

**Depends on slice B landing at commit `e7be45d6`** — `feat/kern-5-rt11-linked-while`
@ `e7be45d6d5b08f62225d9c6be8e074de02c82b6f` (`fix(kern5): correct the rt11 charge model and align
its assertion mechanisms`). That tip carries slice B's **spec + RED oracle + wiring only**: `while`
is **not** in `LinkedKernKirStatement` there (`packages/core/src/kir-runtime/linked-kir-program/contracts.ts:250-274`,
seven members, measured on this branch 2026-09-07). This slice therefore stacks on a *contract*, not
on landed code, and every claim below tagged **PINNED-BY-B** is a slice-B spec pin that this slice
inherits and must re-measure once slice B's implementation commit exists. Slice A
(`feat/kern-5-parity-ledger`) is **IMPLEMENTED** (`.Codex/specs/kern-5-parity-ledger/spec.md`,
status line): the deferral mechanism, `KIR_PYTHON_LEG_DEFERRED_CODE` and the exhaustive lowering
tables are live in `packages/core/src/compiler/kir-python/request.ts:25-156`.

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

> **Evidence caveat, recorded once and honoured everywhere below.** The measurements in RT12J-C3/C4
> ran against `packages/core/dist` built 2026-09-02. That dist is **current for the frontend** — no
> file in `packages/core/src/frontend-projection*`, `parser-core.ts`,
> `parser-validate-body-statements.ts` or `kir-structural/` has changed since 2026-08-26
> (`git log -1 --date=iso` on those paths) — and **stale for the linker**: it predates rt9/rt10, and
> rt10-for's own `accumulate(0,3)` fixture fails to link on it. **Every link-level claim in this spec
> is therefore sourced from `link.ts` itself plus landed, CI-green oracle assertions, never from that
> dist.** The oracle slice must re-measure the base RED table on a freshly built slice-B base.

### The two base refusals, and which gate wins

**[RT12J-C5 VERIFIED — from source, plus two landed oracles]** `compileBlock`
(`link.ts:489-515`) routes only `for` and `if`(+`else`) and sends everything else to
`compileStatement` (`link.ts:308-387`), whose first act is `assertLeaf` (`:317`, defined `:163-165`)
and whose last line is the kind fallthrough (`:386`). So today:

| Fixture | base label | Evidence |
| --- | --- | --- |
| `break` / `continue` as a leaf, anywhere | `<label>: statement kind break is outside RT-1` | `link.ts:386`; **landed and green** at `scripts/kern-5-rt10-for/type-gate.test.mjs:117-129` (`neg-break-in-body`, `neg-continue-in-body`, which also assert the message is *not* `statement must be a leaf`) and again for a `while` body at `scripts/kern-5-rt11-linked-while/type-gate.test.mjs:19-20,83-99` |
| `break` **with children** | `<label>: statement must be a leaf` | `link.ts:317`; the leaf gate runs before any kind branch, so it wins even inside a loop |

**The leaf gate keeps winning after this slice.** `assertLeaf` precedes every kind branch, so a
`break` carrying children is refused with `statement must be a leaf` whether or not it sits inside a
loop, and the loop-depth gate never sees it. That precedence is pinned rather than reordered — it
costs no code and it is the only reading under which the two labels are unambiguous.

### Seven dispatchers branch on `LinkedKernKirStatement.kind`; every one of them gets a *leaf* arm

**[RT12J-C6 VERIFIED]** Exhaustive inventory. Two of the seven are `never`-guarded (a missing arm is
a `tsc` error); four fall through in a way that turns a missing arm into a **TypeError, not a fault**;
one throws a plain `Error` at emit time.

| # | Function | File:line | Today | This slice's arm | Without it |
| --- | --- | --- | --- | --- | --- |
| 1 | `containsReturn` | `link.ts:152-161` | `return` / `for` / `if` | none — a jump is not a `return` and owns no block | nothing: the `.some` predicate is false for an unknown kind. **No arm needed**, and the oracle pins that a `void` handler with a `break` in a loop body still links |
| 2 | `compileBlock` | `link.ts:489-515` | routes `for`, `if`+`else` | none — `compileStatement` grows the two kind branches instead | `break` reaches the `:386` fallthrough (RT12J-C5) |
| 3 | `statementsInvokeCapability` | `contracts.ts:351-373` | `capability` / `if` / `for`, else `statement.value` | `return false` (no owned expression) | `expressionInvokesCapability(undefined, …)` → **TypeError: Cannot read properties of undefined (reading 'kind')** |
| 4 | `statementsCallDepth` | `contracts.ts:443-471` | `capability` / `if` / `for`, else `statement.value` | `return 0` | same TypeError |
| 5 | `walkStatements` (RT-1) | `kir-runtime/expression.ts:176-264` | `let`/`assign`/`capability`/`print`/`if`/`for`, **else = the `return` arm** (`:251-263`) | two real arms (RT12J-D1) | a jump falls into the `return` arm and is treated as a value return → `statementValue(undefined, …)` throws |
| 6 | `blockSource` (JS) | `compiler/kir-js-esm/emitter.ts:271-303` | `return`/`assign`/`for`, else `leafSource` | one arm returning the jump source (RT12J-C13) | `leafSource` reaches `throw new Error('return statements are emitted by the specialized handler')` (`emitter.ts:236`) — an **emit-time TypeScript `Error`**, not a `__Fault` |
| 7 | `statementDeferral` (Python) | `compiler/kir-python/request.ts:100-131` | exhaustive `switch` closed by `const exhaustive: never` (`:126-129`) | `case 'break': case 'continue': return undefined;` | **`tsc` error** — the union-exhaustiveness tripwire slice A built, doing its job |

`expressionVariantUnhandled` (`contracts.ts:283-289`) is the expression-side guard; there is still no
statement-side equivalent, which is why #3 and #4 fail as TypeErrors and why they are drivable from a
hand-built linked statement with **no linker involvement** — an independent RED cause.

The Python `blockSource` (`compiler/kir-python/emitter.ts:289-317`) deliberately gains **nothing**;
its digest stays pinned by slice A's `frozen-surface.test.mjs`.

### RT-1's frame stack already has the shape a jump needs

**[RT12J-C7 VERIFIED]** `WalkFrame` is
`{ readonly loop: LoopState | undefined; readonly statements: readonly LinkedKernKirStatement[]; index: number }`
(`kir-runtime/expression.ts:165-169`) held in a `frames` array; `index` is mutable. A loop body is
pushed **with** `loop` set (`:247`), an `if` branch with `loop: undefined` (`:238`). The re-trip and
exit logic lives in one place, the frame-exhaustion branch (`:182-197`): `loop.current += loop.step`,
then `loopContinues(loop)` → `frame.index = 0; enterTrip(loop)` — or `meter.step()` and `frames.pop()`.
`enterTrip` (`:184-188`) is the **only** loop-head site: `meter.step(); runtime.checkAbort(); bindings.set(...)`.

**[RT12J-C8 VERIFIED]** `walkStatements` calls `runtime.checkAbort()` at exactly two places — the
statement boundary (`:208`, right after `frame.index += 1` and the statement `meter.step()` at `:207`)
and inside `enterTrip` (`:186`). `scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs:141-146`
pins the total at exactly **2**, `:146-158` isolates the statement-boundary window
`between('const statement = frame.statements[frame.index];', "if (statement.kind === 'let')")` at
exactly 1, and `:158-163` isolates the loop-head window
`between('const enterTrip = (loop: LoopState): void => {', 'while (frames.length > 0) {')` at exactly 1.

### Native jumps land correctly on both JavaScript loop forms — and on neither Python one

**[RT12J-C9 VERIFIED]** JS `for` (`compiler/kir-js-esm/emitter.ts:242-269`):

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

**[RT12J-C10 PINNED-BY-B]** Slice B's `while` lowering (RT11W-C15) is
`__meter.step(); while(true){ local=cond; if(local.tag!=='boolean')throw…; if(local.value!==true)break; __meter.step(); __checkAbort(); …body… } __meter.step();`.
A native `continue` jumps to the top of `while(true)` and re-evaluates the condition — again exactly
the fall-off-the-end path. A user `break` and the exit `break` are both native jumps out of the same
loop; they are not confusable at the semantic level (both exit through the trailing `__meter.step()`),
and the shape row that used to assert "a `break` exists" becomes a **count**: the emitted region for a
`while` carries `1 + (number of user breaks)` native `break` tokens (RT12J-C13).

**[RT12J-C11 VERIFIED — this is the tribunal's concern, confirmed]** Python `for`
(`compiler/kir-python/emitter.ts:252-286`):

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
(`compiler/kir-js-esm/emitter.ts:389`) and each helper inside
`const __f0=async(…)=>{…}` (`:335`). A `break` emitted at either top level is
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
`KIR_<SUBJECT>_<REASON>` convention (`KIR_FOR_ZERO_STEP` `:471-473`, `KIR_FOR_BOUND_NOT_INTEGER`
`:436-455`, `KIR_ASSIGN_TO_LOOP_COUNTER` `:357`, `KIR_IF_COND_NOT_BOOLEAN` `:415`,
`KIR_VOID_HANDLER_VALUE_RETURN` `:570`).

**The mechanism.** `LinkScope` (`link.ts:167-174`) gains `readonly loopDepth: number`:

- `compileHandler` builds a **fresh** `LinkScope` per function (`link.ts:530-537`, all-empty sets), so
  `loopDepth: 0` there is what makes the **function boundary reset automatic** — a helper compiled
  from inside a caller's loop body still starts at 0. VERIFIED: helpers are compiled by their own
  `compileHandler` call, never by inheriting the caller's scope.
- `branchScope` (`link.ts:186-195`) copies every field, so an `if` branch **inherits** the depth: a
  `break` inside an `if` inside a loop is admitted, and a `break` inside a loop inside an `if` is too.
- `compileFor` (`link.ts:457-487`) and slice B's `compileWhile` pass `loopDepth: scope.loopDepth + 1`
  into the body scope they already build with `branchScope`.

This is a scope field and not a `compileBlock` parameter precisely so the copy and the reset both come
from machinery that already exists and is already tested.

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
  (`expression.ts:198` on a failed re-test, `:249` when never entered). **No `checkAbort()`, no head
  charge, no condition evaluation.**
- **`continue`**: pop frames until the top frame has `loop !== undefined` **without popping it**, then
  set `frame.index = frame.statements.length` and let the ordinary dispatch loop run. The existing
  frame-exhaustion branch (`expression.ts:182-197`) then does the whole job — advance/re-test, then
  either `frame.index = 0; enterTrip(loop)` (head charge + the existing `checkAbort`) or
  `meter.step(); frames.pop()` (exit charge).

`continue` is therefore expressed as **"jump the loop frame to its end"** and not as duplicated head
logic. Three consequences, each an oracle row: the *continue-lands-on-step* invariant holds by
construction for **both** loop forms; `continue` on the final trip exits and charges the exit slot,
matching the JS fall-through byte for byte; and **RT-1 still carries exactly two `checkAbort()` sites**,
so `tick-discipline.test.mjs:141-146` stays `=== 2` and both isolation windows stay `=== 1`.

**Constraint for the implementer.** Any pop helper may live inside the loop-head isolation window
`between('const enterTrip = …', 'while (frames.length > 0) {')` **only if it contains no
`checkAbort()`**, and neither window marker string may change (`:146-163`). The jump arms belong after
`if (statement.kind === 'let')` (`expression.ts:209`), which puts them outside the statement-boundary
window by construction.

**[RT12J-D3 DECIDED — the JavaScript leg]** One `blockSource` arm, placed **before** the
`if (statement.kind !== 'if') return leafSource(...)` fallthrough (`emitter.ts:283`), emitting exactly:

```
      __meter.step(); __checkAbort();
      break;
```

(and `continue;` respectively). No local allocated, no wrapper, no signal object. A jump is charged as
an **ordinary leaf statement** — one `__meter.step()` and one `__checkAbort()` — which is precisely
what `assignSource` (`:207-209`), the `let`/`print` arms of `leafSource` (`:222-224`, `:227-229`) and
the `if` arm (`:288-290`) each emit, and precisely what RT-1's statement boundary charges (`:207-208`).
Both legs therefore charge the jump statement itself identically, without a per-leg correction.

**[RT12J-C15 VERIFIED — the per-slot charge table]** Every metered slot on both legs, for both loop
forms, with the jump paths added. `B` is the body cost, `C` a condition evaluation, `Bounds` the
three `for` bound reads (once), `Counter` the counter materialisation.

| Path | RT-1 | JavaScript | Equal? |
| --- | --- | --- | --- |
| `for`, natural, `n` trips | `1_init + Bounds + n·(1_head + Counter + B) + 1_exit` | same slots, `emitter.ts:258-268` | yes (rt10-for's landed three-leg rows) |
| `for`, `break` on trip `k` | `1_init + Bounds + (k-1)·(1_head+Counter+B) + (1_head+Counter+B_pre+1_jump) + 1_exit` | `break` skips `cursor+=stride` and the test, lands on `:268` | yes |
| `for`, `continue` on every trip | `1_init + Bounds + n·(1_head+Counter+B_pre+1_jump) + 1_exit` | `continue` runs the header update and the unmetered test | yes |
| `while`, `break` on trip `k` | as above without `Bounds`/`Counter`, with `k·C` condition charges | native `break` out of `while(true)` onto the trailing `__meter.step()` | yes (PINNED-BY-B) |
| `while`, `continue` on every trip | `n` extra `C` charges, because `continue` re-tests the condition | identical: `continue` → top of `while(true)` → condition | yes (PINNED-BY-B) |
| any jump | `1_jump = 1 meter.step() + 1 checkAbort()` at the statement boundary | `__meter.step(); __checkAbort();` | yes (RT12J-D3) |
| the exit slot after a `break` | exactly one `meter.step()`, no `checkAbort()` | the trailing `__meter.step()`, no `__checkAbort()` | yes |

**[RT12J-D5 DECIDED — measured rows, never a formula]** Slice B's lesson (`A + n·P` replacing
`2 + n·(1+B)`) is that a derived formula in an oracle goes RED against a *correct* implementation.
Every metering row here is an identity between twins measured in the same run, using rt10-for's
`loopStepBudget` binary search (`scripts/kern-5-rt10-for/k0-support.mjs:100-125`):

| Row | Identity | What it falsifies |
| --- | --- | --- |
| **J1** break exits | `ticks(for 0..N { break })` is **independent of `N`** for `N ∈ {1,3,10}` | a `break` that does not actually leave the loop |
| **J2** break is an ordinary statement landing on the exit slot | `ticks(for 0..1 { break }) == ticks(for 0..1 { <one metered leaf> })` | a `break` charged 0 or 2, a `break` that re-charges the head, a `break` that skips the exit charge |
| **J3** continue lands on the step | `ticks(for 0..3 { continue }) == ticks(for 0..3 { <one metered leaf> })`, and the run **terminates** | a `continue` that skips the counter advance (would exhaust `maxSteps`), or one that charges the head twice |
| **J4** continue skips the rest of the trip | `ticks(for 0..3 { continue; assign acc=acc+1 }) == ticks(for 0..3 { continue })`, and `acc == 0` | a `continue` that falls through to the trailing statements |
| **J5** the `while` form agrees | `ticks(while … { continue }) == ticks(while … { <one metered leaf> })`, and the trip count is unchanged | a `while` `continue` that skips the condition (would diverge from J3's shape) or double-charges it |
| **J6** jumps are loop-local | `ticks(for o 0..3 { for n 0..2 { break } }) == ticks(for o 0..3 { for n 0..1 { <leaf> } })` | an inner `break` that pops the outer loop (strictly fewer ticks) or pops nothing (strictly more) |
| **J7** leg identity | for each of J1-J6's fixtures, the emitted artifact's own step threshold equals RT-1's execution count exactly, pinned from both sides; and one budget below the threshold fails on both legs | any single slot charged differently on one leg |
| **J8** checkpoint census | RT-1 total `=== 2` with both isolations `=== 1`; the emitted JS statement region gains exactly one `__checkAbort()` per jump statement over the same body without the jump | a third RT-1 site; a jump lowered without the ordinary statement checkpoint |
| **J9** cancellation latency | a `break`/`continue` never widens the abort window: the next observation point is the loop head (`continue`) or the statement boundary after the loop (`break`) | a jump path that bypasses both checkpoints |

### Emitted-shape rows

**[RT12J-C13 VERIFIED — design]** Using slice B's region extraction
(`scripts/kern-5-rt11-linked-while/tick-discipline.test.mjs:22-36`: artifact → `__runSpecialized` →
the `try {`/`} finally {` statement region):

| Rule | Value |
| --- | --- |
| host construct | a native JS `break;` / `continue;` — a keyword, never a host global |
| `for` body with one user `break` | the region carries exactly **one** `break` token for that loop |
| `while` body with one user `break` | exactly **two** `break` tokens: the lowering's exit break plus the user's |
| signal objects | zero. No `__Break`, no `__Continue`, no `throw` added — the tribunal's ruling, and the reason the rt4 fault channel is untouched |
| function boundaries | the region from the loop head onward contains **no** `function` and no `=>` token beyond what the same body carries under a straight-line twin (a native jump cannot cross a function boundary; PINNED-BY-B, RT11W-C21 item 2) |
| new host patterns | zero. `scripts/kern-5-r2-js-lowering/closure.test.mjs:17`'s `FORBIDDEN_EMITTED` matches none of the added text; no `JSON`, `process`, `eval`, `Function`, `import`, `require`, no `node:` specifier |
| new kernel bytes | zero; both `TARGET_KERNEL_SHA256` values unchanged |
| suspension points | zero new `await`/`Promise`/`queueMicrotask`/`setImmediate` |
| dead code after a jump | emitted verbatim and never executed (RT12J-D4) — legal JS, and the metering row J4 proves it costs nothing |

### The single-return rule and unreachable code

**[RT12J-D4 DECIDED — ignore, with precedent from `if` and `for`]** A `return` (or any statement)
after an unconditional `break`/`continue` inside a loop body is **admitted and not analysed**. Three
pieces of precedent, all from source:

1. **The linker performs no reachability analysis anywhere.** `compileBlock` (`link.ts:489-515`)
   compiles children in order and tracks nothing about completion; `containsReturn` (`:152-161`) exists
   solely to feed the void-handler gate, never a reachability decision.
2. **The single-return rule filters the top-level list only** (`link.ts:568-574`:
   `statements.at(-1)?.kind !== 'return'` and `statements.filter(...).length !== 1` over the handler's
   own statement array), which is exactly why rt10-for's `for-early-return` fixture
   (`scripts/kern-5-rt10-for/k0-support.mjs:250-251`, a `return` inside a `for` body plus a final
   top-level `return`) is admitted today. A loop body is never inspected for completion, so a `break`
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
(`scripts/kern-5-parity-ledger/ledger-support.mjs:43` = `['blockedBy','label','nodeKind','since','spec','surface']`),
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
(`ledger-support.mjs:117-124`) enforces that a `blockedBy` entry names an existing row, so these rows
are only valid **after** slice B's row exists, and slice A's catch-up step 3 already prescribes
deleting the reference when the `while` row goes.

| Refusal rule | Value |
| --- | --- |
| what refuses | slice A's compile-entry pass, after `linkVerifiedKernKirProgramOrThrow` succeeds and before `emitPython` |
| the result | exactly `{format:'kern.compiler.kir-python.v1', outcome:'failure', code:'KIR_PYTHON_LEG_DEFERRED'}` — three keys, no `artifact`, no `manifest` |
| **which kind is reported** | `pythonLoweringDeferral` returns the **first** deferred kind in pre-order (`request.ts:145-156`). A `for` body containing a `break` reports `'break'`; a `while` body containing a `break` reports `'while'`. Same code either way — but a row that asserts the reported kind must expect `'break'` only from the `for` position |
| coverage | every catalog-permitted position reachable through the linker: `for` body, `while` body, `if`-then/`if`-else inside a loop body, nested loops |
| `compiler/kir-python/emitter.ts` | **byte-identical**; slice A's frozen digest must not move |

**[RT12J-C17 VERIFIED — Python lowering sketch, so the catch-up is cheap]**

- **`break`** is a bare native `break` in both Python loop forms. In the `for` lowering it exits the
  `while cmp(cursor,bound):` head and the trailing `_meter.step()` runs — the same landing as JS
  (RT12J-C11). Nothing to restructure.
- **`continue` in the `while` form** (slice B's `while True:` sketch, RT11W-C17) is a bare native
  `continue`: the condition is re-evaluated at the top of the loop, so the invariant holds.
- **`continue` in the `for` form must not be a bare `continue`.** The counter advance is the last line
  of the trip body (`emitter.ts:272, inside the trip template at :269-273`). Two admissible repairs, in preference order:
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

1. **`kir-runtime/linked-kir-program/contracts.ts`** — the two union members (RT12J-C14) and the leaf
   arms of `statementsInvokeCapability` and `statementsCallDepth`. If slice B landed its recommended
   `statementSubBlocks`/`statementSubExpressions` extraction, these are two table entries with empty
   blocks and empty expressions; if slice B took its fallback, they are two two-line arms.
2. **`kir-runtime/linked-kir-program/link.ts`** — `loopDepth` on `LinkScope`, `0` in `compileHandler`,
   `+1` in `compileFor` and `compileWhile`, and the two `compileStatement` kind branches with the
   labels of RT12J-D2.
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

`packages/core/src/kir-runtime/linked-kir-program/contracts.ts` is **536 lines** and `link.ts` is
**695** (measured, this branch, 2026-09-07) — both already past the 500-line rule, and slice B grows
both. The 354-file compiled inventory pin
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
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | edit | two union members; two leaf arms in each of the two semantic walkers |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | edit | `LinkScope.loopDepth`; the depth increments in `compileFor`/`compileWhile`; two `compileStatement` branches |
| `packages/core/src/kir-runtime/expression.ts` | edit | the two RT-1 arms (RT12J-D1); **no new `checkAbort()`** |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | edit | one `blockSource` arm before the `leafSource` fallthrough |
| `packages/core/src/compiler/kir-python/emitter.ts` | **no edit** | byte-frozen; slice A pins its digest |
| `packages/core/src/compiler/kir-python/request.ts` | edit | two `'deferred'` table entries + the `never`-guarded switch arm |
| `packages/core/src/kir-runtime/contracts.ts` (`KernKirLimits`, `KernKirDiagnosticCode`) | **no edit** | no new limit, no new code; `maxIterations` is still not a field of this stack |
| `packages/core/src/parser-core.ts`, `parser-validate-body-statements.ts`, `kir-structural/**`, the constitution, the closure ledger, any `.kern` | **no edit** | RT12J-C1/C3: F5 already projects both kinds in every needed position. `BODY_LOOP_CONTROL_OUTSIDE_LOOP` belongs to the legacy TS parser and is not this stack's gate |
| `scripts/kern-5-parity-ledger/parity-ledger.json` | **edit — licensed** | the `break` and `continue` rows (RT12J-C16) |
| `scripts/kern-5-parity-ledger/ledger-support.mjs` | **edit — licensed** | `LEDGER_SHA256` re-pin (`:40`); the only digest a row move touches |
| `scripts/kern-5-parity-ledger/ledger-schema.test.mjs` | **edit — licensed if slice B left a row-count assertion** | slice B replaced slice A's zero-row assertion; if that became "carries the `while` row", it becomes "carries three rows" |
| `scripts/kern-5-rt2-boolean-if/k0-golden.{json,test.mjs}` | **edit — licensed** | `linkedStatementKinds` gains `"break"` and `"continue"`; the golden's **second** test (`:120-129`) requires `STATEMENT_PROBES.filter(admission === 'admitted')` to `deepEqual` that union, so `PROBE_BODIES` (`:17-28`) and `STATEMENT_PROBES` (`:30-40`) each gain a `break` and a `continue` entry whose body wraps the jump in a `for` (a bare jump would be `handler-entry-unsupported` and the two lists would disagree) |
| `scripts/kern-5-rt9-linked-assign/k0-golden.{json,test.mjs}` | **edit — licensed** | `linkedStatementKinds` gains both kinds; the hardcoded `assert.deepEqual(golden.linkedStatementKinds, […])` (`:99-104`) grows; its `for (const kind of ['each','set','while'])` loop drops nothing here but must already have dropped `'while'` in slice B |
| `scripts/kern-5-rt3-binary-expression/k0-golden.json` | **edit — licensed** | its `rt2GoldenSha256` field is derived from the RT-2 golden |
| `scripts/kern-5-rt4-user-fn-call/probe-matrix.json` | **edit — licensed** | carries both `rt2GoldenSha256` and `rt3GoldenSha256` |
| `RT2_GOLDEN_SHA256` literals in rt4, rt5, rt6, rt9, rt10-pre, rt10-X `compatibility.test.mjs` | **edit — licensed** | **6 files** (measured: `grep -rln RT2_GOLDEN_SHA256 scripts`) |
| `RT3_GOLDEN_SHA256` literals in rt6, rt9, rt10-for, rt10-X, rt10-pre, rt11 `compatibility.test.mjs` | **edit — licensed** | **6 files** (measured) |
| `RT9_GOLDEN_SHA256` literals in rt10-for, rt10-X `compatibility.test.mjs` | **edit — licensed** | **2 files** (measured) |
| the historical pre-image literals in rt9 and rt10-pre `compatibility.test.mjs` | **verify, do not assume** | slice B's RT11W-O5 applies unchanged: the reconstructions `{...golden, rt2GoldenSha256: <historical>}` survive only while that is the single RT-3 field the cascade moves |
| `scripts/kern-5-rt10-for/type-gate.test.mjs:117-129` | **edit — licensed** | the test *`break` and `continue` reach the ordinary statement refusal inside a loop body* is exactly what this slice invalidates: both fixtures become **admitted**. Move them to rt10-for's admitted set or delete them and let this slice's suite own them |
| `scripts/kern-5-rt10-for/compatibility.test.mjs:63` | **edit — licensed** | `STILL_OUTSIDE` drops both kinds → `['each','set']` (slice B already dropped `'while'`) |
| `scripts/kern-5-rt11-linked-while/type-gate.test.mjs:19-20,83-99` | **edit — licensed** | slice B's two REFUSALS rows and its *break and continue reach the ordinary statement refusal inside a while body* test flip to admitted |
| `scripts/kern-5-rt11-linked-while/compatibility.test.mjs:67` | **edit — licensed** | `STILL_OUTSIDE` → `['each','set']` |
| `scripts/kern-5-rt11-linked-while/fixtures.mjs:282-283,318-319` | keep | `neg-while-break-in-body` / `neg-while-continue-in-body` stay valid fixtures; only their expected verdict moves |
| `scripts/kern-5-rt11-linked-while/probe-matrix.{json,test.mjs}` | **no edit** | the 28-child list and the catalog schema are unchanged catalog facts |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:97` (`compiledCoreDigest`, currently `5cfa299d…`) | **edit — licensed** | any content change under `packages/core/src` moves it. Re-pin, then `pnpm write:kern-canonicalizer-coverage` |
| `scripts/kern-canonicalizer/*.json` coverage receipts | regenerate | `pnpm write:kern-canonicalizer-coverage`; `coverageImplementationDigest` moves because the re-pin edits a `.mjs` under `scripts/kern-canonicalizer` |
| the 354-file inventory count and path digest | **no edit** | five existing files are edited; none added or removed. **No new file under `packages/core/src` is permitted** |
| `TARGET_KERNEL_SHA256` (both kernels), every emitted-artifact digest, every manifest digest, `projectionArtifactSha256` | **no edit** | if one moves, a `KERNEL_SOURCE` byte was touched, which is forbidden. `linkedProgramSha256` changes per *program*, which is not a re-pin |
| `scripts/runtime-contract-v1/**`, `scripts/kir-v1/alpha-receipt-policy.json` | **no edit** | slice A PL-C7: RC-v1 declares only the `KernRuntimeHandler*` surface. **No amendment record required** |
| `scripts/kern-5-admission-census/**` | **no edit** | RT12J-C13a: zero tracked files are rejected at `link`, so the admission gain is exactly **0** and the ratchet is a floor |
| `scripts/kir-v1/eligibility.json`, `coverage-witness-ledger.json`, `scripts/kern-canonicalizer/coverage-family-registry.json` | **no edit** | slice B's negative grep stands: these are the F5/static-catalog track and do not observe linker admission |
| `scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs:141-163` | **no edit** | RT12J-D1 is chosen precisely so `=== 2` and both `=== 1` isolations hold. If a builder needs a third site, the decision has changed and this spec is wrong |
| `scripts/kern-5-runtime-envelope-max-steps/**`, `scripts/kern-frontend-*`, `scripts/conformance.mjs` | **no edit** | the legacy IRNode runner is a different execution stack |

## Acceptance Criteria

Each becomes a test in `scripts/kern-5-rt12-linked-jumps/`. Every criterion here rests on a VERIFIED
or PINNED-BY-B claim; the PINNED-BY-B ones must be re-measured against slice B's implementation commit
before they are promoted to fixtures.

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
- [ ] All four semantic walkers see a jump: a `capability` after a `break` still reaches the closure
      walk, a call in a jump-carrying body still counts against call depth, and a jump-only body
      answers `false`/`0` rather than throwing (the RED here is a **TypeError**, driven by a hand-built
      linked statement independent of the linker).
- [ ] RT-1 carries exactly **two** `checkAbort()` calls, one in each isolation window (J8).
- [ ] The emitted JavaScript region carries a native `break;`/`continue;` preceded by
      `__meter.step(); __checkAbort();`, no `__Break`/`__Continue`, no new `function`/`=>` token, no new
      `await`/`Promise`/`queueMicrotask`/`setImmediate`, and no new kernel line; a `while` with one user
      break carries exactly two `break` tokens and a `for` exactly one.
- [ ] The metering identities **J1-J9** hold as measured twins, and the two legs' step thresholds agree
      exactly (J7).
- [ ] The parity ledger carries the `break` and `continue` rows with the pinned values, key-set
      identical to slice A's `ROW_KEYS`, sorted after nothing and before `while`, each with
      `blockedBy: ['while']`, and the document validates under slice A's `validateLedger`.
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

- **[RT12J-O1 OPEN — technical, resolve when slice B's implementation lands]** Every PINNED-BY-B claim
  (RT12J-C10, the `while` rows of RT12J-C15, the region markers of RT12J-C13, the frame/`LoopState`
  shape RT12J-D1 pops) is a slice-B *spec* pin, not landed code. If slice B's implementation deviates —
  most plausibly in how a condition loop re-enters its head on frame exhaustion — RT12J-D1's `continue`
  formulation ("jump the loop frame to its end") must be re-derived against what landed. This caps
  confidence below 0.90 and is the single largest residual risk.
- **[RT12J-O2 OPEN — technical, must be measured on a built base]** The base RED table for this
  slice's oracle is **not** measured in this document: the available `packages/core/dist` predates
  rt9/rt10 (evidence caveat under RT12J-C4), so no link-level base label could be produced by running
  code. The oracle slice must build slice B's tip and re-measure. The two labels this spec claims as
  base behaviour (`statement kind break is outside RT-1`; `statement must be a leaf`) are sourced from
  `link.ts:317,386` **and** from landed green assertions in rt10-for and rt11, which is why the claim
  is VERIFIED despite the caveat.
- **[RT12J-O3 DECIDED — 2026-09-07]** Unreachable code after a jump is admitted and ignored
  (RT12J-D4). Recorded as a decision rather than an open question because the alternative would
  introduce the linker's first reachability rule, which `return` would immediately make inconsistent.
- **[RT12J-O4 OPEN — routing, inherited]** Slice B's RT11W-O1 (RT-9's `admissionRow` asserting
  `rt1 === javascript` **and** `javascript === python`, `scripts/kern-5-rt9-linked-assign/k0-golden.test.mjs:72-76`)
  is unresolved. It fires on any per-leg divergence, and this slice adds two more diverging kinds. No
  acceptance criterion here depends on the answer; it is named in Blast Radius either way.
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
