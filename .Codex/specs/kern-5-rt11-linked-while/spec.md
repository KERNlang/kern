# KERN 5 — RT-11 `while`: the condition loop in linked KIR (JS + RT-1 legs, Python leg deferred)

**Status:** SPEC — ORACLE LANDED RED
**Date:** 2026-09-07
**Confidence:** 0.89

Stacked on slice A (`feat/kern-5-parity-ledger` @ `b273b20c`: spec
`.Codex/specs/kern-5-parity-ledger/spec.md`, oracle `scripts/kern-5-parity-ledger/`, empty ledger
`scripts/kern-5-parity-ledger/parity-ledger.json`).

## Executive Summary

`while` becomes the eighth member of `LinkedKernKirStatement`, lowered on the RT-1 and JavaScript
legs only. The Python leg refuses any program containing a `while` through slice A's compile-entry
deferral pass, so `while` is the **first row of the parity ledger** and the mechanism slice A built
gets its first real exercise.

Scope is `while` **alone** (tribunal Q3). No `break`, no `continue`, no `each`, no `do`. The
tribunal's Q4 constraints for those are recorded as spec notes here so try/catch inherits them
rather than relitigating them.

The slice's hidden deliverable is not the syntax. It is the **tick-discipline reconciliation**
(tribunal insight 2): `for`'s existing checkpoint sits at trip-body entry, not on the failed final
condition probe, and `while` must adopt exactly that placement so RT-1 keeps exactly two
`checkAbort()` sites and the rt10-pre pin does not move. A `for`/`while` equivalence golden pair
proves the two loop forms charge the same machinery.

## Current State / Root Cause

### F5 already projects `while`; this slice is linker + two legs + one ledger row

**[RT11W-C1 VERIFIED]** `while` is a bound catalog node with `allowedChildren` set to the same
**28-member** statement list `for` carries — `scripts/kir-structural/constitution.json:780-815` for
`while`, `:816-860` for `for`; generated into
`packages/core/src/kir-structural/catalog.generated.ts:3108-3155`. Its **only** property is `cond`
(`expression`, required). `projectStructuralNode`
(`packages/core/src/kir-structural/node.ts:313-323`) is generic and schema-driven: it does not
special-case any node kind, so a projected `while` and a projected `for` differ only in which
catalog rules attach to the `kind` string.

The 28 admitted children, verbatim (measured live, not copied from the fact report — see the
Corrections Log): `comment, fn, let, expression-v1, assign, destructure, do, fmt,
clamp, firstTruthy, coalesce, firstDefined, objectMerge, objectOmit, objectPick, return, if, else,
while, for, each, try, with, catch, throw, continue, break, branch`. **`print` and `capability` are
absent**, exactly as for `for`.

**[RT11W-C2 VERIFIED — measured 2026-09-07 on `b273b20c`]** Every fixture this slice needs projects
at base. `f5Row` over the fixture set returns `status: 'projected'`, `diagnostics: []` for all of:
`while cond="false"` + `assign` body; a counted `while cond="i < 3"`; `while cond="true"`; `while`
nested in `for`, in `if`-then, in `if`-else, in a helper body, in another `while`; `for` nested in a
`while` body; `print`/`capability` nested under an `if` inside a `while` body; `break`/`continue` as
`while` body children; a non-boolean condition (integer literal, integer parameter, text parameter,
integer binary); an async-helper condition; a user-call condition.

Three shapes are refused by **F5**, not by the linker, and are recorded as fences:

| Fixture | F5 | Evidence |
| --- | --- | --- |
| bare `print` directly under `while` | `rejected` | `print` ∉ `while.allowedChildren` (RT11W-C1) |
| bare `capability` directly under `while` | `rejected` | `capability` ∉ `while.allowedChildren` |
| `while cond="false" name=x` | `rejected` | `cond` is `while`'s only property |
| `while` with no `cond` | `rejected`, `UNEXPECTED_TOKEN` | `cond` is required |

The last two mean the linker will **never** see a `while` with a wrong property set, so this slice
writes no link-level property gate and no `KIR_WHILE_*` property label. `propertySet(properties,
['cond'], [], label)` is defence in depth.

### The base refusal is `statement must be a leaf`, and the empty body is the one exception

**[RT11W-C3 VERIFIED — measured 2026-09-07]** `compileBlock`
(`packages/core/src/kir-runtime/linked-kir-program/link.ts:489-515`) routes `for` and `if`/`else`
and sends **everything else** to `compileStatement` (link.ts:308-387), whose first act is
`assertLeaf` (link.ts:317, defined :163-165). A `while` with children therefore dies at the leaf
gate before any kind branch runs:

| Fixture | base label |
| --- | --- |
| every `while` with a body | `<label>: statement must be a leaf` |
| `while` with an **empty** body | `<label>: statement kind while is outside RT-1` |

The empty-body case passes `assertLeaf` (zero children) and falls through to `compileStatement`'s
final line (link.ts:386). That divergence is the sharpest single-cause discriminator this slice has:
after implementation the empty body must be refused by `compileBranch`'s `branch block is empty`
(link.ts:396), exactly as `for`'s `neg-empty-body` is.

All three legs agree on `handler-entry-unsupported` at base for every one of those fixtures
(measured: `rt1 === javascript === python === 'handler-entry-unsupported'`).

### Two semantic walkers crash on a `while` node and two dispatchers cannot route it

**[RT11W-C4 VERIFIED]** Exactly four functions branch on `LinkedKernKirStatement.kind` and need a
`while` arm. Two are link-time gates, two are the semantic walkers:

| # | Function | File:line | Today | Without a `while` arm |
| --- | --- | --- | --- | --- |
| 1 | `containsReturn` | `link.ts:152-161` | `return` / `for` / `if` | a `return` inside a `while` body is invisible, so a `void` handler links and then faults at execution instead of being refused at link (`KIR_VOID_HANDLER_VALUE_RETURN`, link.ts:570) |
| 2 | `compileBlock` | `link.ts:489-515` | routes `for`, `if`+`else` | `while` reaches `compileStatement` → RT11W-C3 |
| 3 | `statementsInvokeCapability` | `contracts.ts:351-373` | `capability` / `if` / `for`, else `statement.value` | a `while` node has no `.value` → **TypeError**, not a fault |
| 4 | `statementsCallDepth` | `contracts.ts:443-471` | `capability` / `if` / `for`, else `statement.value` | same TypeError |

`expressionVariantUnhandled` (`contracts.ts:283-289`) is the **expression**-side exhaustiveness
guard. There is no statement-side equivalent: walkers 3 and 4 fall through to `statement.value`
rather than erroring on an unrecognised kind. That is why their `while` REDs are TypeErrors rather
than link faults, and why they can be driven by a hand-built linked `while` statement with no
linker involvement — which makes them a separate, independent RED cause from RT11W-C3.

Two more dispatchers are production arms rather than walkers: `walkStatements`
(`packages/core/src/kir-runtime/expression.ts:209-250`, the RT-1 interpreter) and `blockSource`
(`compiler/kir-js-esm/emitter.ts:278-303`). The Python `blockSource`
(`compiler/kir-python/emitter.ts:296-317`) deliberately gains **nothing**.

`forBounds` (`contracts.ts:277-279`) has no `while` analogue: a `while` carries one condition
expression, not three bounds, so both walkers visit `statement.condition` directly the way they
already visit `statement.condition` for `if`.

### RT-1 has exactly two `checkAbort()` sites, and `for` charges the head at trip-body entry

**[RT11W-C5 VERIFIED]** `walkStatements` (`expression.ts:176-264`) calls `runtime.checkAbort()` at
exactly two places:

1. the statement boundary, `expression.ts:208`, immediately after `frame.index += 1` and the
   statement `meter.step()` (`:207`);
2. the loop head, inside `enterTrip` (`expression.ts:184-188`): `meter.step();
   runtime.checkAbort(); bindings.set(loop.counter, …)`.

`enterTrip` is called on first entry only when `loopContinues(loop)` is already true
(`expression.ts:245-247`) and on re-trip only after `loop.current += loop.step` and a second
`loopContinues` test (`:192-197`). **The failed final probe therefore charges `meter.step()`
(`:198`) and no `checkAbort()`.** Codex's tribunal observation, confirmed in source.

`scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs:142-146` pins the total at
exactly 2, `:153-158` pins exactly 1 in the statement-boundary region, and `:161-163` pins exactly
1 in the region `between('const enterTrip = (loop: LoopState): void => {', 'while (frames.length >
0) {')`.

### There is no iteration budget to scope, because `maxIterations` does not exist here

**[RT11W-C6 VERIFIED]** `RuntimeMeter.step()` charges against `limits.maxSteps` and nothing else
(`packages/core/src/kir-runtime/inspect.ts:62-66`); `KernKirLimits` validates exactly seven fields
— `maxBytes, maxCollectionLength, maxDepth, maxDiagnostics, maxEvents, maxSteps, maxStringBytes`
(`inspect.ts:158-168`) — and `maxIterations` is not one of them.
`scripts/kern-5-rt10-for/metering.test.mjs:6-10` states the same in-comment.

