# KERN 5 RT-10-pre: linked-KIR integer arithmetic (`+`, `-`, `*`, unary `-`)

**Status:** IMPLEMENTED, REVIEWED ×2 (production diff landed, RT-10-pre 154/154, whole gate green;
the emitted-artifact digests in rt4/rt5/rt6 re-sealed twice under the coordinator's option-(A)
ruling — once for the arithmetic helpers, once for the result-size bound and the CPython
digit-cap lift the review round added — see *Implementation* and the Corrections Log)
**Date:** 2026-09-02
**Base:** `06b74443` — `feat/kern-5-rt9-linked-assign` (`29feebaf`) merged into this branch on
top of `1a88c705`. **This slice stacks on RT-9 and its PR waits for RT-9 to merge** (RT10P-O1).
**Branch:** `feat/kern-5-rt10-pre-linked-arithmetic`
**Tribunal:** `tribunal-1788367798637-9hxyhm-kern5-rt10-pre-arith` (adversarial, hybrid,
2 rounds, 4/4 engines). Verdict: **total algebraic arithmetic `{+, -, *, neg}`**; `/`, `%`,
`**` and the magnitude cap deferred with their semantics pre-registered. Two adopted
minority points from codex: expectations are **frozen constants**, not cross-leg agreement
alone; and metering is **inherited** from the expression-node model, not one tick per helper.
**Confidence:** 0.90 for the contract below (both former OPEN items are now RULED; the one
remaining OPEN is a recorded label-registry observation); 0.94 for the RED oracle's
attributability, measured on the RT-9 base.

---

## Executive Summary

RT-3 admitted eight closed *boolean-producing* binary operators. Nothing in the linked lane
can produce a new integer: no arithmetic operator links, and no negative integer is even
representable, because F2 projects `-7` as `unary -` around a non-negative literal and the
linked expression union has no unary variant at all. RT-9's own spec named this as the single
most important input to rt10: `for` bodies cannot accumulate without `assign acc = acc + i`,
and that expression does not exist.

RT-10-pre adds exactly four operators — binary `+`, `-`, `*` and unary `-` — over
integer × integer → integer and integer → integer. All four are **total functions over ℤ**:
no reachable runtime fault, no rounding policy, no host-exception bridging, no division
singularity. That totality is the whole reason for the slice boundary: every RED row turns
GREEN through one admission decision, and a failure can only be an evaluation or lowering bug.

Results are **exact arbitrary-precision integers** on all three legs — RT-1's tagged
evaluator, the emitted JavaScript over `BigInt`, and the emitted Python over `int` — and
every operator lowers to a **named helper** (`__add/__sub/__mul/__neg`, `_add/_sub/_mul/_neg`),
never to host infix. There is no magnitude cap in this slice.

Three findings during design changed the tribunal's contract, and two of them make the slice
*bigger* than the verdict assumed:

1. An **integer parameter has no static type today** (`link.ts:436` records `'boolean'` or
   nothing), so `a + b` over `param type=integer` would be refused for its operands even
   after the operator is admitted — and so would RT-3's own `a < b`. RT-8 admitted integer
   *signatures* and left the linker with no reader for them. Closing that orphan is in scope
   (RT10P-C6).
2. `crossCallExpressionType` answers `'boolean'` for **every** binary node
   (`expression.ts:87`). Admitting arithmetic without fixing it lets `h(1 + 2)` pass the
   call-argument gate at link and fail at run time on all three legs — the M02 defect class
   RT-9 pinned (RT10P-C8).
3. Two of the three linked expression walkers **silently default** on an unknown variant
   (`contracts.ts:225`, `:290`), so a `unary` variant is admitted into them with no `tsc`
   error. Only `containsAsyncCall` has the exhaustive `never` tripwire (RT10P-C12).

The review round added two more, both about the *result* rather than the operands:

4. Arithmetic is the only expression that **mints a new integer payload**, and nothing bounded
   it: two in-limit operands could produce a result past `limits.maxStringBytes` on every leg
   (RT10P-C15).
5. CPython ≥ 3.11 caps `int`↔`str` conversion at 4300 digits, so a large exact result that
   RT-1 and the emitted JavaScript return made the emitted Python leg diverge (RT10P-C15a).

The frontend does not move. No `.kern`, no F5 policy, no amendment record, no census change.

---

## Contract

### [RT10P-C1 VERIFIED] F5 already projects every node this slice needs

Verified 2026-09-02 by `runProjection([{moduleId:'route.kern', source}])` from
`scripts/kern-frontend-f5-projection/worker.mjs`, shapes decoded with
`decodeModuleKir(bytes, policy.canonicalLimits)`. All 37 behavior-table sources plus all 26
negative sources projected `status: "projected"` with zero diagnostics.

| Source | Projected shape |
| --- | --- |
| `1 + 2` | `{kind:"binary", fields:{left:{kind:"integer",value:"1"}, op:"+", right:{kind:"integer",value:"2"}}}` |
| `-7` | `{kind:"unary", fields:{argument:{kind:"integer",value:"7"}, op:"-"}}` |
| `-n` | `{kind:"unary", fields:{argument:{kind:"identifier",name:"n"}, op:"-"}}` |
| `-(1 + 2)` | `unary -` over a `binary +` |
| `-(-7)` | `unary -` over `unary -` |
| `2 * 3 + 4` | `binary +` whose **left** is `binary *` (F2 precedence) |
| `2 * (3 + 4)` | `binary *` whose **right** is `binary +` |
| `10 - 3 - 2` | left-associative: `binary -` whose left is `binary -` |
| `1 + 2 > 2` | `binary >` whose **left** is `binary +` |
| `1 - -1` | `binary -` whose right is `unary -` |

Two frontend walls, both `FRONTEND_INVALID_EXPRESSION`, both pinned as `not-projected` rows:

| Source | F5 |
| --- | --- |
| `007` | rejected, `FRONTEND_INVALID_EXPRESSION` (RT-3 already pinned this) |
| `-0`, `- 0`, `-(0)` | **rejected**, `FRONTEND_INVALID_EXPRESSION` |

**Consequence for the `-0` contract:** a literal negative zero is unwritable. The only way to
reach `neg(0)` is through a binding — `let z = 0` / `let n = -z` — and that is the fixture that
pins `-0 ≡ 0`. A fixture written as `return -0` would be a frontend row, not a semantic one.

### [RT10P-C2 DECIDED] The operator set is `{+, -, *, neg}` and nothing else

Binary `+`, `-`, `*` over integer × integer → integer, and unary `-` over integer → integer.
Every one is total over ℤ, so **this slice adds zero reachable execution-phase faults**.

`/`, `%`, `**`, every bitwise and shift operator, and unary `!` and `+` stay fail-closed at
link. Their refusals are regression rows in `type-gate.test.mjs`, not follow-ups.

### [RT10P-C3 DECIDED] The linked unary variant and its operator table

`LinkedKernKirExpression` gains exactly one variant, mirroring the `binary` field naming that
F5 projects:

```ts
| { readonly kind: 'unary'; readonly op: LinkedKernKirUnaryOperator; readonly argument: LinkedKernKirExpression }
```

**Builder must not** name the field `operand`, `value`, or `expression`: F5 projects
`fields.argument`, and `json-call` already uses `argument` for the same role. A second
spelling is a silent divergence between the projected node and the linked node.

The operator is table-driven exactly as RT-3's binary table is, so the same `tsc` tripwire
applies — widening the union without updating RT-1's evaluator table and both emitters is a
build error, not a runtime surprise:

```ts
export type LinkedKernKirUnaryOperator = '-';

export interface LinkedKernKirUnaryOperatorContract {
  readonly javascriptHelper: string;
  readonly operandType: LinkedKernKirStaticType;
  readonly pythonHelper: string;
  readonly resultType: LinkedKernKirStaticType;
}

export const LINKED_KIR_UNARY_OPERATORS = Object.freeze({
  '-': { javascriptHelper: '__neg', operandType: 'integer', pythonHelper: '_neg', resultType: 'integer' },
}) satisfies Record<LinkedKernKirUnaryOperator, LinkedKernKirUnaryOperatorContract>;
```

`linkedKirUnaryOperator(op: string)` mirrors `linkedKirBinaryOperator` (`contracts.ts:27-29`).

### [RT10P-C4 DECIDED] The binary contract gains `resultType`, and `family` gains `arithmetic`

`LinkedKernKirBinaryOperatorContract` (`contracts.ts:9-14`) gains
`readonly resultType: LinkedKernKirStaticType`, and the three new rows are:

| op | family | operandType | resultType | JS helper | Python helper |
| --- | --- | --- | --- | --- | --- |
| `+` | `arithmetic` | `integer` | `integer` | `__add` | `_add` |
| `-` | `arithmetic` | `integer` | `integer` | `__sub` | `_sub` |
| `*` | `arithmetic` | `integer` | `integer` | `__mul` | `_mul` |

Every existing row records `resultType: 'boolean'`. `satisfies` makes a missing `resultType`
a `tsc` error, so the result type can never be inferred in one consumer and hard-coded in
another.

This is what makes the operand gate free: `compileLinkedExpression`'s binary arm already reads
`LINKED_KIR_BINARY_OPERATORS[op].operandType` and refuses a non-integer operand with
`KIR_BINARY_OPERAND_TYPE` (`expression.ts:290-297`). Arithmetic inherits that gate with **no
new code and no new label** — see RT10P-C7.

`family` is read by both emitters solely to decide whether the right operand is passed as a
thunk (`kir-js-esm/emitter.ts:115-117`, `kir-python/emitter.ts:105-107`). `arithmetic` is not
`logical`, so both operands are passed eagerly through the existing non-logical arm and
**neither emitter's binary case changes at all**.

### [RT10P-C5 DECIDED] Exact arbitrary precision, canonical decimal, `-0 ≡ 0`, no cap

| Property | Contract | Why it holds on every leg |
| --- | --- | --- |
| Precision | exact mathematical result, unbounded | RT-1 already lifts a tagged integer through `BigInt(value.value)` (`kir-runtime/expression.ts:83-86`); the emitted JS does the same via `__intOperand` (`kir-js-esm/target-execution.ts:97-100`); the emitted Python via `int(operand["value"])` (`kir-python/target-execution.ts:107-110`). No leg ever sees a host double. |
| Serialization | canonical decimal string, no sign for zero, no `+`, no leading zero | `String(bigint)` and Python `str(int)` agree on every value in the table (cross-checked, below), and `KernKirValue`'s integer payload is already a string (`kir-runtime/contracts.ts:8`). |
| `-0` | `neg(0)` is `"0"`, never `"-0"` | BigInt has no negative zero and Python `str(-0)` is `"0"`. The canonical form is a consequence of the value model, not a normalization step the builder writes. **Builder must not** add a sign-stripping branch; if one is needed the value model is wrong. |
| Magnitude | **no *magnitude* cap, and no gating claim beyond i64** (RT10P-C5a); the payload's *size* is bounded by the existing `maxStringBytes` (RT10P-C15) | `KernKirLimits` (`kir-runtime/contracts.ts:20`) has no integer-magnitude field. Adding `maxIntegerDigits` changes the public request schema, request validation, every fixture that builds limits, both emitted kernels, and fault precedence against the step and envelope limits. That is a resource-governance slice. Enforcing the *existing* per-string limit on a minted payload adds no field and no new fault code, so it is not that slice — see RT10P-C15. |
| Wire | a big integer survives the request boundary in both directions | Verified: an argument `{tag:"integer", value:"18446744073709551617"}` executes and the envelope carries the value as a JSON **string**, so no double is ever constructed. |

The reference (non-linked) semantics at `packages/core/src/ir/semantics/lambda-runtime.ts:138-170`
evaluate `+ - * / %` over host `number`. **That lane is not the model and must not be copied.**

### [RT10P-C5a DECIDED] Range and exactness are separate contracts — the number-model ruling

Ruled 2026-09-02, closing the former RT10P-O2 conflict between RT-8's follow-up and RT-3's
precedent. Three contracts, three owners:

| Contract | Governs | Owner |
| --- | --- | --- |
| **Range** | `integer` is a signed-64-bit-safe integer | the number-model tribunal |
| **Totality, named-helper lowering, exactness *within* range** | this slice | RT-10-pre |
| **Magnitude enforcement** — whether exceeding i64 faults, and with what fault | deferred | the resource-governance slice |

So this slice still computes exactly and still applies no cap, but it **gates** only on values
whose operands and results lie in `[-2^63, 2^63)`. The rows beyond that range are executed and
reported by the oracle and asserted by nothing: they live in `precision-probe.json`, and the
governance slice turns them into fault rows if it adopts i64 faulting. Moving them out of the
gating table is what keeps this slice from silently ratifying an unbounded range contract it
does not own.

The gating table still carries rows in `(2^53, 2^63]` for **every** operator, so a
double-precision shortcut on any leg still dies:

| Row | Expression | Frozen |
| --- | --- | --- |
| `add-s53-twice` | `9007199254740993 + 9007199254740993` | `18014398509481986` |
| `add-i64-max` | `4611686018427387903 + 4611686018427387904` | `9223372036854775807` |
| `sub-i64-max-minus-s53` | `9223372036854775807 - 9007199254740993` | `9214364837600034814` |
| `mul-i64-near-max` | `3037000499 * 3037000499` | `9223372030926249001` |
| `mul-i64-near-max-neg` | `-3037000499 * 3037000499` | `-9223372030926249001` |
| `neg-i64-max` | `-9223372036854775807` | `-9223372036854775807` |

`behavior.test.mjs` asserts the range invariant on the table itself before any row runs, so a
future row that leaves i64 fails the suite rather than quietly widening the gate. The invariant
scans **leaf literals and the final result**, not intermediates, so a row must additionally be
read for intermediate overflow by hand: the original `add-i64-max` row was
`4611686018427387904 + 4611686018427387904 - 1`, whose left subtree evaluates to exactly `2^63`
— outside the gated interval, and therefore an out-of-range *result* of the `+` node that the
scan could not see. Replaced with `4611686018427387903 + 4611686018427387904`, which reaches
`2^63 - 1` with no intermediate leaving the range, and re-verified with `node` BigInt and
`python3` (both `9223372036854775807`).

### [RT10P-C6 DECIDED] An integer parameter gains a static type — the RT-8 orphan

`link.ts:436` records the parameter's static type as
`type.kind === 'boolean' ? 'boolean' : undefined`. `LinkedKernKirStaticType` is exactly
`'boolean' | 'integer'`, so the honest form is the closed one:

```ts
bindName(scope, name, type.kind === 'boolean' || type.kind === 'integer' ? type.kind : undefined, linkedKirCrossCallType(type));
```

**Evidence this is a live orphan, not a nicety.** Measured at base:

| Fixture | Base link result |
| --- | --- |
| `param a,b integer` / `return a < b` | `entry.function.handler.children[0].value: KIR_BINARY_OPERAND_TYPE` |
| `param a integer` / `return a` | `LINKED-OK` |

So RT-8's integer signature is admitted and then unusable in any expression. Without this
change, `a + b` and `-a` would be refused **after** this slice for their operands, which is
the M17 defect class (a fail-closed refusal of a legal program).

This is the **only** row in the corpus whose base failure string is not the operator or unary
refusal, and it is declared as such in *RED evidence*. It moves no exported union and no prior
golden: RT-3's `expressionAdmission` matrix uses boolean parameters and integer literals only.

### [RT10P-C7 DECIDED] The type gate and its labels

| Violation | Where | Code | Label |
| --- | --- | --- | --- |
| a binary arithmetic operand is not statically `integer` | `expression.ts:290-297` (existing) | `handler-entry-unsupported` | `KIR_BINARY_OPERAND_TYPE` |
| mixed operands (`integer` vs `boolean`) | idem | idem | `KIR_BINARY_OPERAND_TYPE` |
| `/`, `%`, `**`, bitwise, shift | `expression.ts:283-284` (existing) | idem | `KIR_BINARY_OP_UNSUPPORTED` |
| unary operator outside the table (`!`, `+`) | new unary arm | idem | `KIR_UNARY_OP_UNSUPPORTED` |
| unary operand is not statically `integer` | new unary arm | idem | `KIR_UNARY_OPERAND_TYPE` |
| an arithmetic result in an `if` condition | `link.ts:368-370` (existing) | idem | `KIR_IF_COND_NOT_BOOLEAN` |
| an arithmetic result as a call argument | `expression.ts:153` (existing) | idem | `KIR_CALL_ARGUMENT_TYPE` |

**Deliberate deviation from the brief, recorded.** The brief proposed an operator-specific
label (`KIR_ARITHMETIC_OPERAND_NOT_INTEGER`). This spec reuses `KIR_BINARY_OPERAND_TYPE`
because the gate that fires is *literally the RT-3 gate*, unchanged, driven by the
`satisfies`-checked `operandType` column. Inventing a second label would require a second
branch in `expression.ts` where one already exists and is already pinned by RT-3's type-gate
suite. A new label is introduced only where a new gate genuinely exists — the unary arm. Rows
that share a label are separated by the fault's **path label**
(`entry.function.handler.children[0].value`) and by the fixture, exactly as RT-3's eight
operators already share one label.

A static type exists only for: a boolean literal, a canonical integer literal, a boolean or
**integer** parameter (RT10P-C6), a `let` whose initializer has one, a binary (its
`resultType`), and a unary (`integer`). Capability results, member reads, `Json` results,
text, decimals, lists and every non-boolean call result have none and can never be an
arithmetic operand.

