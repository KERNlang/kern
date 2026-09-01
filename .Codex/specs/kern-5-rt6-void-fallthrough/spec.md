# KERN 5 RT-6: Void handler fall-through completion

**Status:** IMPLEMENTED
**Date:** 2026-09-01
**Base:** `0733e51d` (RT-4 merged; contains RT-2 boolean `if`, RT-3 binary expressions, RT-4 user calls)
**Implemented at:** `5ea4ebc9` (probe matrix), `f63b2c01` (linked program and RT-1),
`d7f2f551` (both emitters), `b39b13b1` (oracle suite), `38f85feb` (mutation-driven hardening)
**Reviewed at:** `529b42ea` (tick-discipline fix), `573ea84b` (closed type table and golden split),
`2dd752dd` (await-path effects and gate-label pinning)
**Confidence:** 0.95 (raised from 0.93 after the high-risk review found and fixed a real
tick-discipline divergence the original suite did not cover)

## Executive Summary

Every KERN handler admitted so far had to end in a value. That made a handler that
only performs effects — the shape every real entry point in the repo actually has —
inexpressible. RT-6 admits one closed completion form: a handler *declared*
`returns=void` may complete by falling through its last statement, producing the
absent-result envelope the runtime already had. It invents no sentinel, adds no
expression kind, adds no statement kind, and changes no non-void byte.

## Current State / Root Cause

- **VERIFIED:** F5 already projects `returns=void`. The `returns` property comes back
  as the one-field type record `{tag:'record',value:[{key:'kind',value:{tag:'text',value:'void'}}]}`
  — the same shape as `boolean` or `text`, carrying a different kind. F5 needed no
  amendment and received none.
- **VERIFIED:** F5 also projects a bare `return` inside a void handler as a `return`
  node with an *empty* property list. See the decision below.
- **VERIFIED:** `param type=void` is fatal at F5 with `F5_AUTHORITY_DRIFT`, so the
  void-as-parameter position does not exist. The linker's `parameterType()` never
  admitted `void` and still does not; that gate is defense in depth.
- **VERIFIED:** The absent-result envelope already existed. `KernKirSlot` has a
  `{presence:'absent'}` arm, `envelope.ts:slotText` already encodes it as
  `{"presence":"absent"}`, and both emitted kernels (`__slotText`, `_slot_text`)
  already handle it. RT-6 *refines the use* of that representation; it did not
  invent one, and `TARGET_KERNEL_SHA256` is unchanged on both targets.
- **VERIFIED (RED):** At base `0733e51d`, `fn name=route export=true returns=void`
  with two `print` statements projects, the entry resolves, and all three legs
  reject it with `handler-entry-unsupported`. The exact link rejection is
  `entry.function.returns: type is outside RT-1`, thrown by `parameterType()`.
  The control — the same body with a declared `string` return and a final
  `return` — is admitted on all three legs at the same base, so the RED is a
  missing shared semantic owner and not a dead pipeline.

Root cause: one closed return-type set that had no `void` row, plus a
`compileHandler` tail that unconditionally demanded exactly one final `return`.

## Probe Matrix (sequencing gate)

Run before any admission code existed and committed as
`scripts/kern-5-rt6-void-fallthrough/probe-matrix.json`, recomputed on every run.

| Fixture | F5 | RT-1 / JS / Python at base |
| --- | --- | --- |
| void entry, two prints | projected | `handler-entry-unsupported` |
| void entry, bare `return` | projected (`return` node, no properties) | `handler-entry-unsupported` |
| void entry, value-bearing `return` | projected | `handler-entry-unsupported` |
| void helper declared, entry void | projected | `handler-entry-unsupported` |
| void helper in expression call position | projected | `handler-entry-unsupported` |
| non-void handler that falls through | projected | `handler-entry-unsupported` |
| `fn` with no `returns` at all | projected (no `returns` property) | `handler-entry-unsupported` |
| **`log()` as a bare statement** | **rejected `F4_AUTHORITY_DRIFT`** | never reached |
| **`param type=void`** | **fatal `F5_AUTHORITY_DRIFT`** | never reached |

