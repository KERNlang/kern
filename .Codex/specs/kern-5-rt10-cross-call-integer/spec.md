# KERN 5 RT-10-X: integer cross-calls for linked helpers

**Status:** IMPLEMENTED (production diff landed, RT-10-X 94/94, the whole prior gate green at
the declared counts; 10/11 mutants killed, the one survivor a substring-prefix label mutant that
no `includes`-based assertion can kill — see *Implementation* and the Corrections Log)
**Date:** 2026-09-03
**Base:** `cb42f14e` — `feat/kern-5-rt10-pre-linked-arithmetic` (RT-10-pre, itself stacked on
RT-9 `29feebaf` / `06b74443`). **This slice stacks on RT-10-pre and its PR waits for RT-10-pre
to merge** (RT10X-O1).
**Branch:** `feat/kern-5-rt10-cross-call-integer`
**Supersedes:** `[RT10P-C14]` (integer cross-calls deferred) and `[RT10P-O6]` (the
async-position label is unreachable for arithmetic) in
`.Codex/specs/kern-5-rt10-pre-linked-arithmetic/spec.md`.
**Prerequisite for:** the queued rt10 `for` loop slice, whose contract is restated verbatim at
the end of this document so it is inherited rather than re-litigated.
**Confidence:** 0.93 for the contract below; 0.95 for the RED oracle's attributability, which is
measured — every base row and every post-slice row in this document was executed, the post-slice
rows against a throwaway shadow implementation in `packages/core/dist` (gitignored, restored
afterwards) rather than predicted from the spec text.

---

## Executive Summary

RT-8 made `integer` an exact alias of the `number` signature spelling at F5, and RT-10-pre
admitted integer arithmetic into the linked lane. Between them sits one closed table that
neither slice was allowed to touch: `LINKED_KIR_CROSS_CALL_TYPES`
(`kir-runtime/linked-kir-program/contracts.ts:125-130`) admits `boolean`, `text`,
`list<boolean>` and `list<text>` and nothing else, so an integer-typed helper —
`fn … returns=integer`, `param … type=integer` — is refused at *every* call site with
`KIR_CALL_SIGNATURE_TYPE`. A `for` body therefore cannot call a helper to accumulate, and
arithmetic cannot consume a helper's result: `hi() + 1` and `idp(n)` are both link failures on
all three legs today.

RT-10-X adds exactly one row — `integer` — to that table, and makes the two type resolvers that
feed it read their operator tables instead of hard-coding `'boolean'`. Exact-integer values
cross the boundary as the tagged canonical decimal strings they already are, on RT-1, the
emitted JavaScript over `BigInt`, and the emitted Python over `int`. Nothing on the runtime side
changes: `matchesType` (`kir-runtime/expression.ts:68-71`), `__matches`
(`kir-js-esm/target-execution.ts:43-46`) and `_matches` (`kir-python/target-execution.ts:3-6`)
already compare a value's tag against the type record's `kind`, and `typeSource` in both
emitters already serializes `{kind:'integer'}` from the same generic branch. **The target
kernel does not change, so no emitted-artifact digest moves** — the first slice in this ladder
since RT-9 for which that is true, and the oracle asserts it rather than assuming it.

Three findings during design changed the shape of the slice:

1. **`list<integer>` is not free and is not admitted** (RT10X-C3). The contract's `element`
   field is typed `'boolean' | 'text' | undefined`, and admitting a third element widens the
   argument gate for list literals as well as signatures. It is DECIDED out, with its two
   fail-closed rows kept as fences.
2. **The unary and binary cross-call answers must move together with the literal answer**
   (RT10X-C5). Admitting `integer` for a signature while leaving `crossCallExpressionType`
   answering `undefined` for a unary node turns RT-10-pre's *passing* `assign-neg` row into a
   `KIR_ASSIGN_TYPE_MISMATCH`: the binding `let n = 5` would record `integer` and the value
   `-n` would record nothing.
3. **RT-9's assign gate loses its static half's discriminating power** (RT10X-C6). After this
   slice `staticExpressionType` is a function of `crossCallExpressionType`, so the two-table
   assign gate has one table doing all the work and RT-9's own "the static half separates
   these" row becomes a passing but vacuous discriminator. Recorded, not hidden; the static
   table keeps its exclusive readers (the operand gate and the `if` condition gate) and the
   oracle pins those.

The frontend does not move: no `.kern`, no F5 policy, no amendment record, no census change.

---

## Current State / Root Cause

- **VERIFIED:** `LINKED_KIR_CROSS_CALL_TYPES` at
  `packages/core/src/kir-runtime/linked-kir-program/contracts.ts:125-130` has four rows —
  `boolean`, `list<boolean>`, `list<text>`, `text` — and no integer row.
  `LINKED_KIR_CROSS_CALL_TYPE_NAMES` (`:132-134`) is `Object.keys(...).sort()` and
  `linkedKirCrossCallType` (`:136-142`) resolves a `LinkedKernKirParameterType` by matching
  `kind` and `element` against that table, answering `undefined` for anything absent.
- **VERIFIED:** `compileUserCall` (`linked-kir-program/expression.ts:145-165`) refuses a callee
  whose return type has no cross-call row at `:156` and a parameter without one at `:159`, both
  with `KIR_CALL_SIGNATURE_TYPE` under the closed wire code `handler-entry-unsupported`.
- **VERIFIED:** `staticExpressionType`'s user-call arm (`expression.ts:77-79`) answers
  `'boolean'` when the callee returns boolean and `undefined` otherwise, so an integer-returning
  helper has no static type even in the hypothetical where its call links.
- **VERIFIED:** `crossCallExpressionType` (`expression.ts:86-109`) answers `'boolean'` for a
  binary whose `resultType` is boolean and `undefined` otherwise, `undefined` for every unary,
  and — for a literal — `'boolean'` or `'text'` only. RT-10-pre's `[RT10P-C8]` records that the
  `undefined` answers were correct *because the table had no integer row*.
- **VERIFIED (RED, base `cb42f14e`, measured 2026-09-03 over 32 fixtures):** every integer
  cross-call position projects at F5 and is then refused by RT-1, the JavaScript compiler and
  the Python compiler with `handler-entry-unsupported`, and the linker's fault message is
  `KIR_CALL_SIGNATURE_TYPE` in every one of the 29 RED rows. The inventory and the three rows
  that are GREEN at base are in *RED evidence*.
- **VERIFIED:** the runtime needs no change. `matchesType` compares `value.tag === type.kind`
  for a scalar (`kir-runtime/expression.ts:68-71`); `calleeBindings` (`:128-141`) raises
  `KIR_CALL_ARGUMENT_TAG` on a mismatched argument tag and `HELPER_WALK_POLICY` (`:58-62`)
  raises `KIR_CALL_RETURN_TAG` on a mismatched return tag. Both are already exercised for
  `integer` by RT-8's fractional-refusal leg.
- **VERIFIED:** neither emitter needs a per-type branch. `typeSource`
  (`kir-js-esm/emitter.ts:159-163`, `kir-python/emitter.ts:148-152`) emits
  `{kind:'<kind>'}` for every non-list type and `{kind:'list',element:'<element>'}` for a list,
  and the kernels' `__matches` / `_matches` are tag-generic.

Root cause: one closed cross-call table with no integer row, plus two type resolvers that
hard-coded `'boolean'` where the table now answers.

---

## What Already Works

- **F5 needs no change** (RT10X-C1). Every integer signature, every integer argument shape, the
  async integer helper, the arithmetic-on-a-call-result shape and the accumulator shape all
  project cleanly today.
- **The runtime tag guards need no change.** See *Current State*.
- **Both emitters need no change** beyond nothing at all: `typeSource` and the kernels are
  type-generic, which is why `TARGET_KERNEL_SHA256` is unmoved on both legs (RT10X-C10).
- **The three linked expression walkers need no change.** This slice adds no
  `LinkedKernKirExpression` variant, so `containsAsyncCall`,
  `expressionInvokesCapability` and `expressionCallDepth` — and RT-10-pre's `never` tripwires in
  all three — are untouched, and the RT-3 K0 golden's `linkedExpressionKinds` inventory does not
  move (RT10X-C11).
- **RT-4's call machinery needs no change.** Arity, recursion rejection, the depth policy, the
  capability closure, the helper record and the `helpers` field are all type-blind.

---

## Contract

### [RT10X-C1 VERIFIED] How F5 projects an integer signature after RT-8

Verified 2026-09-03 by `runProjection([{moduleId:'route.kern', source}])` from
`scripts/kern-frontend-f5-projection/worker.mjs`, decoded with
`decodeModuleKir(bytes, policy.canonicalLimits)`.

| Source | Projected type record |
| --- | --- |
| `param name=a type=integer` | `{"kind":"integer"}` |
| `param name=a type=number` | `{"kind":"integer"}` — byte-identical to the `integer` twin |
| `fn … returns=integer` | `returns: {"kind":"integer"}` |
| `fn … returns=number` | `returns: {"kind":"integer"}` |
| `param name=xs type="integer[]"` | `{"element":"integer","kind":"list"}` |
| `fn … returns="integer[]"` | `returns: {"element":"integer","kind":"list"}` |

So the spelling dies at F5 exactly as `[RT8-R1]` ruled, and the linker sees one kind. Both
spellings therefore reach the same cross-call row, and the oracle carries the `number`-spelled
twin of an admitted integer call as a three-leg row rather than trusting the alias.

### [RT10X-C2 DECIDED] One new row: `integer`, and nothing else

```ts
export type LinkedKernKirCrossCallType = 'boolean' | 'integer' | 'list<boolean>' | 'list<text>' | 'text';

export const LINKED_KIR_CROSS_CALL_TYPES = Object.freeze({
  boolean: { element: undefined, kind: 'boolean' },
  integer: { element: undefined, kind: 'integer' },
  'list<boolean>': { element: 'boolean', kind: 'list' },
  'list<text>': { element: 'text', kind: 'list' },
  text: { element: undefined, kind: 'text' },
}) satisfies Record<LinkedKernKirCrossCallType, LinkedKernKirCrossCallTypeContract>;
```

`satisfies` keeps the union and the table in lockstep exactly as RT-4 established: widening the
union without adding a row is a `tsc` error, and adding a row without widening the union is one
too. `LINKED_KIR_CROSS_CALL_TYPE_NAMES` becomes
`['boolean','integer','list<boolean>','list<text>','text']`; the list is only ever consumed by
`linkedKirCrossCallType`'s `find`, whose predicate matches on `kind` **and** `element` and can
match at most one row, so the ordering is not load-bearing and the sort is presentational.