### [RT10P-C8 VERIFIED] `crossCallExpressionType` must stop answering `boolean` for a binary

`crossCallExpressionType` (`expression.ts:83-103`) returns `'boolean'` for **any** binary node.
`compileUserCall` gates a call argument on it (`expression.ts:153`). So with arithmetic
admitted and this line untouched, `hb(1 + 2)` — `hb` taking `param flag boolean` — passes the
link-time argument gate, and `calleeBindings` then throws `KIR_CALL_ARGUMENT_TAG` at run time
(`kir-runtime/expression.ts:117-119`). A link refusal silently becomes a runtime failure on
all three legs.

Required form, driven off the same table so it cannot drift from RT10P-C4:

```ts
if (expression.kind === 'binary') {
  return LINKED_KIR_BINARY_OPERATORS[expression.op].resultType === 'boolean' ? 'boolean' : undefined;
}
if (expression.kind === 'unary') return undefined;
```

`undefined` is correct rather than `'integer'` because `LINKED_KIR_CROSS_CALL_TYPES`
(`contracts.ts:38-43`) has **no integer row** — see RT10P-C14.

Pinned by the negative row `neg-arith-call-argument`, whose expected label is
`KIR_CALL_ARGUMENT_TYPE`.

### [RT10P-C9 DECIDED] Metering is inherited: one `meter.step()` per expression node

Model **measured at base** on nine rt3-linkable controls, not assumed:

> execution steps = (statements executed, `return` included on the entry)
> + (expression nodes evaluated)
> + (declared parameters)

| Control | Measured `execution` | Derivation |
| --- | --- | --- |
| `return 1` | 2 | 1 statement + 1 literal |
| `return 1 < 2` | 4 | 1 + (1 binary + 2 operands) |
| `let n=1` / `return n` | 4 | 2 + 2 |
| `let b=true` / `let c=1<2` / `return c` | 8 | 2 + 4 + 2 |
| `return (1<2)==(2<3)` | 8 | 1 + 7 nodes |
| `return flag` (1 boolean param) | 3 | 1 + 1 + 1 parameter |
| `return flag && other` (2 params, both read) | 6 | 1 + 1 + 1 + 1 + 2 parameters |
| `return flag` (2 params, one unread) | 4 | 1 + 1 + **2** parameters — the parameter charge is per *declared* parameter, not per read |
| `return (flag == flag) == flag` (1 param, 3 reads) | 7 | 1 + 5 nodes + 1 parameter |

**This corrects RT9-C8a.** RT-9 recorded "a parameter read costs 2 expression steps"; that is
an approximation which coincides only when a parameter is read exactly once. The charge is one
step per *declared* parameter for request inspection, plus one step per expression node
evaluated. Every constant RT-9 pinned is unchanged under the corrected model.

Arithmetic adds no term: a binary arithmetic node costs `1 + left + right`, a unary node costs
`1 + argument`, and **no helper call adds a tick of its own**. One tick per helper would
double-charge relative to the inherited expression-node model. Derived counts are in *Metering
fixtures*.

Note that a step count cannot distinguish precedence: `2 * 3 + 4` and `2 * (3 + 4)` both cost
6. That is why the frozen value table, not the meter, is the precedence oracle.

### [RT10P-C10 DECIDED] Zero new await points, no new checkpoint

All four helpers are synchronous and total. RT-1 evaluates them inside the existing
synchronous `evaluateExpression` switch; both emitted kernels evaluate them inside the
existing synchronous helper prelude. Cancellation stays at the statement boundary RT-2 pinned.

**Builder must not** introduce any `await`, `setImmediate`, `queueMicrotask`, `Promise`, or
additional `checkAbort()`/`_check_abort()` site under `packages/core/src/kir-runtime/` or in
either emitter's expression path. `git diff` must add **zero** occurrences.

`tick-discipline.test.mjs` pins this three ways: absolute step counts; a static assertion that
the RT-1 arithmetic dispatch region and both emitted helper preludes contain no `await`; and
the RT-2 queued-abort fence at microtask depths 0-4 comparing RT-1 to the emitted JavaScript
byte for byte.

### [RT10P-C11 VERIFIED] Named helpers only — the emitters' binary case does not change

Emitted expression bodies must never contain a host `+`, `-` or `*` applied to a KIR integer.
`kir-js-esm/emitter.ts:110-119` and `kir-python/emitter.ts:100-109` already emit
`helper(left,right)` for every non-`logical` family, so admitting `arithmetic` needs **no
emitter binary change**; the emitters gain only a `unary` case and the four target-kernel
helpers.

Helper bodies themselves necessarily use host `BigInt`/`int` arithmetic — the prohibition is
on semantic lowering, not on implementing arithmetic. The structural assertion therefore scans
the emitted **specialized handler statement region**, not the target kernel prelude.

Target-kernel helper shape (JS, next to `__lt` at `target-execution.ts:112`):

```js
const __intValue = (value) => Object.freeze({ tag: 'integer', value: String(value) });
const __add = (left, right) => __intValue(__intOperand(left) + __intOperand(right));
const __sub = (left, right) => __intValue(__intOperand(left) - __intOperand(right));
const __mul = (left, right) => __intValue(__intOperand(left) * __intOperand(right));
const __neg = (operand) => __intValue(-__intOperand(operand));
```

Python twin next to `_lt` (`target-execution.ts:147`), using `_int_operand` and `str(...)`.
Both must carry the `KIR_BINARY_OPERAND_TYPE` label through the existing `_operand_fault` /
`__operandFault` path so the defense-in-depth label is identical on all three legs (the RT-3
lesson, mutant 11 of that slice).

### [RT10P-C12 VERIFIED] Three expression walkers, and all three now have a tripwire

| Walker | Site | Behavior on an unknown variant |
| --- | --- | --- |
| `containsAsyncCall` | `linked-kir-program/expression.ts:112-135` | `default:` calls `asyncCallVariantUnhandled(expression: never)` — **`tsc` error**, the designed tripwire |
| `expressionInvokesCapability` | at base `linked-kir-program/contracts.ts:225-226`, `default: return false` — **silent**; now `default:` calls `expressionVariantUnhandled(expression: never)` |
| `expressionCallDepth` | at base `linked-kir-program/contracts.ts:290-291`, `default: return 0` — **silent**; now the same tripwire |

All three must gain a `unary` arm that recurses into `argument`. Two of them will compile
happily without it, which is exactly why `walker-coverage.test.mjs` builds a linked
`{kind:'unary', op:'-', argument:<call>}` node by hand and asserts all three look inside it.
At base, `containsAsyncCall` throws `unhandled linked expression variant unary` and the other
two answer `false`/`0` — three RED rows, each for the right reason.

**Amended by the review round.** A `unary` arm closes today's gap and leaves tomorrow's open:
the two permissive `default:` arms would admit the *next* expression variant with no `tsc`
error, exactly as they admitted this one. Both now enumerate `literal` and `identifier`
explicitly and route `default:` through a shared `expressionVariantUnhandled(expression: never)`
that throws `handler-entry-unsupported` at `link`, mirroring `containsAsyncCall`. Verified by
adding a probe variant to `LinkedKernKirExpression`: `tsc -b` then reports
`TS2345 … not assignable to parameter of type 'never'` at three sites — the two walkers and
`containsAsyncCall`. `walker-coverage.test.mjs` grew from 5 to 8 rows: each walker is called with
an unknown-kind node and must throw the closed link fault rather than answer `false`/`0`.

**Both walkers stay in `contracts.ts`, which the tripwire pushes to 503 lines, and the split is
deferred with a hard reason.** Extracting them into `linked-kir-program/walkers.ts` was
implemented and reverted: a new source file under `packages/core/src` becomes a new compiled-core
`.js`, and `scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:10-13` pins the
compiled-core inventory at an authenticated `count: 354` plus a path digest. Moving it to 355
fails `check-kern-canonicalizer-coverage.mjs` with *C-PY-1 lowering historical membership requires
the authenticated current inventory*, and that file is a historical attestation — not in *Allowed
files*, and re-attesting it is not an admission slice's decision. Three lines over a soft
style ceiling is the cheaper of the two costs. A slice that may re-attest the compiled-core
inventory should do the split.

The type gate makes a call inside a unary unreachable through F5 (a boolean-returning call is
refused as `KIR_UNARY_OPERAND_TYPE`, and an integer-returning call is not callable at all —
RT10P-C14), so these arms are defense in depth. RT-3 set the precedent that defense in depth
is still pinned.

`scripts/kern-5-rt5-async-user-fn-call/variant-coverage.test.mjs:51-58` independently enforces
that every member of `LinkedKernKirExpression` has a row in its coverage table, so the `unary`
row there is mandatory — see *Blast radius*.

### [RT10P-C15 VERIFIED] An arithmetic result is bounded by the existing `maxStringBytes`

Found by review, measured before it was fixed: with `maxStringBytes: 20`, the program
`return 10000000000 * 10000000000` produced the 21-digit payload `100000000000000000000` and
**succeeded on all three legs**. Arithmetic is the only expression in the linked lane that mints
a new integer payload — every other integer arrives either through request inspection
(`inspect.ts:160-167` already calls `meter.text`) or as a frontend-validated literal — so it was
the one path where the per-string limit had no reader.

The contract: **if the canonical decimal text of an arithmetic result is longer than
`limits.maxStringBytes`, every leg raises the limit fault the runtimes already raise for an
oversized value.** No new fault code, no new limit field, no new envelope shape.

| Leg | Site | Enforcement |
| --- | --- | --- |
| RT-1 | `kir-runtime/expression.ts` `integerValue(value, meter)` | `meter.text(String(value), 'arithmetic result')` → `KernKirFault('runtime-limit-exceeded', 'execution', …)`, the same call `inspect.ts:52` makes for request text |
| emitted JavaScript | `kir-js-esm/target-execution.ts` `__intValue(value, meter)` | `meter.text(String(value))` → `__Fault('runtime-limit-exceeded','execution')` (`target-base.ts:81-87`) |
| emitted Python | `kir-python/target-execution.ts` `_int_value(value, meter)` | `meter.text(str(value))` → `_Fault("runtime-limit-exceeded", "execution")` (`target-base.ts:135-139`) |

**The bound is checked before the conversion, not after it.** A decimal conversion of an `n`-digit
integer is quadratic, so measuring `String(value).length` to decide whether the value was allowed
means paying the cost of a value that was never allowed. Every leg therefore derives a *lower*
bound on the decimal digit count from the binary size first — Python `int.bit_length()`, JS and
RT-1 `magnitude.toString(16)` (linear) plus the leading nibble's width — and refuses without
converting when

> `floor((bits - 1) * log10(2)) + sign >= maxStringBytes + 1`

using the rational `30102/100000`, which is strictly **under** `log10(2)`, so the floor is never
above the true digit count and the pre-check can only refuse a value that genuinely cannot fit.
When the bound is inconclusive the exact `String`/`str` conversion runs and `meter.text` decides.
The consequence recorded as the contract: **conversion cost is bounded by `maxStringBytes`, not by
the operand magnitude.** The pre-check charges no step either — it is a refusal, not a node.

**The byte count is the canonical decimal text including the leading `-`.** `meter.text` measures
UTF-8 bytes of the whole string, so the sign was already counted on the exact path; the pre-check
adds `+ sign` to match it. Three gating rows pin that this is identical on all three legs, at
`maxStringBytes: 20`:

| Fixture | Result | Bytes | Contract |
| --- | --- | --- | --- |
| `size-at-limit-negative` | `-1000000000 * 1000000000` → `-1000000000000000000` | 19 digits + sign = 20 | success |
| `size-over-limit-negative` | `-9999999999 * 9999999999` | 20 digits + sign = 21 | fault |
| `size-negate-fitting` | `let n = 9999999999 * 9999999999` / `assign n = -n` | 20 → 21 | the product is admitted and its negation is not, which only the sign explains |

**The operand side is bounded too, and not by this slice.** A result bound is half a bound: an
oversized integer *literal* would make the operand side unbounded. It cannot —
`canonicalScalar` (`linked-kir-program/expression.ts:39-50`) already runs every integer and decimal
literal's canonical text through `meter.text`, so a literal longer than `maxStringBytes` is refused
at **link** with the same `runtime-limit-exceeded` / `execution` fault, on all three legs. Verified
and pinned in `type-gate.test.mjs` with a 30-digit literal at `maxStringBytes: 20`, together with
the row proving the same literal is admitted under the suite default — so the gate is the limit and
not the literal's shape. `**` and the shifts, the only other operators that could amplify magnitude
cheaply, stay fail-closed (T3, T4, and `>>` has no table row at all).

**A nested intermediate faults at its own operator node.** `(a * b) + (c * d)` with an overflowing
product on either side faults at that product, before the `+` ever runs:

| Fixture | Contract |
| --- | --- |
| `size-nested-left` | `(10000000000 * 10000000000) + (2 * 3)` faults; the `print` ahead of it is committed, the one after it never runs |
| `size-nested-right` | `(2 * 3) + (10000000000 * 10000000000)` faults with the identical envelope |
| `size-nested-control` | `(9999999999 * 9999999999) + (2 * 3)` succeeds at exactly 20 bytes and costs exactly 8 execution steps |

`tick-discipline.test.mjs` sweeps 90 step budgets for both overflowing variants: neither succeeds at
any budget, the committed-event count is monotonic in the budget, and it ends at exactly one — so
the fault is the result bound and never a step budget the fixture happened to exhaust. **What is
not pinned, and why:** a size fault and a step-limit fault share one diagnostic code and produce
byte-identical envelopes, so the *step index* at which the fault fired is not separable from the
envelope. The step count is pinned on the structurally identical in-limit twin instead, and
left-to-right order stays structurally pinned by RT10P-C13.

The meter reaches the helpers the way it already reached `json-call`: `__meter` / `_meter` is in
scope at every expression node, so both emitters pass it as the arithmetic helpers' last
argument (`family === 'arithmetic'` and the `unary` case only — the logical and comparison arms
are byte-identical to base, which keeps RT10P-C11 intact). RT-1's evaluator tables take the
meter as a third parameter that the boolean-producing rows simply do not declare.

`meter.text` charges **no step** (`inspect.ts:50-56` calls `check()`, not `step()`), so every
pinned metering constant is unchanged — verified: `tick-discipline` is 21/21 with the new
`size-at-limit` fixture pinned at 4, exactly its arithmetic-free twin `add-return`.

Three gating fixtures, all three-leg byte-identical, with `maxStringBytes: 20` in the request:

| Fixture | Program | Contract |
| --- | --- | --- |
| `size-at-limit` | `return 9999999999 * 9999999999` | success, `99999999980000000001`, exactly 20 bytes |
| `size-over-limit` | `return 10000000000 * 10000000000` | failure, one `runtime-limit-exceeded` / `execution` diagnostic, `result: {presence:"absent"}` |
| `size-fault-position` | `print "a"` / `let n = 10000000000 * 10000000000` / `print "b"` / `return n` | failure, and `events` is exactly `[{op:"stdout",text:"a"}]` — the fault fires **at the operator node**, so the following statement never runs and the limit is not deferred to the envelope boundary |

This does **not** change the deferred magnitude cap. `KernKirLimits.maxIntegerDigits` remains
the intended long-term bound and remains the resource-governance slice's to add: `maxStringBytes`
bounds the *serialized payload*, which is a byte budget shared with text and already part of the
public request schema, while `maxIntegerDigits` would bound *magnitude* with its own fault
precedence against the step and envelope limits. C15 removes an unbounded amplification; it does
not pre-empt the cap.

### [RT10P-C15a VERIFIED] The emitted Python kernel lifts CPython's int/str digit cap

CPython ≥ 3.11 raises `ValueError` on any `int`↔`str` conversion over 4300 digits
(`sys.set_int_max_str_digits`). Measured before the fix: a nine-times-squared ten-digit seed
reaches 5120 digits; RT-1 and the emitted JavaScript both returned it, and the emitted Python leg
returned `handler-link-error` — a three-leg divergence on a value both other legs call exact,
inside a `maxStringBytes` the request allows.

**The lift is confined to each conversion, not process-global.** The first fix called
`sys.set_int_max_str_digits(0)` once at kernel start; review ruled that out, because the emitted
module may be imported into an interpreter an embedder shares, and a module-level call silently
removes a safety limit for everything else in that process for its whole lifetime. The kernel now
wraps each conversion instead: `_lifted_digits(convert, argument)` reads
`sys.get_int_max_str_digits()`, sets 0, converts, and restores the previous value in a `finally`,
guarded with `hasattr` for < 3.11. Applied at every site the cap governs — `_int_value`'s
`str(value)` on the way out, and `_int_operand` and `_same_operands`' `int(text)` on the way in,
because a legitimate operand payload can be longer than 4300 digits whenever `maxStringBytes` is.

**Accepted and recorded:** the mutation is still interpreter-global while the window is open, so an
embedder running other threads in the same interpreter may observe the lifted cap for the duration
of one conversion. That is the smallest window CPython's API allows — the limit is a process
setting with no per-thread or context-local form — and the alternative, a hand-rolled chunked
decimal conversion, would put a second arithmetic implementation on one leg only.

`_data_text`'s `str(value)` on an int is deliberately **not** wrapped: KIR integer payloads are
already strings by the time they reach it, and the 5120-digit gating row passing is the evidence
that no large int reaches that path.