Two probed positions re-scoped the slice before implementation:

- **A void handler has no call form at all.** KERN has no expression-statement, so
  `log()` on its own line does not project. The only way to reach a callee is an
  expression position, and a callee that returns nothing has no value there. The
  slice therefore does **not** compose a void helper with a void entry: the
  composition does not exist in the language today. A void callee is rejected at
  link with `KIR_VOID_HANDLER_NO_CALL_FORM`.
- **The bare `return` is deferred, not admitted.** F5 does project it, so it was a
  real choice rather than a missing form. Admitting it would need a new linked
  statement variant, its RT-1 execution, its lowering on both targets, and its own
  place in the closure and depth traversals — a second semantic case. RT-6 keeps
  ONE semantic case and leaves the bare `return` failing closed, exactly as it did
  at base, under `handler-entry-unsupported`.

## Contract

> Binding tribunal verdict for slice `rt6-void-fallthrough`, as amended after the
> probe matrix.

### Form

`LinkedKernKirReturnType = LinkedKernKirParameterType | { kind: 'void' }`, with the
single frozen inhabitant `LINKED_KIR_VOID_RETURN_TYPE`. `LinkedKernKirHandler`
— the *callee* type — keeps its narrow `LinkedKernKirParameterType` return, and a
new `LinkedKernKirEntryHandler` carries the wider one. `LinkedKernKirProgram.program`
is the entry handler; `LinkedKernKirHelper.handler` stays narrow. The type system,
not a runtime check, is what makes a void callee unrepresentable: the call
machinery in `kir-runtime/expression.ts` and both emitters' `helperSource` can
never see a void return type, and neither file needed a change for it.

### Semantic rule

A handler *declared* `returns=void` may complete by falling through its last
statement, producing `result: {presence:'absent'}` with `completion: {kind:'return'}`,
`outcome: 'success'` and its ordered stdout events.

- **No inference.** A missing `returns` is still rejected by `propertySet`. A
  non-void handler that falls through is still rejected with
  `expected exactly one final return`. Void is admitted only where F5 projected the
  word.
- **`void` remains invalid as a parameter type**, on every leg.
- **A value-bearing `return` inside a void handler is rejected at link** with
  `KIR_VOID_HANDLER_VALUE_RETURN` under the closed `handler-entry-unsupported` code.
  Detection is recursive over `if` branches, not a top-level statement filter, so a
  return nested in a `then` or `else` block cannot escape the gate.
- **A bare `return` is rejected at link** (deferred, see above).
- **A void handler is never a callee**: `KIR_VOID_HANDLER_NO_CALL_FORM`.
- **Emitters consume linked return metadata.** Both read
  `LinkedKernKirProgram.program.returnType` and select the void tail from it; neither
  inspects the body. A `returnSource` reached on a void handler throws before
  emitting, which the compilers map to the closed `artifact-emission-failure` code.
- **No host value leaks.** The void tail constructs the absent slot literally
  (`Object.freeze({presence:'absent'})` / `{"presence": "absent"}`). JavaScript
  `undefined` and Python `None` never enter the result slot on any leg.

### Tick discipline

The void completion is built **inside** the frame walker, at the point the frame stack drains —
the same place relative to await boundaries as a value `return`. This is load-bearing, not
incidental: RT-1's walker is `async`, so awaiting its promise always yields at least one
microtask even when no provider was awaited. Completing *after* that await gives RT-1 a
cancellation checkpoint the emitted targets do not have, and an abort queued on the resolving
microtask flips RT-1 to `execution-cancelled` — with stdout already committed — while the
emitted JavaScript succeeds. The void path therefore adds **no await point the non-void path
lacks**; the only `await` in the walker remains the one that awaits a real capability provider.

### Meter and tick