`LinkedKernKirCrossCallTypeContract.element` is **not** widened (RT10X-C3), so the interface is
byte-unchanged.

### [RT10X-C3 DECIDED] `list<integer>` is NOT admitted in this slice, and the reason is not tidiness

RT-4/RT-5 list plumbing does **not** make it free. Three costs, none of which the accumulator
needs:

1. `LinkedKernKirCrossCallTypeContract.element` is `'boolean' | 'text' | undefined`
   (`contracts.ts:120-123`). A `list<integer>` row widens an exported interface, which is a
   second exported-contract move in a slice that already moves the type union.
2. `crossCallExpressionType`'s list arm (`expression.ts:99-104`) hard-codes
   `element !== 'boolean' && element !== 'text'`. Once `integer` is an element, an integer list
   *literal* becomes an admissible argument, which is a new argument-shape gate — homogeneity,
   emptiness, and the interaction with `meter.collection` — none of which the `for` slice reads.
3. It has no consumer. The queued `for` contract accumulates a scalar `integer`; no deferred
   slice in the ladder names an integer list crossing a call boundary.

Kept as **fail-closed fences with their exact label**, both GREEN at base and required to stay
green: an `integer[]` parameter and an `integer[]` return are each refused with
`KIR_CALL_SIGNATURE_TYPE`. The parameter fence deliberately pairs an `integer[]` parameter with
a **boolean** return, so the refusal is attributable to the parameter rather than being masked
by the return-type check that runs first at `expression.ts:156`.

A later slice that admits `list<integer>` owns the element widening, the list-literal argument
gate and the homogeneity rows, and inherits these two fences as its RED.

### [RT10X-C4 DECIDED] `staticExpressionType`'s user-call arm answers the callee's return kind

```ts
if (expression.kind === 'user-call') {
  const kind = scope.calls?.linked.get(expression.handlerName)?.returnType.kind;
  return kind === 'boolean' || kind === 'integer' ? kind : undefined;
}
```

`LinkedKernKirStaticType` is exactly `'boolean' | 'integer'`, so the closed form is the honest
one, mirroring what `[RT10P-C6]` did for the parameter binding at `link.ts:479-484`. Without
this arm the slice admits `idp(1)` and still refuses `idp(1) + 1`, `-idp(1)`, `idp(1) > 2` and
`assign n = idp(1)` — the M17 defect class, a fail-closed refusal of a legal program.

**Builder must not** hard-code `'integer'` here for any call: a `text`-returning or
`list<boolean>`-returning helper must keep answering `undefined` statically, which is what keeps
`t()` out of the RT-3 operand gate.

### [RT10X-C5 DECIDED] `crossCallExpressionType` becomes fully table-driven

Three arms move together. Splitting them is the defect this clause exists to prevent.

```ts
if (expression.kind === 'binary') return LINKED_KIR_BINARY_OPERATORS[expression.op].resultType;
if (expression.kind === 'unary') return LINKED_KIR_UNARY_OPERATORS[expression.op].resultType;
…
if (expression.value.tag === 'integer' && CANONICAL_INTEGER.test(expression.value.value)) return 'integer';
```

- **Binary and unary.** `[RT10P-C8]` wrote `resultType === 'boolean' ? 'boolean' : undefined`
  and recorded that `undefined` was correct *only* because the table had no integer row. With
  the row present, the honest answer is the table's, and the two static/cross answers coincide
  for every operator. This is what admits `idp(1 + 2)` and `idp(-1)`.
- **The integer literal**, guarded by the same `CANONICAL_INTEGER` regex
  (`expression.ts:17`) that `staticExpressionType` uses, so the two tables cannot disagree on a
  literal. F5 never projects a non-canonical integer literal (`007` is
  `FRONTEND_INVALID_EXPRESSION`, pinned by RT-3 and RT-10-pre), so the guard is defense in
  depth — and it is the guard that keeps a hypothetical `-0`-spelled payload out of an integer
  parameter.
- **The list arm** stops hard-coding its element set and asks the table instead:
  `if (element === undefined) return undefined;` followed by the existing homogeneity check and
  `linkedKirCrossCallType({ kind: 'list', element })`. With no `list<integer>` row that still
  answers `undefined` for `[1, 2]`, so behaviour is unchanged and the *reason* moves from a
  literal list of two element names into the table. This is the edit that makes RT10X-C3
  reversible by one row rather than by a second code change.

**Why all three at once.** RT-10-pre's `assign-neg` fixture (`let n = 5` / `assign n = -n`) is
GREEN today because both halves of the RT-9 assign gate answer `undefined`/`undefined` for the
unary and `integer`/`undefined` for the binding. Adding the signature row alone makes the
binding record `integer` on the cross-call side while `-n` still records nothing, and RT-9's
gate at `link.ts:366-371` then raises `KIR_ASSIGN_TYPE_MISMATCH` on a program RT-10-pre pinned
as admitted. Measured under the shadow implementation with all three arms moved:
`assign-arith`, `assign-neg` and `assign-arith-params` stay admitted and keep their frozen
values.

### [RT10X-C6 DECIDED] The static table becomes a function of the cross-call table — the finding

After this slice, for every linked expression:

| `crossCallExpressionType` | `staticExpressionType` |
| --- | --- |
| `'boolean'` | `'boolean'` |
| `'integer'` | `'integer'` |
| `'text'`, `'list<boolean>'`, `'list<text>'` | `undefined` |
| `undefined` | `undefined` |

The mapping is total and holds arm by arm: both read the same operator tables for a binary and a
unary, the same `CANONICAL_INTEGER` guard for a literal, the same `returnType.kind` for a
user-call, and — for an identifier — `scope.types` and `scope.crossCallTypes`, which `bindName`
(`link.ts:194-205`) always writes from one source in one call.

**Consequence, recorded rather than papered over.** RT-9's assign gate reads both tables
(`link.ts:366-371`). Since the static answer is now derivable from the cross-call answer, the
static half of *that* gate can no longer refuse anything the cross-call half admits, and RT-9's
row `the static half of the gate separates the two assigns into one integer binding` keeps
passing while no longer killing the mutant it was written for: at base its fixture
`let n = 1` / `assign n = [1, 2]` reads `integer`/`undefined` statically and
`undefined`/`undefined` across the call boundary, so only the static half fired; after this
slice the binding records `integer` on both sides and both halves fire. Verified under the
shadow: RT-9's type-gate suite is 18/18 refusal rows plus every discrimination row still green,
so nothing in RT-9 breaks — its evidence weakens, it does not fail.

Three things follow, and all three are pinned by this slice's oracle:

1. The static table keeps two **exclusive** readers — the RT-3 operand gate
   (`expression.ts:296-304`, `KIR_BINARY_OPERAND_TYPE`), the RT-10-pre unary operand gate
   (`KIR_UNARY_OPERAND_TYPE`) and the `if` condition gate (`link.ts:410-411`,
   `KIR_IF_COND_NOT_BOOLEAN`) — none of which consults the cross-call table. `hi() > 2` admitted
   and `if cond="hi()"` refused, in the same suite, is what proves the static answer is
   `integer` and not `boolean`.
2. The cross-call table keeps its exclusive reader, the call-argument gate
   (`expression.ts:161`, `KIR_CALL_ARGUMENT_TYPE`), which the static table never reaches:
   `hb(1)` and `label(1)` must be refused for the argument's *type*, not admitted and then
   faulted at run time with `KIR_CALL_ARGUMENT_TAG`. Both are GREEN at base and stay green,
   which makes them fences on the M02 defect class RT-9 and RT-10-pre both pinned.
3. **Do not delete the static half of the assign gate.** It is defense in depth against a future
   arm that breaks the mapping — the first type that is statically meaningful and not
   cross-callable, or the reverse, restores its discriminating power immediately. Deleting it is
   forbidden by *Builder must NOT*, and the redundancy is recorded here so the next reviewer sees
   a ruling rather than dead code.

### [RT10X-C7 DECIDED] Values cross as tagged canonical decimal strings, never as host numbers

No leg constructs a host number for a cross-call integer, and nothing in this slice makes one
possible:

| Leg | Mechanism | Evidence |
| --- | --- | --- |
| RT-1 | the argument is the `KernKirValue` the request or the previous expression already held; `calleeBindings` binds it by reference after `matchesType` | `kir-runtime/expression.ts:128-141` |
| emitted JavaScript | the helper receives the frozen `{tag:'integer',value:'…'}` object; only `__intOperand` ever lifts it, into `BigInt` | `kir-js-esm/target-execution.ts:97-100` |
| emitted Python | the same dict; only `_int_operand` ever lifts it, into `int` | `kir-python/target-execution.ts:107-110` |

The gating row is `9223372036854775807` passed through an identity helper and returned
unchanged, plus `9007199254740993` passed through a `+ 1` helper answering
`9007199254740994`, plus the negative twin `-9007199254740993`. All three are frozen constants
cross-checked with `node` `BigInt` and `python3` `int`, and asserted three-leg byte-identical —
a host double on any leg loses the low bit and every one of the three separates on it.

The `maxStringBytes` bound RT-10-pre added (`[RT10P-C15]`) is unaffected: an argument reaches a
callee only as a request-inspected payload, a frontend-validated literal, or a previous
arithmetic result, and all three are already `meter.text`-bounded. This slice mints no payload,
so it adds no bound and no fault code.

### [RT10X-C8 DECIDED] The type gate and its labels — no new label string

| Violation | Where | Label | At base |
| --- | --- | --- | --- |
| an integer-returning callee is called | `expression.ts:156` (existing) | **admitted** | `KIR_CALL_SIGNATURE_TYPE` |
| an integer parameter is passed | `expression.ts:159` (existing) | **admitted** | `KIR_CALL_SIGNATURE_TYPE` |
| a text argument for an integer parameter | `expression.ts:161` (existing) | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| a boolean argument for an integer parameter | idem | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| a decimal argument for an integer parameter | idem | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| a boolean call result for an integer parameter | idem | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| an integer argument for a text parameter | idem | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_ARGUMENT_TYPE` (green) |
| an integer argument for a boolean parameter | idem | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_ARGUMENT_TYPE` (green) |
| an `integer[]` parameter or return | `expression.ts:156,159` | `KIR_CALL_SIGNATURE_TYPE` | same (green) |
| wrong arity on an integer helper | `expression.ts:155` | `KIR_CALL_ARITY` | same (green) |
| an integer call result in an `if` condition | `link.ts:410-411` | `KIR_IF_COND_NOT_BOOLEAN` | `KIR_CALL_SIGNATURE_TYPE` |
| an integer call result assigned into a boolean binding | `link.ts:366-371` | `KIR_ASSIGN_TYPE_MISMATCH` | `KIR_CALL_SIGNATURE_TYPE` |
| an **async** integer call as an arithmetic operand or a call argument | `link.ts:379` | `KIR_ASYNC_CALL_EXPRESSION_POSITION (KIR_CALL_CALLEE_CAPABILITY)` | `KIR_CALL_SIGNATURE_TYPE` |