The restore cannot be observed through the envelope, so it is pinned from outside: a purpose-built
driver (`digit-window-driver.py`) imports the emitted module, runs it, and reports
`sys.get_int_max_str_digits()` at import, after import and after execution. All three must equal
CPython's 4300 default while the run itself returns the 5120-digit value — which fails if the
kernel-start call comes back, and fails if the `finally` restore is dropped.

The gating value row is three-leg, not a precision-probe row — the probe table asserts nothing by
ruling, so a row there could not have caught this. `behavior.test.mjs` builds the squaring chain
from a ten-digit literal (nine `let`s, each squaring the previous binding), asserts the result
clears 4300 digits, and compares all three legs byte for byte against a `BigInt` recomputation.
No 5000-digit literal is committed anywhere: the seed and the depth are, and the expected value is
recomputed in the test.

### [RT10P-C13 DECIDED] Left-to-right evaluation order is unobservable in this slice

Every admitted operator is total and effect-free, and no operand can carry an effect: `print`
is a statement, a capability is a statement, an async call is refused in expression position
(`KIR_ASYNC_CALL_EXPRESSION_POSITION`), and no integer-returning helper is callable
(RT10P-C14). Both operands are always evaluated, and the step count is order-independent.

**There is therefore no behavioural fixture in this slice that can observe operand order.**
The brief asked for "a left-to-right evaluation-order probe via metered cross-calls"; that
probe is unbuildable on this base and a fixture claiming to be one would be vacuous.

Order is pinned **structurally** instead, three ways:
1. RT-1 evaluates `left` then `right()` in the existing `BINARY_EVALUATORS` shape
   (`kir-runtime/expression.ts:235-237`) — the evaluator table is pinned by the K0 golden.
2. Both emitters emit `helper(<left source>,<right source>)`, and `behavior.test.mjs` asserts
   the emitted specialized region contains the operands in source order for a fixture whose
   two operands are distinguishable literals.
3. The order oracle is **queued with the division slice**, where a zero divisor makes the
   right operand's evaluation observable through a fault. This is recorded as the first
   fixture that slice owes.

### [RT10P-C14 DECIDED] Integer cross-calls are deferred — the facts file was wrong

`LINKED_KIR_CROSS_CALL_TYPES` (`contracts.ts:38-43`) admits `boolean`, `list<boolean>`,
`list<text>`, `text` — **no integer row**. Measured at base:

| Fixture | Base link result |
| --- | --- |
| `fn hi returns=integer` / `return hi()` | `KIR_CALL_SIGNATURE_TYPE` (`expression.ts:148`) |
| `fn idp param a integer returns=integer` / `return idp(1)` | `KIR_CALL_SIGNATURE_TYPE` (`expression.ts:151`) |

So no integer helper is callable in either direction, and `staticExpressionType`'s user-call
arm answers `'boolean'` or nothing (`expression.ts:74-76`). **The rt10-pre facts file claim
"integer cross-calls exist since RT-4/RT-8" is false** — this is the same finding RT-9 logged
as RT9-C5a, and the brief's "integer cross-call operands" probe rows are unbuildable.

Admitting them means widening an exported type union (`LinkedKernKirCrossCallType`,
`LINKED_KIR_CROSS_CALL_TYPE_NAMES`) plus the `staticExpressionType` call arm, which changes
the call-argument gate for every caller and, once RT-9 lands, the assign type gate too. That
is a separate admission edge and it is **deferred**, with both rows above kept as fail-closed
regression fences.

### [RT10P-R1 ACCEPTED RISK] One uninterruptible big multiplication per operator node

Raised by review at 0.97: a `*` node costs exactly one `meter.step()` and performs one
uninterruptible host multiplication, so neither `maxSteps` nor the timeout bounds the CPU or the
allocation of that single operation.

**Accepted, not mitigated, and the bound is why.** With RT10P-C15 in place both operands and the
result are bounded by `limits.maxStringBytes` — operands by request inspection, by
`canonicalScalar`'s literal check and by the previous result's own bound, and the result by the
bit-length pre-check that refuses before converting: an operand reaches a helper only as a
request-inspected payload, a frontend-validated literal, or a previous arithmetic result, and all
three are `meter.text`-bounded. So per-operation cost is polynomial in `maxStringBytes` —
schoolbook-to-Karatsuba multiplication of two `n`-digit integers, with `n ≤ maxStringBytes` — which
is exactly the model RT-3's comparison operators already carry: `BigInt(left) < BigInt(right)`
parses two `maxStringBytes`-bounded payloads inside one metered node with no checkpoint either.

Therefore **no checkpoint inside an expression and no per-digit charge**. Both are forbidden, and
for the same reason they were forbidden before: RT10P-C10 pins zero new await points and zero new
`checkAbort()` sites, and `tick-discipline.test.mjs` asserts it statically and through the RT-2
queued-abort fence at microtask depths 0-4. A per-digit charge would additionally break every
pinned metering constant and the six inherited-metering identities.

**The tightening lever is the governance slice's `maxIntegerDigits`**, which bounds magnitude
directly and can be set far below `maxStringBytes`. A deployment that considers a
`maxStringBytes`-sized multiplication too expensive lowers `maxStringBytes`; a deployment that
wants a magnitude bound independent of the text budget waits for that slice. Recorded so the next
reviewer sees a ruling rather than a gap.

### Pre-registered contracts — DEFERRED, do not build

Recorded now so the next slices inherit the decision instead of re-litigating it.

| Deferred | Pre-registered semantics | Fail-closed today |
| --- | --- | --- |
| `/` | **truncate toward zero** (T-division). `(-a)/b = -(a/b) = a/(-b)`; matches JS `BigInt`, C99, LLVM, WASM, the JVM. Python implements it without any float step: `q = abs(a)//abs(b)`, negated when the signs differ. `int(a/b)` is forbidden — it converts to float. | `KIR_BINARY_OP_UNSUPPORTED` |
| `%` | truncated remainder, `r = a - trunc(a/b)*b`; `r` is zero or carries the **dividend's** sign; `abs(r) < abs(b)`; `q*b + r == a` | `KIR_BINARY_OP_UNSUPPORTED` |
| zero divisor | `KernKirFault('unsupported-runtime-input', 'execution', 'KIR_INTEGER_DIVISION_BY_ZERO')`, raised **inside** the named helper on every leg so no host `RangeError` / `ZeroDivisionError` escapes. Wire shape is the existing failure envelope, which drops the fault message; previously committed events are retained. No special link-time rule for a literal zero denominator. | n/a |
| magnitude cap | `KernKirLimits.maxIntegerDigits`, enforced identically on all three legs, with fault precedence declared against the step and envelope limits — a **resource-governance** slice | no cap |
| `**` | domain unresolved (negative exponent, `0 ** 0`) and it needs the fuel policy the cap slice defines | `KIR_BINARY_OP_UNSUPPORTED` |
| integer cross-calls | RT10P-C14 | `KIR_CALL_SIGNATURE_TYPE` |
| bitwise / shifts, mixed numeric coercion, decimal arithmetic, text `+` | out of profile | `KIR_BINARY_OP_UNSUPPORTED` / `KIR_BINARY_OPERAND_TYPE` |
| **per-program kernel assembly** | `KERNEL_SOURCE` is a module-level constant (`kir-js-esm/emitter.ts:23`, `kir-python/emitter.ts:22`) concatenating the whole target kernel into every artifact, so **every** emitted-artifact digest moves on any slice that adds a kernel helper — including artifacts for programs that use none. Assembling the kernel per program would keep an arithmetic-free artifact byte-identical and let each artifact carry only the helpers it calls. It trades one canonical kernel for a per-program one, so it needs its own reproducibility and audit ruling: a **compiler-architecture** slice, not an admission slice. Ruled out of RT-10-pre by the coordinator on 2026-09-02. | whole-program kernel; artifact digests re-sealed per kernel-helper slice |

---

## Sites the builder must touch

| File:line | What |
| --- | --- |
| `kir-runtime/linked-kir-program/contracts.ts:5-25` | `LinkedKernKirBinaryOperator` gains `'+' \| '-' \| '*'`; the contract interface gains `resultType`; `family` gains `'arithmetic'`; three table rows added and `resultType` added to all eight existing rows (RT10P-C4). |
| `contracts.ts` (new, next to the binary table) | `LinkedKernKirUnaryOperator`, `LinkedKernKirUnaryOperatorContract`, `LINKED_KIR_UNARY_OPERATORS`, `linkedKirUnaryOperator` (RT10P-C3). |
| `contracts.ts:82-111` | `LinkedKernKirExpression` gains the `unary` variant. Placement inside the union is free; the RT-3 golden scrapes the union with `/readonly kind: '([a-z-]+)'/gu`. |
| `contracts.ts:212-227` | `expressionInvokesCapability` gains a `unary` arm — **silent default today** — and, per the review round, an exhaustive `never` tripwire (RT10P-C12). |
| `contracts.ts:274-292` | `expressionCallDepth`, same two changes. |
| `linked-kir-program/index.ts` | re-export the unary operator contract next to the binary one. |
| `linked-kir-program/expression.ts:72` | `staticExpressionType`: binary answers `LINKED_KIR_BINARY_OPERATORS[op].resultType`; new `unary` arm answers `LINKED_KIR_UNARY_OPERATORS[op].resultType`. |
| `expression.ts:87` | `crossCallExpressionType`: binary answers `'boolean'` only when `resultType` is `'boolean'`, otherwise `undefined`; `unary` answers `undefined` (RT10P-C8). |
| `expression.ts:112-135` | `containsAsyncCall` gains a `unary` arm. `tsc` fails until it does. |
| `expression.ts:281-299` | the binary arm needs **no change** — the op table and the operand gate already do the work. |
| `expression.ts` (new arm before `:331`) | `if (kind === 'unary')`: `canonicalRecord(fields, ['argument','op'], …)`, `linkedKirUnaryOperator` → `KIR_UNARY_OP_UNSUPPORTED`, compile the argument at `depth + 1`, `staticExpressionType` must equal `operandType` → `KIR_UNARY_OPERAND_TYPE`. |
| `kir-runtime/linked-kir-program/link.ts:436` | the parameter `bindName` records `'integer'` for an integer parameter (RT10P-C6). Nothing else in `link.ts` changes. |
| `kir-runtime/expression.ts:99-108` | `BINARY_EVALUATORS` gains `+`, `-`, `*` over `integerOperand`, plus an `integerValue` constructor. Per RT10P-C15 the evaluator types take the meter as a third parameter and `integerValue` bounds its payload with `meter.text`. |
| `kir-runtime/expression.ts:231-295` | `evaluateExpression` gains `case 'unary'` calling a `UNARY_EVALUATORS` table keyed by the operator union. |
| `compiler/kir-js-esm/target-execution.ts:112` | `__intValue`, `__add`, `__sub`, `__mul`, `__neg`; each takes the meter and `__intValue` calls `meter.text` (RT10P-C15). |
| `compiler/kir-js-esm/emitter.ts:110-119` | new `case 'unary'` emitting `helper(<argument>,__meter)`. The `binary` case gains one `family === 'arithmetic'` arm passing `__meter`; the logical and comparison arms are byte-identical to base (RT10P-C11). |
| `compiler/kir-python/target-execution.ts:147` | `_int_value`, `_add`, `_sub`, `_mul`, `_neg`; each takes the meter and `_int_value` calls `meter.text` (RT10P-C15). |
| `compiler/kir-python/target-base.ts:1-6` | `import sys` only. The digit-cap lift is **not** here — see RT10P-C15a. |
| `kir-runtime/inspect.ts` (`RuntimeMeter`) | `integerText(value, label)`: the bit-length pre-check plus `text`, shared by RT-1 and mirrored in both kernels (RT10P-C15). |
| `compiler/kir-python/emitter.ts:100-109` | new `case 'unary'` passing `_meter`; the `binary` case gains the same one `arithmetic` arm. |

Sites that must **not** change, with the reason: `link.ts:368-370` (the `if` condition gate is
already correct once `resultType` is honest); `link.ts:301-315` (`let` already records the
initializer's static type through `bindName`); `kir-runtime/execute.ts` (no new step kind);
`inspect.ts`, `digest.ts`, `envelope.ts`; `packages/core/src/ir/**` (the reference lane);
every `packages/core/src/schema.ts` and generated catalog entry.

## Blast radius outside `packages/core`

Adding a variant to `LinkedKernKirExpression` moves exactly one prior-slice golden and one
prior-slice coverage table, and four derived digests hang off them. **All four values are
computed in this spec** so a missed re-pin is a spec violation, not a discovery.

All values below are recomputed against the **RT-9 base** (`06b74443`); the RT-8-era values the
first draft carried are dead and are recorded in the Corrections Log.

| File | Action | Value |
| --- | --- | --- |
| `scripts/kern-5-rt3-binary-expression/k0-golden.json` | Modified | `linkedExpressionKinds` gains `"unary"` → `["binary","identifier","json-call","list","literal","member","record","unary","user-call"]`. Nothing else moves: `OPERATORS` in the RT-3 support file is a hard-coded eight-element list (`k0-support.mjs:45`), so `expressionAdmission` gains no row, and `rt2GoldenSha256` stays at RT-9's `cc7fb869…` because the RT-2 golden scrapes the **statement** union only. Digest `c8a94cc48ebc1e0a7c5364ab6b218a9471b30df02ef60e6fe8ab2d72d677d3f3` → **`cb5799446b64c83f82a4a5a044e2b680d41932b5305fffacf8bb5643e99cc7de`**. |
| `scripts/kern-5-rt5-async-user-fn-call/variant-coverage.test.mjs:40-49` | Modified | one `VARIANTS` row: `unary: { carries: true, wrap: (inner) => ({ argument: inner, kind: 'unary', op: '-' }) }`. Its test 1 asserts the table equals the RT-3 golden's `linkedExpressionKinds`, so this edit is forced by the golden move. |
| `scripts/kern-5-rt4-user-fn-call/probe-matrix.json:137` | Modified | `rt3GoldenSha256` → **`cb579944…`**. |
| `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs:13` | Modified | `RT3_PRE_SLICE_SHA256` `2664a39f…` → **`170faec94790627b1d453f05243799aaf6b788dd9c84f61243b67176727df226`** (the post-move golden with `"user-call"` removed — the transform that file already performs; the current constant was reproduced from the current tree by the same transform, which validates the derivation). |
| `scripts/kern-5-rt6-void-fallthrough/compatibility.test.mjs:27` | Modified | `RT3_GOLDEN_SHA256` → **`cb579944…`**. |
| `scripts/kern-5-rt9-linked-assign/compatibility.test.mjs:11` | Modified | `RT3_GOLDEN_SHA256` → **`cb579944…`**. RT-9 asserts the RT-3 golden is at *its* re-pinned seal, so the RT-3 move breaks RT-9's own guard — a dependent the first draft did not have. |
| `scripts/kern-5-rt9-linked-assign/compatibility.test.mjs:16` | Modified | `RT3_K0_GOLDEN_PRE_RT9_SHA256` `ac690563…` → **`0eca34b6680ca2861fe6cb03fb5c1a0e31326aceb1ee3307afa6650d064f2e86`**. This is a digest of the RT-3 golden with `rt2GoldenSha256` reset to RT-9's pre-image `aa7f116d…`, so it is a *second* derived constant that moves with the golden. |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:97` | Modified | `compiledCoreDigest` (currently `ca8b6b59a1b13a78b384b49a031087654c233eaf671eb636ebf7690642f8a808`) moves because `packages/core/src` changes. **No new source file may be added under `packages/core/src` in this slice**: `scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:10-13` pins the compiled-core inventory at an authenticated `count: 354` plus a path digest, and a 355th file fails the coverage write with *C-PY-1 lowering historical membership requires the authenticated current inventory*. That attestation is not in *Allowed files*. Then one `pnpm write:kern-canonicalizer-coverage` pass republishes the receipt JSONs; because that repin edited a `.mjs` under `scripts/kern-canonicalizer`, `coverageImplementationDigest` — which path-frames every `.mjs` in that directory — moves as a side effect, so **check whether a second `--write` pass is needed** (RT-9's log records the case where it was not). |
| `package.json` | Modified | one script, `test:kern-5-rt10-pre-linked-arithmetic`. |

RT-2's golden (`cc7fb869…`), RT-9's `RT2_GOLDEN_SHA256` and `RT2_K0_GOLDEN_PRE_RT9_SHA256`,
RT-9's own K0 golden (`2378f458…`, which scrapes the **statement** union), the F5 policy
(`e025392a…`) and RT-5's RT-2 digest do not move. They must pass **unmodified**.

**Amended 2026-09-02 (option (A) ruling) and again 2026-09-03 (review round).** This paragraph
originally also claimed that RT-4's and RT-6's **artifact** digests do not move, "because every
compatibility fixture in those suites is arithmetic-free". That reasoning is half right and its
conclusion is wrong: `KERNEL_SOURCE` is a whole-program module-level constant
(`kir-js-esm/emitter.ts:23`, `kir-python/emitter.ts:22`), so **every emitted-artifact digest in
the repository moves on any slice that adds or edits a target-kernel helper**, arithmetic-free
programs included. The standing rule, ruled by the coordinator and now applied twice in this
slice, is:

> an **artifact** digest (`javascript/pythonArtifactSha256` and its manifest) is expected to move
> whenever the target kernel changes; `linkedProgramSha256` and `projectionArtifactSha256` are
> **never** expected to move with it, and that second half is the assertion that keeps the first
> half honest.