The void completion consumes **zero** execution steps: RT-1 reaches it after the
frame stack drains, and neither emitted tail carries a `__meter.step()` /
`_meter.step()`. Measured against a one-print void control, a second print costs
exactly 2 steps and a value `return` costs exactly 2 — the same 2 the void tail
does not charge. Both tails check cancellation on both sides of the envelope
measurement, exactly as the value-return path does, and a capability-free void
handler emits no `await` on either target.

### The type gate is one closed table

Both linker type gates read `LINKED_KIR_TYPE_ADMISSION`, a frozen
`satisfies Record<LinkedKernKirTypeKind, LinkedKernKirTypeAdmission>` table with a
`parameter` / `return` / `scalar` column per kind, rather than two hand-written literal lists
that could drift apart. `void` is the single **return-only** row, and `handlerReturnType`
recognises it precisely by that asymmetry — a kind admitted in return position and refused in
parameter position. Flipping `void.parameter` to `true` therefore does not quietly admit a void
parameter; it breaks the void return itself, so the mutation is caught by behaviour rather than
by a source scan.

### Format compatibility

The linked encoding of a void handler is the ordinary handler shape with
`returnType: {"kind":"void"}`; no field is added to any handler and no optional
field is introduced. Non-void linked programs, emitted artifacts and manifests are
byte-identical to the pre-slice build. `TARGET_KERNEL_SHA256` is unchanged on both
targets because the shared kernels already encoded the absent slot.

The RT-2 and RT-3 K0 goldens are **byte-identical**: RT-6 adds no member to
`LinkedKernKirExpression` and no member to `LinkedKernKirStatement`, which is what
those goldens recompute.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | Modified | `LinkedKernKirReturnType`, the frozen void inhabitant, the entry-handler type, and the program's entry field. |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | Modified | `handlerReturnType` (void in return position only), the recursive `containsReturn` gate, the void-callee rejection. |
| `packages/core/src/kir-runtime/execute.ts` | Modified | One shared success-envelope tail, the void completion, and the defense-in-depth refusal of a value return in a void handler. |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | Modified | Void completion tail in the specialized source; `specializedSource` now reads the linked program. |
| `packages/core/src/compiler/kir-python/emitter.ts` | Modified | The Python twin of the same tail. |
| `scripts/kern-5-rt6-void-fallthrough/*` | Added | Probe matrix, split K0 goldens, compatibility, behavior, effects, divergence, type gate, tick discipline, shared harness. |
| `package.json` | Modified | Root `test:kern-5-rt6-void-fallthrough` script mirroring the RT-4 script. |

Five production files, **116 net production lines** (162 added, 46 removed) after the
review fixes; 854 lines of evidence code plus three generated goldens. No
`packages/core/src` file is added or removed, so the canonicalizer
historical-transition gate does not apply. `kir-runtime/expression.ts` and
`linked-kir-program/{expression,index}.ts` are untouched.

## Acceptance Criteria

- [x] A real F5 projection of `returns=void` is admitted by RT-1 and both package
  compiler exports, and the envelope is byte-identical on all three legs with the
  existing absent result and ordered stdout.
- [x] Branches inside a void handler run and fall through past them identically on
  all three legs.
- [x] `void` is never inferred: a missing or non-void `returns` still requires the
  final value `return` on all three legs.
- [x] `void` is invalid as a parameter type; F5 refuses it before the linker.
- [x] A value-bearing `return` in a void handler, at top level or nested in either
  branch, and a bare `return`, all fail closed at link on all three legs.
- [x] A void handler is never a callee and a void call is never an argument.
- [x] Neither emitted target can put `undefined`, `None` or `null` in the result slot.
- [x] The void completion charges no execution step and no `await`.
- [x] Non-void linked encodings, artifacts and manifests are byte-identical to the
  pre-slice build; the RT-2 and RT-3 K0 goldens are byte-identical.
- [x] RT-2 (35/35), RT-3 (142/142), RT-4 (50/50) and the r1/r2/c-py-1/cli-shadow
  neighborhood (83/83) stay green.

## RED Oracle

`scripts/kern-5-rt6-void-fallthrough/` runs entirely on the real F5 projection and
the built package exports.

