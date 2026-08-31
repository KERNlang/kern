# KERN 5 RT-3: Closed binary expressions

**Status:** IMPLEMENTED
**Date:** 2026-08-31
**Base:** `ad91deb3c2be25e9883a1a60cad68e59a96c6b94` (RT-2 implemented), rebased onto `45941355`
**Implemented at:** `e0e73e50` (oracle and spec), `43b2aeaf` (link, RT-1, both emitters)
**Confidence:** 0.95

## Executive Summary

RT-2 admitted a structural `if` whose condition had to be *statically* a KIR
boolean: a boolean literal, a boolean parameter, or a `let` bound to one. That
gate has no way to express a computed predicate, so every real conditional is
still written outside the language. RT-3 adds one closed binary expression
form — eight operators, two operand types, three admitted positions — to the
same shared linked-program representation, so RT-1, the emitted JavaScript ESM,
and the emitted Python all gain the identical semantics from one admission
edge. It adds no arithmetic, no unary operator, no text ordering, no
truthiness, and no coercion.

## Current State / Root Cause

- **VERIFIED:** F5 already projects a binary expression. Source
  `if cond="flag && other"` projects to an expression node with
  `kind: "binary"` carrying exactly `left`, `op`, and `right` fields; the
  direct projection probe on this base emitted that artifact on 2026-08-31.
- **VERIFIED:** F5 projects all thirteen out-of-profile operators through the
  same `binary` node (`+ - * / % & | ^ << >> === !== ??`) and projects `!` as a
  separate `unary` node. Operator admission is therefore a linker decision, not
  a frontend one.
- **VERIFIED:** `compileLinkedExpression` at
  `packages/core/src/kir-runtime/linked-kir-program/expression.ts:57-208`
  dispatches on a closed list of expression kinds (`null`, `identifier`,
  `boolean`, `text`, `integer`, `decimal`, `list`, `record`, `member`, `call`)
  and falls through to `unsupported(...)` for anything else, so `binary` is
  rejected before RT-1 or either emitter sees it.
- **VERIFIED:** The RT-2 static boolean gate is `isBooleanExpression` at
  `linked-kir-program/link.ts:124-128`; it recognises only boolean literals and
  names recorded in `LinkScope.booleans`, so no computed expression can ever
  reach the `if` condition.
- **VERIFIED (RED):** At the declared base, `if cond="flag && other"`,
  `let name=both value="flag && other"`, `return value="flag || other"`, and
  `let name=r value="1 < 2"` each project successfully and are then rejected by
  RT-1, the JavaScript compiler, and the Python compiler with
  `handler-entry-unsupported` and zero committed events.

Root cause: one intentionally closed expression admission model. Adding binary
lowering to either emitter first would create a second semantic selector, which
is exactly what the RT-1/R2/C-Py-1 stack forbids.

## What Already Works

- **VERIFIED:** F5 needs no change. It projects binary expressions in `if`
  conditions, `let` initializers, and `return` values, and it normalizes
  integer literals — `007` is rejected as `FRONTEND_INVALID_EXPRESSION`, and a
  negative literal projects as a `unary` `-` around a non-negative integer, so
  every admissible integer literal is a canonical non-negative decimal string.
- **VERIFIED:** RT-1 already meters one step per expression node
  (`kir-runtime/expression.ts:6-12`), and both emitters already wrap every
  emitted expression node in its own meter step
  (`compiler/kir-js-esm/emitter.ts:93`, `compiler/kir-python/emitter.ts:83`).
  RT-3 inherits the metering model rather than inventing one.
- **VERIFIED:** The Python emitter already defers every expression through
  `_expression(meter, thunk)`, so a lazily-passed right operand is naturally
  unmetered until it is reached.
- **VERIFIED:** RT-2's frame-stack branch walker keeps cancellation at the
  statement boundary; RT-3 adds no statement kind and therefore no checkpoint.

## Contract

> Binding tribunal verdict for slice `rt3-binary-expression`.

### Closed operator set

`&&`, `||`, `==`, `!=`, `<`, `<=`, `>`, `>=`. No unary operator, no
arithmetic, no bitwise operator, no nullish coalescing, no strict-equality
alias, no text ordering.

### Admitted positions

`if` conditions, `let` initializers, and `return` values. A binary whose type
is `boolean` — every admitted binary — is admissible to the RT-2 static boolean
condition gate.

### Static type gate at link

| Operator family | Operand types | Result |
| --- | --- | --- |
| `&&`, `||` | boolean × boolean | boolean |
| `<`, `<=`, `>`, `>=` | integer × integer | boolean |
| `==`, `!=` | boolean × boolean, or integer × integer | boolean |