Re-sealed in `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs` (20),
`scripts/kern-5-rt5-async-user-fn-call/compatibility.test.mjs` (48) and
`scripts/kern-5-rt6-void-fallthrough/k0-build-golden.json` (2) — 70 digest lines for the
arithmetic helpers, then the same 70 again for RT10P-C15's meter parameter and RT10P-C15a's
`import sys`. What the surviving half of the original claim really proves is still proved: in
every re-sealed row the linked and projection digests are byte-identical, so the delta is the
kernel text alone. RT-6's `compatibility.test.mjs` needs no edit — it recomputes against that
golden rather than carrying constants.

## Allowed files

- `packages/core/src/kir-runtime/linked-kir-program/{contracts,expression,link,index}.ts`
- `packages/core/src/kir-runtime/expression.ts`
- `packages/core/src/compiler/kir-js-esm/{contracts,emitter,target-execution}.ts`
- `packages/core/src/compiler/kir-python/{contracts,emitter,target-execution,target-base}.ts`
  (`target-base.ts` for RT10P-C15a only)
- `scripts/kern-5-rt10-pre-linked-arithmetic/**` (new)
- the prior-slice files enumerated in *Blast radius*, each limited to the stated edit. The
  authoritative list is that table, not a count — it grew from 7 to 10 as dependents were
  discovered (Corrections Log 2026-09-02) and to 13 when the artifact digests were re-sealed
  under option (A):
  1. `scripts/kern-5-rt3-binary-expression/k0-golden.json` — `linkedExpressionKinds`
  2. `scripts/kern-5-rt3-binary-expression/type-gate.test.mjs` — the operator fail-closed list
     and the eight-key table pin
  3. `scripts/kern-5-rt4-user-fn-call/probe-matrix.json` — `rt3GoldenSha256` and
     `linkedExpressionKinds`
  4. `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs` — `RT3_PRE_SLICE_SHA256` **and**
     20 artifact digests (option A)
  5. `scripts/kern-5-rt5-async-user-fn-call/variant-coverage.test.mjs` — the `unary` row
  6. `scripts/kern-5-rt5-async-user-fn-call/compatibility.test.mjs` — the hard-coded RT-3
     inventory **and** 48 artifact digests (option A)
  7. `scripts/kern-5-rt6-void-fallthrough/compatibility.test.mjs` — `RT3_GOLDEN_SHA256`
  8. `scripts/kern-5-rt6-void-fallthrough/k0-build-golden.json` — 2 artifact digests (option A)
  9. `scripts/kern-5-rt9-linked-assign/compatibility.test.mjs` — `RT3_GOLDEN_SHA256` and
     `RT3_K0_GOLDEN_PRE_RT9_SHA256`
  10. `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` plus the coverage receipts
      republished by `write:kern-canonicalizer-coverage`
- `package.json` — the RT-10-pre script, plus wiring RT-9 and RT-10-pre into
  `test:kern-5-script-family` (review round)
- `scripts/ci/test-tier-contract.test.mjs` — the matching `kern5EvidenceCommands` entries
- `.Codex/specs/kern-5-rt10-pre-linked-arithmetic/spec.md`

## FROZEN files

- All F0-F5 compositions (`examples/kern-frontend/**`) and
  `scripts/kern-frontend-f5-projection/{policy.json,policy-validation.mjs,worker.mjs}`.
  `compatibility.test.mjs` pins the F5 policy digest
  `e025392a83b6c6fecad31d7f92a2c34b67403bd0042b1cde9dc4b4223df80519` as a consuming assertion.
- `scripts/kern-frontend-closure/**` — no amendment record is written in this slice.
- `scripts/kir-structural/constitution.json`, `scripts/kir-v1/acceptance-policy.json`,
  `packages/core/src/schema.ts`, the generated structural catalog.
- `scripts/kern-5-admission-census/**`; every `.kern` file in the repository.
- `scripts/kern-5-rt2-boolean-if/**` in its entirety.
- `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs`, the RT-6 twin and
  `scripts/kern-5-rt9-linked-assign/compatibility.test.mjs` **except** the named digest literals
  (one, one and two respectively) — **and except the emitted-artifact digests**, which move on
  every kernel-helper slice under the option-(A) ruling; see the amendment at the end of *Blast
  radius*. What must pass untouched in all three is every `linkedProgramSha256` and every
  `projectionArtifactSha256`, and the re-seal is verified against exactly that: the committed
  diffs contain zero lines of either kind.
- `scripts/kern-5-rt9-linked-assign/**` apart from those two literals: RT-9's statement-union
  golden, behavior, type-gate and tick suites must pass unmodified.
- `packages/core/src/ir/**` — the reference lane, and specifically
  `ir/semantics/lambda-runtime.ts`.

## LOC budget

**≤ 250 net production lines.** Design estimate **~95**: contracts.ts +30 (`resultType` on
eight rows, three new rows, the unary table, two walker arms), linked expression.ts +22
(two type answers, one walker arm, the unary compile arm), link.ts +1, RT-1 expression.ts +14,
JS target kernel +6, JS emitter +5, Python target kernel +12, Python emitter +5. Crossing ~160
means RT10P-C4/C11 were misread — arithmetic is meant to reuse the RT-3 gate and the
non-logical emitter arm, not to grow new ones.

---

## Oracle

`scripts/kern-5-rt10-pre-linked-arithmetic/`, root script
`test:kern-5-rt10-pre-linked-arithmetic`, chained `node --test` in the RT-2…RT-9 pattern.
`k0-support.mjs` re-exports `scripts/kern-5-rt6-void-fallthrough/k0-support.mjs` (which
re-exports RT-4 → RT-2) and adds only RT-10-pre fixtures and helpers. No harness is
duplicated. The frozen expectations live in `behavior-table.json`, whose digest the K0 golden
pins, so a fixture cannot be quietly re-expected.

| Suite | Tests | What it pins | At base |
| --- | --- | --- | --- |
| `probe-matrix.test.mjs` | 9 | F5 facts only: projection status and diagnostic codes for 55 positions and all 34 gating expressions, plus the projected node shapes for 14 of them — the two `FRONTEND_INVALID_EXPRESSION` walls, the helper body, the F2 precedence pair, and the `assign` accumulator shape | **GREEN 9/9** — F5 already projects everything; the matrix is the sequencing gate and must stay green after the build |
| `compatibility.test.mjs` | 5 | the RT-2 golden byte-identical at RT-9's seal; the RT-3 golden at its post-slice seal with the one-element undo reproducing the pre-image; **five** derived literals across rt4/rt4/rt6/rt9/rt9 recomputed from the live golden; the RT-5 coverage row; the F5 policy digest unmoved | **RED 3/5** |
| `k0-golden.test.mjs` | 6 | the 55-row admission map; `LINKED_KIR_BINARY_OPERATORS` imported live from `dist` and serialized whole; the unary union and the expression union scraped from `contracts.ts`; the gating-table and precision-probe digests and row well-formedness | **RED 3/6** |
| `behavior.test.mjs` | 60 | the i64-range invariant on the table itself, all 34 gating rows three-leg byte-identical, the non-gating precision probe, `neg(0)`, the two parameter rows, the three `assign` rows, the three condition positions, the helper body, the two tag-proving failure envelopes, the named-helper census on both legs, the host-infix absence scan on both legs, the emitted operand order, and (review rounds) the three RT10P-C15 size rows, the three sign rows, the three nested-intermediate rows, the pre-check boundary and soundness pins, and the RT10P-C15a 5120-digit round trip with its process-limit restore probe | **RED 2/48 at base; 52 rows after the review round** |
| `type-gate.test.mjs` | 44 | 32 refusals, each with its **label text** pinned, the oversized-integer-literal admission bound and the magnitude-amplifying-operator fences (review round), plus the three label-disambiguation rows, the async-operand row, the `assign` admitted row, the admitted siblings that make each refusal non-vacuous, and the frontend-wall row | **RED 8/41** |
| `walker-coverage.test.mjs` | 8 | the three expression walkers over a hand-built linked `unary` node, and (review round) all three failing closed on an unknown-kind node (RT10P-C12) | **RED 0/5 at base; 8 rows after the review round** |
| `tick-discipline.test.mjs` | 23 | absolute `execution` counts on 17 rows, the nested-intermediate 90-budget sweeps (review round), (the sixteenth is RT10P-C15's `size-at-limit`, pinned at its arithmetic-free twin's cost), the six inherited-metering identities, the no-`await` static assertion on the RT-1 dispatch region and both emitted operator-helper regions, the checkpoint census against two arithmetic-free controls, queued-abort fences at microtask depths 0-4 on two fixtures, the pre-cancel fail-closed envelope | **RED 6/21** |

`probe-matrix` runs first — it proves every negative is a link decision and not a frontend
gap. `compatibility` runs second, in the rt4/rt5/rt6/rt9 position, so a drifted golden is
reported before any behavioural row is scored.

Label texts are asserted, not just the closed code — the RT-6 lesson
(`kern-5-rt6-void-fallthrough/k0-support.mjs:64-84`). `assertLinkLabel` is reused unchanged.

### Frozen behavior table

Expected values are **frozen constants**, computed with `node -e` BigInt and independently
cross-checked with `python3` `int`, then compared against all three legs. Cross-leg agreement
alone is not the oracle: three legs can agree on a wrong answer.

Verification commands (run 2026-09-02, output diffed and identical):

```
node /tmp/table.mjs | awk -F'\t' '{print $1"\t"$3}' > js.txt
python3 /tmp/table.py                                > py.txt
diff py.txt js.txt   # → no output

node /tmp/new.mjs   > new-js.txt   # the five i64-range rows, with an in-i64 assertion column
python3 /tmp/new.py > new-py.txt
diff new-js.txt new-py.txt   # → no output
```

| Row | Source expression | Expected `{"tag":"integer","value":…}` |
| --- | --- | --- |
| `add-small` | `7 + 3` | `10` |
| `add-neg-left` | `-7 + 3` | `-4` |
| `add-neg-right` | `7 + -3` | `4` |
| `add-both-neg` | `-7 + -3` | `-10` |
| `add-zero` | `0 + 0` | `0` |
| `add-s53` | `9007199254740993 + 1` | `9007199254740994` |
| `add-s53-twice` | `9007199254740993 + 9007199254740993` | `18014398509481986` |
| `sub-small` | `7 - 3` | `4` |
| `sub-negative-result` | `3 - 7` | `-4` |
| `sub-neg-left` | `-7 - 3` | `-10` |
| `sub-neg-right` | `7 - -3` | `10` |
| `sub-zero` | `0 - 0` | `0` |
| `sub-s53` | `9007199254740993 - 9007199254740992` | `1` |
| `sub-left-assoc` | `10 - 3 - 2` | `5` (right-associative would answer `9`) |
| `mul-small` | `7 * 3` | `21` |
| `mul-neg-left` | `-7 * 3` | `-21` |
| `mul-neg-right` | `7 * -3` | `-21` |
| `mul-both-neg` | `-7 * -3` | `21` |
| `mul-zero` | `0 * 7` | `0` |
| `mul-neg-zero` | `-7 * 0` | `0` — never `-0` |
| `neg-small` | `-7` | `-7` |
| `neg-s53` | `-9007199254740993` | `-9007199254740993` |
| `neg-of-sum` | `-(1 + 2)` | `-3` |
| `neg-double` | `-(-7)` | `7` |
| `prec-mul-then-add` | `2 * 3 + 4` | `10` (a right-leaning tree would answer `14`) |
| `prec-paren-add-first` | `2 * (3 + 4)` | `14` |
| `assoc-add-left` | `1 + 2 + 3` | `6` |
| `mixed-neg-mul` | `-2 * -3` | `6` |
| `mixed-deep` | `(2 + 3) * (4 - 9)` | `-25` |
| `add-i64-max` | `4611686018427387903 + 4611686018427387904` | `9223372036854775807` |
| `sub-i64-max-minus-s53` | `9223372036854775807 - 9007199254740993` | `9214364837600034814` |
| `mul-i64-near-max` | `3037000499 * 3037000499` | `9223372030926249001` |
| `mul-i64-near-max-neg` | `-3037000499 * 3037000499` | `-9223372030926249001` |
| `neg-i64-max` | `-9223372036854775807` | `-9223372036854775807` |

The eight rows whose operands or results leave `[-2^63, 2^63)` moved to
`precision-probe.json` under RT10P-C5a: `add-b64`, `add-b64-cancel`, `sub-b64`, `sub-b64-self`,
`mul-s53-square`, `mul-s53-neg-square`, `mul-b64-square`, `neg-b64`. `behavior.test.mjs`
executes all eight on all three legs and **prints** `frozen=… observed=…` for each, asserting
only that the probe ran. Their frozen values are preserved in that file so the governance slice
inherits them, and the spec's ruling is that they become fault rows if it adopts i64 faulting.

Seven rows do not come from the gating table because they are not plain integer results:

| Row | Program | Expected |
| --- | --- | --- |
| `neg-zero-through-binding` | `let z = 0` / `let n = -z` / `return n` | `{"tag":"integer","value":"0"}` — the only reachable `neg(0)`, since `-0` is a frontend wall (RT10P-C1) |
| `param-add` | `param a,b integer` / `return a + b`, args `9007199254740993` and `1` | `9007199254740994` — proves the operands came through the request path, not a baked-in literal |
| `arith-return-type-mismatch` | `returns=boolean` / `return 1 + 2` | link succeeds, execution fails `invalid-handler-result`, `events: []` — proves the result is tagged `integer` |
| `arith-print-tag` | `let n = 1 + 2` / `print n`, `returns=void` | execution fails `unsupported-runtime-input` (`print expects text`), `events: []` — the same proof from the other side |
| `assign-arith` | `let n = 1` / `assign n = n + 1` / `return n` | `{"tag":"integer","value":"2"}` — the accumulator shape rt10 needs, and the row that proves the target is read before it is written |
| `assign-neg` | `let n = 5` / `assign n = -n` / `return n` | `-5` |
| `assign-arith-params` | `param a,b integer` / `let n = 0` / `assign n = a + b` / `return n`, args `4` and `5` | `9` |

Every row is asserted three ways: RT-1's envelope against the frozen constant, then the
emitted JavaScript and the emitted Python envelopes byte-identical to RT-1's through
`threeLegBytes`.

### Negative fixtures

| # | Fixture | Expected label / status |
| --- | --- | --- |
| T1 | `6 / 2` | `KIR_BINARY_OP_UNSUPPORTED` |
| T2 | `7 % 2` | `KIR_BINARY_OP_UNSUPPORTED` |
| T3 | `2 ** 3` | `KIR_BINARY_OP_UNSUPPORTED` |
| T4 | `1 << 2` | `KIR_BINARY_OP_UNSUPPORTED` |
| T5 | `!flag` | `KIR_UNARY_OP_UNSUPPORTED` |
| T6 | `+5` | `KIR_UNARY_OP_UNSUPPORTED` |
| T7 | `"a" + "b"` | `KIR_BINARY_OPERAND_TYPE` |
| T8 | `1 + "a"` | `KIR_BINARY_OPERAND_TYPE` |
| T9 | `"a" + 1` | `KIR_BINARY_OPERAND_TYPE` |
| T10 | `true + true` | `KIR_BINARY_OPERAND_TYPE` |
| T11 | `1 + flag` (boolean param) | `KIR_BINARY_OPERAND_TYPE` |
| T12 | `flag + 1` | `KIR_BINARY_OPERAND_TYPE` |
| T13 | `1.5 + 1` | `KIR_BINARY_OPERAND_TYPE` |
| T14 | `[1, 2] + 1` | `KIR_BINARY_OPERAND_TYPE` |
| T15 | `t + t` (string param) | `KIR_BINARY_OPERAND_TYPE` |
| T16 | `capability … name=reply` / `reply + 1` | `KIR_BINARY_OPERAND_TYPE` |
| T17 | `h() + 1` (`h` returns boolean) | `KIR_BINARY_OPERAND_TYPE` |
| T17a | `ah() + 1` (`ah` **async**, returns boolean) | `KIR_BINARY_OPERAND_TYPE`, never the async-position label |
| T17b | `1 + ah()` | `KIR_BINARY_OPERAND_TYPE` |
| T18 | `-t` (string param) | `KIR_UNARY_OPERAND_TYPE` |
| T19 | `-flag` | `KIR_UNARY_OPERAND_TYPE` |
| T20 | `-1.5` | `KIR_UNARY_OPERAND_TYPE` |
| T21 | `-xs` (`integer[]` param) | `KIR_UNARY_OPERAND_TYPE` |
| T22 | `capability … name=reply` / `-reply` | `KIR_UNARY_OPERAND_TYPE` |
| T23 | `-h()` (`h` returns boolean) | `KIR_UNARY_OPERAND_TYPE` |
| T23a | `-(ah())` (`ah` **async**) | `KIR_UNARY_OPERAND_TYPE`, never the async-position label |
| T24 | `if cond="1 + 2"` | `KIR_IF_COND_NOT_BOOLEAN` |
| T25 | `hb(1 + 2)` (`hb` takes a boolean param) | `KIR_CALL_ARGUMENT_TYPE` — the RT10P-C8 row; without the fix this links and fails at run time |
| T26 | `1 + 2 > 2 > 1` | `KIR_BINARY_OPERAND_TYPE` — boolean against integer, RT-3's chained-comparison rule under an arithmetic left operand |
| T27 | `fn hi returns=integer` / `return hi()` | `KIR_CALL_SIGNATURE_TYPE` — RT10P-C14 fence, **green at base and must stay green** |
| T28 | `fn hi returns=integer` / `return hi() + 1` | `KIR_CALL_SIGNATURE_TYPE` — at base the op gate fires first, so this row only reports the right gate after the slice |
| T29 | `fn idp param a integer returns=integer` / `return idp(1)` | `KIR_CALL_SIGNATURE_TYPE` — green at base, must stay green |
| T30 | `return -0` | **not projected**, `FRONTEND_INVALID_EXPRESSION` — green at base |
| T31 | `return 007` | **not projected**, `FRONTEND_INVALID_EXPRESSION` — green at base |