| Suite | Tests | Failing at base |
| --- | --- | --- |
| `divergence.test.mjs` | 16 | 2 (the queued-abort divergence at depth 0) |
| `effects.test.mjs` | 6 | 6 |
| `probe-matrix.test.mjs` | 5 | 1 (the matrix file did not exist) |
| `compatibility.test.mjs` | 4 | 1 (the void K0 golden did not exist) |
| `behavior.test.mjs` | 5 | 5 |
| `type-gate.test.mjs` | 8 | 1 (the void admission rows) |
| `tick-discipline.test.mjs` | 5 | 5 |

The type gate is largely green at base by construction: it pins negatives that must
*stay* closed, which is a regression fence rather than a RED gate. The RED gate is
`behavior` and `tick-discipline`, which cannot pass without the void completion.

## Verified Result

| Gate | Result |
| --- | --- |
| `pnpm test:kern-5-rt6-void-fallthrough` | 52/52 |
| `pnpm test:kern-5-rt4-user-fn-call` | 50/50 |
| `pnpm test:kern-5-rt3-binary-expression` | 142/142 |
| `pnpm test:kern-5-rt2-boolean-if` | 35/35 |
| kern-5 r1 / r2 / c-py-1 / cli-shadow neighborhood | 83/83 |
| `packages/core` KIR unit tests | 101 assertions, exit 0 |
| `pnpm test:kern-canonicalizer` | 872/872, exit 0 |

Canonicalizer receipts recipe, run last and in order: build core and CLI, run
`check-kern-canonicalizer-coverage --write`, re-pin `coverage-prerequisite.test.mjs`'s
`compiledCoreDigest` literal to `6fd1471b…`, then `--write` again.
Only the digest moved; the coverage frontier is unchanged at 112/112 base-complete
with zero legacy-parameter blockers.
| `biome check` | clean on every touched file |

## Mutation Pass

Twelve mutants, applied one at a time to a per-file backup copy and never through
`git checkout`, each rebuilt and run against the whole RT-6 suite.

| # | Mutant | Result | Killed by |
| --- | --- | --- | --- |
| 1 | `parameterType` admits `void` | KILLED | K0 golden: `parameterType` literal inventory |
| 2 | void inferred when `returns` is absent | **EQUIVALENT** | see below |
| 3 | non-void fall-through admitted | KILLED | type gate: void is never inferred |
| 4 | RT-1 fabricates a `null` result | KILLED | behavior, three-leg bytes |
| 5 | emitted JavaScript leaks `undefined` | KILLED | behavior, three-leg bytes |
| 6 | emitted Python leaks `None` | KILLED | behavior, three-leg bytes |
| 7 | `print` dropped in a void handler | KILLED | behavior, three-leg bytes |
| 8 | `print` reordered | KILLED | behavior, three-leg bytes |
| 9 | single-leg void: Python keeps the closed tail | KILLED at `tsc` | the tail is selected from one typed expression |
| 10 | K0 golden copied instead of recomputed | KILLED | K0 golden recompute |
| 11 | any unknown return kind becomes void | KILLED | K0 golden: `handlerReturnType` literal inventory |
| 12 | value-return-in-void admitted | KILLED | type gate: top-level and both branches |
| 13 | void completion moved back after the walker's `await` | KILLED | divergence: queued abort at depth 0 |
| 14 | an extra `await` inserted before the void completion | KILLED | divergence: queued abort at depth 0 |
| 1b | `void.parameter` flipped to `true` in the closed table | KILLED | behaviour golden **and** the void fixture itself |
| 11b | the return gate drops its `admits(kind,'return')` conjunct | **EQUIVALENT** | F5-shielded, see below |
| 15 | void tail skips its pre-measure `checkAbort` | **EQUIVALENT** | synchronous window, see below |

Mutants 13 and 14 are the review's required regression guard: both reintroduce the blocking
divergence and both now die at microtask depth 0.