A static type exists only for a boolean literal, a canonical integer literal, a
boolean parameter, a name bound by a `let` whose initializer has a static type,
and a binary (always boolean). Capability results, member reads, `Json`
intrinsic results, text, decimals, and lists have no static type and can never
be a binary operand. Mixed operand types are rejected; there is no coercion and
no host truthiness anywhere on any leg. Violations fail closed at link through
the existing closed `handler-entry-unsupported` result, mirroring RT-2's label
convention: `KIR_BINARY_OP_UNSUPPORTED` for an operator outside the set and
`KIR_BINARY_OPERAND_TYPE` for an operand-type violation. Both labels live in
the fault message and in the negative-control assertion, never on the wire.
Because `<` is left-associative and yields boolean, a chained comparison such
as `1 < 2 < 3` folds to a boolean-versus-integer ordering and is rejected at
link.

Every binder clears or replaces the static type it records: `let` records the
initializer's static type or deletes any stale entry, `capability` always
deletes, and a parameter records `boolean` or deletes. This is a second,
independent defense — the linker also rejects any re-binding of a live name as
a duplicate binding, and either mechanism alone is sufficient; each was removed
on its own and the capability-rebinding fixtures stayed rejected under the
remaining defense.

### Runtime defense in depth

The static gate makes a mixed-tag operand unreachable, so the operand guard in
RT-1 and in both emitted kernels is defense in depth, not a reachable path. It
raises the closed wire code `unsupported-runtime-input` — a new wire code would
break three public `…CompileFailureCode` contracts for an unreachable state —
and carries `KIR_BINARY_OPERAND_TYPE` as its label. RT-1 passes the label as
the existing `KernKirFault` message; both target kernels gained a matching
optional third `Fault` label argument, so the same label is present in the
shipped artifact on all three legs. `failureEnvelope` still drops fault
messages everywhere, so no wire contract changes.

### Semantics on all three legs

- Short circuit: for `false && rhs` and `true || rhs` the right operand is
  neither evaluated nor metered, and the left operand's own tagged value is the
  result.
- Each operand is evaluated exactly once, left before right.
- Comparisons operate on tagged integers as exact arbitrary-precision integers,
  never as host floating-point numbers, so `9007199254740993 == 9007199254740992`
  is `false` on every leg.
- Equality compares tagged booleans by their tagged value, never by truthiness.
- The emitted Python lowers every operator to a named helper call, so it can
  never emit a Python infix or chained comparison.
- Envelopes are byte-identical across RT-1, emitted JavaScript, and emitted
  Python.

### Meter and tick

The per-expression-node `meter.step()` model is preserved unchanged. RT-3 adds
no `await` and no cancellation checkpoint inside expression evaluation;
cancellation stays at the statement boundary that RT-2 pinned.

## Implementation Approach