`maxIterations` exists only on the **legacy IRNode runner** stack
(`packages/core/src/runtime-envelope/types.ts:12,22`,
`packages/core/src/runtime-handler.ts:261-263`,
`packages/core/src/ir/semantics/internal-effect-machine.ts:122,151`), which is a different
execution stack and is untouched by this slice.

**Consequence for the tribunal's third insight.** The iteration-budget scope pin (per-loop-instance,
reset at entry) is a **note for a later slice**, not a row in this one: there is no iteration budget
to scope. `while` charges `maxSteps` only, exactly as `for` does. Recorded as RT11W-N6 below so the
`break`/`continue` slice inherits the intent rather than the row.

### The census cannot move, because nothing reaches the linker

**[RT11W-C7 VERIFIED — measured 2026-09-07]** `scripts/kern-5-admission-census/admission.json`
carries `total: 240`, `admittedCount: 1`. Grouping the 240 results by `(stage, code)`:

```
101  projection / UNEXPECTED_TOKEN          19  projection / F4_AUTHORITY_DRIFT
 76  projection / FRONTEND_UNSUPPORTED_MODULE_ROOT   11  projection / F4_F2B_DRIFT
 11  projection / FRONTEND_EXCLUDED_HOST_EXPRESSION   8  projection / projection-fatal
  4  projection / FRONTEND_INVALID_EXPRESSION         3  entry-selection / no-exported-entry
  3  projection / projection-request-invalid          2  projection / projection-rejected
  1  projection / FRONTEND_EXCLUDED_HOST_TYPE         1  (admitted)
```

**Zero files are rejected at the `link` stage.** All 239 rejections happen at `projection` or
`entry-selection`. Widening the linker therefore admits **exactly 0** additional tracked `.kern`
files, and `validateReport` (`scripts/ci/kern-5-census-sweep.mjs:17-33`) treats
`ratchet.admitted.length` as a floor, so no ratchet update is needed either. This is measured, not
estimated, and it cost one JSON read rather than a five-minute sweep.

### The cross-leg agreement tripwires — and a third one slice A has not named

**[RT11W-C8 VERIFIED]** Three landed oracles assert, in effect, *the legs always agree on
admission*:

| # | Assertion | File:line | Owner |
| --- | --- | --- | --- |
| 1 | `assert.equal(javascriptCode, pythonCode, 'both targets share one linker; ${kind} diverged')` | `scripts/kern-5-rt2-boolean-if/k0-golden.test.mjs:87` | **slice A** (generic, ledger-aware) |
| 2 | `assertLinkRejected` asserts `rt1 === javascript === python === 'handler-entry-unsupported'` | `scripts/kern-5-rt4-user-fn-call/k0-support.mjs:141-148` | **slice A** (generic, ledger-aware) |
| 3 | `admissionRow` asserts `row.javascript === row.python` **and** `row.rt1 === row.javascript` | `scripts/kern-5-rt9-linked-assign/k0-golden.test.mjs:74-76` | **UNASSIGNED — see RT11W-O1** |

Tripwire 3 fires on RT-9's `control-while` fixture
(`scripts/kern-5-rt9-linked-assign/k0-support.mjs:320-324`, a `while cond="flag"` with a `let`
body), whose golden admission value is `handler-entry-unsupported` today
(`k0-golden.json`) and which becomes `admitted` on JS/RT-1 and `KIR_PYTHON_LEG_DEFERRED` on Python.
RT-9's `linkedStatementKinds` scrape and its `for (const kind of ['each', 'set', 'while'])`
assertion (`k0-golden.test.mjs:104`) move with it.

Per the coordinator's scope change, this slice does **not** design the per-leg golden shape (that is
slice A's generic amendment). It records tripwire 3 as an open routing question and asserts, in its
own oracle, only that the `while` row exists and that the Python compile of a `while`-containing
program returns slice A's refusal.

### The Python emitter already uses Python's `while` to lower KIR `for`

**[RT11W-C9 VERIFIED]** `compiler/kir-python/emitter.ts:252-286` lowers KIR `for` to a native Python
`while` with a sign-selected comparator lambda chosen once above the head (`:280-283`). So Python's
`while` keyword is already load-bearing, and a KIR `while` would reuse the shape rather than invent
one. This slice emits none of it — the design is recorded as RT11W-C15 so the catch-up slice
inherits it.

## What Already Works

- **The frontend.** RT11W-C1/C2: no `.kern`, catalog, constitution, closure-ledger, census or
  `scripts/kern-frontend-*` change. `while` already projects.
- **Both target kernels.** `while` needs no new kernel helper: the boolean tag check is the same
  literal `if(x.tag!=='boolean')throw new __Fault('unsupported-runtime-input','execution')` the `if`
  arm already emits (`kir-js-esm/emitter.ts:295`), and the meter/checkpoint helpers are already
  there. Pinned: JavaScript `b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6`,
  Python `f79a39633f58475124eafdec3c62a9fd042ffa50b1de637509d0f66e0f0cd18e`.
- **The refusal channel.** Slice A's `failure()` + `KIR_PYTHON_LEG_DEFERRED` code. This slice adds a
  ledger row, not a mechanism.
- **The scope model.** `branchScope(scope)` (link.ts:186-195) already copies every scope set/map;
  `compileBranch` (link.ts:389-397) already forbids an empty block and opens a fresh scope. A
  `while` body is a `compileBranch` call, so copied-scope semantics come for free.
- **The single-return rule.** `link.ts:570-574` filters the **top-level** statement list only, so a
  `return` nested in a `while` body is not counted, exactly as `for-early-return` relies on today.
- **The condition gate.** `compileIf` (link.ts:400-425) already reads `cond`, calls
  `assertAsyncCallPosition(condition, scope, label, false)` and refuses a non-boolean static type.
  `while` reuses that sequence verbatim with its own label.
- **No new limit, no new diagnostic code.** RT11W-C6. `KernKirLimits` stays at 7 fields;
  `KernKirDiagnosticCode` stays at 12 members.
- **The evidence wiring pattern.** `test:kern-5-rt11-linked-while` in `package.json`, appended to
  `test:kern-5-script-family`, appended to `kern5EvidenceCommands` in
  `scripts/ci/test-tier-contract.test.mjs` (which `deepEqual`s the two lists, `:151-157`). No
  `.github/workflows/ci.yml` change.

## Contract (Verified)

> Verified against `packages/core/src/kir-runtime/**`, `packages/core/src/compiler/**`,
> `scripts/kir-structural/constitution.json`, `scripts/kern-5-rt10-for/**`,
> `scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs`,
> `scripts/kern-5-rt9-linked-assign/**`, `scripts/kern-5-rt2-boolean-if/**`,
> `scripts/kern-5-admission-census/admission.json`, `scripts/kern-5-parity-ledger/**`, and live
> measurement on 2026-09-07.

### The linked statement

**[RT11W-C10 VERIFIED]** `LinkedKernKirStatement` gains exactly one member, alongside the seven at
`contracts.ts:250-275`:

```ts
| {
    readonly kind: 'while';
    readonly body: readonly LinkedKernKirStatement[];
    readonly condition: LinkedKernKirExpression;
  }
```

Two fields, no counter, no bounds. `condition` reuses `if`'s field name on purpose: both walkers
already know how to visit `statement.condition`.

### Node shape and admitted body vocabulary

| Rule | Value | Tag |
| --- | --- | --- |
| properties | exactly `{cond}`, required, `expression` | VERIFIED (RT11W-C1) |
| body | the node's `children`, never a sibling | VERIFIED (RT11W-C1) |
| linker-admitted body children | `let`, `assign`, `return`, `if`(+`else`), `for`, `while` | VERIFIED (RT11W-C11) |
| catalog-admitted but linker-refused body children | the other 22 of the 28, each with the label below | VERIFIED (RT11W-C11) |
| `print` / `capability` as a **direct** child | refused by **F5**, not the linker | VERIFIED (RT11W-C2 fence) |
| `print` / `capability` **under an `if`** in the body | projects, and must link and run | VERIFIED projection; link is this slice's work |

**[RT11W-C11 VERIFIED]** The linker admits inside a `while` body exactly what it admits inside a
`for` body, because both go through the same `compileBranch` → `compileBlock` pair (link.ts:389-397,
:489-515) and `compileBlock` has no loop-local vocabulary. The refusal labels are therefore the
existing ones, unchanged, all under the closed code `handler-entry-unsupported`:

| Body child | Label | Evidence |
| --- | --- | --- |
| `break` | `statement kind break is outside RT-1` | link.ts:386; pinned for `for` at `scripts/kern-5-rt10-for/type-gate.test.mjs` |
| `continue` | `statement kind continue is outside RT-1` | same |
| `each` | `statement must be a leaf` (has children) | link.ts:317 |
| `do`, `try`, `catch`, `with`, `throw`, `branch`, `fmt`, `clamp`, `firstTruthy`, `coalesce`, `firstDefined`, `objectMerge`, `objectOmit`, `objectPick`, `destructure`, `expression-v1`, `comment`, `fn` | `statement must be a leaf` when they carry children, else `statement kind <k> is outside RT-1` | link.ts:317 / :386 |
| an `else` not paired with an `if` | `statement kind else is outside RT-1` | link.ts:386; pinned in `scripts/kern-5-rt2-boolean-if/branch-behavior.test.mjs` |