**No new label is introduced.** Every gate that fires already exists and is already pinned by a
prior slice; this slice changes which one is reached first, and the oracle asserts the *label
text* on every row so a row cannot be satisfied by the closed wire code alone (the RT-6 lesson).

Two rows above deserve their reasons in prose because their base label and their post-slice
label are the same string for different causes:

- **integer into a text or boolean parameter.** At base the argument has *no* cross-call type
  and the gate refuses it for absence; after the slice it has `integer` and the gate refuses it
  for difference. The row is a fence either way, and it is the row that would catch a builder
  who admits `integer` by making `crossCallExpressionType` answer the *parameter's* expected
  type instead of the argument's own.
- **`integer[]`.** At base the return-type check at `:156` fires before the parameter loop, so
  the parameter fence must not also return `integer[]` or it is untestable. See RT10X-C3.

### [RT10X-C9 VERIFIED] Async integer helpers follow RT-5 unchanged — and the async label becomes reachable

An async-classified integer helper is admissible in exactly the positions RT-5 admitted for a
boolean or text one: the entire `value` of a `let`, `print` or `return`, at any block depth.
Measured under the shadow: `let name=n value="afi()"` and `return value="afi()"` both link and
both return `{"tag":"integer","value":"7"}` three-leg byte-identically, with the capability
event committed in the caller's buffer.

Every other position stays refused with `KIR_ASYNC_CALL_EXPRESSION_POSITION
(KIR_CALL_CALLEE_CAPABILITY)`, and this is where `[RT10P-O6]` is superseded. RT-10-pre recorded
that the async-position label was **unreachable for arithmetic**, because
`compileLinkedExpression` resolves the whole operand tree before `link.ts:379` calls
`assertAsyncCallPosition`, so an async *boolean* call in an arithmetic operand always died first
on `KIR_BINARY_OPERAND_TYPE`. An async **integer** call passes the operand type gate, so the
position gate is now the gate that fires:

| Fixture | Post-slice label (measured) |
| --- | --- |
| `afi() + 1` (`afi` async, returns integer) | `KIR_ASYNC_CALL_EXPRESSION_POSITION (KIR_CALL_CALLEE_CAPABILITY)` |
| `idp(afi())` | `KIR_ASYNC_CALL_EXPRESSION_POSITION (KIR_CALL_CALLEE_CAPABILITY)` |

Both rows assert the position label **and** that neither `KIR_BINARY_OPERAND_TYPE` nor
`KIR_CALL_ARGUMENT_TYPE` appears in the message, which is the pair that proves the ordering
rather than the outcome. RT-10-pre's own `refuse-binary-async-operand` rows (async **boolean**
operand) stay green with the operand label, so both sides of the finding are pinned in the tree
at once.

### [RT10X-C10 VERIFIED] Zero new await points, and the target kernel does not change

- **No await.** The call boundary this slice widens is RT-4's synchronous one and RT-5's
  suspending one; neither gains a suspension point, because a type row cannot introduce one.
  `git diff` must add **zero** occurrences of `await`, `setImmediate`, `queueMicrotask`,
  `Promise` or `checkAbort()` / `_check_abort()` under `packages/core/src/kir-runtime/` or in
  either emitter.
- **No kernel change.** `KERNEL_SOURCE` is a module-level constant
  (`kir-js-esm/emitter.ts:23`, `kir-python/emitter.ts:22`) and `TARGET_KERNEL_SHA256` is its
  digest. This slice touches no target-kernel file, so both digests are unmoved:
  `b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6` (JavaScript) and
  `3df98a2e7b08660a827c2b5ed9f5f64ff0bf1c31e470464ce3a9570d3816d04a` (Python), measured at
  base. **Therefore no emitted-artifact digest is re-sealed** — the 20 lines in
  `rt4/compatibility.test.mjs`, the 48 in `rt5/compatibility.test.mjs` and the 2 in
  `rt6/k0-build-golden.json` that RT-10-pre moved twice under the option-(A) ruling stay
  untouched, and `compatibility.test.mjs` pins both kernel digests as a consuming assertion so
  the claim is asserted and not argued. Verified under the shadow: rt4, rt5 and rt6
  compatibility are green with the integer row present.

### [RT10X-C11 VERIFIED] The walker list — what must be audited and what must not move

Adding a cross-call row is not adding an expression variant, so the walkers RT-10-pre had to
teach are untouched. The list below is the complete set of code paths that read a type, split
into the three that move and the six that must not.

| Site | Reads | Action |
| --- | --- | --- |
| `linked-kir-program/contracts.ts:118-142` — the union, the table, `LINKED_KIR_CROSS_CALL_TYPE_NAMES`, `linkedKirCrossCallType` | the cross-call table | **one row + one union member** (RT10X-C2) |
| `linked-kir-program/expression.ts:70-84` — `staticExpressionType` | the operator tables, the callee's `returnType` | **the user-call arm** (RT10X-C4) |
| `linked-kir-program/expression.ts:86-109` — `crossCallExpressionType` | the operator tables, the cross-call table | **binary, unary, list, integer literal** (RT10X-C5) |
| `linked-kir-program/expression.ts:112-141` — `containsAsyncCall` | the expression union | must not change: no variant is added |
| `linked-kir-program/contracts.ts` — `expressionInvokesCapability`, `expressionCallDepth` | the expression union | must not change, tripwires included |
| `linked-kir-program/link.ts:194-205` — `bindName` | both tables, one call site each | must not change: `[RT10P-C6]` already records `'integer'` for an integer parameter |
| `linked-kir-program/link.ts:366-371` — the RT-9 assign gate | both tables | must not change (RT10X-C6, point 3) |
| `linked-kir-program/link.ts:410-411` — the `if` condition gate | the static table only | must not change |
| `kir-runtime/expression.ts:68-71,128-141,205-218` — `matchesType`, `calleeBindings`, the return-tag guard | the value's tag | must not change: already tag-generic |
| `kir-js-esm/emitter.ts:159-163`, `kir-python/emitter.ts:148-152` — `typeSource`; both kernels' `__matches` / `_matches` | the type record's `kind` | must not change: already tag-generic |
| `linked-kir-program/contracts.ts:220-227` — `LINKED_KIR_TYPE_ADMISSION` | the type-kind table | must not change: `integer` is already `parameter: true, return: true, scalar: true` |

`linked-kir-program/index.ts` needs no edit: `LINKED_KIR_CROSS_CALL_TYPES`,
`LINKED_KIR_CROSS_CALL_TYPE_NAMES`, `LinkedKernKirCrossCallType` and
`LinkedKernKirCrossCallTypeContract` are already re-exported (`index.ts:6-7,15-16`).

### [RT10X-C12 VERIFIED] Metering is unchanged: an integer call costs what a boolean call costs

RT-4's charge — one step for the call node, one per argument node left to right, one dispatch
step, then the callee's body statement and expression steps, with the callee's `return`
consuming no statement step and the callee's declared parameters costing nothing — is a property
of the call form, not of the types crossing it. This slice therefore pins the charge as an
**identity against a boolean twin measured at base**, not as a new constant to be believed:

| Fixture | Program | Steps | Measured |
| --- | --- | --- | --- |
| `bool-nullary-control` | `fn h returns=boolean` / `return h()` | 4 | at base |
| `int-nullary-twin` | `fn hi returns=integer` / `return hi()` | 4 | under the shadow |
| `bool-unary-control` | `fn hb param flag boolean` / `return hb(true)` | 5 | at base |
| `int-unary-twin` | `fn idp param a integer` / `return idp(1)` | 5 | under the shadow |
| `bool-let-call` | `let n = h()` / `return n` | 6 | at base |
| `int-let-call` | `let n = hi()` / `return n` | 6 | under the shadow |
| `int-two-args` | `fn sum param a,b integer` / `return sum(4, 5)` | 8 | under the shadow |
| `int-arith-on-result` | `return idp(7) + 1` | 7 | under the shadow |
| `int-accumulator` | `let n = 0` / `assign n = n + idp(7)` / `return n` | 11 | under the shadow |
| `return-literal-control` | `return 1` | 2 | at base |

Four identities are asserted over the pinned constants, so no constant can move alone:

1. `int-nullary-twin == bool-nullary-control` — the cross-call type is not metered.
2. `int-unary-twin == int-nullary-twin + 1` — exactly one argument node.
3. `int-two-args == int-unary-twin + 3` — one more argument node plus the callee body's extra
   binary and identifier nodes.
4. `int-arith-on-result == int-nullary-twin + 3` — the RT-10-pre binary node (1) plus its right
   literal (1) plus the callee's argument node (1); there is no helper tick and no per-type
   surcharge.

`int-accumulator` is the fixture the queued `for` slice inherits, and its 11 steps decompose
exactly as `3 statements + 1 let literal + (1 binary + 1 identifier + 1 call + 1 argument +
1 dispatch + 1 callee identifier) + 1 return identifier`.

Cancellation is unchanged: the checkpoint census on both emitted legs must match an
arithmetic-and-call-free control of the same statement shape, and the RT-2 queued-abort fence at
microtask depths 0-4 must agree between RT-1 and the emitted JavaScript on a synchronous integer
call chain.

---

## Sites the builder must touch