One shared closed `binary` variant on `LinkedKernKirExpression`, one static
type function used by both the binary gate and the RT-2 condition gate, and one
specialization per target. `LINKED_KIR_BINARY_OPERATORS` in
`linked-kir-program/contracts.ts` is the single operator contract — family,
operand type, and each target's helper name — declared `satisfies
Record<LinkedKernKirBinaryOperator, LinkedKernKirBinaryOperatorContract>`. The
linker, both emitters, and the RT-1 evaluator table all index it by the
operator union, so widening the union without updating every table is a `tsc`
error rather than a runtime surprise; adding a ninth operator was verified to
fail the build in all three consumers. `LinkScope.booleans` becomes a
`Map<string, 'boolean' | 'integer'>` so a single resolver answers both gates.
Both emitters gain named per-operator kernel helpers rather than emitting host
infix operators, which keeps precedence, laziness, tag checking, and
arbitrary-precision integer comparison out of the emitted expression text.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | Modified | Closed binary variant, the operator union, and the static-type union. |
| `packages/core/src/kir-runtime/linked-kir-program/expression.ts` | Modified | Binary compilation, the closed operator table, and the shared static-type resolver. |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | Modified | Typed link scope feeding both the binary gate and the RT-2 condition gate. |
| `packages/core/src/kir-runtime/linked-kir-program/index.ts` | Modified | Re-export the operator and static-type contracts. |
| `packages/core/src/kir-runtime/expression.ts` | Modified | RT-1 short-circuit and tagged comparison evaluation. |
| `packages/core/src/compiler/kir-js-esm/target-execution.ts` | Modified | Named JavaScript operator helpers in the target kernel. |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | Modified | Binary lowering with a lazily-invoked right operand. |
| `packages/core/src/compiler/kir-python/target-execution.ts` | Modified | Named Python operator helpers in the target kernel. |
| `packages/core/src/compiler/kir-python/emitter.ts` | Modified | Binary lowering with a lazily-invoked right operand. |
| `scripts/kern-5-rt3-binary-expression/*` | Added | RED oracle: support harness, behavior/truth table, type gate, short-circuit meter, tick discipline, K0 golden, K0 divergence. |
| `scripts/kern-5-rt3-binary-expression/k0-golden.json` | Added | Additive K0 golden: the 8-operator × 3-operand-shape admission matrix, the `for` projection diagnostic row, the linked expression union, and the RT-2 golden digest. |
| `package.json` | Modified | Root `test:kern-5-rt3-binary-expression` script mirroring the RT-2 script. |

No `packages/core/src` file is added or removed, so the canonicalizer
historical-transition gate (commit `506826ee`) does not apply.

## Acceptance Criteria

- [x] A real F5 projection containing a `binary` node is admitted by RT-1 and
  both package compiler exports, in `if`, `let`, and `return` position.
- [x] All four boolean operators agree with their truth tables across the four
  boolean argument combinations in all three positions, byte-identically on all
  three legs.
- [x] All four ordering operators and both equality operators agree on tagged
  integers, including values beyond IEEE-754 exact range.
- [x] `false && rhs` and `true || rhs` consume exactly the short-circuit step
  budget on all three legs, and the whole-evaluation budget exceeds it by
  exactly the right operand's node count on all three legs.
- [x] Mixed operand types, boolean ordering, text operands, list operands,
  decimal operands, capability/member/intrinsic operands, the thirteen
  out-of-profile operators, and the unary operator all fail closed at link with
  `handler-entry-unsupported` and zero committed events.
- [x] A queued-microtask abort is observed at the same statement boundary by
  RT-1 and by the emitted JavaScript at binary-condition depths 0-4, and the
  emitted specialized body of a capability-free handler contains no `await`.
- [x] The emitted Python contains no infix or chained comparison.
- [x] The K0 golden recomputes exactly, and the RT-2 golden stays byte-identical.
- [x] `pnpm test:kern-5-rt2-boolean-if` and the RT-1 / JS-lowering / Python /
  CLI-shadow neighborhood suites stay green.

## RED Oracle

`scripts/kern-5-rt3-binary-expression/` runs entirely on the real F5
projection and the built package exports. At base `ad91deb3`:

| Suite | Tests | Failing at base |
| --- | --- | --- |
| `behavior.test.mjs` | 72 | 71 |
| `k0-divergence.test.mjs` | 6 | 6 |
| `tick-discipline.test.mjs` | 16 | 16 |
| `short-circuit-meter.test.mjs` | 3 | 3 |
| `k0-golden.test.mjs` | 3 | 1 |
| `type-gate.test.mjs` | 32 | 0 |

`type-gate.test.mjs` is green at base by construction: it pins fail-closed
behavior that must survive the change, so it is a regression fence rather than
a RED gate. Every other suite is RED for the missing shared semantic owner, not
for a missing module, package export, or interpreter. The base probe recorded
`handler-entry-unsupported` from RT-1, the JavaScript compiler, and the Python
compiler for a binary in each of the three admitted positions, with zero
committed events.

## Verified Result

| Gate | Result |
| --- | --- |
| `scripts/kern-5-rt3-binary-expression/behavior.test.mjs` | 72/72 |
| `scripts/kern-5-rt3-binary-expression/type-gate.test.mjs` | 42/42 |
| `scripts/kern-5-rt3-binary-expression/k0-divergence.test.mjs` | 6/6 |
| `scripts/kern-5-rt3-binary-expression/tick-discipline.test.mjs` | 16/16 |
| `scripts/kern-5-rt3-binary-expression/short-circuit-meter.test.mjs` | 3/3 |
| `scripts/kern-5-rt3-binary-expression/k0-golden.test.mjs` | 3/3 |
| `pnpm test:kern-5-rt2-boolean-if` | 35/35 |
| kern-5 r1 / r2 / c-py-1 / cli-shadow neighborhood | 83/83 |
| `packages/core` KIR unit tests | 183 assertions, exit 0 |

Measured step budgets confirm the metering model exactly. For
`return value="flag && ((other == other) == (other == other))"` with two
boolean parameters, the emitted JavaScript and the emitted Python both need 12
steps when the whole expression is evaluated and 5 when the left operand short
circuits; subtracting the 2-step request inspection measured from the
`return value="flag"` control leaves 10 and 3 execution steps. RT-1 needs 25
and 18 steps against a 13-step link cost and the same 2-step inspection,
leaving the identical 10 and 3. All three legs therefore save exactly the
7-node right operand.

## Mutation Discrimination

Ten mutants were applied, rebuilt, run, and reverted. All ten were killed.

| # | Mutant | Site | Killed by |
| --- | --- | --- | --- |
| 1 | Operator swap `<` to `<=` | `kir-runtime/expression.ts` | behavior 1 |
| 2 | Logical swap `&&` to `\|\|` | `kir-js-esm/emitter.ts` | behavior 7 |
| 3 | Eager right-operand evaluation | `kir-runtime/expression.ts` | short-circuit-meter 2 |
| 4 | Right operand metered despite short circuit | `kir-js-esm/emitter.ts` | short-circuit-meter 2 |
| 5 | Mixed-type equality admitted | `linked-kir-program/expression.ts` | type-gate 5, k0-golden 1 |
| 6 | Host truthiness instead of tagged booleans | `kir-js-esm/target-execution.ts` | behavior 3, short-circuit-meter 1 |
| 7 | Double operand evaluation | `kir-js-esm/emitter.ts` | short-circuit-meter 2 |
| 8 | Dropped parenthesization | `kir-js-esm/emitter.ts` | behavior 70 |
| 9 | Python chained-comparison emission | `kir-python/emitter.ts` | short-circuit-meter 3, behavior 45 |
| 10 | `await` inserted inside binary evaluation | `kir-js-esm/emitter.ts` | tick-discipline 12 |

Three further mutants cover the review findings, all killed. Removing *both*
the stale-type clear and the capability duplicate-binding fence admits a
capability result into a boolean gate and fails type-gate 4; dropping the
`KIR_BINARY_OPERAND_TYPE` label from the emitted Python guard fails type-gate
1; adding a ninth operator to `LinkedKernKirBinaryOperator` without updating
the tables fails `tsc` in the JavaScript emitter, the Python emitter, and the
RT-1 evaluator table.

## Out of Scope

- Arithmetic, bitwise, unary, nullish-coalescing, strict-equality, and text or
  decimal ordering operators.
- Loops, `assign`, `for`, `while`, calls other than the existing `Json`
  intrinsics, imports, exceptions, and classes.
- Integer parameters and integer return types: F5 rejects `type=integer` and
  `returns=integer` with `F5_AUTHORITY_DRIFT` today, so every RT-3 integer
  originates from a literal.
- F0-F5 projection, the closure ledger, the `.kern` corpus, the exports policy,
  and `while`/`assign`/`for` linking.
- Any KIR schema or version change, release-gate promotion, push, merge, or
  deployment.

## Open Questions

None blocking.

## Deploy Order

1. Land the shared linked-program binary variant, its static type gate, and
   RT-1 evaluation.
2. Land both emitters in the same compatible change; neither target may accept
   a linked shape the other or RT-1 rejects.
3. Run the suite through the root `test:kern-5-rt3-binary-expression` script.
   It needs Node 22 (`KERN_NODE22`) for the emitted-ESM leg and CPython 3.12
   (`KERN_PYTHON312`) for the emitted-Python leg, matching RT-2.

During an incomplete deployment a binary continues to fail closed as
unsupported; it must never fall back to source or host semantics.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| The recorded static type could go stale across a re-binding, letting a capability result reach a binary operand. | Every re-binding is already rejected as a duplicate binding, so the eight adversarial fixtures fail closed on all three legs today. Removing that unrelated fence, however, admits three of them — the hazard was real and masked. | Binding now clears or replaces the recorded type, giving a second independent defense, and the eight fixtures are permanent regression fences. |
| Per-operator tables were independent `Map` lookups in four places. | Widening the operator union compiled cleanly and would have failed at run time. | One `satisfies`-checked operator contract now feeds the linker, both emitters, and the RT-1 evaluator. |
| The emitted legs meter only the handler body, so an absolute emitted step count equals the expression node count. | Both emitted targets also meter request inspection, exactly as RT-1 does. | The metering oracle derives the per-leg inspection cost from a control fixture instead of assuming zero. |
| A binary in a `let` initializer or `return` value could be probed through RT-1 with empty arguments. | Once the linker admits the program, RT-1 proceeds to argument validation and reports `invalid-handler-arguments`, not an admission code. | The admission probe reports the link outcome by filtering for the closed link-code set, so RT-1 admission stays observable through the real execute path. |