This slice introduces **no new refusal label for a body child**. The oracle pins `break` and
`continue` specifically, because those are the two the next slice admits and the two whose refusal
proves the body is compiled by the ordinary statement path rather than by a permissive loop-local
one.

### Link-time decisions (all under `handler-entry-unsupported`)

| Gate | Label | Rule | Tag |
| --- | --- | --- | --- |
| condition type | `KIR_WHILE_COND_NOT_BOOLEAN` | `staticExpressionType(condition, scope) !== 'boolean'` → refuse. Boolean only; **no truthiness** | VERIFIED (mirrors `KIR_IF_COND_NOT_BOOLEAN`, link.ts:415) |
| condition async position | `KIR_ASYNC_CALL_EXPRESSION_POSITION (KIR_CALL_CALLEE_CAPABILITY)` | `assertAsyncCallPosition(condition, scope, '<label>.cond', false)` — the same `false` `if` passes | VERIFIED (link.ts:283-295, :414) |
| empty body | `branch block is empty` | `compileBranch` refuses a zero-child block | VERIFIED (link.ts:396) |
| `return` in body, void handler | `KIR_VOID_HANDLER_VALUE_RETURN` | requires the `containsReturn` `while` arm | VERIFIED (link.ts:570) |
| property set | never reachable — F5 refuses first | `propertySet(properties, ['cond'], [], label)` is defence in depth | VERIFIED (RT11W-C2) |

**No `while`-specific counter, bound, zero-step or duplicate-binding gate exists**, because `while`
binds no name. `scope.counters` is untouched, so `KIR_ASSIGN_TO_LOOP_COUNTER` (link.ts:357) cannot
fire from a `while` — an `assign` inside a `while` body is governed by RT-9's ordinary `assignable`
rule and nothing else. That is an observable difference from `for` and the oracle pins it.

**[RT11W-C12 VERIFIED]** There is **no link-time infinite-loop gate**. `while cond="true"` links.
`maxSteps` is the only bound (RT11W-C6), and exhausting it is the pinned behaviour, not a bug.

### Semantics

| Rule | Value | Tag |
| --- | --- | --- |
| condition evaluation | before **each** trip, including the first | VERIFIED (this slice) |
| trip order | evaluate condition → if `true`, charge head + `checkAbort`, run body → repeat; if `false`, charge exit and leave | VERIFIED (RT11W-D1) |
| body scope | a copied scope, `branchScope(scope)` / `new Map(scope)` per the leg, exactly like an `if` branch and a `for` body | VERIFIED (link.ts:186-195, :396; emitter.ts:283-285) |
| closure capture | none. The body scope is copied, not captured; nothing outlives the loop | VERIFIED |
| `let` in the body | does not leak past the loop — a post-loop read is `unknown identifier` | VERIFIED (branchScope copies `bindings`) |
| `assign` to an outer `let` | persists across trips and past the loop | VERIFIED (`assignable` is copied by reference-of-membership, and RT-1/JS write the same host local) |
| `return` in the body | legal; ends the handler immediately, on every leg | VERIFIED (link.ts:570-574 counts top-level returns only) |
| iteration budget | `maxSteps` only; no per-loop iteration cap exists | VERIFIED (RT11W-C6) |
| non-boolean at run time | RT-1 `KernKirFault('unsupported-runtime-input','execution')`; JS `__Fault('unsupported-runtime-input','execution')` — **defence in depth, unreachable through the public entry today** (RT11W-O2) | VERIFIED |

**[RT11W-C22 DECIDED — item 5]** The boolean gate is asserted by the **same mechanism RT-2 uses for
`if`, and no further**: `scripts/kern-5-rt2-boolean-if/branch-behavior.test.mjs:150-174` asserts that
every leg fails closed under the one closed link code and that the run commits no event, and makes
no claim about emitted text. This slice's `behavior.test.mjs` carries that row verbatim in shape, and
`type-gate.test.mjs` adds the label discrimination through the landed `assertLinkLabel` helper — a
link-diagnostic assertion, which is the established precedent in rt6, rt9, rt10-pre, rt10-for and
rt10-X. The regex on the emitted tag-check text that this spec's first revision carried has been
**removed**: it was a stricter claim than the precedent it cited, and it was brittle against any
emitter formatting change. The emitted-shape rows that remain — a host `while`, a native `break`, no
`__Break`/`__Continue`, the inline-body census, no new kernel line — are rt10-for's own precedent
(`scripts/kern-5-rt10-for/tick-discipline.test.mjs`, the two `*_SHAPE` tests).

### Metering and tick discipline — the reconciliation

**[RT11W-D1 DECIDED]** **`while` reuses the RT-1 loop-head checkpoint site. RT-1 keeps exactly two
`checkAbort()` calls. The rt10-pre pin does not move.**

### The per-path charge table — RT-1 against JavaScript, from source

**[RT11W-C18 VERIFIED — resolved from source, not derivation]** Every metered slot, on both legs,
for `for` today and for `while` as pinned. The two legs charge **identically on every path**:

| Slot | RT-1 `for` | JS `for` | RT-1 `while` (pinned) | JS `while` (pinned) |
| --- | --- | --- | --- | --- |
| init | `meter.step()`, `expression.ts:207` (statement boundary) | `__meter.step()`, `emitter.ts:259` | same site | same site |
| bounds / condition | `evaluateExpression(from/to/step)`, `expression.ts:240-242` — **once** | `(__meter.step(),…)` per node, `emitter.ts:138`, hoisted above the head at `:260-262` — **once** | `evaluateExpression(condition)` — **once per attempt**, `n+1` times | same, at the top of `while(true)` — **once per attempt**, `n+1` times |
| head, per successful trip | `enterTrip` → `meter.step()` + `runtime.checkAbort()`, `expression.ts:185-186` | `__meter.step(); __checkAbort();`, `emitter.ts:265` | same site, reused | same placement |
| counter materialisation | `integerValue(current, meter)`, `expression.ts:187` | `__intValue(cursor,__meter)`, `emitter.ts:266` | **absent** — a `while` binds no counter | **absent** |
| exit / failed final probe | `meter.step()` — the never-entered `else` at `expression.ts:249` **or** the frame-exhaustion probe at `:198`, exactly one of the two | `__meter.step()`, `emitter.ts:268`, reached by falling out of the host `for` | same two sites | same site, reached by falling out of `while(true)` through the native `break` |
| checkAbort on the failed probe | **none** | **none** | **none** | **none** |

**No pre-existing rt10-for discrepancy exists.** The premise that the JavaScript leg charges nothing
on the failed final probe is false: the trailing `__meter.step()` at `emitter.ts:268` is precisely
the counterpart of RT-1's `expression.ts:198`/`:249`, and `break` in the pinned `while` lowering
falls straight into it. Both legs charge `1_init + Bounds + n·(1_head + Counter + B) + 1_exit` for
`for`, which is why rt10-for's three-leg byte-identity rows pass at base with no per-leg correction.

### The corrected charge formula