| File:line | What |
| --- | --- |
| `kir-runtime/linked-kir-program/contracts.ts:118` | `LinkedKernKirCrossCallType` gains `'integer'`. |
| `kir-runtime/linked-kir-program/contracts.ts:125-130` | one `integer` row, kept in the sorted position the existing table uses. |
| `kir-runtime/linked-kir-program/expression.ts:77-79` | `staticExpressionType`'s user-call arm answers the callee's `returnType.kind` when it is `'boolean'` or `'integer'` (RT10X-C4). |
| `kir-runtime/linked-kir-program/expression.ts:90-92` | `crossCallExpressionType`'s binary arm answers the operator table's `resultType`. |
| `kir-runtime/linked-kir-program/expression.ts:93` | its unary arm answers the unary table's `resultType`. |
| `kir-runtime/linked-kir-program/expression.ts:99-104` | its list arm asks the cross-call table for the element instead of hard-coding two element names. |
| `kir-runtime/linked-kir-program/expression.ts:105-108` | its literal arm answers `'integer'` for a canonical integer literal, guarded by the existing `CANONICAL_INTEGER`. |

Design estimate **≤ 15 net production lines** across **two** files. Crossing ~40 means the
contract was misread: the runtime, both emitters, both kernels, `link.ts`, `index.ts` and all
three expression walkers are type-generic already (RT10X-C11), and any diff in them is a defect,
not a cost.

## Blast radius outside `packages/core`