Mutants 1 and 11 survived the first pass. F5 is fatal on every return or parameter
kind outside its own closed set, so **no projection can reach either linker type
gate** — the gates are real, but unreachable from a projection-driven fixture. The
K0 golden now recomputes the comparison literals each gate is built from, which is
what moves when either widens. Both then died.

Mutant 11b is the residue of 11 after the table rewrite, and is **equivalent under F5's
authority**: dropping the conjunct only changes the answer for a return kind that is absent from
the closed table, and F5 is fatal on every such kind, so no projection reaches it. The table's
shape is pinned instead — the suite asserts it has exactly one return-only row, which is the
property the gate reads.

Mutant 15 is **equivalent**: the skipped `checkAbort` sits between the frame loop draining and the
envelope measurement, with no await in between, so no abort can be delivered in that window; the
per-event `check` callback and the post-measure check both still run. The emitted tails are
separately asserted to carry both checks.

Mutant 2 is **equivalent, not a gap**. `compileHandler` runs
`propertySet(properties, ['export','name','returns'], [], label)` before
`handlerReturnType`, so a `returns` value is never `undefined` at that call. Proved
mechanically by a combined mutant that also moves `returns` to `propertySet`'s
optional list: the suite kills it immediately on the new
`a handler with no returns at all projects and is still rejected on every leg`
fixture. A `returns`-less `fn` does project at F5, so that fixture is real coverage
of the no-inference rule rather than a vacuous one.

## Follow-ups

- `coverage-prerequisite.test.mjs` compares `coverageImplementationDigest` against itself, so that
  row can never fail. Pre-existing and out of scope for RT-6; flagged here so it is not mistaken
  for coverage.
- The bare `return` early exit, with the F5 fact recorded above.

## Out of Scope

- The bare `return` early exit, deferred with the F5 fact recorded above.
- Any void call form, which would need an expression-statement in the language first.
- **rt7-first-real-admission** — turning `ui.kern` into an `export=true` admitted
  entry and ratcheting the census — is the **NEXT** slice, not this one. RT-6 edits
  no repo `.kern` file, touches no census script, and moves no closure ledger or
  static golden.
- RT-5 async semantics, integer projection, and every F0-F5 source, which a parallel
  builder owns.
- Any KIR schema or version change, release-gate promotion, push, merge, or deployment.

## Open Questions

None blocking.

## Deploy Order

1. Land the shared linked-program void return type, the link gates, and RT-1 execution.
2. Land both emitters in the same compatible change; neither target may accept a
   linked shape the other or RT-1 rejects.
3. Run the suite through the root `test:kern-5-rt6-void-fallthrough` script. It needs
   Node 22 (`KERN_NODE22`) for the emitted-ESM leg and CPython 3.12 (`KERN_PYTHON312`)
   for the emitted-Python leg, matching RT-2, RT-3 and RT-4.

During an incomplete deployment a void handler continues to fail closed as
unsupported; it must never fall back to source or host semantics.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| A void helper can be called from a void entry, so the slice composes user calls with void. | KERN has no expression-statement, so `log()` on its own line is rejected at F4 and the position does not exist. | The composition was struck; a void callee is rejected at link and the slice keeps exactly one semantic case. |
| `LinkedKernKirHandler.returnType` can simply widen to include `void`. | That widening reaches `matchesType` in `kir-runtime/expression.ts`, an unowned sixth production file, purely to satisfy a case the call machinery can never see. | The callee type stayed narrow and a separate entry-handler type carries the void, which both keeps the file budget and encodes the stronger invariant that only an entry may be void. |
| A top-level `statements.filter(kind === 'return')` is enough to reject a value return in a void handler. | Returns nested in an `if` branch are compiled into the branch, not the top-level list, so they would have escaped the gate. | The gate is a recursive `containsReturn` walk over both branches, and the type suite pins a then-branch and an else-branch fixture. |
| The void completion needs a new absent sentinel. | `KernKirSlot`'s `absent` arm, `slotText`, `__slotText` and `_slot_text` already existed and already encoded it. | The slice reuses the existing representation; both target kernels are unchanged and `TARGET_KERNEL_SHA256` did not move. |