**[RT11W-C19 VERIFIED — corrects an error in this spec's first revision]** The formula this spec
first carried, `2 + n·(1 + B)`, is **wrong for `while`**. It is `for`'s formula, and it holds for
`for` only because bounds are read once and therefore fold into the constant. A `while` re-evaluates
its condition on **every attempt** — `n` true probes and one false one — so:

```
ticks(n) = A + n · P     with   P = 1_head + B + C   and   A = 1_init + 1_exit + C
```

`B` is the body cost, `C` the condition's per-evaluation cost. Checked on all three paths:

| Path | Charge |
| --- | --- |
| never entered (`n = 0`) | `2 + C` — one false probe, one init, one exit |
| one shot (`n = 1`) | `2 + 2C + 1 + B` |
| `n` trips | `2 + (n+1)·C + n·(1 + B)` |

`2 + n·(1 + B)` cannot satisfy all three, which is exactly why the first revision's metering rows
would have gone RED against a correct implementation. `HEAD_CHARGE = 1` and `1_init + 1_exit = 2`
survive unchanged; the `(n+1)·C` term is what was missing. The one real metering difference between
the two loop forms is this term, and it is a **property of the construct, not of a leg**.

### Cancellation latency

**[RT11W-C20 DECIDED]** Cancellation latency inside a `while` is bounded by one metered condition
evaluation plus the statement-boundary `checkAbort()` that follows the loop — identical to `for`'s
bound and pinned by the same two rt10-pre sites. The failed final probe carries no `checkAbort()` on
either leg and does not need one: an abort raised during the last condition evaluation is observed
at the next head, and an abort raised after the loop is observed at the statement boundary.

**Why this is the reconciling choice, not a second rule.** Two rules were on the table: charge on
each head *attempt* (n+1 checkpoints for n trips) or charge on each *successful trip* (n
checkpoints). `for` already does the second (RT11W-C5, unrefuted in the tribunal). Adopting the
first for `while` would make two loop forms observably differ in metering and would force the
rt10-pre `=== 2` pin to become `=== 3`. Adopting the second costs nothing and keeps one rule.

**What the implementer must do to keep the pin.** `LoopState` (`expression.ts:159-170`) gains the
`while` continuation and `enterTrip` must tolerate a counter-less loop, but the `runtime.checkAbort()`
call **must stay textually inside** the region
`between('const enterTrip = (loop: LoopState): void => {', 'while (frames.length > 0) {')`, or
rt10-pre's isolation at `tick-discipline.test.mjs:161-163` breaks even though the total is still 2.
A `whileContinues` helper placed in that window must contain no `checkAbort()`.

**[RT11W-D2 DECIDED]** **JavaScript leg: exactly one new `__checkAbort()` per `while`, at
trip-body entry, after the boolean tag check and after the exit `break`.** rt10-for's delta-1 rule
(`tick-discipline.test.mjs:60-73`) extends unchanged.

**[RT11W-C13 VERIFIED]** `maxSteps` exhaustion inside `while cond="true"` faults with the existing
limit fault on both legs, with no new code and no new label:

| Leg | Fault | Evidence |
| --- | --- | --- |
| RT-1 | `KernKirFault('runtime-limit-exceeded', 'execution', 'runtime step limit exceeded')` | `packages/core/src/kir-runtime/inspect.ts:65-66` |
| JavaScript | `__Fault('runtime-limit-exceeded', 'execution')` | `packages/core/src/compiler/kir-js-esm/target-base.ts:77-78` |

Both are envelope `outcome: 'failure'`, `diagnostics[0].code === 'runtime-limit-exceeded'`,
`phase: 'execution'`, `result: {presence: 'absent'}`, `events: []`.

### The `for`/`while` equivalence pair (tribunal deliverable 3b)

**[RT11W-C14 VERIFIED — and the naive form is impossible]** A literal "equal tick counts" pair
cannot exist. A `while` must spell out the counter (`let name=i value="0"` plus
`assign target="i" value="i + 1"`), and it re-reads its condition `n+1` times where a `for` reads
three bounds once (RT11W-C18). Asserting equality anyway would be satisfiable only by mis-metering
one of the two forms. What *is* equal, and what the rows below assert, is the machinery: the same
head charge, the same init/exit pair, the same checkpoint placement, and the same charge on both
legs. Six measured rows, every atom twin-measured in the same run:

| Row | Identity | What it falsifies |
| --- | --- | --- |
| M1 affine | `ticks(3) − ticks(1) = 2·(ticks(1) − ticks(0))` — no twin, no `C`, no `A` | a body charged twice, an init or exit that scales, a condition evaluated other than `n+1` times |
| M2 two paths to `C` | `P − 1 − B` equals `A − 2`, both measured | the head charge is not 1, or the two exit paths (`:249` never-entered, `:198` final probe) charge differently |
| M3 body rate | `P(fat) − P(thin) = ` the extra statement's twin cost | a loop that surcharges or discounts a body statement |
| M4 condition is per-attempt | a costlier condition costs `(n+1)·ΔC`, and `1·ΔC` when never entered | a hoisted condition — the mirror of rt10-for's bounds-read-once row, and the row that distinguishes the two forms |
| M5 never-entered body-independence | two never-entered loops with one condition and different bodies cost the same | a lowering that ran the body once before its first test |
| M6 leg identity | the emitted artifact's own step threshold equals RT-1's execution count exactly, pinned from both sides, for never-entered / one-shot / three-trip / wide-body; and an unbounded loop fails byte-identically at three budgets | any single slot charged differently on one leg — a budget one step under the threshold exhausts inside whichever slot the count lands in |
| E1 outputs | a `for` and a `while` over the same trip count return the same integer, byte-identically, on both legs | a loop off by one trip |

### Constraints that keep `break`/`continue` a kind and not a channel

**[RT11W-C21 DECIDED — item 4]** The `while` arms must not bake in "a loop exits only by its
condition or by a `return`". Three constraints, each with an oracle row or a named shape:

1. **Walker arms are generic sub-block recursion, never kind-specific completion logic.** The
   recommended extraction — `statementSubBlocks(statement)` returning the statement's child blocks
   and `statementSubExpressions(statement)` returning its owned expressions — is what both
   `statementsInvokeCapability` and `statementsCallDepth` traverse. `while` becomes one entry in a
   table, and so does `break`/`continue` later: a new *kind*, not a new *channel*. A walker that
   reasoned about "does this block complete" would have to be rewritten when abrupt exit arrives.
   The oracle asserts walker **behaviour** only, so either shape passes today; this constraint is
   what makes the later slice cheap, and it is why the fallback minimal-arms option is second choice.
2. **The JavaScript body stays inline inside the native `while(true){}`** — no function wrapper, no
   per-trip closure, no IIFE. A native `break`/`continue` cannot cross a function boundary, so a
   wrapped body would force the signal-object lowering the tribunal rejected. Oracle row: the
   emitted statement region's `function` and `=>` census equals the same body's census under `for`,
   and the region from the loop head onwards contains neither token.
3. **RT-1's frame stack must let a later `break` pop exactly one loop frame.** The frame shape is
   `WalkFrame { readonly loop: LoopState | undefined; readonly statements: readonly
   LinkedKernKirStatement[]; index: number }` (`expression.ts:165-169`), held in a `frames` array;
   a loop body is pushed as a frame **with** `loop` set (`expression.ts:247`) and an `if` branch as a
   frame with `loop: undefined` (`:238`). So `break` is "pop frames until and including the nearest
   frame whose `loop !== undefined`", and `continue` is "pop to that frame and re-enter its head".
   `while` must therefore push its body as a frame carrying its own loop state — not run the body on
   the enclosing frame — or the later slice has no frame to pop.

### Emitted JavaScript shape

**[RT11W-C15 VERIFIED — design]** `whileSource` mirrors `forSource`
(`kir-js-esm/emitter.ts:242-269`) and the `if` arm's tag check (`:290-303`):

```
      __meter.step();
      while(true){
      ${local}=${condition};
      if(${local}.tag!=='boolean')throw new __Fault('unsupported-runtime-input','execution');
      if(${local}.value!==true)break;
      __meter.step(); __checkAbort();${blockSource(statement.body, new Map(scope), …)}
      }
      __meter.step();
```

| Rule | Value |
| --- | --- |
| host construct | a native `while(true)` with a native `break` — a JS keyword, not a host global |
| new host patterns | **zero**. No `JSON`, `process`, `eval`, `Function`, `import`, `require`, no `node:` specifier. The r2 closure's `FORBIDDEN_EMITTED` (`scripts/kern-5-r2-js-lowering/closure.test.mjs:17`) matches none of the added text |
| new kernel bytes | zero. `__Fault`, `__meter`, `__checkAbort` are already in `KERNEL_SOURCE` |
| hoisting | **none**. The condition is re-emitted nowhere and re-evaluated per attempt, by definition of a condition loop; there is no bound to hoist |
| suspension points | zero new `await`, `Promise`, `queueMicrotask`, `setImmediate` — the condition is refused if it is an async call (RT11W-C10 gate) |
| checkpoint placement | after the tag check and after the `break`, so the failed final probe charges no `checkAbort()` (RT11W-D2) |

`while(cond){…}` with the condition inline in the head is **rejected**: unwrapping the tagged value
and running the tag check would need either a comma-sequence with a throwing arrow function (a new
host pattern) or a duplicated condition emission. `while(true)` + `break` is the minimal form.

### Python leg — the first ledger row

**[RT11W-C16 VERIFIED]** The ledger row, whose key set is whatever slice A's `ROW_KEYS` finally
declares (the oracle asserts agreement rather than hardcoding it), carrying these values:

| Field | Value | Why |
| --- | --- | --- |
| `nodeKind` | `'while'` | the stable ID; never a source path |
| `surface` | `'statement'` | if slice A keeps the column |
| `blockedBy` | `[]` | the catch-up **ordering** dependency: which other deferred node kinds must gain their Python lowering before this one can. It is not an "unblocked for automation" flag and it gates nothing at compile time. `while` is the first row, so nothing precedes it and `[]` is correct |
| `label` | `'KIR_PYTHON_LEG_DEFERRED'` | `= ledger.label`, the redundancy that is the drift gate |
| `since` | `'kern-5-rt11-linked-while'` | matches slice A's `/^kern-5-[a-z0-9]+(-[a-z0-9]+)*$/` |
| `spec` | `.Codex/specs/kern-5-rt11-linked-while/spec.md` | provenance, per the coordinator's scope change; replaces the dropped `jsLoweringBlameDigest` |

| Refusal rule | Value | Tag |
| --- | --- | --- |
| what refuses | the Python compile entry, after `linkVerifiedKernKirProgramOrThrow` succeeds and before `emitPython` | VERIFIED (slice A PL-C1) |
| the result | exactly `{format: 'kern.compiler.kir-python.v1', outcome: 'failure', code: 'KIR_PYTHON_LEG_DEFERRED'}` — three keys, no `artifact`, no `manifest` | VERIFIED (slice A PL-C1/PL-C3) |
| coverage | **every** catalog-permitted position of a `while`: handler top level, `if`-then, `if`-else, `for` body, another `while` body, helper body | VERIFIED (RT11W-C2 projection) |
| `emitter.ts` | **byte-identical**; slice A pins its digest and that pin must not move | VERIFIED (slice A) |
| c-py-1 closure and the 354 inventory | unchanged; no new file under `packages/core/src` | VERIFIED (slice A PL-C6) |

**[RT11W-C17 VERIFIED — Python lowering sketch, for the catch-up slice]** KIR `while` lowers to a
Python `while True:` carrying the same per-trip boolean tag check, in the same style the KIR `for`
lowering already uses (`kir-python/emitter.ts:252-286`): everything that can be selected once is
selected once above the head, and the head itself is an explicit `while` rather than a `range()` or
an iterator protocol. The `for` lowering hoists three bounds and a sign-selected comparator lambda;
a `while` has nothing hoistable, so its head is bare `while True:` and the condition expression is
emitted once in source and evaluated once per attempt. `_meter.step()` above the head, the tag
check and the `if … is not True: break` first inside it, then `_meter.step(); _check_abort()` at
trip-body entry, then the body, then `_meter.step()` after the loop. **No loop-`else`**: Python's
`while … else` runs on normal exit and would need the `break` to distinguish the two exits, which
reintroduces exactly the two-exit ambiguity the native-jump ruling removes. No `int()`, no `float()`,
no chained comparison, no `range(`.

## Implementation Plan

One option; the decision space genuinely collapses. `while` is `for` minus the counter plus a
re-evaluated condition, and every mechanism it needs exists.

1. **`kir-runtime/linked-kir-program/contracts.ts`** — the union member (RT11W-C10) and the `while`
   arms of `statementsInvokeCapability` and `statementsCallDepth`.
2. **`kir-runtime/linked-kir-program/link.ts`** — the `containsReturn` arm, `compileWhile`, and the
   `compileBlock` route.
3. **`kir-runtime/expression.ts`** — the RT-1 `while` arm and the `LoopState`/`enterTrip`
   generalisation, keeping `checkAbort()` inside the `enterTrip` region (RT11W-D1).
4. **`compiler/kir-js-esm/emitter.ts`** — one `blockSource` arm plus `whileSource` (RT11W-C15).
5. **`scripts/kern-5-parity-ledger/parity-ledger.json`** — the `while` row (RT11W-C16), plus
   `LEDGER_SHA256` re-pin in `ledger-support.mjs` and the amendment of slice A's zero-row assertion.
6. **`compiler/kir-python/request.ts`** — flip the `while` mapping entry to `'deferred'`.
7. **The licensed golden moves and the derived digest cascade** (Blast Radius).
8. **`compiledCoreDigest` re-pin, then `pnpm write:kern-canonicalizer-coverage`**, in that order.

### `contracts.ts` is already over the 500-line rule — and a new file is forbidden

`packages/core/src/kir-runtime/linked-kir-program/contracts.ts` is **536 lines**. The 354-file
compiled inventory pin (`scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:11`)
forbids a new file under `packages/core/src`, so the split cannot happen in this slice. Two ways to
land the arms:

- **Recommended — net-neutral.** Extract two private helpers used by *both* walkers,
  `statementSubBlocks(statement)` and `statementSubExpressions(statement)`, replacing the duplicated
  `if`/`for` arms in `statementsInvokeCapability` and `statementsCallDepth` with one shared
  traversal. `while` then costs one entry in each helper rather than two nine-line arms, the file
  does not grow, and both walkers become structurally exhaustive in one place instead of two.
  `forBounds` folds into `statementSubExpressions`.
- **Fallback — minimal.** Two `while` arms mirroring the `if` arms, taking the file to roughly 550
  lines.

The split of `contracts.ts` into `contracts.ts` + a walker module stays **queued** either way, and
is only unblockable when the inventory pin is renegotiated. Recorded in Queued follow-ups.

The oracle asserts walker **behaviour**, never walker shape, so either option passes.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-rt11-linked-while/spec.md` | add | this document |
| `scripts/kern-5-rt11-linked-while/**` | add | 8 test files, 2 JSON fixtures, 1 harness module, 1 fixture-catalogue module (the catalogue is split out so neither hand-written module passes 500 lines) |
| `.Codex/specs/kern-5-parity-ledger/spec.md` | **no edit** | slice A's spec is slice A's; RT11W-O1's routing answer belongs there or in the implementation, not here |
| `package.json` | edit | `test:kern-5-rt11-linked-while`; appended to `test:kern-5-script-family` |
| `scripts/ci/test-tier-contract.test.mjs` | edit | `kern5EvidenceCommands` gains one entry; the `deepEqual` is exact and order-sensitive |
| `.github/workflows/ci.yml` | **no edit** | the `kern-5-evidence` job runs the aggregate once |
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | edit | the `while` union member; the two walkers' `while` arms |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | edit | `containsReturn`, `compileWhile`, the `compileBlock` route |
| `packages/core/src/kir-runtime/expression.ts` | edit | the RT-1 `while` arm; `LoopState`/`enterTrip` generalised with `checkAbort()` kept in place (RT11W-D1) |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | edit | one `blockSource` arm + `whileSource` |
| `packages/core/src/compiler/kir-python/emitter.ts` | **no edit** | byte-frozen; slice A pins its digest and that pin must not move |
| `packages/core/src/compiler/kir-python/request.ts` | edit | the `while` statement mapping entry flips to `'deferred'` |
| `packages/core/src/kir-runtime/contracts.ts` (`KernKirLimits`, `KernKirDiagnosticCode`) | **no edit** | RT11W-C6: no new limit, no `maxIterations`, no new diagnostic code |
| `scripts/kern-5-parity-ledger/parity-ledger.json` | **edit — licensed** | the first row (RT11W-C16) |
| `scripts/kern-5-parity-ledger/ledger-support.mjs` | **edit — licensed** | `LEDGER_SHA256` re-pin; the only digest the row move touches |
| `scripts/kern-5-parity-ledger/ledger-schema.test.mjs` | **edit — licensed** | slice A's "ships with zero rows" assertion becomes "carries the `while` row" |
| `scripts/kern-5-rt2-boolean-if/k0-golden.{json,test.mjs}` | **edit — licensed** | `linkedStatementKinds` scrape gains `"while"`; `PROBE_BODIES.while` must become a projectable body (its bare `print` is F5-rejected today, so `while` would otherwise stay `projection-rejected` while sitting in the union and break the second golden test); the per-leg shape is **slice A's** generic amendment |
| `scripts/kern-5-rt9-linked-assign/k0-golden.{json,test.mjs}` | **edit — licensed** | `linkedStatementKinds` gains `"while"`; `control-while` flips off `handler-entry-unsupported`; `k0-golden.test.mjs:104`'s `['each','set','while']` becomes `['each','set']`; **tripwire 3 (RT11W-C8/RT11W-O1) lives here** |
| `scripts/kern-5-rt3-binary-expression/k0-golden.json` | **edit — licensed** | its `rt2GoldenSha256` field is derived from the RT-2 golden |
| `scripts/kern-5-rt4-user-fn-call/probe-matrix.json` | **edit — licensed** | `rt2GoldenSha256` **and** `rt3GoldenSha256` are both derived |
| `RT2_GOLDEN_SHA256` literals in rt4, rt5, rt6, rt9, rt10-pre, rt10-X `compatibility.test.mjs` | **edit — licensed** | 6 files carry `6d6754e7…` as a consuming assertion |
| `RT3_GOLDEN_SHA256` literals in rt6, rt9, rt10-for, rt10-X `compatibility.test.mjs` | **edit — licensed** | 4 files carry `935da814…`; it moves because rt3's golden gains a new `rt2GoldenSha256` |
| `RT9_GOLDEN_SHA256` literals in rt10-for, rt10-X `compatibility.test.mjs` | **edit — licensed** | 2 files carry `c8a7253c…` |
| the historical pre-image literals `RT2_K0_GOLDEN_PRE_RT9_SHA256` (rt9), `RT2_GOLDEN_PRE_SLICE_SHA256` / `RT2_GOLDEN_PRE_RT9_SHA256` (rt10-pre) | **no edit** | historical stamps. The reconstructions `{...golden, rt2GoldenSha256: PRE}` still reproduce them because only that one field of rt3's golden changes — **verify, do not assume** |
| `scripts/kern-5-rt10-for/type-gate.test.mjs` | **edit — licensed** | `LEAF_REFUSALS` row `['neg-while', 'statement must be a leaf']` is exactly what this slice invalidates: `neg-while` becomes admitted on JS/RT-1. Move it to the admitted set or delete it and let this slice's suite own it |
| `scripts/kern-5-rt10-for/compatibility.test.mjs` | **edit — licensed** | `STILL_OUTSIDE` at `:63` drops `'while'` → `['break','continue','each','set']`; the RT-9 and RT-3 golden digest literals re-pin |
| `scripts/kern-5-rt10-for/k0-support.mjs` `neg-while` fixture | keep | it stays a valid fixture; only its expected verdict moves |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:97` (`compiledCoreDigest`) | **edit — licensed** | any content change under `packages/core/src` moves it. Re-pin, then `pnpm write:kern-canonicalizer-coverage` |
| `scripts/kern-canonicalizer/*.json` coverage receipts | regenerate | `pnpm write:kern-canonicalizer-coverage`; `coverageImplementationDigest` moves because the re-pin edits a `.mjs` under `scripts/kern-canonicalizer` |
| the 354-file inventory count and path digest | **no edit** | five existing files are edited; none is added or removed. **No new file under `packages/core/src` is permitted** |
| `TARGET_KERNEL_SHA256` (both kernels), every emitted-artifact digest, every manifest digest, `linkedProgramSha256`, `projectionArtifactSha256` | **no edit** | if one moves, a `KERNEL_SOURCE` byte was touched, which is forbidden. `linkedProgramSha256` changes **per program** (a while program is a new program) but the constant is not re-pinned |
| `scripts/runtime-contract-v1/**` and `scripts/kir-v1/alpha-receipt-policy.json` | **no edit** | slice A PL-C7: RC-v1 declares only the `KernRuntimeHandler*` surface and the alpha-receipt policy binds no `kir-runtime`/`compiler` path. **No amendment record required** |
| `scripts/kern-5-admission-census/**` (`admitted.json`, `admission.json`) | **no edit** | RT11W-C7: zero tracked files are rejected at `link`, so admission gain is exactly 0 and the ratchet is a floor |
| `scripts/kir-v1/eligibility.json`, `coverage-witness-ledger.json`, `scripts/kern-canonicalizer/coverage-family-registry.json` (the already-promoted `while-iteration` family) | **no edit** | `git grep -l 'linkVerifiedKernKir\|LinkedKernKirStatement' scripts/kir-v1 scripts/kern-canonicalizer` → **zero hits**, 2026-09-07. These are the F5/static-catalog track and do not observe linker admission |
| `scripts/kern-frontend-*`, `scripts/capstone-checker-subset/**`, `scripts/conformance.mjs`, `scripts/class-conformance.mjs`, `scripts/kern-5-runtime-envelope-max-steps/**`, any `.kern`, the constitution, the closure ledger | **no edit** | RT11W-C1: F5 already projects `while`. The `runtime-envelope-max-steps` `while` fixtures drive the **legacy IRNode runner**, a different stack (RT11W-C6) |
| `scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs:142-146` (`checkAbort()` count `=== 2`) | **no edit** | RT11W-D1 is chosen precisely so this pin holds. If a builder needs a third site, the decision has been changed and this spec is wrong |
| RT-9's `type-gate.test.mjs`, RT-10-pre's, RT-10-X's and RT-2's behaviour suites | **no edit** | pinned green by this slice's `compatibility.test.mjs` |

## Acceptance Criteria

Each is a test in `scripts/kern-5-rt11-linked-while/`.

- [ ] `while` is a member of `LinkedKernKirStatement` with exactly `body` and `condition`, and
      `break`, `continue`, `each` and `set` stay outside it.
- [ ] Every projectable `while` position — handler top level, `if`-then, `if`-else, `for` body,
      `while` body, helper body — links and runs on RT-1 and the JavaScript leg with
      byte-identical envelopes.
- [ ] The condition is evaluated before each trip; the loop runs the exact trip count for every
      frozen behaviour row; `to`-style off-by-one errors separate.
- [ ] A non-boolean condition is refused at link with `KIR_WHILE_COND_NOT_BOOLEAN` on all three
      legs, for an integer literal, an integer parameter, a text parameter and an integer binary. No
      truthiness.
- [ ] An empty `while` body is refused with `branch block is empty`, not with
      `statement kind while is outside RT-1`.
- [ ] `break` and `continue` inside a `while` body are refused with
      `statement kind <k> is outside RT-1` and specifically **not** with `statement must be a leaf`,
      so the body is proven to be compiled by the ordinary statement path.
- [ ] An async-helper condition is refused with `KIR_ASYNC_CALL_EXPRESSION_POSITION`.
- [ ] `print` and `capability` nested under an `if` inside a `while` body link and run, with
      byte-identical stdout / event ordering on RT-1 and JS; as **direct** body children they stay
      F5-rejected (the two fences).
- [ ] A `let` in the body does not leak (post-loop read is `unknown identifier`); an `assign` to an
      outer `let` persists; a `return` in the body ends the handler; a `void` handler whose only
      `return` is in a `while` body is refused at link with `KIR_VOID_HANDLER_VALUE_RETURN`.
- [ ] An `assign` inside a `while` body is governed by RT-9's rule alone —
      `KIR_ASSIGN_TO_LOOP_COUNTER` is unreachable from a `while`.
- [ ] All four walkers recurse into a `while`: a `capability` in the body and one in the condition
      reach the closure walk; a helper called from the body reaches it; a call in the body and a
      call in the condition count against call depth; two nested `while`s do not shorten a
      two-frame chain; a `while`-free answer is `false`/`0` rather than a throw.
- [ ] RT-1 carries exactly **two** `checkAbort()` calls, one in the statement-boundary region and
      one in the `enterTrip` region (RT11W-D1).
- [ ] The JavaScript leg adds exactly **one** checkpoint per `while` over the straight-line twin,
      and one per head for a nested pair.
- [ ] The emitted JavaScript `while` region carries a host `while`, the boolean tag check, the
      `break`, zero `await`/`Promise`/`queueMicrotask`/`setImmediate`, and no new kernel line.
- [ ] The charge is `2 + n·(1 + B)` with `HEAD_CHARGE = 1`, and the five equivalence rows E1-E5
      hold.
- [ ] `while cond="true"` exhausts `maxSteps` and faults `runtime-limit-exceeded` / `execution` with
      an absent result and no events, on RT-1 and JS.
- [ ] The parity ledger carries the `while` row with the pinned values (RT11W-C16), key-set
      identical to slice A's `ROW_KEYS`, and it validates under slice A's `validateLedger`.
- [ ] The Python compile of a `while` program returns exactly
      `{format, outcome: 'failure', code: 'KIR_PYTHON_LEG_DEFERRED'}` — three keys, no `artifact`,
      no `manifest` — in **every** catalog-permitted `while` position, while the JavaScript leg of
      the same program is `admitted`.
- [ ] `KernKirLimits` stays at seven fields, `maxIterations` is not introduced, and
      `KernKirDiagnosticCode` stays at twelve members.
- [ ] Both target kernels are byte-unchanged, and the F5 projection policy digest is unchanged.
- [ ] `pnpm test:ci-contract` passes with the new evidence leaf wired; `pnpm lint` is clean.

## Out of Scope

- **`break` and `continue`.** Tribunal Q3: `while` alone. They stay refused with their existing
  labels, and this slice pins those refusals so the next slice's RED is real.
- **`each`, `do`, `set`, `try`/`catch`.** Outside the linked union, asserted.
- **The Python `while` lowering.** Deferred by ledger row. RT11W-C17 records the design.
- **The rt2/rt4 per-leg golden shape.** Slice A owns it generically (coordinator scope change,
  2026-09-07). This slice adds the row and asserts the refusal; it designs no harness shape.
- **Any `maxIterations` / iteration-budget field.** RT11W-C6: it does not exist here and is not
  created.
- **Any `link.ts` target parameter.** Link stays target-neutral (slice A PL-C10).
- **The `contracts.ts` split.** Blocked by the 354 inventory pin; queued.
- **Any RC-v1 amendment record**, any `scripts/runtime-contract-v1/*` edit, any kernel byte.
- **Any push, merge, release-gate promotion or deployment.**

## Notes pinned now for later slices (tribunal Q4, free today)

- **[RT11W-N1]** Unlabelled `break`/`continue` only, bound to the **innermost** enclosing loop at
  link time.
- **[RT11W-N2]** `break`/`continue` outside any loop is a **link error**. A function boundary resets
  the loop context: a helper called from inside a loop body has loop depth 0.
- **[RT11W-N3]** **Native jumps only** in both emitters. No `__Break`/`__Continue` signal-object
  lowering: it pollutes the rt4 fault channel and grows the c-py-1 forbidden-pattern surface. The
  JavaScript `while(true)` + `break` form (RT11W-C15) is already a native jump, so this slice sets
  the precedent rather than deferring it.
- **[RT11W-N4]** `break`/`continue` **never cross a `try` boundary**. Written now so try/catch
  inherits it.
- **[RT11W-N5]** Boolean-only conditions, no truthiness (landed here as `KIR_WHILE_COND_NOT_BOOLEAN`).
  No loop-`else`. Copied-scope bindings, no closure capture. Walkers recurse through every loop form.
- **[RT11W-N6]** **Iteration-budget scope is a note, not a row.** The tribunal recommended
  per-loop-instance, reset at entry. RT11W-C6 shows there is no iteration budget in
  `KernKirLimits` to scope, so `while` charges `maxSteps` only, exactly as `for` does. If a future
  slice introduces one, per-loop-instance-reset-at-entry is the pinned intent, because it is the
  only choice that keeps a `range()`-based Python `for` lowering and the *`continue` lands on the
  step* invariant intact.
- **[RT11W-N7]** The `continue` slice must decide whether `continue` charges the head again. Under
  RT11W-D1 it must, because `continue` re-enters the trip through the same head, and any other
  answer creates the second metering rule this slice exists to avoid.

## Oracle — RED/GREEN gate table

Measured on this branch @ the slice-A tip `b273b20c`, each file run individually with
`node --test scripts/kern-5-rt11-linked-while/<file>.test.mjs`.

**96 tests: 22 GREEN, 74 RED.**

| File | tests | pass | fail | Base |
| --- | --- | --- | --- | --- |
| `probe-matrix` | 6 | **6** | 0 | all GREEN — the F5 facts this contract is built on, and the four schema fences |
| `compatibility` | 8 | **8** | 0 | all GREEN — must stay green |
| `tick-discipline` | 10 | 3 | **7** | RT-1's two-site pin and both isolations are GREEN; every emitted-shape row needs an admitted `while` |
| `type-gate` | 24 | 1 | **23** | the `for` regression row is GREEN |
| `behavior` | 25 | 3 | **22** | the two table-shape rows and the RT-2-precedent boolean-gate row are GREEN |
| `metering` | 13 | 1 | **12** | the twin-cost row is GREEN |
| `walker-coverage` | 7 | 0 | **7** | two TypeError causes plus the union gap |
| `python-deferral` | 3 | 0 | **3** | one row is blocked on slice A's column change (RED-6) |

Every RED resolves to exactly one of six causes:

| Cause | REDs | Verbatim, as measured |
| --- | --- | --- |
| **RED-1** the linker does not route `while` | 65 | thirteen `expected the <gate> gate to fire, but the linker reported: <label>: statement must be a leaf`; two `… reported: <label>: statement kind while is outside RT-1` (the empty body); seven `RT11W_LINK_REFUSED: <fixture> must link on RT-1`; thirty-two `RT11W_LINK_REFUSED: javascript compile failed: handler-entry-unsupported`; ten `<id>: linking does not succeed inside the scanned step range`; one `RT11W_ROUTE_GAP: the refusal must be attributed to the while body, not to the while statement` |
| **RED-2** the union has no `while` member | 1 | `RT11W_UNION_GAP: the linked statement union must carry the while member` |
| **RED-3/RED-4** the two semantic walkers are blind to `while` | 6 | `TypeError: Cannot read properties of undefined (reading 'kind')` — the walkers fall through to `statement.value`, which a `while` node does not have |
| **RED-5** the ledger has no `while` row | 1 | `RT11W_LEDGER_ROW_MISSING: the parity ledger must carry the while row` |
| **RED-6** slice A's ledger column change has not landed | 1 | `RT11W_LEDGER_SHAPE: the proposed while row must carry exactly blockedBy, jsLoweringBlameDigest, label, nodeKind, since, surface` |

RED-3 and RED-4 are driven by a hand-built linked `while` (`linkedWhileStatement` in
`k0-support.mjs`), so they are independent of RED-1 and fail even after `while` links. They share one
verbatim message because both walkers fall through the same way; the test names separate them, and
each test targets exactly one walker. RED-2 is a source scrape, likewise independent of RED-1.

The ten metering REDs whose message is `linking does not succeed inside the scanned step range` are
the weakest-worded of the RED-1 group: `loopStepBudget` binary-searches a step budget rather than
reading a label, so it reports the search failing rather than the refusal. The cause is still
single — the fixture links at no budget — and `type-gate` names the label for the same fixtures.

No RED comes from a fixture typo. `probe-matrix.test.mjs` asserts every one of the 48 position
fixtures projects with zero diagnostics, GREEN at base, precisely so a projection regression can
never masquerade as a link RED. The oracle-cause labels RED-1..RED-6 are distinct from the
contract claim IDs RT11W-C1..RT11W-C22.

### Tests blocked on slice A's production code

Slice A shipped spec + RED oracle only; its mapping, `KIR_PYTHON_LEG_DEFERRED_CODE` and the
compile-entry pass do not exist yet, and its ledger column list has not yet been changed. All three
tests in `python-deferral.test.mjs` are affected, and the one that needs both slices is written so
the `while` side is named first:

| Test | Depends on | Base cause | Cause after `while` lands, before slice A's pass |
| --- | --- | --- | --- |
| `the while row satisfies the parity ledger schema slice A defines` | **slice A only** | RED-6 — slice A's `ROW_KEYS` still declares `jsLoweringBlameDigest` and no `spec` | — (goes GREEN when slice A lands the column change) |
| `the parity ledger carries the while row` | this slice only | RED-5 | — (goes GREEN) |
| `a while program is admitted on the JavaScript leg and refused on the Python leg` | this slice **and** slice A | RED-1 (the JS admission assertion runs first and fails first) | `RT11W_PY_NOT_DEFERRED: expected KIR_PYTHON_LEG_DEFERRED, received handler-entry-unsupported` |

The RED-6 row is deliberately left RED rather than pinned to the current column list: the row's key set
is asserted against slice A's `ROW_KEYS` **export**, so whatever shape slice A finally lands is what
this slice's row must match, and the failure message prints the live column list. That is the only
cross-slice RED in the suite, and it is not blocked on any `while` production code.

The position sweep over all six `while` positions lives inside that last test, so slice A's
absence cannot masquerade as a `while` failure and vice versa. No `python-deferral` test imports a
slice-A production symbol statically; the ledger row is read from JSON and the refusal code is
compared as a string literal, so a missing slice-A export cannot turn into a module-level
`SyntaxError` that hides the GREEN pin.

### Neighbour gates at base

| Command | Base |
| --- | --- |
| `pnpm test:ci-contract` | **19/19 pass**, with this slice's `kern5EvidenceCommands` entry and the `test:kern-5-script-family` append applied |
| `pnpm lint` | **exit 0**, `Checked 1449 files`, 2 pre-existing infos (`String.raw`), no error |

`biome.json`'s `files.includes` covers `packages/*/src/**`, `packages/*/tests/**` and two named
scripts, so `scripts/kern-5-rt11-linked-while/**` carries no lint gate and is hand-formatted to the
120-column, 2-space style of its neighbours.

## Open Questions

- **[RT11W-O1 OPEN — routing, needs the coordinator]** RT-9's `admissionRow`
  (`scripts/kern-5-rt9-linked-assign/k0-golden.test.mjs:74-76`) is a **third** cross-leg agreement
  tripwire, alongside the rt2 and rt4 ones slice A is making ledger-aware. It asserts both
  `javascript === python` and `rt1 === javascript`, and it fires on RT-9's own `control-while`
  fixture. Either slice A's generic amendment covers it or this slice's implementation owns it. It
  is named in Blast Radius either way, and no acceptance criterion or oracle row in this slice
  depends on the answer.
- **[RT11W-O2 DECIDED — 2026-09-07]** The runtime non-boolean-condition fault is **defence in
  depth and unreachable through the public entry today**. `staticExpressionType` is total over
  linked KIR, so a condition that is not statically boolean is refused at link; RT-2 pins exactly
  this for `if` — `scripts/kern-5-rt2-boolean-if/branch-behavior.test.mjs:150-174` asserts all three
  legs return `handler-entry-unsupported` for every non-boolean condition and exercises no runtime
  path. `while` inherits the same posture: the tag check is asserted by **source and emitted text**,
  not by an executed fault. Claiming an executed dynamic fault would be an unfalsifiable oracle row.
- **[RT11W-O3 DECIDED — 2026-09-07]** The equivalence pair asserts machinery equality plus
  twin-measured differences, not literal tick equality, because literal equality is arithmetically
  impossible for `n > 0` (RT11W-C14). Recorded as a decision rather than an accepted risk: the
  weaker literal claim would be *satisfiable only by a bug*.
- **[RT11W-O4 OPEN — advisory, caps nothing]** The ledger row's key set is asserted against slice
  A's `ROW_KEYS` export rather than hardcoded, because slice A's branch will gain further commits
  (the coordinator has already dropped `jsLoweringBlameDigest` and added `spec`). If slice A also
  drops `surface`, the row loses that field and no oracle row changes. No acceptance criterion rests
  on the presence of `surface`.
- **[RT11W-O5 OPEN — technical, resolve during implementation]** The historical pre-image
  reconstructions in `scripts/kern-5-rt9-linked-assign/compatibility.test.mjs:51-55` and
  `scripts/kern-5-rt10-pre-linked-arithmetic/compatibility.test.mjs:81,120` rebuild a past RT-3
  golden digest as `{...golden, rt2GoldenSha256: <historical>}`. That reconstruction survives only
  because `rt2GoldenSha256` is the **single** field of the RT-3 golden this cascade changes. Verify
  it, do not assume it: if the RT-2 golden's per-leg amendment forces any other RT-3 field to move,
  those pre-images break and the fix is a documented pre-image re-derivation, not a re-pin.

## Deploy Order

1. **This slice: spec + RED oracle + wiring.** 74 RED, 22 GREEN. Nothing under `packages/core/src`
   moves, so no digest is re-pinned here.
2. **Slice A's implementation** (mapping, `KIR_PYTHON_LEG_DEFERRED_CODE`, the compile-entry pass)
   must land before the `while` row can refuse anything. A `while` implementation without it
   produces a Python artifact for a node Python cannot lower — the exact lying artifact the tribunal
   rejected mechanism (B) for.
3. **This slice's implementation**, in one commit for the core edits: union member + walkers + link +
   RT-1 + JS emitter. A union member without walker arms does not compile; walker arms without a
   link route are dead.
4. **The ledger row + the mapping flip**, together. Either alone fails slice A's bidirectional
   staleness gate — which is the whole reason that gate is bidirectional.
5. **The licensed golden moves and the derived digest cascade**, in dependency order: rt2 golden →
   rt3 golden's `rt2GoldenSha256` → rt4 probe matrix → the six `RT2_GOLDEN_SHA256` literals → the
   four `RT3_GOLDEN_SHA256` literals → rt9 golden → the two `RT9_GOLDEN_SHA256` literals. Then
   re-verify the pre-images (RT11W-O5).
6. **`compiledCoreDigest` re-pin, then `pnpm write:kern-canonicalizer-coverage`**, in that order.

No version skew window: every consumer is in this repository and ships in the same commit.

## Queued follow-ups

- **`break`/`continue` slice.** RT11W-N1 through N4 and N7 are its contract. It also owns the
  abrupt-exit charge semantics question and reopens `for` lowering in both emitters.
- **`each` slice.** Needs the collection model; `each` carries nine properties (RT11W-C1 territory,
  `constitution.json:696-702`) against `while`'s one.
- **The Python `while` catch-up.** RT11W-C17 is the design. Follows slice A's documented catch-up
  procedure: land the lowering, re-pin `emitter.ts`'s frozen digest, flip the mapping to
  `'lowered'`, delete the row, re-pin `LEDGER_SHA256`, add three-leg byte-identical envelope rows.
- **The closures slice.** KIR has no functions-as-values today, so copied bindings are simply the
  `for`/`if` precedent and no escape is expressible. When capture arrives, per-trip `let` freshness
  against outer-`assign` write-through must be re-examined: this slice pins both halves as rows
  (`behavior.test.mjs` — an `assign` to an outer `let` accumulates across trips while a body `let` is
  per-trip; `type-gate.test.mjs` — a post-loop read of a body `let` is `unknown identifier`), and a
  capturing closure would make the two observably different from what a copied scope implies.
- **The `contracts.ts` split.** Blocked by the 354-file compiled inventory pin. Unblockable only
  when that pin is renegotiated; the net-neutral helper extraction above is the interim mitigation.
- **RT11W-O1** (RT-9's third cross-leg tripwire) and **RT11W-O5** (the pre-image reconstructions).

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| A `for`/`while` equivalence pair can assert literally equal tick counts | A `while` must spell out `let i = 0` and `assign i = i + 1`, which are metered; equality is arithmetically impossible for `n > 0` and would be satisfiable only by mis-metering one form | Replaced with five rows E1-E5: equal outputs, an identical `HEAD_CHARGE = 1`, init/exit charged once, and two cross-form differences measured from twins in the same run (RT11W-C14, RT11W-O3) |
| The base refusal for `while` is one label | It is two: `statement must be a leaf` for a `while` with a body, `statement kind while is outside RT-1` for an empty one, because `assertLeaf` runs before any kind branch | The empty-body fixture became the sharpest single-cause discriminator in the suite, and its post-slice label is `branch block is empty` rather than either base label (RT11W-C3) |
| The non-boolean condition has a reachable dynamic runtime path, per the brief | RT-2 pins the `if` equivalent as a **link** refusal on all three legs and exercises no runtime path; `staticExpressionType` is total, so no projectable fixture reaches the tag check | The tag check is asserted by source and emitted text only. An executed-fault row would have been an unfalsifiable oracle fixture (RT11W-O2) |
| `while` charges an iteration budget whose scope must be pinned as a contract row | `maxIterations` is not a field of `KernKirLimits`; only the legacy IRNode runner has one | Downgraded from a contract row to a note for a later slice (RT11W-C6, RT11W-N6), and `compatibility.test.mjs` pins that no such field appears |
| The census admission count must be measured with a sweep, or declared unmeasured | `admission.json` already records all 240 results by stage: **zero** are rejected at `link` | Answered exactly — the gain is 0 admissions — from a single JSON read, with no five-minute sweep (RT11W-C7) |
| rt2 and rt4 are the two cross-leg agreement tripwires | RT-9's `admissionRow` is a third, and it asserts `rt1 === javascript` as well as `javascript === python` | Raised as RT11W-O1 for coordinator routing, and recorded in Blast Radius so it cannot be discovered during implementation |
| The rt2 golden's `while` admission row is what moves | Its `PROBE_BODIES.while` uses a bare `print` under `while`, which F5 rejects; the row would stay `projection-rejected` while `while` sat in `linkedStatementKinds`, breaking the golden's *second* test rather than its first | The probe **body** must change, not only the expected value — a distinct edit from the per-leg amendment slice A owns |
| The `while` charge is `2 + n·(1 + B)`, the same formula `for` is pinned to | It is `A + n·P` with `P = 1 + B + C` and `A = 2 + C`, because a `while` re-evaluates its condition on every attempt — `n+1` times — where a `for` reads its bounds once. `2 + n·(1 + B)` cannot satisfy the never-entered, one-shot and n-trip paths simultaneously | **Four metering rows in the first revision would have gone RED against a correct implementation.** Replaced with six rows that cancel `A` and `C` by construction or cross-check two independent paths to the same unknown: affine linearity, the two-paths-to-`C` agreement, body rate, the per-attempt condition row, never-entered body-independence, and the two-leg step threshold (RT11W-C19, M1-M6) |
| The JavaScript leg charges nothing on the failed final condition probe, so the legs disagree | False, and checked at source: the trailing `__meter.step()` at `kir-js-esm/emitter.ts:268` is the counterpart of RT-1's `expression.ts:198`/`:249`, and the native `break` falls straight into it. Both legs charge `1_init + Bounds + n·(1_head + Counter + B) + 1_exit` for `for` | **No pre-existing rt10-for discrepancy exists** and none is copied. The per-slot table (RT11W-C18) now states every charge with file:line for both legs and both loop forms, and M6 pins leg identity by measurement rather than by derivation |
| The emitted boolean tag check can be asserted by a regex on the artifact, citing RT-2 as precedent | RT-2 asserts the `if` gate behaviourally — all legs fail closed under the closed link code, zero events (`branch-behavior.test.mjs:150-174`) — and makes no claim about emitted text | The regex rows are removed from `behavior.test.mjs` and `tick-discipline.test.mjs` and replaced with RT-2's own row verbatim in shape; the emitted-shape rows that remain are rt10-for's precedent (RT11W-C22) |
| A missing name reached through `export *` is in scope | `export *` re-exports for consumers but does not bind into the re-exporting module's own scope, so `assertTwoLegStepThreshold` threw `loopStepBudget is not defined` on first run | `loopStepBudget` is imported by name as well as re-exported, the same guard rt10-for's own harness carries in a comment. Caught by running the suite, not by review |
| `while`'s `allowedChildren` has 27 members | It has **28**. The fact report's verbatim list is right and its count label is wrong: `throw` is in the list and was not counted | The probe matrix asserts 28 and `deepEqual`s the list against `for`'s, so the count is now measured rather than quoted |
| A `while` body containing an `each` is a discriminating negative on the message alone | At base the outer unrouted `while` fires the identical `statement must be a leaf`, so the row was GREEN for the wrong reason | The assertion moved to the label **path** (`/\.body\.children\[/`): a refusal attributed to the loop's body proves the loop itself was compiled |
| The zero-trip `for`/`while` charge difference can be asserted directly | The only available expression for the expected value is the measured difference itself, making the row a tautology | Replaced with a body-independence row: two never-entered loops with the same condition and different bodies must cost the same, which a lowering that ran the body once before its first test fails and nothing else does |
| The `while` union member needs a `forBounds`-style bounds helper | A `while` carries one condition expression, and both walkers already visit `statement.condition` for `if` | No new helper; `forBounds` folds into the recommended shared-traversal extraction instead (RT11W-C10, Implementation Plan) |