T27, T29, T30 and T31 are among the `type-gate` rows that pass at base: they are fences on
behavior that must survive the change, exactly as RT-3's whole type-gate suite was.

**T17a/T17b/T23a are the async rows, and their label is the finding.** `compileLinkedExpression`
resolves the entire operand tree before `link.ts:337` calls `assertAsyncCallPosition`, so the
static-type resolver refuses an async boolean call for its *type* and the
`KIR_ASYNC_CALL_EXPRESSION_POSITION` label is **unreachable for arithmetic in this slice**. Each
row asserts both halves: the type label fires and the async label does not. They fail if the
unary arm forgets to resolve its argument at all, which is the defect they exist for; the
`containsAsyncCall` half of the same walk is covered by `walker-coverage.test.mjs`, because no
F5-projectable arithmetic operand can carry an async call once the type gate is correct.

### Metering fixtures

Absolute `execution` counts, hand-derived from the base-measured model of RT10P-C9. Controls
are rt3-linkable and were **measured** at base; arithmetic rows are derived and turn from
"no step budget in the scanned range linked the metering fixture" to the pinned constant.

| Fixture | Program | Derivation | Steps |
| --- | --- | --- | --- |
| `return-literal-control` | `return 1` | 1 + 1 | 2 (measured) |
| `return-binary-control` | `return 1 < 2` | 1 + 3 | 4 (measured) |
| `let-literal-control` | `let n=1` / `return n` | 2 + 2 | 4 (measured) |
| `add-return` | `return 7 + 3` | 1 + 3 | 4 |
| `add-let` | `let n = 1 + 2` / `return n` | 4 + 2 | 6 |
| `neg-return` | `return -7` | 1 + 2 | 3 |
| `neg-through-binding` | `let z=0` / `let n=-z` / `return n` | 2 + 3 + 2 | 7 |
| `neg-of-sum` | `return -(1 + 2)` | 1 + 4 | 5 |
| `prec-mul-then-add` | `return 2 * 3 + 4` | 1 + 5 | 6 |
| `prec-paren-add-first` | `return 2 * (3 + 4)` | 1 + 5 | 6 |
| `local-add` | `let a=4` / `let b=5` / `return a + b` | 2 + 2 + 4 | 8 |
| `param-add` | `param a,b integer` / `return a + b` | 1 + 3 + 2 | 6 |
| `param-neg` | `param a integer` / `return -a` | 1 + 2 + 1 | 4 |
| `mixed-neg-mul` | `return -2 * -3` | 1 + 5 | 6 |
| `assign-arith` | `let n=1` / `assign n = n + 1` / `return n` | 2 + 4 + 2 | 8 |
| `size-at-limit` | `return 9999999999 * 9999999999` | 1 + 3 | 4 — RT10P-C15's `meter.text` and pre-check charge no step |
| `size-nested-control` | `return (9999999999 * 9999999999) + (2 * 3)` | 1 + 7 | 8 |

Six identities are asserted over the pinned constants, so a constant cannot move alone:

1. `add-return == return-binary-control` — an arithmetic binary costs exactly what a
   comparison binary costs; there is no helper tick.
2. `neg-return == return-literal-control + 1` — a unary node costs exactly one tick plus its
   argument.
3. `prec-mul-then-add == prec-paren-add-first` — the meter is precedence-blind, which is why
   the value table is the precedence oracle (RT10P-C9).
4. `add-let - let-literal-control == 2` — the two extra operand nodes, nothing else.
5. `assign-arith - add-let == 2` and `assign-arith - let-literal-control == 4` — an
   arithmetic `assign` is one statement tick plus its three value nodes, exactly the RT9-C8
   `1 + ticks(value)` rule with an arithmetic value.

Plus the cancellation rows: the emitted checkpoint census on both legs against an
arithmetic-free control of the same statement shape, the RT-2 queued-abort fence at microtask
depths 0-4 on `add-let` and on an arithmetic condition inside a taken branch, and the
pre-cancelled fail-closed envelope (`execution-cancelled`, `events: []`, byte-identical RT-1
vs emitted JavaScript).

## Mutant list

Sixteen mutants at design time plus four from the review round, each argued non-equivalent
against the real RT-1 / JS / Python semantics rather than against the spec text. Twelve is the
standing floor.

| # | Mutant | Why it is not equivalent | Killed by |
| --- | --- | --- | --- |
| M01 | no arithmetic rows in `LINKED_KIR_BINARY_OPERATORS` | every arithmetic fixture is `KIR_BINARY_OP_UNSUPPORTED` again | `k0-golden`, all of `behavior` |
| M02 | no `unary` variant / no unary compile arm | every unary fixture is `unsupported expression kind unary` | `k0-golden`, `behavior` unary rows, `walker-coverage` |
| M03 | `-` and `+` swapped in the RT-1 evaluator table | `sub-negative-result` answers `10`, `add-neg-left` answers `-10` | `behavior` `sub-*` and `add-*` |
| M04 | `__sub` computes `right - left` | sign flips on every asymmetric row while `sub-zero` and `sub-b64-self` stay right | `sub-small`, `sub-negative-result`, `sub-left-assoc` |
| M05 | `staticExpressionType` answers `'boolean'` for an arithmetic binary (RT10P-C4 ignored) | `1 + 2 > 2` is refused as `KIR_BINARY_OPERAND_TYPE`, and `if cond="1 + 2"` is **admitted** and then faults at run time | `behavior` `if`-position rows, T24 |
| M06 | `crossCallExpressionType` left answering `'boolean'` for a binary (RT10P-C8) | `hb(1 + 2)` links and fails at run time with `KIR_CALL_ARGUMENT_TAG` on all three legs | **T25** |
| M07 | the unary operand gate is dropped | `-t`, `-flag`, `-1.5`, `-xs`, `-reply`, `-h()` all link; RT-1 then faults where a link refusal was contracted | T18-T23 |
| M08 | the unary **operator** gate is dropped (any unary op is negation) | `!flag` becomes an integer negation of a boolean; `+5` becomes `-5` | T5, T6 |
| M09 | the integer-parameter static type is not recorded (RT10P-C6 reverted) | `a + b`, `-a` and `a < b` are all refused for operands the parameters genuinely have | `param-add`, `param-neg`, `param-ordering` |
| M10 | `__neg`/`_neg` returns `String(-value)` built by string concatenation of `'-'` | `neg(0)` answers `"-0"`, and a double negation answers `"--7"` | `neg-zero-through-binding`, `neg-double` |
| M11 | either emitted helper coerces through a host double (`Number(...)` / `float(...)`) | every `>2^53` row loses precision; `mul-s53-square` is the widest separator | `add-s53`, `mul-s53-square`, `mul-b64-square` |
| M12 | either emitter lowers arithmetic to host infix instead of the named helper | Python `1 + 2` over the tagged dicts raises `TypeError`; JS concatenates the frozen objects. Also breaks the structural assertion | `behavior` (that leg), the named-helper structural row |
| M13 | the `arithmetic` family is spelled `logical`, so the right operand is passed as a thunk | JS `__add(left, ()=>right)` adds a function; Python `_add(left, lambda: right)` raises. Divergent per leg | `behavior` all arithmetic rows |
| M14 | `expressionInvokesCapability` / `expressionCallDepth` keep their silent default for `unary` | a capability or a deep call chain hidden inside a unary is invisible to the closure walk and to the depth policy | **`walker-coverage`** |
| M15 | `containsAsyncCall` returns `false` for a `unary` instead of recursing | an async call under a unary escapes the position gate | `walker-coverage` |
| M16 | RT-1 charges an extra `meter.step()` inside the arithmetic dispatch (one tick per helper) | every arithmetic row costs one more than its comparison twin; identity 1 breaks in one direction only | `tick-discipline` identity 1, `add-return` |
| M22 | RT-1's `integerValue` drops the `meter.text` bound (RT10P-C15) | RT-1 returns a 21-byte payload under `maxStringBytes: 20`, so its envelope diverges from both emitted legs, which still fault | `behavior` `size-over-limit`, `size-fault-position` |
| M23 | the emitted JavaScript `__intValue` drops the bound | the JavaScript leg succeeds where RT-1 and Python fault | `behavior` `size-over-limit`, `size-fault-position` |
| M24 | the emitted Python `_int_value` drops the bound | the Python leg succeeds where the other two fault | `behavior` `size-over-limit`, `size-fault-position` |
| M25 | either walker gets a permissive `default:` back (RT10P-C12) | an unknown expression variant is answered `false`/`0` instead of failing closed, which is the amendment's whole point | **`walker-coverage`** the two fail-closed rows |

No mutant here relies on a division rounding difference, a zero-divisor path, or a magnitude
cap — those are the three phantom classes the deferred operators would have introduced.

---

## Acceptance criteria

1. `pnpm test:kern-5-rt10-pre-linked-arithmetic` — **154/154** (135 at design time; the first
   review round added four `behavior` rows and three `walker-coverage` rows to reach 142, and the
   targeted second round added eight more `behavior` rows, three `type-gate` rows and two
   `tick-discipline` rows).
2. The seven prior suites green at the **pre-slice counts measured on this base**, with one
   declared exception. Record each count at base before implementing; do not copy a count from
   an older spec, which was measured on an older base, nor from a truncated run.

   | Suite | Pre-slice | Post-slice | Why |
   | --- | --- | --- | --- |
   | `test:kern-5-rt2-boolean-if` | 35 | 35 | unchanged |
   | `test:kern-5-rt3-binary-expression` | 142 | **139** | **the declared exception.** Three rows asserted `+`, `-` and `*` fail closed; admitting them is this slice, so they leave the negative list. Nothing else in RT-3 moves and its own K0 golden does not. |
   | `test:kern-5-rt4-user-fn-call` | 50 | 50 | unchanged; 20 artifact digests re-sealed in place |
   | `test:kern-5-rt5-async-user-fn-call` | 86 | 86 | unchanged; 48 artifact digests re-sealed in place |
   | `test:kern-5-rt6-void-fallthrough` | 52 | 52 | unchanged; 2 build-golden digests re-sealed in place |
   | `test:kern-5-rt8-integer-signatures` | 28 | 28 | unchanged |
   | `test:kern-5-rt9-linked-assign` | 82 | 82 | unchanged |

   Only the prior-slice edits enumerated in the *Blast radius* table are licensed. That table is
   the authority; the licensed set grew from 7 files to 10, and to 13 with the option-(A)
   artifact re-seal, each growth recorded in the Corrections Log.
2a. `node --test scripts/ci/test-tier-contract.test.mjs` green with `test:kern-5-rt9-linked-assign`
   and `test:kern-5-rt10-pre-linked-arithmetic` present in both `test:kern-5-script-family` and
   `kern5EvidenceCommands`, in rt order. Without this the two suites are defined but never run in
   required CI (review round).
3. F5 / closure / census unchanged; `pnpm test:kern-canonicalizer` green after the
   `compiledCoreDigest` re-pin and the `write:kern-canonicalizer-coverage` pass.
4. `pnpm --filter @kernlang/core build` (tsc) clean; `biome check` clean on the nine touched
   `packages/core` files.
5. `git diff` adds **zero** occurrences of `await`, `setImmediate`, `queueMicrotask`,
   `Promise`, or `checkAbort()` under `packages/core/src/kir-runtime/`.
6. Adding a tenth binary operator to `LinkedKernKirBinaryOperator`, or a second unary
   operator, without updating every table fails `tsc` in the linker, RT-1's evaluator, and
   both emitters — verified by applying and reverting the widening.
7. Net production diff ≤ 250 lines (design estimate ~95).
8. Every `behavior` row matches the frozen constant **and** the three legs are byte-identical.
   Cross-leg agreement alone never satisfies a row.

---

## RED evidence at base `06b74443` (RT-9 merged)

`pnpm --filter @kernlang/core build` clean, then each suite under `node --test`.

| Suite | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `probe-matrix.test.mjs` | 9 | **9** | 0 |
| `compatibility.test.mjs` | 5 | 3 | **2** |
| `k0-golden.test.mjs` | 6 | 3 | **3** |
| `behavior.test.mjs` | 48 | 2 | **46** |
| `type-gate.test.mjs` | 41 | 8 | **33** |
| `walker-coverage.test.mjs` | 5 | 0 | **5** |
| `tick-discipline.test.mjs` | 21 | 6 | **15** |
| total | **135** | 31 | **104** |

**Every failure is one of exactly four link strings — or, in the three structural suites, the
absence of the contract itself.** No string changed when the base moved from RT-8 to RT-9. The
link inventory, measured 2026-09-02 across 89 fixtures:

1. `entry.function.handler.children[N].value: KIR_BINARY_OP_UNSUPPORTED` — every arithmetic
   binary, in `let`, `return`, `print`, `if cond`, a call argument, a nested operand and a
   helper body. Raised at `linked-kir-program/expression.ts:284`, and raised **before** the
   operand gate, which is why an operand-shape negative is still attributable to the operator
   refusal at base.
2. `entry.function.handler.children[N].value: unsupported expression kind unary` — every
   unary form, including `!` and `+`. Raised at `linked-kir-program/expression.ts:331`.
3. `entry.function.handler.children[0].value: KIR_BINARY_OPERAND_TYPE` — the **single**
   second-cause row, `param a,b integer / return a < b` (RT10P-C6). Raised at
   `linked-kir-program/expression.ts:292-297`. Declared, not accidental.
4. `entry.function.handler.children[0].value: KIR_CALL_SIGNATURE_TYPE` — the deferred
   integer cross-call fence (T27, T29), raised at `linked-kir-program/expression.ts:148,151`.
   T27 and T29 are **GREEN** at base and must stay green; T28 (`hi() + 1`) is RED at base
   because the operator gate fires before the call is compiled.

The three `assign` positions RT-9 made available report the same two causes at
`children[1].value` — `KIR_BINARY_OP_UNSUPPORTED` for `assign n = n + 1` and
`assign n = a + b`, `unsupported expression kind unary` for `assign n = -n` — so RT-9's new
statement kind adds a position, not a cause.

Verbatim base failures, copied from the runs:

`type-gate.test.mjs` rows 5 and 7 — the label pin naming the gate that *did* fire:

```
not ok 5 - refuse-unary-not is refused at link with KIR_UNARY_OP_UNSUPPORTED
  error: 'expected the KIR_UNARY_OP_UNSUPPORTED gate to fire, but the linker reported:
           entry.function.handler.children[0].value: unsupported expression kind unary'

not ok 7 - refuse-text-operands is refused at link with KIR_BINARY_OPERAND_TYPE
  error: 'expected the KIR_BINARY_OPERAND_TYPE gate to fire, but the linker reported:
           entry.function.handler.children[0].value: KIR_BINARY_OP_UNSUPPORTED'
```

`behavior.test.mjs` row 1 — the three-leg harness refusing to compile the fixture:

```
not ok 1 - 7 + 3 evaluates to the frozen constant 10 on all three legs
  error: |-
    javascript compile failed: handler-entry-unsupported
```

`walker-coverage.test.mjs` rows 1-3 — the `never` tripwire firing on a hand-built node:

```
not ok 1 - containsAsyncCall looks inside a unary argument
  error: 'unhandled linked expression variant unary'
```

`tick-discipline.test.mjs` row 1 fails with
`no step budget in the scanned range linked the metering fixture`, and row 7 with
`RT10PRE_DISPATCH_GAP: the RT-1 evaluator table must carry '+'`.
`k0-golden.test.mjs` fails as one diff in which every arithmetic and unary admission row reads
`handler-entry-unsupported`, `LINKED_KIR_BINARY_OPERATORS` is missing three keys and its eight
existing rows are missing `resultType`, `linkedUnaryOperators` is `[]`, and
`linkedExpressionKinds` is missing `"unary"`.

The 31 tests that pass at base are load-bearing and must keep passing: the whole F5 probe
matrix (9); the four deferred-operator fences T1-T4, the two integer-cross-call fences T27/T29,
the frontend-wall row and the operator-label disambiguation row for the deferred binaries
(8 type-gate rows); the RT-2 golden at RT-9's seal, the F5 policy digest and the derived-pin
recomputation (3 compatibility rows); the deferred-operator-absence row, the gating-table and
precision-probe seals, and the golden's own fail-closed shape check (3 K0 rows); the i64-range
invariant on the gating table and the non-gating precision probe (2 behavior rows); and the six
metering identities over the pinned constants (6 tick rows).

No failure is a fixture error, a missing file, a harness error, a missing package export, or a
frontend rejection.

### Neighborhood at base (nothing else moved)

This commit adds only new files plus one `package.json` script, so no prior-slice file is
modified — `git show --stat` is the primary evidence. Spot-checked at base:

| Gate | Result |
| --- | --- |
| `kern-5-rt8-integer-signatures/{admission,alias-equivalence,fractional-rejection}.test.mjs` | 13/13 |
| `kern-5-rt6-void-fallthrough/{probe-matrix,type-gate,compatibility}.test.mjs` | 20/20 |

The prior-slice golden move described in *Blast radius* happens when the builder implements,
**not now**. At base every prior suite is untouched, and the derived-pin row in this slice's
`compatibility.test.mjs` passes precisely because nothing has moved yet — it flips to a
failure the moment the RT-3 golden moves without its three dependents.

---

## Implementation

Landed on base `732ed52c` (the RED oracle re-pinned onto the RT-9 base) across three commits:
`837f27e8` (the shared contract, RT-1's evaluator tables and both emitted legs), `7c3108f3`
(the licensed prior-slice re-pins plus the canonicalizer receipts) and `3fc8b335` (three
prior-slice dependents *Blast radius* did not enumerate — see the Corrections Log), then the
option-(A) artifact re-seal `0a7d7607`.

The review round added five more: the CI wiring, the RT10P-C15 result bound on all three legs,
the RT10P-C15a CPython digit-cap lift, the RT10P-C12 walker tripwires, and the oracle/spec
reconciliation with its second artifact re-seal.

### Production diff

`git diff --numstat 732ed52c..837f27e8 -- packages/core/src` — **+183 / −13**, i.e. **170 net
lines** against the ≤250 cap. The design estimate was ~95 and the excess is entirely
mechanical: adding `resultType` to the eight existing binary rows pushed each single-line
object past the formatter width, so all eight were re-wrapped into six-line objects. That
reflow is +96/−8 of the diff and the semantic net is ~82 lines, inside the estimate's band.

After the review round, `git diff --numstat 732ed52c..HEAD -- packages/core/src` is
**+217 / −21**, i.e. **196 net lines**, still inside the ≤250 cap. The review round's own additions are the meter
parameter on eight kernel helpers and RT-1's two evaluator tables, the guarded
`sys.set_int_max_str_digits(0)`, and the shared `never` tripwire with two explicit leaf arms per
walker.

| File | + | − |
| --- | --- | --- |
| `kir-runtime/linked-kir-program/contracts.ts` | 117 | 13 |
| `kir-runtime/linked-kir-program/expression.ts` | 22 | 2 |
| `kir-runtime/linked-kir-program/link.ts` | 6 | 1 |
| `kir-runtime/linked-kir-program/index.ts` | 4 | 0 |
| `kir-runtime/expression.ts` | 23 | 3 |
| `compiler/kir-js-esm/target-execution.ts` | 5 | 0 |
| `compiler/kir-js-esm/emitter.ts` | 7 | 1 |
| `compiler/kir-python/target-base.ts` | 6 | 0 |
| `compiler/kir-python/target-execution.ts` | 20 | 0 |
| `compiler/kir-python/emitter.ts` | 7 | 1 |
| **total** | **217** | **21** |

Every site the spec named is present and nothing else. Both emitters' `binary` cases are
byte-identical to base, which discharges RT10P-C11 by the diff rather than by argument: the
`arithmetic` family falls through the existing non-`logical` eager arm. Each emitter gained
one `case 'unary'`; each target kernel gained `__intValue`/`_int_value` and the four helpers.

The slice adds **three** comments, each stating a constraint the code cannot show: why
arithmetic is the only payload-minting expression (RT-1's `integerValue`), why CPython's digit
cap must be lifted at kernel start (the Python prelude), and why both walkers are exhaustive on
purpose (`contracts.ts`). Everything else is carried by a `satisfies`-checked table.

Criterion 5 holds: the production diff adds **zero** occurrences of `await`, `setImmediate`,
`queueMicrotask`, `Promise` or `checkAbort()` under `packages/core/src/kir-runtime/` or in
either emitter. Criterion 4 holds: `pnpm --filter @kernlang/core build` is clean and
`biome check` reports nothing on the nine touched files beyond one pre-existing `String.raw`
*info* on the Python target kernel.

Criterion 8's frozen-constant discipline was re-verified independently of the three legs: all
34 gating rows and all 8 `precision-probe.json` rows were recomputed from their source
expressions with JS `BigInt` **and** with `python3` `int`, agreeing with the frozen value on
every row, and every gating row was confirmed inside `[-2^63, 2^63)`.

### Gates — measured, this base

Measured after the review round (the design-time run was RT-10-pre 135/135 with the same
prior-suite numbers):

| Gate | Total | Pass | Fail |
| --- | --- | --- | --- |
| `test:kern-5-rt10-pre-linked-arithmetic` | **154** | **154** | 0 |
| `test:kern-5-rt2-boolean-if` | 35 | 35 | 0 |
| `test:kern-5-rt3-binary-expression` | 139 | 139 | 0 |
| `test:kern-5-rt4-user-fn-call` | 50 | 50 | 0 |
| `test:kern-5-rt5-async-user-fn-call` | 86 | 86 | 0 |
| `test:kern-5-rt6-void-fallthrough` | 52 | 52 | 0 |
| `test:kern-5-rt9-linked-assign` | 82 | 82 | 0 |
| `test:kern-5-rt8-integer-signatures` | 28 | 28 | 0 |
| `node --test scripts/ci/test-tier-contract.test.mjs` | 9 | 9 | 0 |
| `node --test scripts/kern-canonicalizer/*.test.mjs` | 872 | 872 | 0 |
| `composition.mjs`, `check-kern-canonicalizer.mjs`, `check-kern-canonicalizer-coverage.mjs` | 3 scripts | 3 | 0 |

RT-10-pre is **154/154**, matching acceptance criterion 1 exactly: probe-matrix 9,
compatibility 5, k0-golden 6, behavior 60, type-gate 44, walker-coverage 8, tick-discipline 23.

RT-3 measures 139, not its base 142: the three rows that asserted `+`, `-` and `*` fail closed
are gone, because admitting them is this slice. Nothing else in RT-3 moved and its own K0
golden did not — `OPERATORS` is a hard-coded eight-element list, exactly as *Blast radius* said.

The whole gate is green. The three rows that were red before the artifact re-seal were **one**
finding, recorded in the Corrections Log and ruled by the coordinator as option (A). The
`pnpm test:kern-canonicalizer` script itself cannot run in this worktree: its second step builds
`@kernlang/cli`, which fails with 17 `TS2307`/`TS2875` errors on missing `react`/`ink` type
declarations under `packages/terminal/src/runtime/*.tsx`. Re-measured in the review round and
unchanged by this slice — none of those files is touched. The canonicalizer suite proper
(872/872), `check-kern-canonicalizer.mjs`, `check-kern-canonicalizer-coverage.mjs` and
`composition.mjs` all run green directly; the blocker is the environment, not the slice.

### Mutant kill table — 28 applied, 28 killed, 0 survivors

Each mutant was applied by hand to the source, `tsc -b` re-run, the naming suite re-run, and
the source restored from a byte-copy and `touch`ed so the next build re-emits (RT-9's log
records the stale-`dist` trap this avoids). The final restore is byte-identical to the commit.

| # | Mutant | Killed by |
| --- | --- | --- |
| M01 | no arithmetic rows in `LINKED_KIR_BINARY_OPERATORS`, union and RT-1 table following | `k0-golden` 1-2 (`RT10PRE_K0_GOLDEN_DRIFT`; "the binary operator table carries exactly the eleven admitted operators") — 24/47 red |
| M02 | no unary compile arm; a unary falls through to the unsupported-kind wall | `type-gate` 15 rows: *expected the KIR_UNARY_OP_UNSUPPORTED gate to fire, but the linker reported: … unsupported expression kind unary* |
| M03 | `+` and `-` swapped in RT-1's evaluator table | `behavior` 23 rows, first `7 + 3 → 10` |
| M04 | emitted JavaScript `__sub` computes `right − left` | `behavior` 9 rows — `7 - 3`, `3 - 7`, `10 - 3 - 2`; `sub-zero` survives exactly as the mutant's own argument predicted |
| M05 | `staticExpressionType` hard-codes `'boolean'` for a binary | `type-gate` `refuse-arith-if-cond` (T24) + the three admitted-position rows |
| M06 | `crossCallExpressionType` still answers `'boolean'` for a binary | `type-gate` `refuse-arith-call-argument` (**T25**) + 3 |
| M07 | the unary operand gate is dropped | `type-gate` 10 rows, T18-T23a |
| M08 | the unary operator gate is dropped (any unary op is negation) | `type-gate` T5, T6 and the operator-versus-operand label row: *the linker reported KIR_UNARY_OPERAND_TYPE* |
| M09 | the integer-parameter static type is not recorded (RT10P-C6 reverted) | `type-gate` "an integer parameter is a legal operand for both an RT-3 comparison and an RT-10-pre operator" + 2 |
| M10 | `__neg` builds its value by string concatenation | `behavior` `-(-7) → 7` and "the only reachable neg(0) canonicalizes to \"0\", never to \"-0\"" |
| M11 | emitted JavaScript `__add` coerces through a host double | `behavior` `9007199254740993 + 1`, `… + 9007199254740993`, and `param-add` |
| M12 | the JavaScript emitter lowers arithmetic to host infix | `behavior` 37 rows and `RT10PRE_HOST_INFIX` |
| M13 | the `'+'` row is spelled `logical`, so the right operand is thunked | `behavior` 19 rows |
| M14 | `expressionInvokesCapability` / `expressionCallDepth` keep the silent `unary` default | **`walker-coverage`** 4-5, both `RT10PRE_WALKER_GAP` |
| M15 | `containsAsyncCall` answers `false` for a unary | **`walker-coverage`** 1 and 3, `RT10PRE_WALKER_GAP` |
| M16 | RT-1 charges an extra `meter.step()` in the unary dispatch | `tick-discipline` 1, `RT10PRE_METER_DRIFT` |
| M17 | RT-1's `'+'` evaluator double-evaluates its right operand (same value, extra ticks) | `tick-discipline` 1, `RT10PRE_METER_DRIFT` |
| M18 | an `await` token appears in the RT-1 operator dispatch region | `tick-discipline` 8, "RT-1 arithmetic dispatch adds no await point and no extra cancellation checkpoint" |
| M19 | the Python kernel's `_mul` lowers through a host float | `behavior` `3037000499 * 3037000499` and its negative twin — the two widest in-i64 separators |
| M20 | `/` is admitted, reusing the `*` helpers | `k0-golden` 1, 2, 4 ("no deferred operator has a table row") and `type-gate` `refuse-div` plus the operator-label row |
| M21 | unary `!` is admitted, reusing `__neg` | `k0-golden` 1, 3, 4 and `type-gate` `refuse-unary-not` plus the operator-label row |
| M22 | RT-1's `integerValue` drops `meter.text` (RT10P-C15) | `behavior` 2/3 size rows — `size-over-limit` and `size-fault-position`; the at-limit row survives, exactly as the mutant predicts |
| M23 | the emitted JavaScript `__intValue` drops `meter.text` | `behavior` the same 2/3, from the other side: *emitted JavaScript diverged from RT-1* |
| M24 | the emitted Python `_int_value` drops `meter.text` | `behavior` the same 2/3: *emitted Python diverged from RT-1* |
| M25 | `expressionInvokesCapability` gets `default: return false` back (RT10P-C12) | **`walker-coverage`** 1/8, "the closure walk fails closed on an expression variant it does not handle" — `RT10PRE_WALKER_DEFAULT` |
| M26 | RT-1's pre-check comparison weakened from `>=` to `>` | `behavior` 1/2 pre-check rows — `RT10PRE_PRECHECK_BOUNDARY` at `2^70`. Note what this kill does and does not say: the mutant is **behaviour-preserving at the envelope**, because a value the weakened pre-check lets through is still refused by the exact conversion. What dies is the *cost contract* — the pre-check silently ceasing to fire at its boundary — which is why the boundary is pinned on the predicate rather than only through an envelope |
| M27 | the emitted JavaScript counts the unsigned text, dropping the minus sign from the byte count | `behavior` 2/6 sign rows — `size-over-limit-negative` and `size-negate-fitting` diverge from RT-1. The same mutation applied to a *pre-check* would survive, because the pre-check is conservative: dropping `+ sign` only makes it fire later and the exact path still decides |
| M28 | the Python conversion window drops its `finally` restore | `behavior` 1/1 — `RT10PRE_DIGIT_WINDOW_LEAK`: the driver reports `sys.get_int_max_str_digits()` as 0 after execution instead of CPython's 4300 default |

M22-M28 were applied and reverted the same way, each `tsc -b`-rebuilt and the source restored
from a byte-copy and `touch`ed. Every one died, and each died on the row the mutant list named —
no size mutant killed the at-limit row, which is the check that the size fixtures separate on the
bound rather than on arithmetic.

M20 and M21 are the widening probes acceptance criterion 6 asks for, applied and reverted:
each adds a row to one operator table, and the oracle names the table, the union and the
deferred-operator fence rather than failing with a shrug.

Five mutants (M03, M04, M11, M13, M19) separate on **value**, five (M02, M05-M09) on the
**label text**, three (M14, M15, M12) on a **structural** assertion, three (M16-M18) on
**metering or the await census**, and three (M01, M20, M21) on the **table seals**. No mutant
needed a division rounding difference, a zero divisor or a magnitude cap.

---

## Out of scope

- `/`, `%`, `**`, bitwise and shift operators, decimal arithmetic, text concatenation, mixed
  numeric coercion — all pre-registered above and all fail-closed regression rows here.
- Any `KernKirLimits` change, including `maxIntegerDigits`.
- Integer cross-calls in either direction (RT10P-C14).
- `for`, `while`, `each`, `set`, `assign`, `break`, `continue` — no statement kind is added.
- Any F0-F5 edit, amendment record, constitution, census or closure-ledger change.
- Any KIR schema or version change, release-gate promotion, push, merge, or deployment.

## Builder must NOT

1. Touch any frontend file, any `.kern`, the constitution, the census, the closure ledger, or
   `scripts/kern-frontend-*`. F5 already projects every node in this slice.
2. Add any statement kind to `LinkedKernKirStatement`.
3. Introduce any `await`, `setImmediate`, microtask yield, or additional `checkAbort()` site on
   the RT-1 or emitted expression path (RT10P-C10).
4. Name the unary variant's field anything but `argument` (RT10P-C3).
5. Add a `resultType`-free operator row, or hard-code a result type in any consumer instead of
   reading the table (RT10P-C4).
6. Invent a per-family operand label for binary arithmetic. The RT-3 gate and
   `KIR_BINARY_OPERAND_TYPE` are reused deliberately (RT10P-C7).
7. Leave `crossCallExpressionType` answering `'boolean'` for an arithmetic binary (RT10P-C8),
   or add an `integer` row to `LINKED_KIR_CROSS_CALL_TYPES` (RT10P-C14).
8. Add a sign-stripping or `-0` normalization branch. Canonical zero is a property of the value
   model (RT10P-C5).
9. Lower arithmetic to host infix in either emitter, or pass an arithmetic right operand as a
   thunk (RT10P-C11).
10. Charge a `meter.step()` per helper call, or exempt an arithmetic node from the
    per-expression-node tick (RT10P-C9).
11. Add a magnitude check, a digit cap, or any `KernKirLimits` field. Enforcing the **existing**
    `maxStringBytes` on a minted arithmetic payload is required, not forbidden (RT10P-C15): it
    adds no field, no fault code and no envelope shape. Adding `maxIntegerDigits` is still the
    governance slice's.
12. Leave a permissive `default` in `expressionInvokesCapability` or `expressionCallDepth`: a
    `unary` arm alone is not enough, both must route `default` through a `never` tripwire
    (RT10P-C12).
13. Edit any prior-slice oracle file beyond the edits enumerated in the *Blast radius* table.
    That table is the authority; no constraint here states a count, because the licensed set
    grew twice under recorded rulings.
14. Accept a fixture whose expected value was not computed by BigInt **and** cross-checked by
    `python3`, or satisfy a row by cross-leg agreement alone.
15. Rescue a RED by widening the slice to `/`, `%`, `**`, an integer cross-call, or the
    frontend.
16. Assert only the closed link code in a negative test. The label text is the assertion.
17. Promote a `precision-probe.json` row into the gating table, or add a gating row whose
    operands, **intermediates** or result leave `[-2^63, 2^63)` (RT10P-C5a). The asserted
    invariant scans leaf literals and the final result only, so intermediates must be read by
    hand — the original `add-i64-max` row failed exactly there.
18. Charge a per-digit cost or add a checkpoint inside an expression to bound big-integer work
    (RT10P-R1). The bound is `maxStringBytes`, and the tightening lever is the governance
    slice's `maxIntegerDigits`.
19. Change any interpreter- or process-global setting at kernel import time. The CPython digit cap
    is lifted inside each conversion and restored in a `finally` (RT10P-C15a); a module-level
    `sys.set_int_max_str_digits` call removes a safety limit for every other user of a shared
    interpreter.
20. Decide the result bound by measuring the converted text alone. The bit-length pre-check runs
    first so an oversized result is refused without paying its quadratic conversion (RT10P-C15),
    and the byte count includes the sign on every leg.
21. Touch anything in `scripts/kern-5-rt9-linked-assign/` beyond the two named digest literals
    and the emitted-artifact re-seal option (A) licenses.

## Standing review question

**Every new dispatch path must add zero await points.** Answered in RT10P-C10: all four
operators are synchronous, total, and evaluated inside the existing synchronous switch. The
reviewer should check `git diff` for any new `await`, `setImmediate`, `queueMicrotask`,
`Promise`, or `checkAbort()` occurrence under `packages/core/src/kir-runtime/` and in both
emitters' expression paths, and expect **zero**.

## Open questions

- **[RT10P-O1 DECIDED — ruled 2026-09-02]** **This slice builds on RT-9.**
  `feat/kern-5-rt9-linked-assign` (`29feebaf`) is merged into this branch as `06b74443`, so the
  PR **stacks** and waits for RT-9 to merge before it can land. Consequences, all discharged:
  the oracle carries three real `assign` positions (`assign n = n + 1`, `assign n = a + b`,
  `assign n = -n`) in the probe matrix, the admission map, the behavior table and the metering
  table, each single-cause RED at `children[1].value`; every predecessor digest is recomputed
  against the RT-9 tree; and RT-9's own `compatibility.test.mjs` gained two derived pins in
  *Blast radius*. RT-9's K0 golden does not move — it scrapes the statement union, and this
  slice moves the expression union.
- **[RT10P-O2 DECIDED — ruled 2026-09-02]** Range and exactness are separate contracts with
  separate owners: see **RT10P-C5a**. The number-model tribunal's "`integer` is 64-bit-safe"
  governs **range**; this slice governs **totality, named-helper lowering and exactness within
  range**; magnitude **enforcement** stays deferred to the resource-governance slice. The
  oracle gates only on `[-2^63, 2^63)` and reports the eight beyond-i64 rows without asserting
  them.
- **[RT10P-O3 OPEN — deferred, recorded]** `KIR_UNARY_OP_UNSUPPORTED` and
  `KIR_UNARY_OPERAND_TYPE` are new label strings and therefore new de-facto contract surface,
  even though labels never reach the wire (`failureEnvelope` drops fault messages). No prior
  slice has needed a label-registry; if one is ever introduced these two are its first unary
  entries.
- **[RT10P-O4 CLOSED]** Whether arithmetic is admitted in a helper body: **yes**, and the
  oracle covers it. `compileHandler` is shared, so helpers get it for free and the contract
  adds no per-position gate. Verified at base that F5 projects a helper-body arithmetic
  expression and the link fault names the helper frame:
  `helper.g.handler.children[0].value: KIR_BINARY_OP_UNSUPPORTED`. The fixture returns a
  **boolean** from the helper (`let x = 1 + 2` / `return x > 2`) because an integer-returning
  helper is not callable at all (RT10P-C14).
- **[RT10P-O5 CLOSED]** Whether an evaluation-order fixture is buildable: **no** — see
  RT10P-C13. Order is pinned structurally and the behavioural order oracle is queued with the
  division slice.
- **[RT10P-O6 CLOSED]** Whether an async call can reach the unary or arithmetic operand
  position through F5: **no**, and the reason is a pinned label rather than an assumption — the
  static-type resolver runs to completion before `assertAsyncCallPosition`, so T17a/T17b/T23a
  report the operand-type label and never the async-position label. The walker half is covered
  by hand-built nodes in `walker-coverage.test.mjs`.

## Deploy order

1. Land the shared contract: the operator tables, `resultType`, the `unary` variant, the two
   type answers, the three walker arms, the unary compile arm, and the integer-parameter static
   type. Nothing is admitted until this is complete, because both emitters and RT-1 index the
   same tables.
2. Land RT-1's evaluator rows and both emitters in the same compatible change; neither target
   may accept a linked shape the other or RT-1 rejects.
3. Land the prior-slice re-pins enumerated in the *Blast radius* table — ten files, plus the
   emitted-artifact re-seal option (A) licenses in three of them — then the canonicalizer
   coverage pass. Wire both new suites into `test:kern-5-script-family` and the CI tier contract
   in the same push.
4. Run the suite through `pnpm test:kern-5-rt10-pre-linked-arithmetic`. It needs Node 22
   (`KERN_NODE22`) for the emitted-ESM leg and CPython 3.12 (`KERN_PYTHON312`) for the
   emitted-Python leg, matching RT-2…RT-9.

During an incomplete deployment an arithmetic or unary node continues to fail closed as
unsupported; it must never fall back to source or host semantics.

## Corrections Log

| Date | Correction |
| --- | --- |
| 2026-09-03 | **FLAWED on targeted review: the digit-cap lift was process-global.** `sys.set_int_max_str_digits(0)` at kernel start removes a CPython safety limit for the whole lifetime of any interpreter the emitted module is imported into, including one an embedder shares. Replaced by `_lifted_digits`, which saves `sys.get_int_max_str_digits()`, sets 0, converts and restores in a `finally`, guarded with `hasattr` — applied to `_int_value`'s `str` on the way out **and** to `_int_operand`/`_same_operands`' `int` on the way in, because the cap governs both directions and an operand payload may legitimately be longer than 4300 digits whenever `maxStringBytes` is. Accepted and recorded: while a window is open the setting is still interpreter-global, so an embedder running other threads may observe the lifted cap for one conversion; CPython exposes no per-thread or context-local form, and the alternative is a second, hand-rolled decimal conversion on one leg only. The restore is unobservable through the envelope, so `digit-window-driver.py` imports the emitted module, runs it and reports the limit at import, after import and after execution — all three must be 4300 while the run returns its 5120-digit value. That probe is what kills M28. |
| 2026-09-03 | **The result bound measured the conversion it was supposed to avoid paying for.** `meter.text(String(value))` decides whether a value was allowed only *after* a quadratic base-10 conversion, so an oversized result cost its own conversion before being refused. All three legs now derive a lower bound on the decimal digit count from the binary size first — Python `bit_length()`, JS/RT-1 `toString(16)` plus the leading nibble — and refuse without converting when `floor((bits-1) * log10(2)) + sign >= maxStringBytes + 1`, using `30102/100000`, strictly under `log10(2)`, so the floor is never above the true digit count and the pre-check can only refuse a value that genuinely cannot fit. Inconclusive falls through to the exact conversion, which stays the semantic gate. Recorded as the contract in RT10P-C15: **conversion cost is bounded by the limit, not by the operand magnitude.** No step is charged. Measured boundary at `maxStringBytes: 20`: `2^70` is decisive, `2^69` is not, and `-2^69` is decisive because the sign counts — the rows that kill M26 and a sign-dropping pre-check mutant. |
| 2026-09-03 | **The pre-check is a cost bound, not a second semantic gate, and its mutants say so.** Weakening `>=` to `>` is behaviour-preserving at the envelope: a value the weakened pre-check lets through is still refused by the exact conversion. The contract at risk is the pre-check *firing at all*, so the boundary is pinned on a shared exported predicate (`arithmeticResultExceedsLimit`, `kir-runtime/inspect.ts`) that RT-1 calls and both kernels transliterate, plus a soundness sweep over 2^0…2^512 and their negations asserting that anything pre-refused really does exceed the limit. Without that pin M26 would have been an equivalent mutant; recorded so the kill is not read as stronger than it is. |
| 2026-09-03 | **Sign accounting: the byte count is the canonical text including the minus sign, and it always was on the exact path.** `meter.text` measures UTF-8 bytes of the whole string, so `-` was already counted; the pre-check adds `+ sign` to match. Three gating rows pin it identically on all three legs at `maxStringBytes: 20`: 19 digits plus a sign is exactly at the limit and succeeds, 20 digits plus a sign faults, and a 20-digit product that is admitted has a negation that is not. The third is the one only the sign explains, and it is what kills M27. |
| 2026-09-03 | **VERIFIED, not a finding: an oversized integer literal cannot enter the runtime.** A result bound is half a bound, so the operand side was checked rather than assumed. `canonicalScalar` (`linked-kir-program/expression.ts:39-50`) already runs every integer and decimal literal's canonical text through `meter.text`, so a literal longer than `maxStringBytes` is refused at **link** with the same `runtime-limit-exceeded` / `execution` fault on all three legs — measured with a 30-digit literal at `maxStringBytes: 20`, and pinned in `type-gate.test.mjs` alongside a row proving the same literal is admitted under the suite default, so the gate is the limit and not the literal's shape. `**` and `<<` stay fail-closed as T3/T4, and `>>` has no operator-table row at all, so no cheap magnitude amplifier is admitted. |
| 2026-09-03 | **A nested intermediate faults at its own operator node, and the step index at which it fires is not envelope-observable.** `(a * b) + (c * d)` with either product over the limit faults at that product, before `+` runs: the `print` ahead of it is committed and the one after it never runs, byte-identically on all three legs. The in-limit twin succeeds at exactly 20 bytes and costs exactly 8 execution steps. `tick-discipline.test.mjs` sweeps 90 step budgets for both overflowing variants — neither succeeds at any budget, committed events are monotonic in the budget and end at exactly one. **What could not be pinned:** a size fault and a step-limit fault share one diagnostic code and produce byte-identical envelopes, so the step at which the fault fired cannot be read off the envelope, and left-to-right operand order therefore stays structurally pinned by RT10P-C13 rather than behaviourally by these rows. Stated rather than papered over. |
| 2026-09-03 | **BLOCKING, fixed: an arithmetic result was the one integer payload nothing bounded.** Measured before the fix, with `maxStringBytes: 20`: `return 10000000000 * 10000000000` returned the 21-digit `100000000000000000000` and **succeeded on all three legs**. Every other integer in the linked lane is already `meter.text`-bounded — a request argument at `inspect.ts:160-167`, a literal by the frontend — so arithmetic was the only amplification path. Fixed as RT10P-C15 by threading the meter into the four helpers on all three legs and calling the *existing* `meter.text`, which raises the *existing* `runtime-limit-exceeded` / `execution` fault. Three gating fixtures added: at the limit (success, exactly 20 bytes), one byte over (failure, byte-identical envelopes on all three legs), and a position pin whose failure envelope carries exactly one prior `stdout` event, proving the fault fires at the operator node rather than at the envelope boundary. `meter.text` charges no step, so every pinned metering constant survives — `size-at-limit` is pinned at 4, its arithmetic-free twin's cost. This does not pre-empt `maxIntegerDigits`: `maxStringBytes` bounds a serialized payload, the deferred cap bounds magnitude, and the governance slice still owns the second. |
| 2026-09-03 | **BLOCKING, fixed: CPython's 4300-digit int/str cap made the Python leg diverge on a value the other two legs call exact.** Measured before the fix: nine squarings of a ten-digit seed reach 5120 digits; RT-1 and the emitted JavaScript both returned it, the emitted Python leg returned `handler-link-error`. Fixed as RT10P-C15a with a `hasattr`-guarded `sys.set_int_max_str_digits(0)` at kernel start — the only correct place, because the cap also applies to `int(text)` on the way in. The regression row is **gating and three-leg**, not a `precision-probe.json` row: the probe table asserts nothing by ruling, so a row there could not have caught this. No 5000-digit literal is committed; the seed and the depth are, and the expected value is recomputed with `BigInt` in the test. |
| 2026-09-03 | **ACCEPTED RISK, recorded as RT10P-R1: one uninterruptible big multiplication per operator node.** Review raised at 0.97 that a `*` node costs one `meter.step()` and one uninterruptible host multiplication, so neither `maxSteps` nor the timeout bounds it. With RT10P-C15 in place both operands and the result are `maxStringBytes`-bounded, so the per-operation cost is polynomial in `maxStringBytes` — identical to the model RT-3's comparison operators already carry, since `BigInt(left) < BigInt(right)` parses two bounded payloads inside one metered node with no checkpoint either. **No checkpoint inside an expression and no per-digit charge**: both are forbidden by RT10P-C10, which `tick-discipline.test.mjs` pins statically and through the RT-2 queued-abort fence, and a per-digit charge would break every metering constant. The tightening lever is the governance slice's `maxIntegerDigits`. |
| 2026-09-03 | **BLOCKING, fixed: the RT-9 and RT-10-pre suites were defined but never run in required CI.** `test:kern-5-script-family` — the single command the `kern-5-evidence` CI job runs — ended at `test:kern-5-rt8-integer-signatures`, and `kern5EvidenceCommands` in `scripts/ci/test-tier-contract.test.mjs` ended there too, so the contract that exists to catch exactly this omission agreed with it. Both suites appended in rt order and the contract's expected list updated; `node --test scripts/ci/test-tier-contract.test.mjs` is 9/9. Recorded as acceptance criterion 2a, because "the leaf script exists" and "CI runs the leaf script" are two different facts and only the second is a gate. |
| 2026-09-03 | **Extracting the two walkers into their own file was implemented and reverted: `packages/core/src` cannot gain a file in this slice.** `walkers.ts` would have kept `contracts.ts` at 320 lines instead of 503, but a new source file becomes a new compiled-core `.js`, and `scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs:10-13` pins that inventory at an authenticated `count: 354` plus a path digest. `check-kern-canonicalizer-coverage.mjs --write` failed with *C-PY-1 lowering historical membership requires the authenticated current inventory* — a historical attestation, not in *Allowed files*, and not an admission slice's to re-attest. Both walkers stay in `contracts.ts` at 503 lines, three over a soft style ceiling, and the split is recorded for a slice that may re-attest the inventory. One trap worth naming: `tsc -b` does not delete a stale `dist` output, so the first re-pin of `compiledCoreDigest` was measured against a `dist` that still carried `walkers.js` and had to be recomputed after removing it. |
| 2026-09-03 | **The two permissive walker defaults were closed for today's variant only, and the review round closed them for tomorrow's.** RT10P-C12 originally required a `unary` arm in `expressionInvokesCapability` and `expressionCallDepth`; both kept `default: return false` / `return 0`, so the *next* expression variant would have been admitted with no `tsc` error, exactly as `unary` was. Both now enumerate `literal` and `identifier` and route `default` through a shared `expressionVariantUnhandled(expression: never)`. Verified by adding a probe variant to the union: `tsc -b` reports `TS2345 … not assignable to parameter of type 'never'` at three sites, the two walkers and `containsAsyncCall`. Both walkers moved into `linked-kir-program/walkers.ts` — `contracts.ts` would otherwise have crossed 500 lines, and a walker is not a contract. `walker-coverage.test.mjs` grew 5 → 8 with a fail-closed row per walker, which is what kills M25. |
| 2026-09-03 | **The `add-sub-i64-max` gating row had an intermediate of exactly `2^63`, outside the interval RT10P-C5a gates on.** `4611686018427387904 + 4611686018427387904 - 1` evaluates its left subtree to `9223372036854775808`, which is an out-of-range *result* of the `+` node under the same "operands or result" criterion that moved eight rows into `precision-probe.json`. The asserted range invariant scans leaf literals and the final result, so it could not see it. Replaced with `add-i64-max` = `4611686018427387903 + 4611686018427387904`, re-verified with `node` BigInt and `python3` (both `9223372036854775807`), and the frozen-table digest and the probe-matrix key re-sealed additively. *Builder must NOT* #17 now says "operands, **intermediates** or result" and names the scan's limit, because the constraint was already right and the check behind it was weaker than the constraint. |
| 2026-09-03 | **The normative sections were reconciled with what actually landed.** Five sections contradicted the Implementation record and the rulings above them: *Blast radius* and *FROZEN files* still forbade the artifact re-seal that option (A) had licensed and the header already reported; *Allowed files* licensed seven prior-slice files where thirteen had landed; *Deploy order* step 3 and *Builder must NOT* #13 both said "six"; and acceptance criterion 2 demanded all seven prior suites at pre-slice counts while RT-3 deliberately went 142 → 139. All five now state the landed contract, and the licensed set is stated once as an explicit list rather than three times as a count — a count is what drifted. Criterion 2 carries a per-suite table with the RT-3 exception declared. Also corrected: "Four identities" over a list of five covering six (now "Six"), the `add-in-let` fixture name (`add-let`), "eight rt3-linkable controls" over a nine-row table, the compatibility row's `RED 2/5` where the pass-at-base count is 3, and the 2026-09-03 entry that named the RT-5 script without its `rt5-` segment in the one entry whose point is that only the per-suite script name is authoritative. |
| 2026-09-03 | **The artifact digests were re-sealed a second time, by the same rule that ruled the first.** RT10P-C15 adds a meter parameter to eight kernel helpers and RT10P-C15a adds `import sys` plus two lines to the Python prelude, so all **70** artifact digest lines moved again — 20 in `rt4/compatibility.test.mjs`, 48 in `rt5/compatibility.test.mjs`, 2 in `rt6/k0-build-golden.json`, carrying **50 distinct values** because RT-5 replicates RT-4's five call-free fixtures. Re-sealed by recomputation, and the same guarantee holds: zero `linkedProgramSha256` and zero `projectionArtifactSha256` lines in the diff, and the three suites return to 50/50, 86/86 and 52/52. This is the second application of the standing rule and the reason it is stated as a rule rather than as a one-off ruling. |
| 2026-09-03 | **A suite total was undercounted by four because a per-file sweep was cut off by a timeout.** RT-5 was first reported as 82; the authoritative `pnpm test:kern-5-rt5-async-user-fn-call` run measures **86/86**. The gap is `provider-propagation.test.mjs` (4 tests), the twelfth file in a directory a ten-minute manual sweep listed only eleven of before it was killed, and the resumed sweep started from `position-gate` without re-listing the directory. Corrected here and in the gate table. The lesson is the same one the spec's own acceptance criterion 2 states — "record each count at base before implementing; do not copy a count from an older spec" — extended one step: do not copy a count from a *truncated run* either. Only the per-suite `pnpm` script is authoritative, because it enumerates its own files. |
| 2026-09-02 | **RULED option (A): the emitted-artifact digests are re-sealed, and the kernel constant is why they move on every kernel-helper slice.** The coordinator ruled that `KERNEL_SOURCE` is a whole-program constant *by design* (`kir-js-esm/emitter.ts:23`, `kir-python/emitter.ts:22`) and that a conditional kernel is an architecture change for a later slice, not this one; RT-9's precedent — re-seal in place and log it, because a SHA-256 constant records one fact about a file's bytes at one moment while "may this slice move it?" is a spec question already answered — applies unchanged. Re-sealed **70** digests with recomputed values: `rt4/compatibility.test.mjs` 20 across five call-free fixtures, `rt5/compatibility.test.mjs` 48 across twelve call-free and helper-bearing fixtures, and `rt6/k0-build-golden.json` 2. RT-6's `compatibility.test.mjs` needed no edit — it recomputes against that golden rather than carrying constants. **What was deliberately not touched, and how that is guaranteed:** every `linkedProgramSha256` and every `projectionArtifactSha256`. The re-seal script asserted each stable digest equalled its live value before writing anything — 5 in rt4, 12 in rt5, 2 in rt6, 19 in total, all unchanged — and the committed diff contains **zero** `linkedProgramSha256` or `projectionArtifactSha256` lines. Those digests stay inside the same `deepEqual` the artifact digests live in, so a linked-encoding regression hiding inside a future artifact re-seal still fails the suite; no new test row was added, and the three suites return to their pre-slice totals 50/50, 86/86 and 52/52. The standing rule this establishes: **an artifact digest is expected to move whenever the target kernel gains a helper, and a linked or projection digest is never expected to move with it** — the second half is the assertion that keeps the first half honest. `per-program kernel assembly` is recorded as a deferred design item in *Pre-registered contracts*. |
| 2026-09-02 | **BLOCKING: the emitted target kernel is embedded in every artifact, so every frozen emitted-artifact digest moves — and *Blast radius* claimed the opposite.** The spec asserts "RT-4's and RT-6's **artifact** digests … do not move: every compatibility fixture in those suites is arithmetic-free, and that is the independent proof that arithmetic-free emission stays byte-identical." Half of that is true and half is false. `KERNEL_SOURCE` is a module-level constant (`kir-js-esm/emitter.ts:23`, `kir-python/emitter.ts:22`) concatenating the whole `TARGET_EXECUTION_SOURCE` into **every** artifact, so RT10P-C11's four kernel helpers land in arithmetic-free artifacts too — measured directly: an artifact for `return flag` contains `__add`, `__sub`, `__mul`, `__neg`, `__intValue` and `def _add(`…`def _int_value(`. Three rows go red and no more: `rt4/compatibility.test.mjs` ("every call-free digest is byte-identical to the pre-slice build"), `rt5/compatibility.test.mjs` ("every RT-4 digest, call free and helper bearing …") and `rt6/compatibility.test.mjs` ("the RT-6 build golden pins the emitted artifacts …"). **What the failures prove is the spec's real claim:** in every red row `linkedProgramSha256` and `projectionArtifactSha256` are **unchanged** and only `javascript/pythonArtifactSha256` and their manifests moved, so the linked encoding and the F5 projection of an arithmetic-free program *are* byte-identical and the delta is the kernel text alone. The exhaustive blast radius of frozen artifact-digest constants is exactly those three files plus `rt6/k0-build-golden.json`; `kern-5-admission-census` pins only `projectionArtifactSha256`, which does not move, and the other seven consumers of `…ArtifactSha256` compare two live artifacts rather than a frozen constant. **Not resolved here, deliberately.** Two options, both real: (A) re-seal the artifact digests in those three files and log it — the RT-9 precedent, and the primitive that keeps the guard byte-exact and fail-closed for the next licensed move; (B) assemble `KERNEL_SOURCE` per program so a program that uses no arithmetic embeds no arithmetic helper, which keeps all three guards green and is inside this slice's allowed files, but invents a conditional-kernel mechanism the spec never contemplated and trades a single canonical kernel for a per-program one. (A) is a seal decision; (B) is an architecture decision. Neither is the implementer's to take unilaterally, so both are reported and the digests are left untouched. |
| 2026-09-02 | **Three prior-slice dependents of the expression-union move that *Blast radius* did not enumerate — the same class its own last row names.** *Blast radius* listed one golden and one coverage table. Three more guards read the same two facts. (1) `kern-5-rt3-binary-expression/type-gate.test.mjs:44` lists `'+', '-', '*'` among thirteen operators that must fail closed, and `:243` pinned the shared table to exactly RT-3's eight keys. Admitting the three operators is the slice, so they leave the negative list (ten remain) and the shared-contract row now asserts RT-3's eight are still *in* the table rather than that nothing else is — an additive guard, so the next admission slice does not reopen it. RT-3 therefore measures 139 rather than its base 142. (2) `kern-5-rt4-user-fn-call/probe-matrix.json` scrapes `linkedExpressionKinds` from `contracts.ts` **independently of the RT-3 golden**, so it needed `"unary"` too; nothing digests that file's bytes, so the move is free. (3) `kern-5-rt5-async-user-fn-call/compatibility.test.mjs:292` carries a hard-coded copy of the RT-3 inventory. Landed as `3fc8b335`. The derived-fact count is therefore 6 digests + 4 inventories, not 6 + 1. |
| 2026-09-02 | **The conquer builder reported `builder-failed` on work that was 130/135 green.** The launch stopped at `turn 1 · stop` with `Stopped: builder-failed · turns 1 · consults 0`, leaving nine production files edited but **uncommitted** in the isolated worktree. The cause is a harness cap, not a defect: the builder exhausted its CLI max-turns budget (100) *inside* one conquer turn, so conquer saw a single failed turn and never obtained a gate verdict. Measured on the abandoned dirty tree: probe-matrix 9/9, k0-golden 6/6, behavior 48/48, type-gate 41/41, walker-coverage 5/5, compatibility 3/5 — the two red rows being the derived pins, which are *supposed* to be red until the prior-slice re-pins land — and tick-discipline unmeasured. Reviewed against the contract, the diff needed **no** correction: no forbidden `await`, no `-0` normalisation branch, no new operand label, no thunked arithmetic operand, no per-helper tick, no silent walker default, the field named `argument`, and both emitters' `binary` cases untouched. The lesson: a `builder-failed` conquer verdict is a statement about the turn budget, not about the tree, and the worktree must be inspected before the work is re-run from scratch. |
| 2026-09-02 | **`tick-discipline.test.mjs` is slow, not hung.** A chained run of the whole rt10 script exceeded ten minutes and was read as a hang. Run alone the file is **21/21 in 76 s**; the chained cost is the 48 three-leg behavior rows ahead of it, each spawning a Node 22 child and a CPython 3.12 child. The whole rt10 script measures ~12 minutes. No fixture blocks and no fence deadlocks. |
| 2026-09-02 | **The spec's `compiledCoreDigest` pre-image was dead, exactly as its own predecessor row warned.** *Blast radius* named `ca8b6b59…` as the value to move; the constant actually at `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs:97` on this base was `4f9fa7a6…`, because the RT-9 merge moved `packages/core/src` after the rt10-pre spec was drafted. Recomputed and re-pinned to **`2ff60c45273c262aae401269f0723a7db15acd46cf28acbe38507fba7444ed4a`**. This is why the spec's own rule is to verify every pin by recomputation: the three *derived* pins it computed reproduced byte-exactly (`cb579944…`, `170faec9…`, `0eca34b6…`) and the one it quoted from an older tree did not. |
| 2026-09-02 | **One `write:kern-canonicalizer-coverage` pass sufficed, and the reason is ordering.** `coverageImplementationDigest` path-frames every `.mjs` under `scripts/kern-canonicalizer`, so re-pinning `compiledCoreDigest` inside `coverage-prerequisite.test.mjs` moves it as a side effect. Because the re-pin was applied **before** the write, one pass published both moved digests (`e61ae032…` → `59e62748…`) and a second `--write` changed nothing — verified by re-running it and diffing the two receipt JSONs byte for byte. Same outcome RT-9's log recorded; the recipe's "check whether a second pass is needed" is discharged by edit-then-write ordering. |
| 2026-09-02 | **The `resultType` column cost 96 formatter lines, and that is the whole LOC overrun.** The production diff is +183/−13 against a ~95-line design estimate. Adding one field to the eight existing `LINKED_KIR_BINARY_OPERATORS` rows pushed each single-line object past the formatter width, so all eight were re-wrapped into six-line objects; that reflow is +96/−8 and the semantic net is ~82 lines. Recorded so the number is not read as a misread of RT10P-C4/C11 — both emitters' `binary` cases are byte-identical to base, which was that claim's load-bearing half. |
| 2026-09-02 | **Mutant campaign: 21 applied, 21 killed, no survivors — and one harness artifact worth naming.** The spec's sixteen were all applied plus five more (a Python-float `_mul`, an RT-1 right-operand double-evaluation, an `await` token in the dispatch region, and the two widening probes criterion 6 asks for: `/` admitted and unary `!` admitted). M10's first form built its value with a nested template literal inside `TARGET_EXECUTION_SOURCE`, which is *itself* a template literal, so it died as `error TS1005` — a **syntax** kill that proves nothing about the oracle. Re-applied with string concatenation it was killed properly, by `-(-7) → 7` and the `neg(0)` canonicalisation row. A mutant that fails `tsc` for a reason unrelated to the contract must be rewritten, not scored. |
| 2026-09-02 | **The facts file's "integer cross-calls exist since RT-4/RT-8" is false.** `LINKED_KIR_CROSS_CALL_TYPES` has no integer row, so an integer-returning helper is refused with `KIR_CALL_SIGNATURE_TYPE` (`expression.ts:148`) and a helper with an integer parameter is refused at `:151`. Measured at base. The brief's "integer cross-call operands" probe rows are unbuildable; they became the deferred fences T27-T29 and claim RT10P-C14. Same finding RT-9 logged as RT9-C5a. |
| 2026-09-02 | **An integer parameter has no static type.** `link.ts:436` records `'boolean'` or nothing, so RT-3's own `a < b` over two integer parameters is refused with `KIR_BINARY_OPERAND_TYPE` at base while `return a` links. RT-8 admitted the signature and left the linker with no reader. Scope grew by one expression (RT10P-C6) and the corpus gained the one declared second-cause RED row. |
| 2026-09-02 | **`crossCallExpressionType` answers `'boolean'` for every binary.** Admitting arithmetic without RT10P-C8 turns a contracted link refusal into a runtime failure for `hb(1 + 2)`. Found by reading the call-argument gate, not by the tribunal; it is now T25 and mutant M06. |
| 2026-09-02 | **Two of the three expression walkers default silently.** Only `containsAsyncCall` has the `never` tripwire; `expressionInvokesCapability` (`contracts.ts:225`) and `expressionCallDepth` (`contracts.ts:290`) return `false`/`0` for an unknown variant, so a `unary` variant compiles cleanly and is invisible to the closure walk and the depth policy. Added `walker-coverage.test.mjs` and mutants M14/M15. |
| 2026-09-02 | **`-0` is a frontend wall, not a runtime case.** `-0`, `- 0` and `-(0)` are all rejected by F5 with `FRONTEND_INVALID_EXPRESSION`. The tribunal's `-0 → "0"` row is unwritable as a literal; the `-0 ≡ 0` contract is pinned through `let z = 0` / `let n = -z` instead, and the literal form became fail-closed row T30. |
| 2026-09-02 | **Left-to-right evaluation order is unobservable in this slice.** Every operator is total and no operand can carry an effect (statements only for `print` and capability, async calls refused in expression position, integer helpers not callable). The brief's "metered cross-call order probe" cannot be built; RT10P-C13 pins order structurally and queues the behavioural oracle with the division slice, where a zero divisor makes it observable. |
| 2026-09-02 | **RT9-C8a's metering rule was an approximation.** RT-9 recorded "a parameter read costs 2 expression steps"; measured here, the charge is one step per **declared** parameter (request inspection) plus one per expression node evaluated — an unread second parameter still costs one, and a parameter read three times still costs one. Verified on nine controls. Every constant RT-9 pinned is unchanged under the corrected model. |
| 2026-09-02 | **The brief asked for an arithmetic-specific operand label; this spec reuses `KIR_BINARY_OPERAND_TYPE`.** The gate that fires is the RT-3 gate, unchanged, driven by the `satisfies`-checked `operandType` column, so a new label would need a new branch where one already exists. A new label is introduced only for the genuinely new unary gate. Recorded as a deliberate deviation in RT10P-C7. |
| 2026-09-02 | **The `arithmetic` family needs no emitter change.** Both emitters branch on `family === 'logical'` only, to decide whether to pass the right operand as a thunk. Arithmetic falls through the existing eager arm, so the emitters gain a `unary` case and four kernel helpers and nothing else. This cut the LOC estimate from ~140 to ~95. |
| 2026-09-02 | **Sequencing ruled: rt10-pre stacks on RT-9, and the first draft's digests were all dead.** The spec was authored on `1a88c705` (RT-8 era) and recommended landing first; the coordinator ruled the other way and merged RT-9 in as `06b74443`. Every predecessor digest moved: RT-2 `aa7f116d…` → `cc7fb869…`, RT-3 `ac690563…` → `c8a94cc4…`, and therefore the post-slice RT-3 seal `0eca34b6…` → `cb579944…` and the rt4 derived pre-image `709e0be0…` → `170faec9…`. Two of the first draft's values survive with new meanings: `0eca34b6…` is now RT-9's `RT3_K0_GOLDEN_PRE_RT9_SHA256` post-move (the RT-3 golden with `rt2GoldenSha256` reset to `aa7f116d…` *and* `"unary"` added), which is exactly the old RT-8-era post-slice seal. Nothing in the contract changed; only the pins and the base. |
| 2026-09-02 | **RT-9 added two more dependents of the RT-3 golden, and both are digests of derived pre-images.** `kern-5-rt9-linked-assign/compatibility.test.mjs:11` asserts the RT-3 golden is at RT-9's seal, and `:16` pins the pre-RT-9 pre-image. Adding `"unary"` breaks both. The derived-pin count went 4 → 6 (rt3 golden, rt4 `rt3GoldenSha256`, rt4 `RT3_PRE_SLICE_SHA256`, rt6 `RT3_GOLDEN_SHA256`, rt9 `RT3_GOLDEN_SHA256`, rt9 `RT3_K0_GOLDEN_PRE_RT9_SHA256`) plus the RT-5 coverage row, and this slice's `compatibility.test.mjs` now recomputes all of them from the live golden. This is the third instance of the class RT-9's own log named. |
| 2026-09-02 | **Number-model conflict ruled, and the gating table shrank by eight rows and grew by five.** RT10P-O2 is closed as RT10P-C5a: range is the number-model tribunal's contract, exactness-within-range is this slice's, enforcement is the governance slice's. Eight rows whose operands or results left `[-2^63, 2^63)` moved into a non-gating `precision-probe.json` that the behavior suite runs and prints but does not assert. Five new gating rows in `(2^53, 2^63]` replace their discriminating power, one per operator plus a negative product — `add-sub-i64-max` (`9223372036854775807`), `sub-i64-max-minus-s53` (`9214364837600034814`), `mul-i64-near-max` (`9223372030926249001`), `mul-i64-near-max-neg`, `neg-i64-max` — each computed with `node` BigInt and cross-checked with `python3` (`diff new-js.txt new-py.txt` → no output). The coordinator's triage said five rows exceeded 2^63; the measured count under "operands **or** result" is eight, and all eight moved. |
| 2026-09-02 | **The async-operand rows resolve to the type label, not the async label — and that is the finding.** `compileLinkedExpression` resolves the whole operand tree before `link.ts:337` reaches `assertAsyncCallPosition`, so `-(ah())` reports `KIR_UNARY_OPERAND_TYPE` and `ah() + 1` reports `KIR_BINARY_OPERAND_TYPE`; `KIR_ASYNC_CALL_EXPRESSION_POSITION` is unreachable for arithmetic in this slice. Both rows assert the type label fires **and** the async label does not, which is what proves the unary arm resolves its argument rather than trusting the emitters. Recorded as RT10P-O6 CLOSED. |
| 2026-09-02 | **Host-infix absence needed string stripping, and both legs needed the four-helper census.** The first draft asserted the helper census on one fixture per leg and had no infix scan. The scan as first written failed on its own arithmetic-free control: diagnostic codes such as `'handler-entry-unsupported'` carry hyphens inside string literals, so the region must be stripped of quoted text before scanning for `[+*-]`. With stripping, the control region measures **zero** host arithmetic characters on both legs, which is what makes the assertion meaningful; the census now covers `__add/__sub/__mul/__neg` and `_add/_sub/_mul/_neg` across a four-fixture corpus. |
| 2026-09-02 | **Four derived digests hang off the RT-3 golden move, not one.** `rt3GoldenSha256` in the rt4 probe matrix, `RT3_GOLDEN_SHA256` in the rt6 compatibility test, `RT3_PRE_SLICE_SHA256` in the rt4 compatibility test (a digest of a *derived* pre-image), and the `unary` row that `kern-5-rt5-async-user-fn-call/variant-coverage.test.mjs:51-58` forces. This is the exact class RT-9's log calls "a digest whose own input includes the file the previous repin edited"; all four values are computed in *Blast radius* and asserted by this slice's `compatibility.test.mjs` so a missed re-pin fails loudly. |