| File | Action | Value |
| --- | --- | --- |
| `scripts/kern-5-rt10-cross-call-integer/**` | Added | this slice's oracle. |
| `package.json` | Modified | `test:kern-5-rt10-cross-call-integer`, plus appending it to `test:kern-5-script-family` after `test:kern-5-rt10-pre-linked-arithmetic`. |
| `scripts/ci/test-tier-contract.test.mjs:49-64` | Modified | the matching `kern5EvidenceCommands` entry, in rt order, last. |
| `scripts/kern-5-rt4-user-fn-call/type-gate.test.mjs:167` | Modified | the key-set pin becomes `['boolean','integer','list<boolean>','list<text>','text']`, and one row asserts `LINKED_KIR_CROSS_CALL_TYPES.integer` is `{ element: undefined, kind: 'integer' }`. |
| `scripts/kern-5-rt4-user-fn-call/type-gate.test.mjs:172-192` | Modified | **the declared inversion.** `an integer signature in call position is gated by the closed cross-call type set, not by F5` asserts that `inc(1) == 1` is refused on all three legs for both the `integer` and the `number` spelling. It is now admitted on all three legs for both spellings; the row is inverted in place, keeping the uncalled-helper half and the RT-8 alias half. RT-4 stays at **50** tests. |
| `scripts/kern-5-rt10-pre-linked-arithmetic/k0-golden.json` | Modified | three `admission` values flip from `"handler-entry-unsupported"` to `"admitted"`: `refuse-integer-helper-call`, `refuse-integer-helper-operand`, `refuse-integer-param-helper-call`. Nothing else in the golden moves — `binaryOperatorContracts`, `linkedUnaryOperators`, `linkedExpressionKinds`, `behaviorTableSha256` and `precisionProbeSha256` are all untouched, which is the assertion that keeps the flip honest. Pre-slice digest `93e47dc288799b3cc7152eddd80f6fd0fcd135b9a5589de76aa8a9ae715e384a`, reproduced by this slice's `compatibility.test.mjs` by flipping the three rows back. |
| `scripts/kern-5-rt10-pre-linked-arithmetic/k0-golden.test.mjs:170-174` | Modified | the admitted-position count `32` → `35`. |
| `scripts/kern-5-rt10-pre-linked-arithmetic/type-gate.test.mjs:50-52,54-76` | Modified | **the declared exception.** The three `KIR_CALL_SIGNATURE_TYPE` rows leave `REFUSALS` and join `ADMITTED`; admitting them is this slice. RT-10-pre goes **156 → 153**. Its probe matrix, behavior table, walker coverage and tick discipline do not move. |
| `scripts/kern-5-rt10-pre-linked-arithmetic/k0-support.mjs:68-70,84-85` | Modified | two comments that state integer helpers are not callable become false and are corrected. No fixture, helper or export moves. |
| `scripts/kern-5-rt9-linked-assign/k0-support.mjs:36-38` and `scripts/kern-5-rt9-linked-assign/type-gate.test.mjs:100-105,227-229` | Modified | the same class of correction: three comments assert that an integer-returning helper is uncallable and that only the static half of the assign gate can refuse an integer list. Both become false (RT10X-C6). Comments only — **no assertion, fixture or count moves, and RT-9 stays at 82.** |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:97` | Modified | `compiledCoreDigest`, currently `0177435313515515774d9406ec8d2ed7fbb6bddcff93475f57d5240bcfd41b29`, moves because `packages/core/src` changes. **No source file may be added or removed under `packages/core/src`**: `scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:10-13` pins the compiled-core inventory at an authenticated `count: 354` plus digest `78ab887dbbf137326046a27fcabe4da3cc0adead7586005ce4b5987773a21ecb`, and that attestation is not licensed here. Then one `pnpm write:kern-canonicalizer-coverage` pass republishes the receipts; because the re-pin edits a `.mjs` under `scripts/kern-canonicalizer`, `coverageImplementationDigest` moves as a side effect, so apply the re-pin **before** the write and check whether a second pass is needed (RT-9 and RT-10-pre both record that one sufficed). |

### Pins that must pass UNMOVED

Every value below was measured at base `cb42f14e` and re-measured green under the shadow
implementation. `compatibility.test.mjs` asserts each one as a consuming assertion, so "did not
move" is a test result and not a claim.

| Pin | Value | Why it cannot move |
| --- | --- | --- |
| RT-2 K0 golden | `cc7fb869d3f51ca6222521df52dd70e2364a83c8f97365f8db0a8c83cc2f9908` | scrapes the statement union |
| RT-3 K0 golden | `cb5799446b64c83f82a4a5a044e2b680d41932b5305fffacf8bb5643e99cc7de` | scrapes the **expression** union, which gains no variant |
| RT-9 K0 golden | `2378f458943eb450984d8286e43bf45f322aa1f9e862eb0202188436bf2ab94a` | statement union |
| F5 projection policy | `e025392a83b6c6fecad31d7f92a2c34b67403bd0042b1cde9dc4b4223df80519` | the frontend is frozen |
| JavaScript target kernel | `b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6` | no kernel file is touched |
| Python target kernel | `3df98a2e7b08660a827c2b5ed9f5f64ff0bf1c31e470464ce3a9570d3816d04a` | idem |
| every `javascript/pythonArtifactSha256` and manifest digest in rt4/rt5/rt6 | unchanged | follows from the two kernel digests |
| every `linkedProgramSha256` and `projectionArtifactSha256` in rt4/rt5/rt6/rt9/rt10-pre | unchanged | no linked shape and no projection moves for a boolean/text fixture |
| `rt3GoldenSha256` (rt4 probe matrix), `RT3_GOLDEN_SHA256` (rt6, rt9), `RT3_PRE_SLICE_SHA256` (rt4), `RT3_K0_GOLDEN_PRE_RT9_SHA256` (rt9) | unchanged | all derived from the RT-3 golden |
| `scripts/kern-5-rt5-async-user-fn-call/variant-coverage.test.mjs` `VARIANTS` | unchanged | no expression variant is added |
| compiled-core inventory | `count: 354`, `78ab887d…` | no file added or removed under `packages/core/src` |
| census | 1/240, unchanged | no node type, property or diagnostic code is added |

## FROZEN files

- Every F0-F5 composition (`examples/kern-frontend/**`) and
  `scripts/kern-frontend-f5-projection/{policy.json,policy-validation.mjs,worker.mjs}`.
- `scripts/kern-frontend-closure/**` — no amendment record is written in this slice.
- `scripts/kir-structural/constitution.json`, `scripts/kir-v1/acceptance-policy.json`,
  `packages/core/src/schema.ts`, the generated structural catalog.
- `scripts/kern-5-admission-census/**`; every `.kern` file in the repository.
- `scripts/kern-5-rt2-boolean-if/**` and `scripts/kern-5-rt3-binary-expression/**` in their
  entirety.
- `scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs`.
- Every emitted-artifact digest and every `linkedProgramSha256` in rt4/rt5/rt6.
- `packages/core/src/ir/**` — the reference lane.
- `packages/core/src/kir-runtime/expression.ts`, `execute.ts`, `inspect.ts`, both emitters and
  both target kernels: the runtime and emission paths are already type-generic, and a diff in
  any of them contradicts RT10X-C11.

---

## Oracle

`scripts/kern-5-rt10-cross-call-integer/`, root script
`test:kern-5-rt10-cross-call-integer`, chained `node --test` in the RT-2…RT-10-pre pattern.
`k0-support.mjs` re-exports `scripts/kern-5-rt10-pre-linked-arithmetic/k0-support.mjs` (which
re-exports rt6 → rt4 → rt2) and adds only this slice's fixtures. No harness is duplicated. The
frozen expectations live in `behavior-table.json`, whose digest the K0 golden pins, so a fixture
cannot be quietly re-expected.

| Suite | Tests | What it pins | At base |
| --- | --- | --- | --- |
| `probe-matrix.test.mjs` | 7 | F5 facts only: projection status and diagnostics for all 43 positions, the `{kind:"integer"}` / `{element:"integer",kind:"list"}` type records for both spellings in parameter and return position, the projected call shapes for the accumulator and the arithmetic-on-a-result rows | **GREEN 7/7** — F5 already projects everything; the matrix is the sequencing gate and must stay green |
| `compatibility.test.mjs` | 8 | the five unmoved goldens and policy digests, both target-kernel digests, the five RT-3-derived pins, the RT-5 coverage table, and the RT-10-pre golden's pre-image reconstruction plus its three required flips | **RED 2/8** |
| `k0-golden.test.mjs` | 6 | the 43-row admission map; `LINKED_KIR_CROSS_CALL_TYPES` imported live from `dist` and serialized whole, with its names list; the expression union scraped from `contracts.ts` (which must **not** move); the behavior-table digest; every refusal being the closed code | **RED 3/6** |
| `behavior.test.mjs` | 36 | all 21 frozen value rows three-leg byte-identical, the `>2^53` and i64-max round trips, the negative round trip, the `number`-spelled twin, the async integer helper in `let` and `return` position with its committed event, the two tag-proving failure envelopes, the accumulator, and the emitted-artifact structural rows | **RED 33/36** |
| `type-gate.test.mjs` | 26 | 15 refusals with their label text, the label-disambiguation pairs, the async-position rows asserting the operand and argument labels are *absent*, the `list<integer>` fences, the admitted-position sweep, and the static/cross separation rows | **RED 17/26** |
| `tick-discipline.test.mjs` | 11 | absolute `execution` counts on 15 rows against boolean twins measured at base, the four identity groups, the no-`await` census on the linked type resolvers and both emitted helper regions, the checkpoint census against the boolean twin, the queued-abort fence at microtask depths 0-4, the pre-cancelled envelope and the exact step threshold | **RED 6/11** |

`probe-matrix` runs first — it proves every negative is a link decision and not a frontend gap.
`compatibility` runs second, in the rt4/rt5/rt6/rt9/rt10-pre position, so a drifted or
un-re-pinned golden is reported before any behavioural row is scored.

**Two `compatibility` rows are the forcing function for the blast radius, not for the production
diff.** `undoing the three RT-10-pre admission flips reproduces its pre-slice golden byte for
byte` and `the RT-4 cross-call contract pin names the five admitted cross-call types` fail until
the licensed prior-slice edits land, and they fail *with the production diff already applied* —
measured: under the shadow implementation `compatibility` is 6/8 with exactly those two rows red.
That is deliberate. They are the only mechanism that makes a missed re-pin loud, and they are why
*Deploy order* step 2 is not optional. The other six rows are green at base and must stay green.

### Frozen behavior table

Expected values are **frozen constants**, computed with `node -e` BigInt and independently
cross-checked with `python3` `int`, then compared against all three legs. Cross-leg agreement
alone is not the oracle: three legs can agree on a wrong answer.

| Row | Program (helper + entry) | Expected |
| --- | --- | --- |
| `int-return` | `fn hi returns=integer` / `return hi()` | `7` |
| `int-both` | `fn idp param a integer returns=integer` / `return idp(7)` | `7` |
| `int-two-args` | `fn sum param a,b integer returns=integer` / `return sum(4, 5)` | `9` |
| `int-arith-on-result` | `return idp(7) + 1` | `8` |
| `int-result-as-operand` | `return 1 + idp(7)` | `8` |
| `int-arith-argument` | `return idp(1 + 2)` | `3` |
| `int-unary-on-result` | `return -idp(7)` | `-7` |
| `int-nested-call` | `return idp(idp(7))` | `7` |
| `int-let-passthrough` | `let x = 5` / `return idp(x)` | `5` |
| `int-param-passthrough` | `param a integer` / `return idp(a)`, arg `9007199254740993` | `9007199254740993` |
| `int-big-through-helper` | `fn add1 param a integer returns=integer` (`a + 1`) / `return add1(9007199254740993)` | `9007199254740994` |
| `int-big-argument` | `return idp(9223372036854775807)` | `9223372036854775807` |
| `int-negative-argument` | `return idp(-9007199254740993)` | `-9007199254740993` |
| `int-assign-value` | `let n = 1` / `assign n = hi()` / `return n` | `7` |
| `int-accumulator` | `let n = 0` / `assign n = n + idp(7)` / `return n` | `7` |
| `int-accumulator-twice` | `let n = 0` / `assign n = n + idp(7)` / `assign n = n + idp(7)` / `return n` | `14` |
| `int-async-let` | `fn afi` (capability, returns integer) / `let n = afi()` / `return n` | `7` |
| `int-async-return` | `return afi()` | `7` |
| `number-spelling` | the `number`-spelled twin of `int-both` | `7` |
| `int-helper-chain` | `fn inner param a integer returns=integer`, `fn outer param a integer returns=integer` calling `inner(a + 1)` / `return outer(7)` | `8` |
| `int-mixed-signature` | `fn pick param a integer, flag boolean returns=integer` / `return pick(7, true)` | `7` |

Rows whose result is not a plain integer:

| Row | Program | Expected |
| --- | --- | --- |
| `int-param-only` | `fn pos param a integer returns=boolean` (`a > 0`) / `return pos(1)` | `{"tag":"boolean","value":true}` |
| `int-under-comparison` | `return hi() > 2`, `returns=boolean` | `{"tag":"boolean","value":true}` |
| `int-print-tag` | `let n = hi()` / `print n`, `returns=void` | failure, `unsupported-runtime-input`, `events: []` — proves the crossed value is tagged `integer` |
| `int-return-tag-mismatch` | `return hi()`, `returns=boolean` | failure, `invalid-handler-result`, `events: []` — the same proof from the other side |

Every row is asserted three ways: RT-1's envelope against the frozen constant, then the emitted
JavaScript and the emitted Python envelopes byte-identical to RT-1's through `threeLegBytes`.

### Negative fixtures

| # | Fixture | Expected label | At base |
| --- | --- | --- | --- |
| T1 | `idp(t)` (text parameter `t`) | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| T2 | `idp(flag)` | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| T3 | `idp(1.5)` | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| T4 | `idp(h())` (`h` returns boolean) | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| T5 | `idp([1, 2])` | `KIR_CALL_ARGUMENT_TYPE` | `KIR_CALL_SIGNATURE_TYPE` |
| T6 | `label(1)` (`label` takes `string`) | `KIR_CALL_ARGUMENT_TYPE` | same, **green** |
| T7 | `hb(1)` (`hb` takes `boolean`) | `KIR_CALL_ARGUMENT_TYPE` | same, **green** |
| T8 | `fn suml param xs "integer[]" returns=boolean` / `suml([1, 2])` | `KIR_CALL_SIGNATURE_TYPE` | same, **green** — the RT10X-C3 parameter fence |
| T9 | `fn mkl returns="integer[]"` / `mkl()` | `KIR_CALL_SIGNATURE_TYPE` | same, **green** — the return fence |
| T10 | `idp(1, 2)` | `KIR_CALL_ARITY` | same, **green** |
| T11 | `if cond="hi()"` | `KIR_IF_COND_NOT_BOOLEAN` | `KIR_CALL_SIGNATURE_TYPE` |
| T12 | `let b = true` / `assign b = hi()` | `KIR_ASSIGN_TYPE_MISMATCH` | `KIR_CALL_SIGNATURE_TYPE` |
| T13 | `afi() + 1` (`afi` async, integer) | `KIR_ASYNC_CALL_EXPRESSION_POSITION` | `KIR_CALL_SIGNATURE_TYPE` |
| T14 | `idp(afi())` | `KIR_ASYNC_CALL_EXPRESSION_POSITION` | `KIR_CALL_SIGNATURE_TYPE` |
| T15 | `label("a") + 1` (`label` returns text) | `KIR_BINARY_OPERAND_TYPE` | same, **green** |

T6, T7, T8, T9, T10 and T15 pass at base: they are fences on behavior that must survive the change,
exactly as RT-3's and RT-10-pre's own type-gate rows were. T6/T7 are the rows whose *cause*
changes while their label does not (RT10X-C8), and each is paired with its admitted sibling —
`idp(1)` and `label("a")` — so neither refusal can be satisfied vacuously.

### Mutant list

Twelve mutants, each argued non-equivalent against the real RT-1 / JavaScript / Python semantics
rather than against the spec text. Twelve is the standing floor.

| # | Mutant | Why it is not equivalent | Killed by |
| --- | --- | --- | --- |
| M01 | no `integer` row in `LINKED_KIR_CROSS_CALL_TYPES` | every positive row is `KIR_CALL_SIGNATURE_TYPE` again | `k0-golden`, all of `behavior` |
| M02 | the row is added but `staticExpressionType`'s user-call arm is left answering `'boolean'`-or-nothing | `idp(1)` links while `idp(1) + 1`, `-idp(7)`, `hi() > 2` and `assign n = hi()` are refused for operands they have | `behavior` `int-arith-on-result`, `int-unary-on-result`, `int-under-comparison`, `int-assign-value` |
| M03 | `staticExpressionType`'s user-call arm answers `'integer'` for **every** callee | a text-returning helper becomes an arithmetic operand; `label("a") + 1` links and faults at run time | `type-gate` the text-callee operand row |
| M04 | `crossCallExpressionType`'s binary arm left at `resultType === 'boolean' ? 'boolean' : undefined` | `idp(1 + 2)` is refused with `KIR_CALL_ARGUMENT_TYPE` for an argument that is an integer | `type-gate` admitted sweep, `behavior` `int-arith-argument` |
| M05 | its unary arm left answering `undefined` | RT-10-pre's `assign-neg` becomes `KIR_ASSIGN_TYPE_MISMATCH` — a prior slice's green row dies | rt10-pre `behavior`/`type-gate` `assign-neg`, `type-gate` `idp(-1)` |
| M06 | its literal arm left answering boolean/text only | `idp(1)` is refused: an integer literal is not an integer argument | `behavior` `int-both`, `type-gate` admitted sweep |
| M07 | the literal arm answers `'integer'` **without** the `CANONICAL_INTEGER` guard | the two tables can disagree on one literal; defense in depth against a non-canonical payload is gone | `k0-golden` (the guard is scraped from `expression.ts`) |
| M08 | the list arm is widened to admit an `integer` element (`list<integer>` by the back door) | `idp([1,2])` and `suml([1,2])` change label from `KIR_CALL_ARGUMENT_TYPE` / `KIR_CALL_SIGNATURE_TYPE` | `type-gate` T5, T8 |
| M09 | a `list<integer>` row is added to the table | T8 and T9 become admitted, and the names list gains a sixth member | `k0-golden` names row, `type-gate` T8, T9 |
| M10 | `crossCallExpressionType` answers the *parameter's* expected type instead of the argument's own | every argument matches, so `hb(1)` and `label(1)` link and fault at run time with `KIR_CALL_ARGUMENT_TAG` | `type-gate` T6, T7 |
| M11 | the argument tag guard in `calleeBindings` is weakened to accept any tag | nothing changes at link, and a text value reaches an integer parameter's body | `behavior` the three-leg failure rows; `type-gate` T6/T7 stay green, which is why the behavior rows carry it |
| M12 | one extra `meter.step()` on the cross-call type resolution | every integer call costs one more than its boolean twin; identity 1 breaks in one direction only | `tick-discipline` identity 1 |

No mutant here relies on a kernel change, a new fault code, or a magnitude cap: this slice adds
none of the three.

---

## Acceptance criteria

1. `pnpm test:kern-5-rt10-cross-call-integer` — **94/94** (probe-matrix 7, compatibility 8,
   k0-golden 6, behavior 36, type-gate 26, tick-discipline 11).
2. The prior suites green at the counts measured on this base, with the two declared exceptions:

   | Suite | Pre-slice | Post-slice | Why |
   | --- | --- | --- | --- |
   | `test:kern-5-rt2-boolean-if` | 35 | 35 | unchanged |
   | `test:kern-5-rt3-binary-expression` | 139 | 139 | unchanged |
   | `test:kern-5-rt4-user-fn-call` | 50 | 50 | **declared inversion**: one row's assertions flip from refused to admitted, and the key-set pin gains `integer`. No test is added or removed. |
   | `test:kern-5-rt5-async-user-fn-call` | 86 | 86 | unchanged; no artifact digest re-sealed |
   | `test:kern-5-rt6-void-fallthrough` | 52 | 52 | unchanged; no artifact digest re-sealed |
   | `test:kern-5-rt8-integer-signatures` | 28 | 28 | unchanged |
   | `test:kern-5-rt9-linked-assign` | 82 | 82 | unchanged; comments only |
   | `test:kern-5-rt10-pre-linked-arithmetic` | 156 | **153** | **declared exception**: three rows asserted that an integer cross-call fails closed; admitting it is this slice, so they leave the negative list and join the admitted sweep. |

   Only the prior-slice edits enumerated in *Blast radius* are licensed. That table is the
   authority.
3. `node --test scripts/ci/test-tier-contract.test.mjs` green with
   `test:kern-5-rt10-cross-call-integer` present in both `test:kern-5-script-family` and
   `kern5EvidenceCommands`, last and in rt order. Without this the suite is defined but never
   run in required CI — the omission RT-10-pre's review round caught for RT-9 and itself.
4. F5 / closure / census unchanged; `pnpm test:kern-canonicalizer` green after the
   `compiledCoreDigest` re-pin and the `write:kern-canonicalizer-coverage` pass.
5. `pnpm --filter @kernlang/core build` (tsc) clean; `biome check` clean on the two touched
   `packages/core` files.
6. `git diff` adds **zero** occurrences of `await`, `setImmediate`, `queueMicrotask`, `Promise`
   or `checkAbort()` under `packages/core/src/kir-runtime/`, and **zero** lines under
   `packages/core/src/compiler/`.
7. Both `TARGET_KERNEL_SHA256` values are unchanged, and no `javascript/pythonArtifactSha256`,
   manifest, `linkedProgramSha256` or `projectionArtifactSha256` line is edited anywhere in the
   repository.
8. Adding a sixth cross-call type to `LinkedKernKirCrossCallType` without adding its table row,
   or adding a row without widening the union, fails `tsc` — verified by applying and reverting
   the widening.
9. Net production diff ≤ 40 lines across ≤ 2 files (design estimate ≤ 15).
10. Every `behavior` row matches its frozen constant **and** the three legs are byte-identical.
    Cross-leg agreement alone never satisfies a row.

---

## RED evidence at base `cb42f14e`

`pnpm --filter @kernlang/core build` clean, then each suite under `node --test`.

Measured 2026-09-03. The suite is **33/94 at base — 61 red**:

| Suite | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `probe-matrix.test.mjs` | 7 | **7** | 0 |
| `compatibility.test.mjs` | 8 | 6 | **2** |
| `k0-golden.test.mjs` | 6 | 3 | **3** |
| `behavior.test.mjs` | 36 | 3 | **33** |
| `type-gate.test.mjs` | 26 | 9 | **17** |
| `tick-discipline.test.mjs` | 11 | 5 | **6** |
| total | **94** | 33 | **61** |

**Every link failure is one string.** Measured across all 43 admission fixtures: 29 rows
report

```
entry.function.handler.children[N].value: KIR_CALL_SIGNATURE_TYPE
```

raised at `linked-kir-program/expression.ts:156` (an integer return type) or `:159` (an integer
parameter), with the path label naming the exact operand or statement position — `.value.left`
for `hi() + 1`, `.value.right` for `1 + idp(7)`, `.value.argument` for `-idp(7)`, `.cond` for
`if cond="hi()"`, and `children[1].value` for an `assign` value. No row reports a projection
failure, a harness error, a missing export or a second cause.

Three rows are **GREEN at base and must stay green**, each for the reason the contract requires:

| Row | Base label | Gate that fires |
| --- | --- | --- |
| `label(1)` / `hb(1)` | `KIR_CALL_ARGUMENT_TYPE` | the argument gate, on an argument with no cross-call type at base and the `integer` type after |
| `suml([1,2])` with an `integer[]` parameter and a boolean return, and `mkl()` returning `integer[]` | `KIR_CALL_SIGNATURE_TYPE` | the signature gate, on the `list<integer>` row this slice does **not** add |
| `idp(1, 2)` | `KIR_CALL_ARITY` | arity, checked at `:155` before either signature check |

Verbatim base failures, copied from the runs:

```
int-return              | projected | handler-entry-unsupported | entry.function.handler.children[0].value: KIR_CALL_SIGNATURE_TYPE
int-arith-on-result     | projected | handler-entry-unsupported | entry.function.handler.children[0].value.left: KIR_CALL_SIGNATURE_TYPE
int-result-as-operand   | projected | handler-entry-unsupported | entry.function.handler.children[0].value.right: KIR_CALL_SIGNATURE_TYPE
int-unary-on-result     | projected | handler-entry-unsupported | entry.function.handler.children[0].value.argument: KIR_CALL_SIGNATURE_TYPE
int-accumulator         | projected | handler-entry-unsupported | entry.function.handler.children[1].value.right: KIR_CALL_SIGNATURE_TYPE
refuse-int-call-if-cond | projected | handler-entry-unsupported | entry.function.handler.children[0].cond: KIR_CALL_SIGNATURE_TYPE
```

`behavior.test.mjs` rows fail through the three-leg harness refusing to compile the fixture
(`javascript compile failed: handler-entry-unsupported`); `tick-discipline` rows fail with
`no step budget in the scanned range linked the metering fixture`; `k0-golden` fails as one diff
in which every integer position reads `handler-entry-unsupported` and
`LINKED_KIR_CROSS_CALL_TYPES` is missing its `integer` key; `compatibility` fails on the two
rows that require the RT-10-pre golden's three flips and RT-4's key-set pin.

The 33 tests that pass at base are load-bearing and must keep passing: the whole F5 probe matrix
(7); the six unmoved golden, policy and kernel-digest rows in `compatibility`; `k0-golden`'s
expression-union row, its deferred-type row and its behavior-table seal (3); the i64-range
invariant, the inert uncalled helper and the text/boolean argument controls in `behavior` (3);
the five base-green type-gate fences plus the arity-ordering row, the text-callee operand row,
the inert-helper row and the `list<integer>` partner (9); and the four metering identity groups
plus the resolver await census in `tick-discipline` (5).

### Post-slice expectations are measured, not predicted

Every post-slice row in this document was executed against a throwaway shadow implementation
applied to `packages/core/dist` — which is gitignored — consisting of exactly the seven edits in
*Sites the builder must touch*, then restored (`packages/core` rebuilt afterwards and the
cross-call names list re-checked as the four-row base set).

Measured under it: **91/94**, and the three that stay red are not oracle defects.

| Suite | Under the shadow | The three remaining red rows |
| --- | --- | --- |
| `probe-matrix` | 7/7 | — |
| `compatibility` | 6/8 | the RT-10-pre golden flips and the RT-4 key-set pin, which are prior-slice edits the shadow did not make |
| `k0-golden` | 5/6 | `both type resolvers read one operator table…` scrapes `packages/core/src`, which the shadow did not touch |
| `behavior` | 36/36 | — |
| `type-gate` | 26/26 | — |
| `tick-discipline` | 11/11 | — |

So all 21 value rows return their frozen constant three-leg byte-identically, all 15 negative
rows report the label this spec names, the metering identities hold, and the prior-suite damage
is exactly the four rt10-pre rows and two rt4 rows enumerated in *Blast radius* — rt4, rt5, rt6
and rt10-pre compatibility (30 rows, 70 artifact digests) and RT-9's whole type-gate stay green.
That is why no expectation in the oracle is tagged ASSUMED, and it is also how the one unsound
row in the first draft was caught (Corrections Log, the shared-budget entry).

---

## Queued: the rt10 `for` loop contract

Restated verbatim from the tribunal record so the next slice inherits the decision rather than
re-litigating it. **Not built here. No statement kind is added by this slice.**

> `for`: `to` **exclusive**; `step` defaults to `1`; a **literal** `step=0` is a link refusal
> `KIR_FOR_ZERO_STEP` and a **dynamic** zero step is the runtime error
> `ERR_KIR_LOOP_ZERO_STEP`; bounds are evaluated **once**, left to right; a non-integer bound is
> `KIR_FOR_BOUND_NOT_INTEGER`; the counter is **read-only** (`KIR_ASSIGN_TO_LOOP_COUNTER`) and
> **unobservable after the loop**; there is no `break` and no `continue`; the meter charge is
> `1_init + Σ(1_head + body) + 1_exit`; Python lowers to an **explicit `while`** with no chained
> comparison and no `int()`; JavaScript lowers to a `for` over `BigInt`; there is **no
> cancel-mid-loop fixture**; and the nested-accumulation golden is **18**.

What this slice hands that one, and why it was the prerequisite:

- an integer helper is callable from a loop body, so an accumulator can call one
  (`int-accumulator`, `int-accumulator-twice`);
- an integer helper's result is an arithmetic operand and an integer argument, so
  `assign acc = acc + f(i)` links (`int-arith-on-result`, `int-arith-argument`);
- the per-call meter charge is pinned as an identity against a boolean twin, so the `for` slice
  can derive `1_init + Σ(1_head + body) + 1_exit` over a body that calls a helper without
  re-measuring the call;
- `KIR_ASSIGN_TYPE_MISMATCH` and `KIR_IF_COND_NOT_BOOLEAN` still fire on an integer call result,
  so the loop counter's read-only rule inherits a live gate rather than a new one.

---

## Out of scope

- `list<integer>` in either direction (RT10X-C3), with its two fences kept here.
- `text`, `decimal`, `json`, record and `void` cross-call changes; `void` still has no call form.
- Any new operator, statement kind, expression variant, diagnostic code, fault code, label
  string or `KernKirLimits` field.
- `for`, `while`, `each`, `set`, `break`, `continue` — the queued contract above is restated,
  not implemented.
- Cross-module calls, member and dynamic callees, closures, higher-order functions, recursion.
- Any target-kernel change, and therefore any emitted-artifact re-seal.
- Any F0-F5 edit, amendment record, constitution, census or closure-ledger change.
- Any KIR schema or version change, release-gate promotion, push, merge, or deployment.

## Builder must NOT

1. Touch any frontend file, any `.kern`, the constitution, the census, the closure ledger, or
   `scripts/kern-frontend-*`. F5 already projects every fixture in this slice (RT10X-C1).
2. Add a `list<integer>` row, or widen `LinkedKernKirCrossCallTypeContract.element`
   (RT10X-C3). The two fences are the contract, not an oversight.
3. Add any expression variant, statement kind, operator, label or fault code. This slice
   introduces **no new string** into the diagnostic surface (RT10X-C8).
4. Touch `packages/core/src/kir-runtime/expression.ts`, `execute.ts`, `inspect.ts`, either
   emitter or either target kernel. They are already type-generic (RT10X-C11), and a diff there
   moves 70 emitted-artifact digests for nothing.
5. Hard-code `'integer'` in `staticExpressionType`'s or `crossCallExpressionType`'s user-call
   arm for any callee. Read `returnType.kind` and the table (RT10X-C4).
6. Move the signature row without also moving the binary, unary, list and integer-literal arms
   of `crossCallExpressionType`. Splitting them breaks RT-10-pre's `assign-neg` (RT10X-C5).
7. Drop the `CANONICAL_INTEGER` guard on the literal arm, or use a different guard than
   `staticExpressionType` uses (RT10X-C5).
8. Delete or bypass the static half of the RT-9 assign gate because it became redundant
   (RT10X-C6, point 3). Record the redundancy; do not act on it.
9. Charge a `meter.step()` anywhere in the cross-call type resolution, or exempt an integer call
   from RT-4's per-call charge (RT10X-C12).
10. Introduce any `await`, `setImmediate`, `queueMicrotask`, `Promise` or additional
    `checkAbort()` / `_check_abort()` site (RT10X-C10).
11. Re-seal any emitted-artifact digest, manifest digest, `linkedProgramSha256` or
    `projectionArtifactSha256`. If one moves, the kernel was touched and rule 4 was broken.
12. Add or remove a source file under `packages/core/src`: the compiled-core inventory is
    attested at 354 and re-attesting it is not this slice's decision.
13. Edit any prior-slice oracle file beyond the edits enumerated in *Blast radius*. That table
    is the authority.
14. Assert only the closed link code in a negative test. The label text is the assertion.
15. Rescue a RED by widening the slice to `list<integer>`, a new operator, the `for` statement,
    or the frontend.
16. Accept a fixture whose expected value was not computed by BigInt **and** cross-checked by
    `python3`, or satisfy a row by cross-leg agreement alone.

## Standing review question

**Every new dispatch path must add zero await points, and every kernel-free slice must move zero
artifact digests.** Answered in RT10X-C10: this slice adds no dispatch path at all — it widens a
type table that two resolvers read — and touches no kernel file. The reviewer should check
`git diff` for any occurrence of `await`, `setImmediate`, `queueMicrotask`, `Promise` or
`checkAbort()` under `packages/core/src/kir-runtime/`, for **any** line under
`packages/core/src/compiler/`, and for any edited digest literal, and expect **zero** of each.

## Open questions

- **[RT10X-O1 DECIDED — 2026-09-03]** This slice stacks on RT-10-pre. Its PR waits for
  RT-10-pre to merge, exactly as RT-10-pre waited for RT-9. Consequences, all discharged: every
  predecessor digest in *Pins* is measured against the RT-10-pre tree, the RT-10-pre golden and
  type-gate are in the licensed blast radius, and the oracle carries three RT-10-pre positions as
  admitted rows.
- **[RT10X-O2 DECIDED — 2026-09-03]** `list<integer>` is not admitted. See RT10X-C3 for the
  three costs and the two fences.
- **[RT10X-O3 OPEN — deferred, recorded]** RT-9's assign gate now has a redundant static half
  (RT10X-C6). No slice in the ladder needs it to discriminate, and removing it would delete
  defense in depth against the first type that breaks the static/cross mapping. Recorded as an
  observation for the reviewer, not a task. It caps nothing: no acceptance criterion and no
  oracle fixture rests on it.
- **[RT10X-O4 CLOSED]** Whether an integer helper is callable from a helper body: **yes**, and
  the oracle covers it — `compileHandler` is shared, so `int-helper-chain` has `outer` calling
  `inner(a + 1)` and returning an integer through two frames.
- **[RT10X-O5 CLOSED]** Whether the async-position label is reachable for arithmetic: **yes**,
  and that supersedes `[RT10P-O6]`. See RT10X-C9; both rows measured.
- **[RT10X-O6 CLOSED]** Whether the runtime or either emitter needs a per-type branch: **no**,
  and it is read from source rather than assumed. See *Current State* and RT10X-C11.

## Deploy order

1. Land the shared contract: the union member, the table row, and the four
   `crossCallExpressionType` arms plus the one `staticExpressionType` arm. Nothing is admitted
   until this is complete, because the linker is the only decision point — RT-1 and both
   emitters index the same tables and need no change.
2. Land the prior-slice re-pins enumerated in *Blast radius* — the two rt4 rows, the three
   rt10-pre files, the comment corrections in rt9 and rt10-pre — then the canonicalizer coverage
   pass. Wire the new suite into `test:kern-5-script-family` and the CI tier contract in the same
   push.
3. Run the suite through `pnpm test:kern-5-rt10-cross-call-integer`. It needs Node 22
   (`KERN_NODE22`) for the emitted-ESM leg and CPython 3.12 (`KERN_PYTHON312`) for the
   emitted-Python leg, matching RT-2…RT-10-pre.

During an incomplete deployment an integer cross-call continues to fail closed as unsupported;
it must never fall back to source or host semantics, and it must never link and then fault with
`KIR_CALL_ARGUMENT_TAG` at run time.

---

## Implementation (measured 2026-09-03)

Production diff, **2 files, +16/-13 (net +3)** — under the ≤15-line design estimate and far
under the ≤40-line ceiling:

| File | +/− | What |
| --- | --- | --- |
| `kir-runtime/linked-kir-program/contracts.ts` | +5/−5 | the `integer` union member, the `integer` table row, `LinkedKernKirCrossCallTypeContract.kind` widened to admit `'integer'`, and `LINKED_KIR_CROSS_CALL_TYPE_NAMES` compacted from three lines to two so the file does not grow past the 503 lines it already had. `element` is **not** widened. |
| `kir-runtime/linked-kir-program/expression.ts` | +11/−8 | `staticExpressionType`'s user-call arm answers the callee's `returnType.kind` when it is `'boolean'` or `'integer'`; `crossCallExpressionType`'s binary and unary arms answer their operator table's `resultType`, its user-call arm asks the cross-call table for the callee's declared return type, its list arm resolves the element through the table's scalar rows instead of two hard-coded names, and its literal arm answers `'integer'` under the shared `CANONICAL_INTEGER` guard. |

Nothing else in `packages/core/src` moved: zero lines under `packages/core/src/compiler/`, zero
added occurrences of `await`, `setImmediate`, `queueMicrotask`, `Promise` or `checkAbort()` under
`packages/core/src/kir-runtime/`, and zero edited `TARGET_KERNEL_SHA256`,
`javascript/pythonArtifactSha256`, manifest, `linkedProgramSha256` or `projectionArtifactSha256`
literals anywhere in the repository. `tsc -b` and `biome check` clean on both files.

### Measured suite counts

| Suite | Expected | Measured |
| --- | --- | --- |
| `test:kern-5-rt10-cross-call-integer` | 94 | **94/94** (probe-matrix 7, compatibility 8, k0-golden 6, behavior 36, type-gate 26, tick-discipline 11) |
| `test:kern-5-rt2-boolean-if` | 35 | **35/35** |
| `test:kern-5-rt3-binary-expression` | 139 | **139/139** |
| `test:kern-5-rt4-user-fn-call` | 50 | **50/50** (declared inversion applied) |
| `test:kern-5-rt5-async-user-fn-call` | 86 | **86/86** |
| `test:kern-5-rt6-void-fallthrough` | 52 | **52/52** |
| `test:kern-5-rt8-integer-signatures` | 28 | **28/28** |
| `test:kern-5-rt9-linked-assign` | 82 | **82/82** (comments only) |
| `test:kern-5-rt10-pre-linked-arithmetic` | 153 | **153/153** (declared exception applied) |
| `node --test scripts/ci/test-tier-contract.test.mjs` | green | **9/9** |
| `pnpm test:kern-canonicalizer` | green | **green**, including the `@kernlang/cli` build, the composed-checker CLI pass and the coverage receipts |

The pins moved are exactly the ones *Blast radius* licenses: three `admission` value flips plus
the `32` → `35` count and the three-row `REFUSALS` → `ADMITTED` move in rt10-pre, the RT-4
key-set pin and its one inverted row, `compiledCoreDigest` with one
`write:kern-canonicalizer-coverage` pass, and five comment corrections in rt9/rt10-pre. No rt2,
rt3 or rt9 golden and no emitted-artifact digest was touched.

### Mutant battery — 10/11 killed

Each mutant was applied to `packages/core/src`, the core rebuilt, the predicted suite run, then
the byte-copy backup restored and `touch`ed.

| # | Mutant | Result | Killed by |
| --- | --- | --- | --- |
| M01 | the argument gate admits any type where `integer` is expected | **KILLED** | `type-gate` `refuse-text-into-int-param`, `refuse-bool-into-int-param`, `refuse-decimal-into-int-param` |
| M02 | the callee return-type check at `expression.ts:159` is dropped | **KILLED** | `type-gate` `refuse-int-list-return`, the signature-before-argument ordering row |
| M03 | the call-argument type check is dropped | **KILLED** | `type-gate` the three argument-type refusals |
| M04 | `staticExpressionType` calls an integer return `boolean` | **KILLED** | `type-gate` `refuse-int-call-if-cond`, `refuse-async-int-operand`, the admitted sweep |
| M05 | `crossCallExpressionType`'s unary arm is skipped | **KILLED** | `type-gate` the admitted sweep |
| M06 | the RT-9 assign type gate is skipped | **KILLED** | `type-gate` `refuse-int-into-bool-assign` and the cross-call-half separation row |
| M07 | a `list<integer>` row mis-types the deferred list fence | **KILLED** | `type-gate` `refuse-int-list-param`, `refuse-int-list-return`, the signature-attribution row |
| M08 | the signature-refusal label becomes `KIR_CALL_SIGNATURE_TYPES` | **SURVIVED** (advisory) | — |
| M09 | the `CANONICAL_INTEGER` guard is dropped from the literal arm | **KILLED** | `k0-golden` the shared-guard resolver row |
| M10 | `crossCallExpressionType`'s binary arm answers boolean only | **KILLED** | `behavior` `int-arith-argument`, `int-accumulator`, `int-accumulator-twice` |
| M08b | the same label *replaced* rather than extended (`KIR_CALL_SIGNATURE_KIND`) | **KILLED** | `type-gate` `refuse-int-list-param`, `refuse-int-list-return`, the signature-attribution row — added to prove M08's survival is the helper's substring check and not a missing label assertion |

**M08 is a test-strength finding in a shared prior-slice helper, not a defect in this slice's
contract.** RT-6's `assertLinkLabel` (`scripts/kern-5-rt6-void-fallthrough/k0-support.mjs:79-81`),
which every slice from RT-6 onward reuses, asserts `thrown.message.includes(label)`. Any mutant
that *extends* a label rather than replacing it is therefore unkillable by construction:
`KIR_CALL_SIGNATURE_TYPES` contains `KIR_CALL_SIGNATURE_TYPE`. A label mutant that replaces the
suffix instead (`KIR_CALL_SIGNATURE_KIND`) is killed by the same rows. Closing the gap means
turning that helper's substring check into a boundary-anchored one, which edits a prior slice's
harness outside this slice's licensed blast radius; it is recorded here as advisory for the
reviewer and for whichever slice next owns the RT-6 support module.

## Corrections Log

| Date | Correction |
| --- | --- |
| 2026-09-03 | **`LinkedKernKirCrossCallTypeContract` is not byte-unchanged after all: its `kind` field had to widen.** RT10X-C2 recorded that only `element` stays fixed, but the interface declared `kind: 'boolean' \| 'list' \| 'text'`, so the `integer` row's `kind: 'integer'` fails the `satisfies Record<…>` check until `kind` admits `'integer'` too. One field of one exported interface widens; `element` stays `'boolean' \| 'text' \| undefined`, so `list<integer>` is still unrepresentable and both RT10X-C3 fences hold. |
| 2026-09-03 | **`crossCallExpressionType`'s user-call arm reads the callee's declared return kind, which the K0 golden scrapes and the shadow implementation never proved.** The one row that stayed red under the shadow — `both type resolvers read one operator table and share one canonical-integer guard` — scrapes `expression.ts` and requires the literal text `returnType.kind` inside *both* resolvers. The arm is written as `callee?.returnType.kind === undefined` so the optional chain both models "unknown callee" and reads the discriminant the golden pins; `linkedKirCrossCallType` still does the table lookup. |
| 2026-09-03 | **`LINKED_KIR_CROSS_CALL_TYPE_NAMES` was compacted so `contracts.ts` does not grow.** The file was already at 503 lines, over the 500-line ceiling, and the `integer` row adds one. Its three-line `Object.freeze(Object.keys(...).sort()) as readonly …` form became a two-line binding plus freeze, so the row lands at no net cost and the file stays at 503. The names list is still `Object.keys(...)` sorted, and `linkedKirCrossCallType`'s unique kind/element match still makes the ordering presentational. |
| 2026-09-03 | **The mutant battery found a substring gap in the shared RT-6 label helper.** `assertLinkLabel` asserts `thrown.message.includes(label)`, so a mutant that appends to a label string cannot be killed by any label row in any slice from RT-6 onward. Recorded as advisory: replacing a label's suffix is caught, extending it is not, and closing the gap edits a prior slice's harness outside this slice's licensed blast radius. |
| 2026-09-03 | **The RT-10-pre base moved under this slice after the production diff landed.** Two CI-only fixes were pushed to `feat/kern-5-rt10-pre-linked-arithmetic` — the linked-program tripwire message no longer uses host `JSON.stringify` (`228b96ca`) and the c-py-1 standard-library allowlist gains `sys` (`dba722ed`) — and were merged in. Both touch neighbour gates this slice's per-slice gate never ran; neither touches the cross-call table or either type resolver. `compiledCoreDigest` was re-pinned a second time and the coverage receipts republished, and the r1, r2-closure and c-py-1 gates were added to this slice's run. |
| 2026-09-03 | **The brief's "decide `list<integer>`: recommend NOT now unless RT-4/RT-5 list plumbing makes it free" resolves to NOT, and the plumbing is not what costs.** The kernels' `__matches` / `_matches` and both `typeSource` functions handle a list of any element generically, so *emission and execution* really are free. The cost is at link: `LinkedKernKirCrossCallTypeContract.element` is `'boolean' \| 'text' \| undefined`, and `crossCallExpressionType`'s list arm hard-codes the same two names, so admitting an integer element also admits an integer list *literal* as an argument — a new argument-shape gate with homogeneity and emptiness rows that no queued slice consumes. DECIDED out, with an `integer[]` parameter and an `integer[]` return kept as `KIR_CALL_SIGNATURE_TYPE` fences (RT10X-C3). |
| 2026-09-03 | **The kernel-touch question answers NO, and it is asserted rather than argued.** Both `typeSource` implementations and both kernels' `_matches` compare a tag against the type record's `kind` with no per-type branch, so a cross-call type addition reaches emission without changing `KERNEL_SOURCE`. Both `TARGET_KERNEL_SHA256` values are pinned in `compatibility.test.mjs` as consuming assertions, and rt4/rt5/rt6 compatibility were re-run green under the shadow implementation — the first slice since RT-9 that re-seals none of the 70 artifact digest lines. |
| 2026-09-03 | **Admitting the signature row alone would have broken a prior slice's green row.** `crossCallExpressionType`'s unary arm answers `undefined` today. With an `integer` row present but the unary arm untouched, `let n = 5` records `integer` across the call boundary while `-n` records nothing, so RT-9's assign gate raises `KIR_ASSIGN_TYPE_MISMATCH` on RT-10-pre's admitted `assign-neg` fixture. The binary, unary, list and integer-literal arms therefore move together (RT10X-C5) and mutant M05 pins it. |
| 2026-09-03 | **RT-9's assign gate loses the discriminating power of its static half, and the honest record is a finding rather than a deletion.** After this slice `staticExpressionType` is a total function of `crossCallExpressionType`, so the two-table assign gate has one table deciding. RT-9's row "the static half of the gate separates the two assigns into one integer binding" still passes — its fixture is refused by both halves now — but no longer kills the mutant it was written for. The static table keeps two exclusive readers (the operand gates and the `if` condition gate) and this slice pins them; deleting the redundant half is forbidden (RT10X-C6, RT10X-O3). |
| 2026-09-03 | **`[RT10P-O6]` is superseded: the async-position label becomes reachable for arithmetic.** RT-10-pre recorded that `KIR_ASYNC_CALL_EXPRESSION_POSITION` was unreachable for an arithmetic operand, because the static-type resolver refused an async *boolean* call for its type before `link.ts:379` was reached. An async *integer* call passes the type gate, so `afi() + 1` and `idp(afi())` now report the position label, measured. RT-10-pre's boolean rows stay green with the operand label, so both halves are pinned in the tree simultaneously. |
| 2026-09-03 | **The `integer[]` parameter fence was untestable as first written.** `fn suml param xs "integer[]" returns=integer` refuses at `expression.ts:156` for its **return** type before the parameter loop runs, so the row would have proved the return fence twice. The fence returns `boolean`, which makes the refusal attributable to the `list<integer>` parameter, and the return fence is a separate row over `fn mkl returns="integer[]"`. |
| 2026-09-03 | **Two base-green rows change cause without changing label, and saying so is the point.** `label(1)` and `hb(1)` report `KIR_CALL_ARGUMENT_TYPE` both before and after: at base because an integer literal has *no* cross-call type, afterwards because it has `integer` and the parameter wants something else. They stay in the suite as fences, each paired with its admitted sibling, and they are the rows that catch a builder who resolves an argument's cross-call type from the *parameter's* expectation (M10). |
| 2026-09-03 | **The RT-4 row that gated integer signatures is inverted, not deleted, and it carries the RT-8 alias with it.** `an integer signature in call position is gated by the closed cross-call type set, not by F5` asserted that `inc(1) == 1` is refused on all three legs for both the `integer` and the `number` spelling. Both are admitted now. The row keeps its uncalled-inert-helper half and its two-spelling structure and flips the expectation, so RT-4 stays at 50 tests and the alias equivalence stays asserted where RT-4 put it. |
| 2026-09-03 | **The metering claim is an identity, not a constant.** "The meter is unchanged (RT-4's per-call charge)" is unfalsifiable as prose and untestable as a lone number, so every integer metering row is pinned against a boolean twin measured at base: 4/4 nullary, 5/5 one-argument, 6/6 in `let` position. A per-type surcharge breaks the identity in one direction only, which is exactly what mutant M12 does. |
| 2026-09-03 | **A shared `maxSteps` is not a shared budget across the three legs, and the first draft of the oracle assumed it was.** A row asserting that all three legs consume the same step budget for one integer call failed under the shadow implementation: RT-1 meters *linking* at run time, while an emitted artifact has its linking baked in at compile time, so the same `maxSteps` value buys a different amount of execution on RT-1 than on either emitted leg. The pinned totals are RT-1's, the row now pins the threshold as exact rather than monotone on RT-1 alone, and cross-leg agreement stays where it is sound — the 21 envelope byte-identity rows at the suite default. |
| 2026-09-03 | **The three rt10-pre positions are re-homed by value, not by name.** `refuse-integer-helper-call`, `refuse-integer-helper-operand` and `refuse-integer-param-helper-call` become admitted. Renaming them would re-sort two canonically serialized JSON files for a cosmetic gain, and deleting them would drop three F5 probe rows that stay true; so the licensed edit is three value flips in `k0-golden.json`, one count (`32` → `35`) in `k0-golden.test.mjs`, and a move from `REFUSALS` to `ADMITTED` in `type-gate.test.mjs`. RT-10-pre goes 156 → 153 and its probe matrix does not move. |
| 2026-09-03 | **Post-slice expectations were measured against a shadow implementation rather than predicted.** The seven edits were applied to `packages/core/dist` — gitignored, restored afterwards — and every value row, label row, metering row and prior-suite interaction in this document was executed under them. Three predictions were wrong before that run and are corrected above: the unary-arm interaction with `assign-neg`, the async-position label, and the `integer[]` parameter fence's masking by the return check. No expectation in the oracle is tagged ASSUMED. |
