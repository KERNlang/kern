# KERN 5 slice F — linked `with`

**Status:** IMPLEMENTED
**Date:** 2026-09-10
**Confidence:** 0.92 (implemented and measured; see Corrections Log)
**Base:** `2dd26302` (origin/main, PR #587 merged — slice E tip)
**Branch:** `feat/kern-5-f-with`
**Oracle:** `scripts/kern-5-f-linked-with/` — 10 test files + fixture, pin, golden and measurement modules, **162 measured rows: 134 RED at base, 28 GREEN** (plus commit-rows' 8 self-drive rows and 1 env-gated row), measured 2026-09-10 with `node --test --test-reporter=tap` against the base build; wired as `test:kern-5-f-linked-with` into `test:kern-5-script-family` and the CI tier contract.
**Landed:** one linker commit (three files, 84 net hand-written lines) turns the oracle **162 GREEN, 0 RED**; slice E's suite stays 135 GREEN after the pin moves; the canonicalizer `compiledCoreDigest` is re-measured. Two implementation defects the oracle caught and two oracle defects the implementation disproved are recorded in the Corrections Log.
**Tribunal:** `~/.agon/runs/tribunal-1789044317238-hm8v4l-kern5-f-with-contract` (claude, codex, agy, kimi; minimax and zai returned nothing). Rulings recorded under *Open Questions* and the Corrections Log.

## Executive Summary

Slice F admits `with name=N value=V cleanup=C { body }` to the linked-KIR compiler by **link-time
expansion**, the design slice E recorded (`.Codex/specs/kern-5-e-linked-each-do/spec.md:289-320`)
and the tribunal upheld 3–1: the linker rewrites one `with` node into two linked statements the
union already has — `let N = V` followed by `try { body } finally { do C }` — and binds `N` so the
body cannot reassign it. **No new linked kind, no new RT-1 arm, no new JavaScript arm, no Python
table entry, no ledger row.** RT-1 and the JS leg execute the expansion through the `let`, finally-
bearing `try` and `do` machinery slices D and E landed, so the metering equality with the hand-written
twin program is structural, not synthesised; and the Python leg defers through the `try`/`do` rows
that already stand.

What the slice therefore owns is the **linker contract** of `with`: which surface forms are admitted,
the binding's scope and immutability, the async-flag rule, and the labels — plus an oracle that pins
the expansion's observable behaviour on both legs (cleanup order on every exit path, fault precedence,
scope isolation) so that a later change to any of the three underlying mechanisms cannot move `with`
unnoticed.

The governing principle carries over from slice E: **slice F invents zero new metering shapes** —
here by construction, and the oracle still asserts it per exit path against the twin.

## Current State

Measured at base `2dd26302` on 2026-09-10 (live probes: `scratchpad/probe-with{,2,3}.mjs` through
slice E's `admission()` harness).

| Fact | Evidence | Tag |
|---|---|---|
| `LinkedKernKirStatement` is 14 kinds; `with` is outside it and stays outside it | `linked-kir-program/contracts.ts:250-297` | VERIFIED |
| A `with` node has children, so it refuses at `assertLeaf` before any kind check: `statement must be a leaf` | `statements.ts:68`; probe `ROW lit-lit projected \| entry.function.handler.children[1]: statement must be a leaf` | VERIFIED |
| Slice E's oracle asserts `with` keeps that generic refusal and that no `KIR_WITH_*` label is spelled anywhere in the linked source | `scripts/kern-5-e-linked-each-do/reserved-labels.test.mjs:63-97`; `pins.mjs:97-103` (`RESERVED_WITH_LABELS`) | VERIFIED |
| F5 projects `with` with `name` and `value` **required** and `cleanup`, `async`, `protocol`, `trailingComment` **optional**; every `with` refusal today is a *link* decision | probe rows: `no-name` / `no-value` → `not-projected`; `no-cleanup`, `protocol-with`, `protocol-empty`, `async-true`, `async-false`, `trailing-comment` → `projected` | VERIFIED |
| F5 refuses `?` propagation on `value` and on `cleanup` | probe rows `value-propagate`, `cleanup-propagate` → `not-projected` | VERIFIED |
| F5 refuses a `catch` child inside a `with` body and a `type=` property on `with` | probe rows `catch-in-with`, `extra-prop` → `not-projected` | VERIFIED |
| F5 projects a `with` whose body is empty, a `with` inside a helper, inside a `finally`, inside a `try` body, nested `with`, `for`/`each`/`throw`/`return`/`break` inside a `with` body, `name=` shadowing a `let` or a parameter, and `cleanup` spelled as a member call, a JSON intrinsic, a literal or an async call | probe rows `empty-body`, `with-in-helper`, `with-in-finally`, `with-in-try`, `nested-with`, `for-in-with`, `each-in-with`, `throw-in-with`, `return-in-with`, `break-in-with-in-for`, `shadow-let`, `shadow-param`, `cleanup-member`, `cleanup-json`, `cleanup-lit-text`, `cleanup-async` — all `projected` | VERIFIED |
| The projected node carries `name` as text, `value`/`cleanup` as expression records, `async` as a bool, `protocol` as text (`"with"` or `""`) | probe node dumps | VERIFIED |
| The native TypeScript codegen lowers `with` to `const N = [await ]V; try { body } finally { [await ]C; }`, binds `N` as a `const` scoped to the body, **normalises `protocol=""` to omission**, and refuses `protocol=with` and `?` on either expression | `codegen/body-ts.ts:724-761` (`:732` normalisation) | VERIFIED |
| Natively, `cleanup=` is required only when `protocol !== 'with'`; `protocol=with` delegates cleanup and is Python-only | `schema.ts:3878-3912` | VERIFIED |
| Only one repository `.kern` file uses `with` (`examples/with-primitive.kern`), and the census rejects it upstream of `with` (`FRONTEND_UNSUPPORTED_MODULE_ROOT`); slice F moves the census by zero files | `scripts/kern-5-admission-census/admission.json:1954-1961` | VERIFIED |
| `tryFamily` is `requireExport`: `try`/`throw` are entry-only, refused in helpers with `KIR_TRY_FAMILY_IN_HELPER` | `link.ts:202`; `statements.ts:31,235` | VERIFIED |
| Void helpers have no call form, so a cleanup can only call a value-returning helper and discard the value — the `do` precedent | `link.ts:137` (`KIR_VOID_HANDLER_NO_CALL_FORM`) | VERIFIED |
| The parity ledger has 7 rows, `LEDGER_SHA256 = c9b14194…`; a ledger row and a `request.ts` `'deferred'` entry are one fact (both directions asserted), and the table is keyed by linked kind | `parity-ledger.json`; `ledger-support.mjs:40`; `staleness.test.mjs:42-57`; `request.ts:25-39` | VERIFIED |
| Both kernel digests are frozen pins | `JAVASCRIPT_KERNEL_SHA256 b53251fd…`, `PYTHON_KERNEL_SHA256 f79a3963…` (`kern-5-e-linked-each-do/pins.mjs:28-29`) | VERIFIED |
| Line counts: `statements.ts` 355 (E budget 380), `link-support.ts` 164, `link.ts` 361, `contracts.ts` 394, `statement-walker.ts` 300 (E budget 300, untouched by F), `statement-source.ts` 345 (untouched by F) | `wc -l` 2026-09-10; `kern-5-e-linked-each-do/pins.mjs:11-18` | VERIFIED |

## What Already Works

`with` is realised by three mechanisms that already exist and are **not** to be touched:

- **The `let` shape.** RT-1 binds with `bindings.set(name, yield* statementValue(...))`
  (`statement-walker.ts:194-195`); JS charges one step and assigns a fresh local
  (`statement-source.ts:161-166`). Both accept an async user-call at statement position via
  `assertAsyncCallPosition(value, scope, label, true)` (`link-support.ts:153-164`).
- **The finally-bearing `try` shape.** RT-1's `TryTrap` frames, `settle()` and the frame-exhaustion
  finally entry (`statement-walker.ts:95,136-152,181-184`); JS's `__ef`/`__r`/`__h` deferred-return
  lowering that runs the cleanup on fallthrough, return and user-throw and skips it on an envelope
  fault (`statement-source.ts:282-319`; D-5d/D-5e/D-7b).
- **The `do` shape.** A statement-position user-call whose result is discarded
  (`statements.ts:69-90`; `statement-source.ts` leaf arm).
- **Immutable bindings.** `bindName` without `assignable.add` is how loop counters and `each` items
  are bound; `assign` names the reason from `eachBindings`/`counters` (`statements.ts:139-146`).
- **`KIR_LOOP_JUMP_CROSSES_TRY`.** `finallyDepth` vs `loopFinallyDepth` (`statements.ts:97-98`);
  `with` increments `finallyDepth` for its body exactly as `compileTry` does (`statements.ts:266`).
- **Sub-block and sub-expression walkers, `containsReturn`, `containsAsyncCall`.** They already walk
  `let`/`try`/`do`, so the expansion is reachable by every consumer with no new arm.
- **JS local allocation.** Every `let` gets a fresh `nextLocal()` and the binding map is per block
  (`statement-source.ts:161-166,196-199`), so two sibling expansions binding the same `N` cannot
  redeclare; RT-1's flat `bindings` map overwrites, which is how the `catch` binding and loop counters
  already behave (`statement-walker.ts:128-131,146`).

## Contract (Verified)

> Verified against the `feat/kern-5-f-with` worktree at `2dd26302` and the live probes above on
> 2026-09-10. Rows tagged **RULING** are decisions this spec makes (tribunal-reviewed); they are
> not source precedent and the oracle pins them as such.

### F-1 Surface: what the linker sees

| # | Claim | Evidence | Tag |
|---|---|---|---|
| F-1a | `propertySet(properties, ['name', 'value'], ['async', 'cleanup', 'protocol', 'trailingComment'], label)`. Anything else is F5's wall (`type=` measured `not-projected`) | Current State rows 4, 6 | VERIFIED |
| F-1b | A `with` node's children are its body; `assertLeaf` must **not** run for it. `compileWith` is dispatched from `compileBlock` beside `each`/`for`/`while`/`try` and **pushes two statements** | `statements.ts:307-340`; D-6a precedent | VERIFIED |
| F-1c | Empty body refuses with the existing message `branch block is empty` — no new label | `statements.ts:185,246`; probe `empty-body` projects | VERIFIED |
| F-1d | `protocol=""` is **treated as absent** (the native normalisation, `body-ts.ts:732`). A non-empty `protocol` (`with`) refuses **`KIR_WITH_PROTOCOL_UNSUPPORTED`** (spent): the linked contract has no context-manager protocol and no linked target could honour one. `protocol=with` **without** `cleanup` refuses PROTOCOL, single cause (checked first) | probes `protocol-with`, `protocol-with-quoted`, `protocol-empty`, `protocol-and-cleanup` all project; `body-ts.ts:732,736-740` | RULING |
| F-1e | `cleanup` absent (with no protocol) refuses **`KIR_WITH_CLEANUP_REQUIRED`** (spent) | probe `no-cleanup` projects; `schema.ts:3907-3912` | RULING (native precedent for the no-protocol case) |
| F-1f | `?` propagation on either expression never reaches the linker, so **`KIR_WITH_PROPAGATION_UNSUPPORTED` stays reserved-not-spent**; the oracle asserts the F5 wall on both fixtures and the label's absence from source | probes `value-propagate`, `cleanup-propagate` `not-projected` | VERIFIED |

### F-2 Expansion

| # | Claim | Evidence | Tag |
|---|---|---|---|
| F-2a | `compileWith(node, scope, meter, label, compileBranch)` returns `readonly [let, try]` where `let = { kind:'let', name:N, value:V' }` and `try = { kind:'try', body, catchBody:[], finallyBody:[{ kind:'do', value:C' }] }`; `compileBlock` spreads both into the block at the `with`'s position. The union stays 14 kinds; `statement-walker.ts`, `kir-js-esm/statement-source.ts`, `kir-python/request.ts` and `contracts.ts` are byte-identical to base | design; tribunal Q1 | RULING |
| F-2b | **Structural twin equality.** The hand-written twin (`let N=V` then `try { body } finally { do C }`) links to a deep-equal linked handler; the oracle asserts `deepEqual` on the linked statements. Every behaviour and metering claim below follows from that equality plus slices D/E | design | RULING |
| F-2c | No `origin` provenance field is added to the expanded nodes in F (no consumer today; queued for the Review lane) | tribunal Q1 (codex/kimi suggestion) | RULING |
| F-2d | The Python leg refuses every `with` fixture with `KIR_PYTHON_LEG_DEFERRED` through the standing `try` and `do` rows; **no ledger row is added**, because a ledger row must be a `request.ts` kind and `with` is none. `with` becomes Python-lowerable the moment D2 lowers `try` and `do` | `staleness.test.mjs:42-57` | VERIFIED |

### F-3 Admission rules and labels

| # | Claim | Evidence | Tag |
|---|---|---|---|
| F-3a | `with` is **entry-only** in F, refused in a helper with the new label **`KIR_WITH_IN_HELPER`** (checked via `scope.tryFamily`, the same bit `try` reads). Not `KIR_TRY_FAMILY_IN_HELPER`: its documented reason is the throw payload channel (D-2h), and splitting a shared label later breaks every golden that references it. Helper admission is queued: the finally-bearing lowering inside helper functions and RT-5 continuation frames has no oracle row today | `link.ts:202`; probe `with-in-helper` projects; tribunal Q3 (2–1–1 for the new label) | RULING |
| F-3b | `value` (acquire) follows the **`let` rule**: any linked expression, async user-call permitted at statement position, async call inside an argument refused with `KIR_ASYNC_CALL_EXPRESSION_POSITION`. **`KIR_WITH_ACQUIRE_UNSUPPORTED` stays reserved-not-spent** and the oracle asserts its absence | `statements.ts:102-116`; `link-support.ts:153-164` | VERIFIED |
| F-3c | `cleanup` follows the **`do` rule** with one label: it must be a `user-call`; a member call, a JSON intrinsic, a literal, an identifier or a binary refuses **`KIR_WITH_CLEANUP_UNSUPPORTED`** (spent), message suffixed with the expression kind. An async cleanup call is permitted (statement position); a void callee refuses with the existing `KIR_VOID_HANDLER_NO_CALL_FORM` | `statements.ts:69-90`; probes `cleanup-member`, `cleanup-json`, `cleanup-lit-text`, `cleanup-async` project | RULING (do precedent) |
| F-3d | **Async flag rule.** Let `A` = `containsAsyncCall(V)`, `B` = `containsAsyncCall(C)`, `flag` = `async === true` (`async=false` ≡ absent). Admit iff `flag === (A \|\| B)`; otherwise refuse the new label **`KIR_WITH_ASYNC_MISMATCH`**. The linked legs derive suspension from the callee and never read the flag; the rule exists so one source cannot mean two things across the native TS codegen (which awaits on the flag, `body-ts.ts:756-761`) and the linked legs. Cost: one comparison at link | `expression.ts:124-140`; tribunal Q2 (2–2; coordinator keeps bidirectional — refuse-on-inconsistency is this repo's discipline, and derive-and-ignore leaves a dead unchecked field) | RULING |
| F-3e | Order of refusals inside `compileWith`, so every negative fixture is single-cause: property set → `KIR_WITH_IN_HELPER` → `KIR_WITH_PROTOCOL_UNSUPPORTED` → `KIR_WITH_CLEANUP_REQUIRED` → duplicate binding → acquire (`let` rule) → cleanup (`do` rule) → `KIR_WITH_ASYNC_MISMATCH` → empty body → body | design | RULING |
| F-3f | New labels minted by F (emitted, never registry members — the D-6i / rt12 precedent): `KIR_WITH_IN_HELPER`, `KIR_WITH_ASYNC_MISMATCH`, `KIR_ASSIGN_TO_WITH_BINDING`. Spent from E's reserve: `KIR_WITH_PROTOCOL_UNSUPPORTED`, `KIR_WITH_CLEANUP_REQUIRED`, `KIR_WITH_CLEANUP_UNSUPPORTED`. Unspent, asserted absent: `KIR_WITH_ACQUIRE_UNSUPPORTED`, `KIR_WITH_PROPAGATION_UNSUPPORTED`. Each spent label has exactly one declaration site, in `statements.ts` | `kern-5-d0-contracts-split/reserved-labels.json` (registry holds only the try family) | VERIFIED (registry) / RULING (sets) |

### F-4 Binding and scope

| # | Claim | Evidence | Tag |
|---|---|---|---|
| F-4a | `N` is bound with `bindName` and **not** added to `assignable`; `LinkScope` gains `withBindings: Set<string>` beside `eachBindings`/`counters` so `assign target=N` refuses **`KIR_ASSIGN_TO_WITH_BINDING N`** (single cause). This closes the "body reassigns the resource, cleanup sees the wrong value" hazard the tribunal raised: reassignment is a link refusal, so no internal alias is needed | `statements.ts:139-146`; `link-support.ts:79-93,105-120`; tribunal Q4 | RULING |
| F-4b | `N` colliding with any enclosing binding (parameter, `let`, counter, each item, another `with`) refuses the existing `duplicate binding N`; a body `let name=N` likewise; a **sibling** `with` reusing `N` after the first has closed is legal | `statements.ts:105`; probes `shadow-let`, `shadow-param` project | VERIFIED (mechanism) |
| F-4c | Scope discipline: `withScope = { ...branchScope(scope), finallyDepth: scope.finallyDepth + 1 }`; `V` is compiled in the **outer** scope (it cannot see `N`: a `value` naming `N` with no outer `N` refuses as undeclared); `N` is then bound into `withScope`; `C` is compiled in `withScope` **before** the body (it sees `N` and every outer binding, never a body `let` — such a reference refuses as undeclared); the body is compiled in `branchScope(withScope)`. After the node nothing it bound is visible (a later read of `N` or of a body `let` refuses as undeclared) | design mirroring `compileTry` (`statements.ts:266-272`) and `compileFor` (`loop-statements.ts:76-82`) | RULING |
| F-4d | The linked `let` produced by the expansion is **not** in `assignable` even though a user `let` would be — mutability is a link-time property of the binding, not of the node kind, and the runtime `let` node has no mutability | `statements.ts:114` (`assignable.add` happens in the `let` arm, which `compileWith` does not call) | VERIFIED |

### F-5 Control flow

| # | Claim | Evidence | Tag |
|---|---|---|---|
| F-5a | `with` is **finally-bearing**: `break`/`continue` in its body that target a loop outside it refuse `KIR_LOOP_JUMP_CROSSES_TRY` (reused); a loop inside the body jumps freely and the cleanup runs exactly once, after the loop | `statements.ts:97-98`; probe `break-in-with-in-for` projects | VERIFIED |
| F-5b | `return` inside the body is admitted; the return value is evaluated before the cleanup, the cleanup runs, then the value leaves, charged once at the return site; through nested finalizers (a `with` inside a `try`/`finally`, nested `with`) the inner cleanup runs first | `statement-walker.ts:136-152`; `statement-source.ts:290-303` | VERIFIED (D mechanism) |
| F-5c | A user `throw` inside the body runs the cleanup, then continues outward: into an enclosing `catch` if one exists, else to the `uncaught-throw` result. Cleanup effects precede the catch body's effects | `settle()` `statement-walker.ts:136-152`; D-7b | VERIFIED |
| F-5d | The cleanup is one `do` inside a finally: it cannot `return`/`break`/`continue`/`throw` (`KIR_ABRUPT_FINALLY_UNSUPPORTED` is unreachable; helpers cannot issue a user throw). A helper **can** raise an envelope fault — that case is F-7c, not a dual fault | E spec `:308-311`; `statements.ts:21,208-223`; tribunal Q5 | VERIFIED |
| F-5e | `with` inside `try`, `catch`, `finally`, `for`, `while`, `each`, `if` and another `with` links; `for`/`while`/`each`/`if`/`throw`/`do`/`print`/`let`/`assign` inside a `with` body link **subject to each construct's own rules** (a `throw` in a `with` inside a `finally` is still `KIR_ABRUPT_FINALLY_UNSUPPORTED`; a `break` in a `with` inside a loop is F-5a). **F5 asymmetry:** `with`'s `allowedChildren` lists `try` but neither `catch` nor `finally`, and not `capability`, so a usable `try` inside a `with` body is unreachable (a bare `try` projects and refuses `KIR_TRY_REQUIRES_CATCH_OR_FINALLY`) and a `capability` inside a `with` body does not project; both are pinned as F5-wall rows, not link labels | catalog `allowedChildren` (`catalog.generated.ts:3223-3252`); oracle probes `wall-try-in-with`, `wall-capability-in-with` | VERIFIED |
| F-5f | `containsReturn` reaches the body through the expanded `try`, so a `return` inside a `with` in a void handler still refuses `KIR_VOID_HANDLER_VALUE_RETURN` | D-4c | VERIFIED |

### F-6 Metering

`with` charges exactly what its twin charges because it **is** its twin after link (F-2b):
let boundary + `V` + try boundary + entered body + body + finally entered + do boundary + `C`; a
return through the cleanup is charged once at the return site; a throw through the cleanup pays the
throw boundary, the settle step and the finally entry (D-5a).

**QF-1 (rule).** Every metering row is the **difference against the twin measured in the same run**,
asserted equal on RT-1 **and** at the exact step-exhaustion threshold on the JS leg (succeeds at
RT-1's count, fails one below), **per exit path**: fallthrough, return, break from an inner loop,
caught throw, uncaught throw, nested `with`, async acquire, async cleanup.

**QF-2.** ZERO new `checkAbort()` sites anywhere: `statement-walker.ts` stays at its pinned 2 and
`kir-runtime/expression.ts` at 0 — trivially, both files are byte-identical to base.

### F-7 Faults and precedence

| # | Claim | Evidence | Tag |
|---|---|---|---|
| F-7a | **Acquisition failure** = an envelope fault while evaluating `V`. The binding is never made and the cleanup **does not run**, because the `let` precedes the `try` in the expansion | expansion order; `statement-walker.ts` `let` arm | VERIFIED |
| F-7b | **Envelope fault inside the body** (`runtime-limit-exceeded`, `execution-cancelled`, `execution-timeout`) skips the cleanup — D-5d/D-5e verbatim | D-5d, D-5e | VERIFIED |
| F-7c | **Cleanup failure** = an envelope fault inside `C`, after fallthrough, after a `return`, after a caught throw or after an uncaught throw. The fault wins and the pending completion is discarded; no success, no `uncaught-throw`. Python's exception chaining (`__context__`) is not a parity observable and is out of scope with the Python leg | `statement-walker.ts` (fault leaves the generator); `statement-source.ts:317-319` | VERIFIED |

## Implementation Options

**Chosen: link-time expansion (slice E's recorded design), no new linked kind.** Tribunal 3–1.

- *First-class `with` linked kind realised per leg.* Rejected: the only argument for it (a ledger row
  needs a kind) is circular — the ledger audits kinds, it does not dictate them — and it would
  hand-synthesise the try/finally step charges in the RT-1 walker, on exactly the abrupt-exit paths
  with the least golden coverage. Expansion makes the equality structural and leaves both legs and
  the Python table byte-identical.
- *Expansion with an unspellable internal binding.* Not needed: the body cannot reassign `N`
  (F-4a), so the cleanup always sees the acquired value; the sibling-reuse case is handled by
  per-block JS locals and the flat RT-1 map.
- *Expansion with an `origin: 'with'` provenance tag.* Queued (F-2c); no consumer in F.
- *Reuse `KIR_TRY_FAMILY_IN_HELPER` / admit helpers now.* Rejected (F-3a).
- *Derive asyncness and ignore the flag.* Rejected (F-3d).

## Oracle Inventory (planned; measured after landing)

| File | Owns |
|---|---|
| `probe-matrix.test.mjs` (+ `probe-matrix.json`, `measure-probe-matrix.mjs`) | every fixture's F5 status pinned; leg parity against the pinned row |
| `compatibility.test.mjs` | kernel pins; F5 untouched; `statement-walker.ts`, `statement-source.ts`, `kir-python/{request,emitter}.ts` byte-identical to base; line budgets; no new `packages/core/src` module; `STILL_OUTSIDE` (`set` only); E's byte-identity corpus still emits identical artifacts |
| `expansion.test.mjs` | the union is still 14 kinds; the linked shape of a `with` (let + try/finally[do], no `with` kind); twin deep-equality (F-2b); QF-2 pins |
| `type-gate.test.mjs` | every refusal in F-1/F-3/F-4/F-5 as a single-cause row; the admitted set; the F5-wall rows |
| `behavior.test.mjs` (+ `behavior-table.json`) | two-leg byte-equality rows for every F1 behaviour bullet |
| `metering.test.mjs` | QF-1 per-exit-path twin rows on RT-1 and JS thresholds |
| `fault.test.mjs` | F-7a/F-7b/F-7c rows on both legs |
| `python-deferral.test.mjs` | ledger unchanged (7 rows, no `with`), `request.ts` has no `with` key, every fixture refuses `KIR_PYTHON_LEG_DEFERRED` |
| `reserved-labels.test.mjs` | spent/new/unspent label sets, one declaration site each (F-3f) |
| `commit-rows.test.mjs` (+ `commit-rows.json`) | commit mapping total and disjoint; leaf/aggregate/tier-contract wiring |

## Commit Plan

| Commit | Content |
|---|---|
| F.0 | spec + RED oracle; leaf wired into the family and the tier contract (RED by design until F1 lands) |
| F1 | `compileWith` in `statements.ts` (dispatch in `compileBlock`, labels, `KIR_ASSIGN_TO_WITH_BINDING` in the assign reason chain); `withBindings` on `LinkScope` (`link-support.ts`, seeded in `link.ts`) |
| F2 | pins: E's `reserved-labels` "no `KIR_WITH_`" rows retired in favour of F's; E's `LINE_BUDGETS` for `statements.ts` raised to 430; canonicalizer `compiledCoreDigest` re-measured; spec flips to IMPLEMENTED with the Corrections Log |

**QF-3 (budget).** No new `packages/core/src` module. Every hand-written file stays under **450**
lines after every commit; budgets pinned in `scripts/kern-5-f-linked-with/pins.mjs`.

**QF-4 (net LOC).** ≤ 90 net hand-written production lines: `compileWith` ≤ 70, scope plumbing ≤ 20.

**QF-5 (mutants).** ≥ 12 non-equivalent mutants: cleanup compiled in the body scope; value compiled
in the with-scope; binding added to `assignable`; `finallyDepth` not incremented; expansion order
swapped (try before let); cleanup placed in `catchBody` instead of `finallyBody`; cleanup emitted as
a bare expression statement instead of `do`; async flag ignored; protocol accepted; helper accepted;
empty body accepted; duplicate binding accepted.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `kir-runtime/linked-kir-program/statements.ts` | edit | `compileWith`; `with` dispatch in `compileBlock`; `KIR_ASSIGN_TO_WITH_BINDING` in the assign reason chain |
| `kir-runtime/linked-kir-program/link-support.ts` | edit | `withBindings` on `LinkScope` + `branchScope` |
| `kir-runtime/linked-kir-program/link.ts` | edit | seed `withBindings` |
| `contracts.ts`, `statement-walker.ts`, `kir-js-esm/*`, `kir-python/*`, `schema.ts`, `catalog.generated.ts`, `kir-structural/*` | **untouched** | byte-identical to base; both kernel SHAs; F5 frozen |
| `scripts/kern-5-parity-ledger/*` | **untouched** | no row, no kind |
| `scripts/kern-5-e-linked-each-do/{pins,reserved-labels.test}.mjs` | edit | prior-slice pins moved (F2) |
| `scripts/kern-canonicalizer/{coverage-summary.json,coverage-prerequisite-summary.json,coverage-prerequisite.test.mjs}` | edit | `compiledCoreDigest` re-measured |
| `package.json`, `scripts/ci/test-tier-contract.test.mjs` | edit | leaf + family + tier wiring |

## Acceptance Criteria

Binary; each becomes an oracle row.

**F1 — `with`**
- [ ] `with name=r value="bump(1)" cleanup="bump(r)"` links, runs on RT-1 and on the emitted JS leg, and both envelopes agree byte for byte; `r` is readable in the body and in the cleanup with the acquire's static type.
- [ ] The linked handler contains no `with` kind and deep-equals the hand-written twin's linked handler.
- [ ] Cleanup runs after the body on fallthrough, after a `return` in the body (value evaluated before, delivered after, charged once), after a user `throw` in the body (before the enclosing `catch` body's effects; before the `uncaught-throw` result when uncaught), inner-then-outer for nested `with`, and inner-then-outer through a `with` inside a `try`/`finally`.
- [ ] `break`/`continue` inside a loop inside the body run the cleanup exactly once, after the loop; `break`/`continue` targeting an outer loop refuse `KIR_LOOP_JUMP_CROSSES_TRY`.
- [ ] An async acquire and an async cleanup (each alone, with `async=true`) link and both legs agree; an async call inside an acquire argument refuses `KIR_ASYNC_CALL_EXPRESSION_POSITION`.
- [ ] `async=true` with sync acquire and cleanup, `async` absent with an async acquire, and `async` absent with an async cleanup each refuse `KIR_WITH_ASYNC_MISMATCH`, single cause; `async=false` behaves as absent.
- [ ] `protocol=with` (with or without cleanup) refuses `KIR_WITH_PROTOCOL_UNSUPPORTED`; `protocol=""` links and both legs agree with the omitted twin.
- [ ] Missing `cleanup` refuses `KIR_WITH_CLEANUP_REQUIRED`.
- [ ] `cleanup` as member call, JSON intrinsic, literal, identifier and binary each refuse `KIR_WITH_CLEANUP_UNSUPPORTED`; a void callee refuses `KIR_VOID_HANDLER_NO_CALL_FORM`.
- [ ] `assign target=r` refuses `KIR_ASSIGN_TO_WITH_BINDING r`; `name=` equal to a parameter, an enclosing `let`, a counter or an enclosing `with` binding, and a body `let name=r`, each refuse `duplicate binding`; a sibling `with` reusing the name links and both legs agree.
- [ ] `value` naming its own binding, `cleanup` naming a body `let`, and a read of `r` or of a body `let` after the block each refuse as undeclared.
- [ ] `with` in a helper refuses `KIR_WITH_IN_HELPER` and the message does not spell `KIR_TRY_FAMILY_IN_HELPER`.
- [ ] Empty body refuses `branch block is empty`.
- [ ] `with` inside `try`/`catch`/`finally`/`for`/`while`/`each`/`if` links and runs; `for`/`while`/`each`/`if`/`do`/`print` inside a `with` body link and run; a clause-bearing `try` and a `capability` inside a `with` body stay not projected (F-5e).
- [ ] `value="bump(1)?"` and `cleanup="bump(r)?"` stay not projected; `KIR_WITH_PROPAGATION_UNSUPPORTED` and `KIR_WITH_ACQUIRE_UNSUPPORTED` appear in no source file.
- [ ] QF-1 per exit path.
- [ ] F-7: cleanup effects absent after an acquire fault and after a body fault; a fault inside the cleanup after fallthrough / return / caught throw / uncaught throw yields the fault result on both legs.
- [ ] Every `with` fixture refuses on the Python leg with `KIR_PYTHON_LEG_DEFERRED`; the ledger and `request.ts` are unchanged.

**F2 — pins**
- [ ] The linked statement union is still exactly 14 kinds; E's union, ledger-count and exhaustiveness pins are untouched and green.
- [ ] `TARGET_KERNEL_SHA256` equals the frozen pin on both legs; `kir-python/emitter.ts`, `kir-python/request.ts`, `statement-walker.ts`, `statement-source.ts`, `contracts.ts` have an empty diff against base; every E corpus program emits a byte-identical artifact vs base.
- [ ] Every file in `LINE_BUDGETS` is at or under its budget and under 450; no new `packages/core/src` module.

## Out of Scope

`with` in helpers; `protocol=with`; `?` propagation; the Python lowering (arrives with D2's `try`/`do`);
provenance tagging of expanded nodes; any F5 edit; any kernel or leg edit; the legacy TypeScript /
Python codegens.

## Queued

| Item | Blocked on |
|---|---|
| `with` in helpers | finally-bearing lowering proven inside helper functions + RT-5 continuation frames |
| `origin: 'with'` provenance on expanded nodes | a Review-lane consumer |
| Python catch-up batch D2 | `throw`, `try`, `break`, `continue`, `while`, `do`, `each` rows (`with` follows `try`+`do`) |

## Open Questions

- **OQ-F1 — CLOSED by probe.** `protocol` projects (both spellings and `""`).
- **OQ-F2 — CLOSED by probe.** A `with` without `cleanup` projects, so the label is spent.
- **OQ-F3 — CLOSED by probe.** `?` never reaches the linker.
- **OQ-F4 — CLOSED by tribunal (2–2) + coordinator ruling.** Bidirectional async-flag refusal (F-3d).
- **OQ-F5 — CLOSED by tribunal (2–1–1).** Entry-only with `KIR_WITH_IN_HELPER` (F-3a).
- **OQ-F6 — CLOSED by tribunal (3–1).** Link-time expansion, not a first-class kind (F-2).

## Deploy Order

1. Edit `packages/core/src` (three linker files only).
2. `pnpm --filter @kernlang/core build` — tsc clean before any digest is measured.
3. Move E's pins (reserved-labels rows, `LINE_BUDGETS`).
4. `pnpm write:kern-canonicalizer-coverage`, hand re-pin `compiledCoreDigest` in
   `coverage-prerequisite.test.mjs`, run the write **again** (the two steps do not commute).
5. Local gate:

```
pnpm --filter @kernlang/core build && pnpm lint \
  && pnpm test:kern-5-f-linked-with \
  && pnpm test:kern-5-e-linked-each-do && pnpm test:kern-5-d-linked-try \
  && pnpm test:kern-5-d0-contracts-split && pnpm test:kern-5-rt12-linked-jumps \
  && pnpm test:kern-5-rt11-linked-while && pnpm test:kern-5-rt10-for \
  && pnpm test:kern-5-parity-ledger && pnpm test:kern-canonicalizer
```

`pnpm test:infra` runs separately and alone.

## Corrections Log

### Tribunal (2026-09-10, `tribunal-1789044317238-hm8v4l`)

| Finding | Disposition |
|---|---|
| Q1: the ledger argument for a first-class kind is circular; expansion makes metering equality structural (codex, agy, kimi) | **Accepted.** Design switched to link-time expansion; union stays 14; no ledger row (F-2). The goal statement's "KIR_PYTHON deferred row added" is satisfied in substance — every `with` fixture refuses on Python with the deferral label — and cannot be satisfied literally without a kind. |
| Q2: derive-and-ignore the async flag (codex, agy) vs bidirectional (claude, kimi) | **Rejected.** Bidirectional kept (F-3d): refuse-on-inconsistency, one comparison, no dead field. |
| Q3: reuse `KIR_TRY_FAMILY_IN_HELPER` (agy) / admit helpers now (codex) | **Rejected.** New `KIR_WITH_IN_HELPER`, entry-only (F-3a); helper admission queued with its blocker named. |
| Q4: body reassignment of `N` corrupts the cleanup (agy, kimi) — needs an internal alias | **Moot by construction:** `assign` to `N` is a link refusal (F-4a); a body `let N` is a duplicate binding. Rows added for both. |
| Q4: scope rows — value cannot see own binding, cleanup cannot see body `let`, body `let` does not leak, sibling reuse | **Accepted** as refusal/behaviour rows (F-4c, acceptance). |
| Q4: per-exit-path metering, not aggregate; fault-in-cleanup over fallthrough/return/caught/uncaught | **Accepted** (QF-1, F-7c). |
| Q4: "empty body still runs cleanup" (kimi) | **Rejected.** Empty body is a link refusal (F-1c), the `try` precedent. |
| Q4: truthy-returning cleanup suppresses (Python) | **Not applicable** — Python leg deferred; the cleanup is a `do`, its value discarded on the linked legs. |
| Q5: F-1d wrong — native normalises `protocol=""` (codex, agy, kimi) | **Accepted.** `protocol=""` ≡ absent; admitted row added. |
| Q5: F-1e overstated — native requires cleanup only without protocol | **Accepted.** Retagged; `protocol=with` without cleanup refuses PROTOCOL first. |
| Q5: F-3a not proved by `tryFamily: requireExport`; F-2a/F-3e/F-4c/F-8b are design | **Accepted.** Retagged RULING. |
| Q5: F-5d contradicted by envelope faults in helpers | **Accepted.** Reworded; envelope fault in cleanup is F-7c. |
| Q5: F-5e overclaims unconditional admission | **Accepted.** "Subject to each construct's own rules." |
| agy: "spec emits native JS `with`" / "walker visits cleanup as a statement" | **Rejected** — not in the spec. |

### Corrections found while implementing (2026-09-10)

| Finding | Disposition |
|---|---|
| `propertyText` refuses empty text (`inspect.ts:149` `requiredText`), so `protocol=""` faulted as malformed instead of being treated as absent (F-1d). Caught by `python-deferral` row 3 | **Fixed:** the protocol is read off the raw record with `plainRecord`; empty text is absent, any other text refuses PROTOCOL |
| The expanded `do` pays a link step in the twin (`compileStatement`) that `compileWith` did not charge; every twin row agreed on execution steps and disagreed on link steps by exactly one per expansion | **Fixed:** one `meter.step()` where the `do` is materialised. Runtime metering matched the twin on every exit path from the first build (QF-1's actual claim) |
| Oracle: the twin byte comparison included the envelope `requestId`, which embeds the fixture name | **Oracle fixed:** the pair shares one request id |
| Oracle: `with-value-visible` pinned `['acquired','acquired','acquired']`, dropping the body's own marker | **Oracle fixed:** re-derived from a measured run, `['acquired','body','acquired']`, first/last equality asserted |
| Oracle: the four cleanup-fault rows assumed completion−1 starves the cleanup; the last step buys the trailing `return`, and the hand-written twin behaves identically | **Oracle fixed:** measured starvation point (smallest budget at which the cleanup marker appears, minus one), asserted on both legs and against the twin |
| Oracle: `try` with `catch`/`finally` and `capability` inside a `with` body do not project (F5 `allowedChildren`) | **Spec corrected** (F-5e); pinned as wall rows |
| `statements.ts` lands at exactly 430/430 lines; the next slice touching it must extract first | recorded; QF-3 holds |

## Confidence

0.92. Both residuals from the pre-build estimate resolved: the oracle measured 134 RED at base for
its own labels, and the return-through-nested-finalizers and nested-`with` rows executed the deferred-
return lowering through two finalizers on both legs, byte-identical to the twin. What remains is the
independent review and the mutation pass.
