# KERN 5 RT-9: `assign` as a LINKED KIR statement

**Status:** RED ORACLE / READY TO BUILD
**Date:** 2026-09-02
**Base:** `dcb54d6c` (RT-8 merged)
**Branch:** `feat/kern-5-rt9-linked-assign`
**Tribunal:** `tribunal-1788334816236-9xwz53-kern5-rt9-linked-for` (adversarial, hybrid,
2 rounds, 3/4 engines — codex timed out both rounds). Verdict: **rt9 = `assign` alone,
`for` deferred to rt10.** The AGAINST case carried it on unattributability grounds and
on two concrete defects in the bundled `for + assign` contract (a hand-wrong nested
golden of 36 where the arithmetic is 18, and a `cancel-mid-loop` fixture no admitted
loop body can express without adding the banned await point).
**Confidence:** 0.91 for the contract below; 0.86 for the LOC estimate.

## Executive Summary

RT-9 admits exactly one new linked statement kind — `assign` — so a `let` binding can
be rebound after it is declared. It is the first slice since RT-2 to widen
`LinkedKernKirStatement`, and that is the whole of its risk: five production files, one
new union variant, five new link gates, two lines of RT-1, and one emission form per
target leg.

The frontend does not move. F5 already projects `assign target="…" value="…"`
(verified below); the statement dies at `link.ts:340` with
`statement kind assign is outside RT-1`. RT-9 is a pure runtime/linker/emitter slice
with **no** F0–F5 edit, **no** amendment record, and **no** constitution or census
change.

Three findings during design changed the tribunal's contract; each is recorded as a
DECIDED claim with its evidence and each makes the slice *smaller*:

1. `assign.target` is a **lowered expression**, not a name string.
2. Both emitters already declare every statement local as a function-scoped `let`, so
   the "link-time mutability analysis" the tribunal asked for is dead code before it
   is written.
3. Link-time **shadowing is unrepresentable** — a `let` that re-declares a name in an
   inner block is already refused as `duplicate binding` — so "assignment resolves to
   the innermost binding" is vacuous and becomes a pinned negative instead.

---

## Contract

### [RT9-C1 VERIFIED] Form: `assign` carries a lowered-expression target

Evidence — `packages/core/dist/kir-structural/catalog.generated.js`, catalog entry for
`assign`:

```
disposition: structural-candidate, allowedChildren: null, schemaStatus: bound
  op              schemaKind=string     required=false  disposition=included-value
  target          schemaKind=expression  required=true  disposition=lowered-expression
  trailingComment schemaKind=string     required=false  disposition=included-value
  value           schemaKind=expression  required=true  disposition=lowered-expression
```

Verified by decoding a real projection (`decodeModuleKir(bytes, policy.canonicalLimits)`
against `scripts/kern-frontend-f5-projection/policy.json`) for
`assign target="s" value="\"b\""`:

```json
{"kind":"assign","children":[],"properties":[
 {"key":"target","value":{"tag":"record","value":[
   {"key":"fields","value":{"tag":"record","value":[{"key":"name","value":{"tag":"text","value":"s"}}]}},
   {"key":"kind","value":{"tag":"text","value":"identifier"}}]}},
 {"key":"value","value":{"tag":"record","value":[
   {"key":"fields","value":{"tag":"record","value":[{"key":"value","value":{"tag":"text","value":"b"}}]}},
   {"key":"kind","value":{"tag":"text","value":"text"}}]}}]}
```

`trailingComment` is **dropped by F5** and never reaches the linker (verified: a source
line `assign target="s" value="\"b\"" # note` projects with property keys
`["target","value"]` only, exactly as `let … # note` projects `["name","value"]`).

**Consequence for the builder:** the target cannot be read with
`propertyText(properties, 'target', …)`. It must be decoded as the two-field canonical
record `{fields,kind}` and required to be `kind === "identifier"`, taking the name from
`fields.name`. `link.ts` already imports `canonicalRecord` (`:8`) and has a local
`propertyText` (`:67`) that takes a `ReadonlyMap`, so the helper is ~9 lines and adds no
import.

Member and index targets project and must be refused (see RT9-C6):

| Source | projected `target.kind` |
| --- | --- |
| `target="s"` | `identifier` |
| `target="s.x"` | `member` |
| `target="s[0]"` | `index` |

### [RT9-C2 DECIDED] The linked shape is `{ kind:'assign', target, value }`

```ts
| { readonly kind: 'assign'; readonly target: string; readonly value: LinkedKernKirExpression }
```

`target` is the resolved **name**, `value` is a `LinkedKernKirExpression`. The
expression field **must** be called `value`, because three existing walks reach a
statement's expression through `statement.value` with no per-kind branch and would
otherwise crash or silently under-report:

- `contracts.ts:244` `statementsInvokeCapability` — `return expressionInvokesCapability(statement.value, …)`
- `contracts.ts:330` `statementsCallDepth` — `return expressionCallDepth(statement.value, …)`
- `link.ts:152` `containsReturn` — matches `'return'` / `'if'` only, so `assign` answers
  `false` and needs no edit.

**Builder must not** rename the field to `expression`/`rhs`; that is a silent
capability-closure hole (an async helper inside an assign value would stop classifying
its caller as async).

### [RT9-C3 VERIFIED] `op=` is refused, not desugared — no linkable arithmetic exists

The tribunal's plan was to desugar `assign x op= e` at link into `assign x = x op e`.
That is **impossible on this base**:

- `LINKED_KIR_BINARY_OPERATORS` (`contracts.ts:16-25`) admits exactly
  `&& || == != < <= > >=`. There is no arithmetic and no bitwise operator, and
  `compileLinkedExpression` refuses any other spelling at `expression.ts:284` with
  `KIR_BINARY_OP_UNSUPPORTED`.
- `SUPPORTED_ASSIGN_OPERATORS`
  (`packages/core/dist/generated/utils/assignment-operators.js`) is
  `["=","+=","-=","*=","/=","%=","**=","&=","|=","^=","<<=",">>=","++","--"]`.
  `&=`/`|=` are **bitwise**, not logical; `&&=`/`||=` are documented
  (`schema.ts:1971`) as "JS-only logical/nullish … stays foreign/raw" and are not KERN
  spellings.

Intersection of the two sets is empty. Every compound spelling would desugar to an
operator the expression linker refuses, so desugaring buys a second, worse-labelled
rejection path.

**DECIDED:** any `op` property present ⇒ link refusal `KIR_ASSIGN_OP_UNSUPPORTED`.
This includes `op="="`, which projects with the property present and is a redundant
spelling of the admitted form; admitting it would be a special case with no semantic
gain and would give the linked program two source spellings for one shape.

The postfix forms need no gate: `assign target="n" op="++"` (value-less) is refused by
**F5** with `UNEXPECTED_TOKEN` because `value` is a required property. Verified.

`propertySet(properties, ['target','value'], ['op'], label)` — `op` is listed as
*optional* precisely so the refusal carries `KIR_ASSIGN_OP_UNSUPPORTED` instead of the
generic `unsupported property set`.

### [RT9-C4 DECIDED] Only `let`- and `capability`-bound names are assignable; parameters are not

The linker's `LinkScope` gains one field, `assignable: Set<string>`, written by the
`let` (`link.ts:313`) and `capability` (`:329`) branches and **not** by the parameter
loop (`:436`). `branchScope` (`:183`) copies it exactly as it copies `bindings`.

Why parameters are excluded, with evidence:

1. **The JS leg emits parameters as `const`.** Verified in a real artifact:
   `const __k0=__request.arguments[__argumentNames[0]];…` while statement locals are
   `let __k1,__k2,__k3,__k4;`. Admitting parameter assignment means changing parameter
   emission from `const` to `let`, which rewrites the emitted bytes of **every**
   program including assign-free ones, moving the artifact digests pinned in
   `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs:57-74` and the RT-6 twin.
   That is a strictly larger slice with a digest cascade and no new expressiveness.
2. **KERN already says so.** `schema.ts:1610`: "Use `kind=let` when the binding must be
   reassigned later with `assign`". A `param` is an input binding.
3. It keeps the gate one-sided: the linker only has to *record* which names came from a
   binding statement, never to reason about liveness.

A capability result **is** assignable (it is bound by a statement, its host local is a
statement local, and `bindName(scope, name, undefined, undefined)` at `:329` records no
type — see RT9-C5 for what that admits).

Refusals:

- name not in `scope.bindings` ⇒ `KIR_ASSIGN_UNDECLARED`
- name in `scope.bindings` but not in `scope.assignable` ⇒ `KIR_ASSIGN_TARGET_NOT_LET`

The order matters and is pinned: **declared is checked first**, so an unknown name
never reports `NOT_LET`.

### [RT9-C5 DECIDED] The type gate: an assign must not change either recorded type

`LINKED_KIR_TYPE_ADMISSION` (`contracts.ts:132-138`) is a table over *type kinds* in
*signature positions* (`parameter`/`return`/`scalar`). It is not a binding-type lattice
and cannot express "the value's type equals the binding's type"; the tribunal text
named the wrong table. What the linker actually records per binding is two partial
types, written by `bindName` (`link.ts:192-203`):

- `scope.types: Map<string, 'boolean'|'integer'>` — from `staticExpressionType`
  (`linked-kir-program/expression.ts:68-81`). Partial: `undefined` for text, list,
  member, json-call, decimal, and any user-call not returning boolean.
- `scope.crossCallTypes: Map<string, 'boolean'|'list<boolean>'|'list<text>'|'text'>` —
  from `crossCallExpressionType` (`:83-103`). Partial: no `integer` row.

**DECIDED gate** (three lines, no new table):

```
staticExpressionType(value, scope)    !== scope.types.get(target)          ⇒ KIR_ASSIGN_TYPE_MISMATCH
crossCallExpressionType(value, scope) !== scope.crossCallTypes.get(target) ⇒ KIR_ASSIGN_TYPE_MISMATCH
```

Strict equality, `undefined` included. The rule reads: **`assign` never rebinds a
link-time type record.** Therefore the assign branch must **not** call `bindName`, and
every downstream consumer of a binding's recorded type (`if` condition gate at
`link.ts:368`, binary operand gate at `expression.ts:290-297`, call argument gate at
`:153`) stays valid without re-deriving anything.

Worked consequences, each an oracle row:

| Binding | Value | `types` | `crossCallTypes` | Verdict |
| --- | --- | --- | --- | --- |
| `let s = "a"` | `"b"` | undefined = undefined | `text` = `text` | admitted |
| `let n = 1` | `2` | `integer` = `integer` | undefined = undefined | admitted |
| `let b = false` | `1 < 2` | `boolean` = `boolean` | `boolean` = `boolean` | admitted |
| `let n = 1`, `let m = 2` | `m` | `integer` = `integer` | undefined = undefined | admitted |
| `let ys = [flag,flag]` | `[flag]` | undefined = undefined | `list<boolean>` = `list<boolean>` | admitted |
| `capability … name=first`, `… name=second` | `second` | undefined = undefined | undefined = undefined | admitted |
| `let n = 1` | `true` | `integer` ≠ `boolean` | — | **MISMATCH** |
| `let n = 1` | `"x"` | `integer` ≠ undefined | — | **MISMATCH** |
| `let s = "a"` | `1` | undefined ≠ `integer` | — | **MISMATCH** |
| `let ys = [flag,flag]` | `"x"` | undefined = undefined | `list<boolean>` ≠ `text` | **MISMATCH** |
| `capability … name=reply` | `"x"` | undefined = undefined | undefined ≠ `text` | **MISMATCH** |

The last row is the one surprise and is deliberate: a capability result carries **no**
type record, so only another untyped value may be assigned into it. It is pinned as a
negative rather than left as a discovery.

#### The call-resolved rows — the `crossCallTypes` seam RT-8 → RT-9

Both tables have a `user-call` arm (`expression.ts:78-80`, `:89-92`) that reads the
callee's signature out of `scope.calls.linked`, so a binding declared from a helper call
carries whatever type record that signature produced. That arm is a **separate code path**
from the literal arms and has to be exercised on both sides of the gate, or a linker that
resolves only literals refuses assigns for types the binding genuinely has.

**[RT9-C5a VERIFIED] An integer-returning helper is not callable at all on this base.**
`linkedKirCrossCallType` has no `integer` row (`contracts.ts:38-43`) and
`expression.ts:148` refuses any user call whose return type has no cross-call row with
`KIR_CALL_SIGNATURE_TYPE`. Verified today, assign-free:
`fn h export=false returns=number` returning `1`, called as `let n = h(); return n`
→ `entry.function.handler.children[0].value: KIR_CALL_SIGNATURE_TYPE`. A *call-typed
integer* binding is therefore unrepresentable, and the call-typed fixtures carry the two
cross-call shapes that do resolve: `boolean` (`h()`) and `list<boolean>` (`hs()`).

| Binding | Value | `types` | `crossCallTypes` | Verdict |
| --- | --- | --- | --- | --- |
| `let n = h()` (h→boolean) | `h()` | `boolean` = `boolean` | `boolean` = `boolean` | admitted |
| `let n = h()` | `false` | `boolean` = `boolean` | `boolean` = `boolean` | admitted |
| `let ys = hs()` (hs→boolean[]) | `[flag]` | undefined = undefined | `list<boolean>` = `list<boolean>` | admitted |
| `let n = h()` | `2` | `boolean` ≠ `integer` | `boolean` ≠ undefined | **MISMATCH** |
| `let n = 1` | `h()` | `integer` ≠ `boolean` | undefined ≠ `boolean` | **MISMATCH** |
| `let ys = hs()` | `"x"` | undefined = undefined | `list<boolean>` ≠ `text` | **MISMATCH** |

The last row is the only fixture in the corpus where the **`crossCallTypes` half fires
alone on a record that came from a call signature**: both sides read `undefined` from
`types`, so dropping that half admits it. Its admitted sibling (`[flag]` into the same
binding) is the row a linker resolving only the literal arms would wrongly refuse.

`let n = h()` / `assign n = 2` is over-strict, and **deliberately so**: the binding's
static record is `boolean`, the rule is strict equality, and no widening is possible even
though nothing at RT-1 inspects the assigned tag. That is the price of RT9-C5's central
invariant — an `assign` never rebinds a link-time type record — which is what keeps the
`if` condition gate, the binary operand gate and the call argument gate valid without
re-derivation. Relaxing it needs a real binding-type lattice with a widening relation and
a re-run of every downstream gate after each assign; **that is an rt10+ slice, not a gate
tweak.**

This gate is not a value-type guarantee — nothing at RT-1 checks an assigned value's tag
— but it does not need to be. A type-wrong value that slipped through would be caught
identically on all three legs at the `return` (`matchesType` at
`kir-runtime/expression.ts:197` / `__matches` in JS / `_matches` in Python), producing the
same `invalid-handler-result` envelope. **Divergence is structurally impossible here;
the gate exists to keep the linker's own type records honest.**

### [RT9-C6 DECIDED] Non-identifier targets are refused

`target.kind !== 'identifier'` ⇒ `KIR_ASSIGN_TARGET_NOT_IDENTIFIER`. Member and index
targets project (RT9-C1) and there is no linked lvalue concept: `LinkedKernKirExpression`
has `member` but no assignment path, and RT-1's `bindings` is a flat
`Map<string, KernKirValue>` with frozen values (`Object.freeze` on every record/list in
`evaluateExpression`), so a member write is not expressible without a mutable value
model. Out of scope, refused with its own label.

### [RT9-C7 VERIFIED] Shadowing is unrepresentable, so "innermost wins" is vacuous

The tribunal asked for a fixture where an assign resolves to the innermost of two
same-named bindings. **That program cannot link on this base.** `link.ts:304`:

```ts
if (scope.bindings.has(name)) fault('handler-entry-unsupported', `${label}: duplicate binding ${name}`);
```

and `branchScope` seeds the branch's set from a copy of the enclosing one, so a
re-declaration inside a branch sees the outer name. Verified today, no assign involved:

```
let s = "a"; if flag { let s = "c"; print s }; return s
  → entry.function.handler.children[1].then.children[0]: duplicate binding s
```

Related verified scope facts (all pre-existing, all assign-free):

| Program | Result today |
| --- | --- |
| `if flag { let t = "b"; print t }; return "d"` | links |
| `if flag { let t = "c" }; return t` | `entry.function.handler.children[1].value: unknown identifier t` |
| `let flag = true` with `param flag` | `entry.function.handler.children[0]: duplicate binding flag` |

So one name has at most one binding per handler, and `assign` needs no resolution rule
at all — it needs a *reachability* rule, which `branchScope`'s copy already provides:
a binding declared in a sibling branch is not in scope, so
`if flag { let t = … } else { assign t = … }` is `KIR_ASSIGN_UNDECLARED`.

**The oracle pins the refusal, not the resolution.**

### [RT9-C8 VERIFIED] Metering: `1 + ticks(value)`, exactly a `let`

`walkStatements` charges one step per statement at `kir-runtime/expression.ts:161`
(`if (statement.kind !== 'return' || policy.meterReturn) meter.step();`), then
`evaluateExpression` charges one step per expression node at `:230`. `let` is
`bindings.set(name, yield* statementValue(...))` at `:164` — statement tick plus the
expression walk, nothing else. `assign` is the same two costs.

Empirically measured **today** with `directStepBudget`
(`scripts/kern-5-rt4-user-fn-call/k0-support.mjs:186`), which reports execution steps
net of the link budget:

| Program | `execution` |
| --- | --- |
| `return "a"` | 2 |
| `let s = "a"; return s` | 4 |
| `let s = "a"; let t = "b"; return s` | 6 |
| `let s = "a"; let t = "b"; let u = "c"; return s` | 8 |
| `let b = true; return b` | 4 |
| `let b = true; let c = 1 < 2; return c` | 8 |
| `let s = "a"; print s; return s` | 6 |
| `let s = "a"; if flag { let t = "b" }; return s`, flag=true | 9 |
| `let s = "a"; if flag { let t = "b" }; return s`, flag=false | 7 |

Derived model (matches every row): a leaf statement costs 1 + one step per expression
node; a text/boolean/integer literal or a `let`-bound identifier is 1 node; a **parameter
read is 2 nodes**; a binary is 1 (the operator) plus its two operands; an `if` costs 1 +
its condition, plus its body when taken.

**[RT9-C8a VERIFIED] The parameter-read premium.** The "3 / 2" figures for an executed
and a skipped `if` above are not constants — they are 1 + the condition cost, and every
measured `if` row happens to test a *parameter*. Measured **today**, four fresh rows that
isolate it:

| Program | `execution` | Reading |
| --- | --- | --- |
| `return "a"` | 2 | 1 stmt + 1 literal |
| `param flag`; `return flag` | 3 | 1 stmt + **2** for a parameter read |
| `let s = "a"; return s` | 4 | 2 + (1 stmt + 1 let-bound identifier) |
| `param flag`; `let b = flag; return b` | 5 | (1 + 2) + (1 + 1) |

So a skipped `if` over a parameter condition is 1 + 2 = 3 (matching the measured 7-row),
and the `assign-in-skipped-branch` = 7 / `assign-in-taken-branch` = 9 pins below are
unchanged. The distinction is load-bearing only for the new self-referential rows, where
one fixture's binary operands are both `let`-bound and the other's second operand is a
parameter.

Hand-computed expectations for the RT-9 metering fixtures, all of them *deltas against
a row measured above*:

| Fixture | Program | Expected `execution` | Derivation |
| --- | --- | --- | --- |
| `assign-literal` | `let s = "a"; assign s = "b"; return s` | **6** | 4 + (1 stmt + 1 literal) |
| `let-literal-control` | `let s = "a"; let t = "b"; return s` | 6 (measured) | — |
| `assign-binary` | `let b = true; assign b = 1 < 2; return b` | **8** | 4 + (1 stmt + 3 binary) |
| `let-binary-control` | `let b = true; let c = 1 < 2; return c` | 8 (measured) | — |
| `assign-in-taken-branch` | `let s = "a"; if flag { assign s = "b" }; return s`, flag=true | **9** | 9-row with the branch `let` replaced by an assign of equal cost |
| `assign-in-skipped-branch` | same, flag=false | **7** | the assign is never reached, so it costs nothing |

The two control rows are the load-bearing pins: **an `assign` costs exactly what a
`let` of the same value costs** (`assign-literal` = `let-literal-control` = 6,
`assign-binary` = `let-binary-control` = 8). They cannot drift with the shared entry
constant.

Eight further rows cover the self-referential and post-suspension fixtures. Every one has
a `let`-shaped control **measured today at base** (all four control values below were
confirmed by running `directStepBudget`), so each assign row is a substitution delta, not
a free-standing guess:

| Fixture | Program | Expected `execution` | Derivation |
| --- | --- | --- | --- |
| `assign-self-and` | `let b=true; let c=false; assign b = b && c; return b` | **10** | 2 + 2 + (1 + 1op + 1b + 1c) + 2 |
| `let-self-and-control` | same with `let d = b && c; return d` | 10 (measured) | — |
| `assign-self-or` | `param flag`; `let b=false; assign b = b \|\| flag; return b`, flag=true | **9** | 2 + (1 + 1op + 1b + **2**flag) + 2 |
| `let-self-or-control` | same with `let d = b \|\| flag; return d` | 9 (measured) | — |
| `assign-after-async-taken` | `let s="a"; let r=fetchIt(t); assign s=r; if flag { assign s="c" }; return s`, flag=true | **19** | 2 + **8** + 2 + (1 + 2flag + 2) + 2 |
| `let-after-async-taken-control` | same with `let u=r` and `let v="c"`, returning `u` | 19 (measured) | fixes the `let r = fetchIt(t)` cost at 8 by subtraction |
| `assign-after-async-skipped` | same as the taken row, flag=false | **17** | 2 + 8 + 2 + (1 + 2flag) + 2 |
| `let-after-async-skipped-control` | the let-shaped twin, flag=false | 17 (measured) | — |

`assign-self-and` − `assign-self-or` = 1 is the parameter-read premium of RT9-C8a plus one
extra `let`, and it is asserted as two separate identities rather than as that one
difference. The async rows are the only ones whose derivation leans on a *subtracted*
constant (the 8-step cost of `let r = fetchIt(t)`, which the spec's leaf formula does not
cover because it says nothing about user-call or capability-dispatch nodes); the two
measured controls are what make that subtraction exact, and the parity assertion
`assign-after-async-* == let-after-async-*-control` is the pin that survives if the
call-dispatch cost itself ever moves.

### [RT9-C9 VERIFIED] Zero new await points on RT-1

The standing review question — *every new completion/dispatch path must add zero await
points* (the RT-2/RT-5/RT-6 bug class, four occurrences) — is answered structurally, not
by inspection.

RT-1's binding store is a **flat mutable** `Map<string, KernKirValue>`
(`kir-runtime/expression.ts:150-152`: the frame stack holds
`{statements, index}` only; `bindings` is threaded through unchanged and every `let`
writes it with `bindings.set` at `:164`). There is **no per-frame binding environment
and therefore no frame walk to write**. `assign` is one `else if` arm that is
character-for-character the `let` arm with the target substituted:

```ts
} else if (statement.kind === 'assign') {
  bindings.set(statement.target, yield* statementValue(statement.value, bindings, meter, runtime));
}
```

`yield*` on a synchronous generator suspends and resumes with no microtask hop (the
existing comment at `:206-207` states the invariant for the same construct), and
`runtime.checkAbort()` at `:162` already runs for every statement before dispatch, so
the cancellation checkpoint is the pre-existing per-statement one. **No new `await`, no
`setImmediate`, no microtask yield, no new checkAbort site.**

**Builder must not** place the assign arm after the trailing `else` — that `else` is the
`return` handler (`:191-201`), so an unhandled `assign` is silently executed as a return.
Mutant `M09` pins it.

### [RT9-C10 VERIFIED] JS emission: the mutability analysis is unnecessary

The tribunal required a link-time mutability analysis so assign targets emit `let`
rather than `const`. **Verified moot:** both emitters rename every KERN binding to a
host local drawn from a counter and declare *all* statement locals with one
function-scoped `let`.

`kir-js-esm/emitter.ts:202-208` — `let` does **not** emit a declaration:

```
if (statement.kind === 'let') {
  const value = statementValueSource(statement.value, bindings, calls);
  bindings.set(statement.name, local);
  return `\n      __meter.step(); __checkAbort();\n      ${local}=${value};`;
}
```

and the declaration is emitted once per function, at `:282` for helpers and in
`specializedSource` for the entry: `let __k1,__k2,__k3,__k4;`. Verified in a real
artifact for `let s; if flag { let t; print t }; return s`:

```js
const __k0=__request.arguments[__argumentNames[0]];…
let __k1,__k2,__k3,__k4;
…
  __k1=(__meter.step(),Object.freeze({tag:"text",value:"a"}));
  __meter.step(); __checkAbort();
  __k2=(__meter.step(),__k0);
  if(__k2.tag!=='boolean')throw new __Fault(…);
  if(__k2.value===true){
  __meter.step(); __checkAbort();
  __k3=(__meter.step(),Object.fre…
```

Every statement local, including one declared inside a branch, is a function-scoped
`let`. **Drop the analysis.** The JS assign form is:

```
__meter.step(); __checkAbort();
<existingLocal>=<statementValueSource(value)>;
```

where `existingLocal = bindings.get(statement.target)`. `blockSource` copies the scope
map per branch (`new Map(scope)` at `:234,:238`), so an assign inside a branch reads the
enclosing local and writes the function-scoped variable — exactly KERN's frame-reach
semantics.

It must be `statementValueSource`, not `expressionSource`: the assign value may be an
async helper call (RT9-C11), and only `statementValueSource` emits the `await`.

**`assign` consumes no host local.** Route it in `blockSource` beside `return`
(`if (statement.kind === 'assign') return assignSource(...)`) *before* the
`leafSource(statement, nextLocal(), …)` call at `:231`, so local numbering stays a
function of the `let`/`capability`/`print`/`if` count and assign-free programs emit
byte-identically. The artifact digests in
`scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs:57-74` (and the RT-6 twin) are
the independent proof of that and **must stay green untouched**.

### [RT9-C11 VERIFIED] Python emission: plain rebinding, no nested scope

`kir-python/emitter.ts:204-211` mirrors JS: `let` emits `        ${local} = ${source}`
with **no declaration at all**, so a rebinding is the same function-local name.

The frame-reach question the tribunal raised — does a KERN `let` inside an `if` create a
Python nested scope? — is **no**. `blockSource` (`:239-252`) emits an `if`-branch body
by textual indentation via `indented` (`:190-195`):

```python
        if _k2["value"] is True:
            _meter.step()
            _check_abort()
            _k3 = _expression(_meter,lambda:{…})
```

Verified in a real artifact. A nested `def` appears only for **helpers**
(`helperSource:288`), whose parameters and locals live in their own namespace, so no
`nonlocal`/`global` declaration is needed anywhere and none may be emitted. The Python
assign form is:

```python
        _meter.step()
        _check_abort()
<prelude>        <existingLocal> = <source>
```

from `statementValue(statement.value, bindings, calls)` (the `{prelude, source}` pair),
never `expressionSource`, for the same await reason.

### [RT9-C12 VERIFIED] An async helper call is a legal assign value

`assertAsyncCallPosition(value, scope, label, /* statementValue */ true)`
(`link.ts:278-289`) checks only the *arguments* of a user-call in a statement-value
position, so an async callee as the whole value is admitted — the same rule `let` gets
at `:312`. Verified: `let a = "x"; assign a = fetchIt(t); return a` projects, and its
assign-free twin `let a = "x"; let b = fetchIt(t); return b` links today and returns
`{"tag":"text","value":"reply-value"}` with one capability event on all three legs.

The assign branch therefore calls `assertAsyncCallPosition(compiled.value, scope,
`${label}.value`, true)` — identical to `let`.

### [RT9-C13 DECIDED] Admitted bodies

`let` / `capability` / `print` / `return` / `if` + `else` / **`assign`**. No `for`, no
`while`, no `break`/`continue`, no `each`, no print-in-loop. A void handler
(`returns=void`, RT-6) may contain an assign: `containsReturn` (`link.ts:152`) does not
match `assign`, so `KIR_VOID_HANDLER_VALUE_RETURN` cannot misfire. Verified that the
assign-free twin `let s = "a"; print s` with `returns=void` links today and completes
with `{"kind":"return"}` / `{"presence":"absent"}` / one stdout event.

---

## F5 Facts (verified 2026-09-02 by running the pipeline)

Method: `runProjection([{moduleId:'route.kern', source}])` from
`scripts/kern-frontend-f5-projection/worker.mjs`; shapes decoded with
`decodeModuleKir(bytes, policy.canonicalLimits)` using the same
`scripts/kern-frontend-f5-projection/policy.json` `canonicalLimits` the F5 policy uses.
Link column from `linkVerifiedKernKirProgramOrThrow(verified, ENTRY, new RuntimeMeter(LIMITS))`.

| Probe | F5 | Diagnostics | Link at base |
| --- | --- | --- | --- |
| `assign target="s" value="\"b\""` | projected | — | `statement kind assign is outside RT-1` |
| `assign target=s value="\"b\""` (unquoted) | **rejected** | `UNEXPECTED_TOKEN` | never reached |
| `assign target="n" op="+=" value="2"` | projected | — | `statement kind assign is outside RT-1` |
| `assign target="n" op="=" value="2"` | projected | — | idem |
| `assign target="n" op="++"` (value-less) | **rejected** | `UNEXPECTED_TOKEN` | never reached |
| `assign` inside an `if` then-branch | projected | — | `…children[1].then.children[0]: statement kind assign is outside RT-1` |
| `assign` inside an `else` branch | projected | — | `…children[1].else.children[0]: statement kind assign is outside RT-1` |
| `assign` before the `let` that declares its target | projected | — | idem (kind gate fires first) |
| `assign target="p"` where `p` is a `param` | projected | — | idem |
| `assign target="s.x"` | projected | — | idem |
| `assign target="s[0]"` | projected | — | idem |
| `assign … value="\"b\"" # note` | projected | — | idem; `trailingComment` **not** in the projected node |
| `assign target="s" value="1 < 2"` | projected | — | idem |
| `assign` with an async-helper-call value | projected | — | idem |
| `assign` inside a `returns=void` handler | projected | — | idem |
| `assign target="b" value="b && c"` (target read in its own value) | projected | — | idem |
| `assign target="n" value="h()"` (sync helper call value) | projected | — | idem |
| `assign` after a `let` bound to an async call, plus one inside the following `if` | projected | — | `…children[2]: statement kind assign is outside RT-1` |
| `assign` **inside a helper body** (`export=false`) | projected | — | `helper.g.handler.children[1]: statement kind assign is outside RT-1` |

Projected node shapes (the frontier this slice builds on):

| Source form | `properties` keys | `target.kind` | `value.kind` | `children` |
| --- | --- | --- | --- | --- |
| `target="s" value="\"b\""` | `["target","value"]` | `identifier` | `text` | 0 |
| `target="n" op="+=" value="2"` | `["op","target","value"]` | `identifier` | `integer` | 0 |
| `target="b" value="1 < 2"` | `["target","value"]` | `identifier` | `binary` | 0 |
| `target="s.x" value="\"b\""` | `["target","value"]` | `member` | `text` | 0 |
| `target="s[0]" value="\"b\""` | `["target","value"]` | `index` | `text` | 0 |
| helper body `target="x" value="\"q\""` | `["target","value"]` | `identifier` | `text` | 0 |

Every one of the 38 projected fixtures this oracle uses was confirmed
`status: "projected"` at base; the only two frontend walls are the unquoted target and
the value-less postfix form, both `UNEXPECTED_TOKEN`. **No F1–F5 edit is required and
none is licensed.** No F5 composition pin moves, so
`scripts/kern-frontend-closure/amend.mjs` is not invoked and no amendment record is
written.

---

## Sites the builder must touch

| File:line | What |
| --- | --- |
| `kir-runtime/linked-kir-program/contracts.ts:157-173` | `LinkedKernKirStatement` union gains the `assign` variant (RT9-C2). Nothing else in this file changes: `statementsInvokeCapability:244` and `statementsCallDepth:330` already reach `statement.value`. |
| `kir-runtime/linked-kir-program/link.ts:166-171` | `LinkScope` gains `assignable: Set<string>`. |
| `link.ts:183-190` | `branchScope` copies `assignable` (`new Set(scope.assignable)`). |
| `link.ts:301-315` | the `let` branch adds the name to `assignable`. |
| `link.ts:316-331` | the `capability` branch adds the name to `assignable`. |
| `link.ts:291-341` | new `assign` branch in `compileStatement`, before the `:340` fallthrough: `propertySet(['target','value'],['op'])`, `op` refusal, target decode + identifier check, declared check, assignable check, `compileLinkedExpression` on the value, `assertAsyncCallPosition(…, true)`, the two-table type gate, **no `bindName`**. |
| `link.ts:419-424`, `:436` | the entry `LinkScope` literal gains `assignable: new Set()`; the parameter loop does **not** write it. |
| `kir-runtime/expression.ts:184` | new `else if (statement.kind === 'assign')` arm **before** the trailing `else` (RT9-C9). |
| `compiler/kir-js-esm/emitter.ts:230-231` | `blockSource` routes `assign` before `nextLocal()`; new `assignSource` helper (RT9-C10). |
| `compiler/kir-python/emitter.ts:237-238` | the Python twin (RT9-C11). |

Sites that must **not** change, with the reason: `link.ts:152` `containsReturn`
(`assign` correctly answers `false`); `link.ts:449-457` the one-final-return rule;
`kir-runtime/execute.ts` (no new step kind, no new completion); `inspect.ts`;
`digest.ts`.

## Blast radius outside `packages/core`

Adding a variant to `LinkedKernKirStatement` moves exactly one prior-slice golden,
because exactly one oracle scrapes that union.

| File | Action | Reason |
| --- | --- | --- |
| `scripts/kern-5-rt2-boolean-if/k0-golden.json` | Modified | `linkedStatementKinds` gains `"assign"`; `admission.assign` moves `projection-rejected` → `admitted`. |
| `scripts/kern-5-rt2-boolean-if/k0-golden.test.mjs` | Modified | `PROBE_BODIES.assign:15` currently probes with an **unquoted** target (`assign target=held …`), which F5 refuses — that is why the row reads `projection-rejected`. It must be quoted (`assign target="held" …`) or RT-2's second test breaks: it filters `admission[kind] === 'admitted'` and compares against `linkedStatementKinds`, so `assign` in the union with a non-admitted row is an unconditional failure. Verified today: the quoted body projects and reports `handler-entry-unsupported` on all three legs, and its types are `text`/`text` so the RT9-C5 gate admits it. |
| `scripts/kern-5-rt3-binary-expression/k0-golden.json` | Modified | `rt2GoldenSha256` digest literal only (recomputed by `k0-golden.test.mjs:74`). |
| `scripts/kern-5-rt4-user-fn-call/probe-matrix.json` | Modified | `rt2GoldenSha256` digest literal only (`probe-matrix.test.mjs:158`). |

This is the same one-digest-literal move RT-2 → RT-6 already performed; nothing else in
those suites may be touched.

## Allowed files

- `packages/core/src/kir-runtime/linked-kir-program/contracts.ts`
- `packages/core/src/kir-runtime/linked-kir-program/link.ts`
- `packages/core/src/kir-runtime/expression.ts`
- `packages/core/src/compiler/kir-js-esm/emitter.ts`
- `packages/core/src/compiler/kir-python/emitter.ts`
- `scripts/kern-5-rt9-linked-assign/**` (new)
- `scripts/kern-5-rt2-boolean-if/k0-golden.json`, `k0-golden.test.mjs` — additive row +
  the quoted probe body, nothing else
- `scripts/kern-5-rt3-binary-expression/k0-golden.json`,
  `scripts/kern-5-rt4-user-fn-call/probe-matrix.json` — the `rt2GoldenSha256` literal only
- `package.json` — one script, `test:kern-5-rt9-linked-assign`
- `.Codex/specs/kern-5-rt9-linked-assign/spec.md`

## FROZEN files

- All F0–F5 compositions (`examples/kern-frontend/**`) and
  `scripts/kern-frontend-f5-projection/policy.json`, `policy-validation.mjs`, `worker.mjs`
- `scripts/kern-frontend-closure/**` — closure ledger, static goldens, `amendments/`,
  `validate.mjs`, `amend.mjs`. No amendment record is written in this slice.
- `scripts/kir-structural/constitution.json` and `scripts/kir-v1/acceptance-policy.json`
- `packages/core/src/schema.ts` and the generated structural catalog
- `scripts/kern-5-admission-census/**` — the census reads repo `.kern` files, none of
  which change
- Every `.kern` file in the repository
- Canonicalizer receipts, **except** the single `rt2GoldenSha256` digest literal in each
  of the two files named above — the precedent RT-2 → RT-6 established
- `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs` and
  `scripts/kern-5-rt6-void-fallthrough/compatibility.test.mjs` artifact digests: they are
  the independent proof that assign-free emission is byte-identical, and they must pass
  **unmodified**

## LOC budget

**≤ 400 net production lines** (tribunal cap). Design estimate: **~70** —
contracts.ts +5, link.ts +35, RT-1 expression.ts +3, JS emitter +10, Python emitter +12.
Crossing ~150 means the design above was misread; stop and re-read RT9-C9/C10/C11 rather
than growing the slice.

## Oracle

`scripts/kern-5-rt9-linked-assign/`, root script `test:kern-5-rt9-linked-assign`,
chained `node --test` in the RT-2…RT-8 pattern. `k0-support.mjs` re-exports
`scripts/kern-5-rt6-void-fallthrough/k0-support.mjs` (which re-exports RT-4 → RT-2) and
adds only RT-9 fixtures and two helpers; no harness is duplicated.

| Suite | Tests | What it pins | At base |
| --- | --- | --- | --- |
| `probe-matrix.test.mjs` | 6 | F5 facts only — projection status, diagnostic codes and the projected node/target shapes across 40 positions and 4 control positions, including the helper-body assign | **GREEN 6/6** (F5 already projects `assign`; the matrix pins the frontier and must stay green after the build too) |
| `k0-golden.test.mjs` | 5 | `linkedStatementKinds` scraped from `contracts.ts`, the 44-row admission map, the `assign` catalog schema, the untouched loop/`set` controls | **RED 4/5** |
| `behavior.test.mjs` | 23 | three-leg byte-identical envelopes for the twenty positive fixtures | **RED 0/23** |
| `type-gate.test.mjs` | 24 | 16 refusals, each with its **label text** pinned, plus the label-disambiguation rows, the call-resolved admitted rows and the two-table separation row | **RED 1/24** |
| `tick-discipline.test.mjs` | 17 | exact `execution` step counts on 14 rows, `assign` = `let` parity on six pairs, queued-abort fences at microtask depths 0–4 on two fixtures, pre-cancel fail-closed | **RED 5/17** |

`probe-matrix` runs first: it is the sequencing gate, and it proves every negative is a
link decision rather than a frontend gap.

Label texts are asserted, not just the closed code — the RT-6 review lesson
(`kern-5-rt6-void-fallthrough/k0-support.mjs:64-84`: "the linker's rejection code is
closed, so a suite that only asserts the code cannot tell which gate fired"). RT-9's
`assertAssignLabel` wraps `assertLinkRejected` and asserts the label appears in the
`linkVerifiedKernKirProgramOrThrow` message.

### Positive fixtures with hand-computed expectations

| # | Fixture | Program body | Expected envelope |
| --- | --- | --- | --- |
| B1 | `simple-reassign` | `let s = "a"` / `assign s = "b"` / `return s` | result `{"tag":"text","value":"b"}`, events `[]` |
| B2 | `branch-then` (flag=true) | `let s = "a"` / `if flag { assign s = "b" }` / `return s` | `"b"` |
| B3 | `branch-then` (flag=false) | same | `"a"` |
| B4 | `branch-else` (flag=true / false) | `let s = "a"` / `if flag { assign s="b" } else { assign s="c" }` / `return s` | `"b"` / `"c"` |
| B5 | `branch-return` (flag=true / false) | `let s="a"` / `if flag { assign s="b"; return s }` / `return s` | `"b"` / `"a"` |
| B6 | `ordering-print` | `let s="a"` / `assign s="b"` / `print s` / `assign s="c"` / `return s` | events `[{"op":"stdout","text":"b"}]`, result `"c"` |
| B7 | `two-assigns` | `let s="a"` / `assign s="b"` / `assign s="c"` / `return s` | `"c"` |
| B8 | `binary-value` | `let b=false` / `assign b = 1 < 2` / `return b` | `{"tag":"boolean","value":true}`; twin with `2 < 1` → `false` |
| B9 | `integer-from-identifier` | `let n=1` / `let m=2` / `assign n = m` / `return n` | `{"tag":"integer","value":"2"}` |
| B10 | `list-assign` | `let ys=[flag,flag]` / `assign ys=[flag]` / `return ys` | a one-element boolean list |
| B11 | `async-value` | helper `fetchIt(t)` invoking a capability; `let a="x"` / `assign a = fetchIt(t)` / `return a` | result `{"tag":"text","value":"reply-value"}`, one capability event (matches the measured assign-free twin) |
| B12 | `void-with-assign` | `returns=void`; `let s="a"` / `assign s="b"` / `print s` | completion `{"kind":"return"}`, result `{"presence":"absent"}`, events `[{"op":"stdout","text":"b"}]` |
| B13 | `self-referential-and` | `let b=true` / `let c=false` / `assign b = b && c` / `return b` | `{"tag":"boolean","value":false}`, events `[]` |
| B14 | `self-referential-or` (flag=true / false) | `param flag`; `let b=false` / `assign b = b \|\| flag` / `return b` | `true` / `false` |
| B14b | `self-referential-or-held` (flag=false / true) | `param flag`; `let b=true` / `assign b = b \|\| flag` / `return b` | `true` / `true` |
| B15 | `call-typed-positive` | helper `h() -> boolean` returning `true`; `let n = h()` / `assign n = h()` / `return n` | `{"tag":"boolean","value":true}`, events `[]` |
| B16 | `call-typed-literal` | same helper; `let n = h()` / `assign n = false` / `return n` | `{"tag":"boolean","value":false}` |
| B17 | `call-typed-list` (flag=false) | helper `hs() -> boolean[]` returning `[true]`; `let ys = hs()` / `assign ys = [flag]` / `return ys` | a one-element list `[{"tag":"boolean","value":false}]` |
| B18 | `after-async-suspension` (flag=true / false) | helper `fetchIt(t)`; `let s="a"` / `let r = fetchIt(t)` / `assign s = r` / `if flag { assign s="c" }` / `return s` | `"c"` / `"reply-value"`; exactly one event, `events[0].op === "capability"` |
| B19 | `helper-body-assign` | helper `g() -> string` whose body is `let x="p"` / `assign x="q"` / `return x`; entry is `return g()` | `{"tag":"text","value":"q"}`, events `[]` |

B1's expectation is hand-derived from the semantics, and every leg is asserted
byte-identical against RT-1 via `threeLegBytes`; B11's and B12's are anchored on the
assign-free twins measured at base (RT9-C12, RT9-C13).

B13, B14 and B14b are the **self-referential** rows: their value expression reads the
assign target itself, which is the only thing that makes evaluation order observable.
Every other positive has a target-free RHS, so an implementation that rebinds the target
before evaluating the value passes all of B1–B12. The two flavours of that mutant are
separated deliberately:

- **target left unset / undefined before evaluation** — B13 and B14 both kill it: the
  operand read is an unset binding, so RT-1 faults and the emitters read `undefined` into
  `__and`/`__or`, and no leg can produce the contracted clean `success` envelope.
- **target cleared to a `false` default before evaluation** — B13 (`true && false`) and
  B14 (`false || flag`) both *coincide* with the correct answer, so neither kills it.
  **B14b is the one row that does:** the correct answer is `true || false = true`, and a
  target cleared to `false` answers `false`. It is in the corpus for exactly that reason
  and must not be dropped as a duplicate of B14.

B18's flag=false expectation is anchored on the measured assign-free twin
(`let s="a"; let r=fetchIt(t); let u=r; if flag { let v="c" }; return u`), which returns
`{"tag":"text","value":"reply-value"}` with one capability event at base. B19's is
anchored on the same twin shape with the helper body's `assign` replaced by a second
`let` — measured `{"tag":"text","value":"q"}` at base.

B6 is the discriminating fixture for evaluation order, and the one that kills a RT-1
implementation that mistakes an assign for a return: such an implementation returns
`"b"` with **no** stdout event.

### Negative fixtures

| # | Fixture | Expected label |
| --- | --- | --- |
| T1 | `assign zz = "b"` (never declared) | `KIR_ASSIGN_UNDECLARED` |
| T2 | `if flag { let t="b"; print t } else { assign t="c" }` | `KIR_ASSIGN_UNDECLARED` |
| T3 | `assign s="b"` / `let s="a"` / `return s` | `KIR_ASSIGN_UNDECLARED` |
| T4 | `let n=1` / `assign n=true` | `KIR_ASSIGN_TYPE_MISMATCH` |
| T5 | `let n=1` / `assign n="x"` | `KIR_ASSIGN_TYPE_MISMATCH` |
| T6 | `let s="a"` / `assign s=1` | `KIR_ASSIGN_TYPE_MISMATCH` |
| T7 | `let ys=[flag,flag]` / `assign ys="x"` | `KIR_ASSIGN_TYPE_MISMATCH` |
| T8 | `capability … name=reply` / `assign reply="x"` | `KIR_ASSIGN_TYPE_MISMATCH` |
| T9 | `param p string` / `assign p="b"` | `KIR_ASSIGN_TARGET_NOT_LET` |
| T10 | `assign n op="+=" value="2"` | `KIR_ASSIGN_OP_UNSUPPORTED` |
| T11 | `assign s op="=" value="\"b\""` | `KIR_ASSIGN_OP_UNSUPPORTED` |
| T12 | `assign s.x = "b"` | `KIR_ASSIGN_TARGET_NOT_IDENTIFIER` |
| T13 | `assign s[0] = "b"` | `KIR_ASSIGN_TARGET_NOT_IDENTIFIER` |
| T14 | `let s="a"` / `if flag { let s="c"; print s }` (RT9-C7, no assign) | `duplicate binding s` — pinned **now**, passes at base, must keep passing |
| T15 | two capabilities / `assign first = second` / `return first` | **admitted**; three-leg byte-identical, two capability events, result `{"tag":"text","value":"reply-value"}` |
| T16 | `let n = h()` (h→boolean) / `assign n = 2` | `KIR_ASSIGN_TYPE_MISMATCH` (deliberately over-strict, RT9-C5) |
| T17 | `let n = 1` / `assign n = h()` | `KIR_ASSIGN_TYPE_MISMATCH` |
| T18 | `let ys = hs()` (hs→boolean[]) / `assign ys = "x"` | `KIR_ASSIGN_TYPE_MISMATCH` — the `crossCallTypes` half firing alone on a call-resolved record |

All 18 project at base (verified), so every refusal is a link decision.

### Metering fixtures

The six rows of RT9-C8 plus the eight self-referential / post-suspension rows. `tick-discipline.test.mjs` asserts each absolute
`execution` count, then the two parity identities
(`assign-literal == let-literal-control`, `assign-binary == let-binary-control`), then
reuses the RT-2 queued-abort fence (`kern-5-rt2-boolean-if/tick-discipline.test.mjs:43-70`)
across microtask depths 0–4 on the assign fixtures, and finally the pre-cancelled
fail-closed envelope (`preCancelled: true` ⇒ `execution-cancelled`, `events: []`,
byte-identical direct vs emitted JS).

## Mutant list

Nineteen mutants, each argued non-equivalent against the real JS/Python/RT-1 semantics
rather than against the spec text.

| # | Mutant | Why it is not equivalent | Killed by |
| --- | --- | --- | --- |
| M01 | `compileStatement` has no `assign` branch | falls through to `link.ts:340`; every positive is `handler-entry-unsupported` | `k0-golden`, all of `behavior` |
| M02 | the assign branch calls `bindName(scope, target, staticType(value), crossCallType(value))` | the binding's recorded type follows the last assign, so `let n=1; assign n=true; return n` links and then fails at `matchesType` with `invalid-handler-result` on all three legs — a runtime failure where a link refusal was contracted | T4 (expects the label at link, observes a success-then-runtime-failure) |
| M03 | drop the `crossCallTypes` half of the type gate | `let ys=[flag,flag]; assign ys="x"` links; RT-1 returns text against `boolean[]`. Independent of M04: this table has no `integer` row, so `let n=1; assign n=true` is still caught by the other half | T7 |
| M04 | drop the `types` half of the type gate | `let n=1; assign n=true` links; the `crossCallTypes` half cannot see it, because integer has no cross-call row and both sides read `undefined` | T4 |
| M05 | `assignable` is `scope.bindings` (parameters assignable) | T9 links; the emitted JS then executes `__k0=…` against `const __k0` in an ESM module — a real `TypeError: Assignment to constant variable`, while Python rebinds happily. Genuine three-leg divergence, unlike a `1n < 2` style phantom | T9 label pin; `behavior` byte-equality if the label check were removed |
| M06 | `op` is accepted and treated as a plain assign | `assign n op="+=" value="2"` executes as `n = 2`, silently wrong arithmetic on every leg with no error anywhere | T10, T11 |
| M07 | a `member`/`index` target is accepted by taking the object's name | `assign s.x = "b"` writes `s`, replacing a record with a text; the frozen value model makes the intended write impossible in the first place | T12, T13 |
| M08 | declared/assignable checks swapped | an unknown name reports `KIR_ASSIGN_TARGET_NOT_LET`; the closed link code is identical, so only the label text separates them | T1 (label), T9 (label) |
| M09 | RT-1 handles `assign` in the trailing `else` (i.e. the arm is missing) | the `else` at `expression.ts:191-201` is the **return** handler: the assign's value becomes the handler result and the walk stops. B1 coincidentally returns `"b"`, which is exactly why B6 and B7 exist — B6 loses its stdout event, B7 returns `"b"` instead of `"c"` | B6, B7, B12 |
| M10 | RT-1 skips `meter.step()` for `assign` (adds it to the `:161` return exemption) | every assign costs 1 instead of 2, so the `let` parity identity breaks in both directions | `tick-discipline` `assign-literal` (6→5) and the parity assertions |
| M11 | RT-1 uses `evaluateExpression` instead of `yield* statementValue` for the value | an async-helper value throws `KIR_ASYNC_CALL_EXPRESSION_POSITION` at RT-1 (`expression.ts:240`) while both emitters `await` it happily — RT-1-only failure, maximal divergence | B11 |
| M12 | either emitter assigns into a freshly allocated local instead of `bindings.get(target)` | the target never updates on that leg only: B1 returns `"a"` in JS/Python and `"b"` at RT-1. Also perturbs local numbering, so assign-free artifacts move | B1–B7 byte-equality; RT-4/RT-6 `compatibility` digests |
| M13 | either emitter uses `expressionSource` instead of `statementValueSource`/`statementValue` | the async assign emits with no `await`, so the local holds a pending promise and the returned value fails `__matches`/`_matches` — that leg only | B11 |
| M14 | the Python emitter omits `_check_abort()` on the assign line | the emitted Python stops observing cancellation at an assign, so a queued abort lands one statement later than at RT-1 | `tick-discipline` queued-abort fence, pre-cancel row |

| M15 | the target is rebound (or its host local cleared) **before** the value is evaluated | `assign b = b && c` reads an unset binding, so RT-1 faults and both emitters feed `undefined` into `__and`/`__or`; no leg can produce the contracted clean envelope. Every other positive has a target-free RHS and cannot see it | B13, B14 |
| M16 | as M15, but the target is cleared to a `false` default rather than to unset | B13 (`true && false`) and B14 (`false \|\| flag`) both coincide with the correct answer, so the ordering is still unobservable on them. `true \|\| false` is the only shape that separates them | **B14b alone** |
| M17 | the type gate resolves only the literal arms of the two tables and treats a `user-call` value as untyped | `let n = h()` records nothing, so `assign n = false` and `assign ys = [flag]` are refused for a type the binding genuinely has — a fail-closed refusal of legal programs, invisible to every literal-only fixture | B15, B16, B17, and the type-gate admitted-through-a-call-signature row |
| M18 | drop the `crossCallTypes` half **on the call path only** (M03's narrower sibling) | `let ys = hs(); assign ys = "x"` links, because the `types` half reads `undefined` on both sides. The `[flag,flag]` list-literal binding of M03/T7 does not reach the call arm, so T7 cannot see this | T18 |
| M19 | `assign` is admitted in an entry handler but refused (or ignored) inside a helper body | `compileHandler` is shared, so a per-position gate is an added special case; the helper's local rebinding is then never emitted and `g()` returns `"p"` on the leg that skipped it | B19 |

M13–M19 bring the table to nineteen; twelve is the tribunal's floor. M13/M14 are the
cheapest emitter-only kills, and M15–M19 are the five the nero pass added — the two
evaluation-order flavours, the two call-resolution paths, and the helper-body position.

No mutant in this list relies on a `const`-vs-`let` JS analysis, on a `int()` coercion,
or on mixed-BigInt arithmetic — the three phantom classes the tribunal's `for` contract
produced.

---

## Acceptance criteria

1. `pnpm test:kern-5-rt9-linked-assign` — 75/75.
2. `pnpm test:kern-5-rt2-boolean-if` 35/35, `test:kern-5-rt3-binary-expression` 142/142,
   `test:kern-5-rt4-user-fn-call` 50/50, `test:kern-5-rt5-async-user-fn-call` 86/86,
   `test:kern-5-rt6-void-fallthrough` 52/52, `test:kern-5-rt8-integer-signatures` 28/28.
3. F5 / closure / census / canonicalizer unchanged: 67 / 5 / 10 / 872.
4. `pnpm --filter @kernlang/core build` (tsc) clean; `biome check` clean on the five
   touched `packages/core` files.
5. `scripts/kern-5-rt4-user-fn-call/compatibility.test.mjs` and the RT-6 twin pass with
   **no digest edited** — the proof that assign-free emission is byte-identical.
6. `git diff` adds zero occurrences of `await`, `setImmediate`, `queueMicrotask`,
   `Promise`, or `checkAbort()` under `packages/core/src/kir-runtime/`.
7. Net production diff ≤ 400 lines (design estimate ~70).

---

## RED evidence at base `dcb54d6c`

`pnpm --filter @kernlang/core build` clean, then each suite under `node --test`.

| Suite | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `probe-matrix.test.mjs` | 6 | **6** | 0 |
| `k0-golden.test.mjs` | 5 | 4 | **1** |
| `behavior.test.mjs` | 23 | 0 | **23** |
| `type-gate.test.mjs` | 24 | 1 | **23** |
| `tick-discipline.test.mjs` | 17 | 5 | **12** |
| total | 75 | 16 | **59** |

Before the nero pass the corpus was 59 tests / 46 RED. The sixteen added tests are 13 new
RED rows and three that pass at base and must keep passing: the helper-body F5 shape row,
and the two new metering identities over the pinned constants.

The 16 that pass at base are load-bearing and must keep passing: the whole F5 probe
matrix including the helper-body assign shape, the four K0 control assertions (loop kinds
still outside RT-1, `set` still an excluded host, the `assign` catalog schema), the
shadowing refusal (RT9-C7), and the five arithmetic identities over the pinned metering
constants.

**Every failure is the link fault, for the right reason. Two verbatim assertion texts:**

`type-gate.test.mjs` row 1 — the label pin, which names the gate that *did* fire:

```
not ok 1 - neg-undeclared is refused at link with KIR_ASSIGN_UNDECLARED
  error: 'expected the KIR_ASSIGN_UNDECLARED gate to fire, but the linker reported:
           entry.function.handler.children[0]: statement kind assign is outside RT-1'
```

`behavior.test.mjs` row 1 — the three-leg harness refusing to compile the fixture:

```
not ok 1 - a reassigned let carries the assigned value, not the declared one
  error: |-
    javascript compile failed: handler-entry-unsupported
    + 'failure'
    - 'success'
  stack: threeLegs (scripts/kern-5-rt2-boolean-if/k0-support.mjs:218:10)
```

`k0-golden.test.mjs` fails as one diff: all thirteen admitted positions read
`handler-entry-unsupported` instead of `admitted`, and `linkedStatementKinds` is missing
`'assign'`. `tick-discipline.test.mjs` row 1 fails with
`no step budget in the scanned range linked the metering fixture`, and its queued-abort
rows with the same `javascript compile failed: handler-entry-unsupported`.

No failure is a fixture error, a missing file, a harness error, or a frontend rejection.

### Neighborhood at base (nothing else moved)

| Gate | Result |
| --- | --- |
| `pnpm test:kern-5-rt2-boolean-if` | 35/35 |
| `pnpm test:kern-5-rt6-void-fallthrough` | 52/52 |
| `pnpm test:kern-5-rt8-integer-signatures` | 28/28 |

These match the counts recorded in `.agon-goals/rt9/facts.md`, so the RT-9 oracle files
added nothing that perturbs a neighbour at base. The RT-2 golden move described in
"Blast radius" happens **when the builder implements**, not now.

## rt10 `for` — pinned, queued, NOT built

Copied verbatim from the tribunal verdict so rt10 inherits the decision rather than
re-litigating it:

> **rt10 = `for`**, pinned now, built later: `to` exclusive; step default 1; literal
> step 0 → link `KIR_FOR_ZERO_STEP`, dynamic → runtime `ERR_KIR_LOOP_ZERO_STEP`; bounds
> evaluated once; `KIR_FOR_BOUND_NOT_INTEGER`; counter read-only via
> `KIR_ASSIGN_TO_LOOP_COUNTER`; counter unobservable after loop (link error, so Python
> `range` leak is moot); no break/continue; meter
> `1_init + Σ(1_head + body) + 1_exit`; budget = maxSteps only; cancellation = existing
> per-statement check, **no new await**; Python explicit `while` with sign-selected
> comparator, no chained comparisons, no `int()` coercion; JS BigInt per rt3. Fixtures
> must not include a "cancel mid-loop" row unless the body admits a capability call — it
> doesn't.

And the corrected golden the tribunal caught:

> `fx_for_nested_acc`: outer `0..3`, inner `0..4`, `acc += outer*inner` → **18**, not 36.
> Σ(0,1,2)·Σ(0,1,2,3) = 3·6 = 18.

Two rt10 notes that follow from RT-9's findings rather than from the verdict:

- `KIR_ASSIGN_TO_LOOP_COUNTER` is expressible only because RT-9 introduced
  `scope.assignable`: rt10 binds the counter in `bindings` but **not** in `assignable`,
  and the counter refusal is then the RT-9 `KIR_ASSIGN_TARGET_NOT_LET` gate with a
  loop-specific label. rt10 must not add a second mechanism.
- `for` bodies cannot accumulate without `assign`, and `assign` cannot see a compound
  operator (RT9-C3), so rt10's accumulator fixtures must be written as
  `assign acc = acc + i` — which needs an **arithmetic** linked binary operator that
  does not exist yet. **rt10 must therefore be preceded or accompanied by an arithmetic
  operator slice, or its accumulation goldens are unwritable.** This is a new
  dependency the tribunal did not surface and it is the single most important input to
  rt10 planning.

## Builder must NOT

1. Touch any frontend file, any `.kern`, the constitution, the census, the closure
   ledger, or `scripts/kern-frontend-*`. F5 already projects `assign`.
2. Add `for`, `while`, `each`, `break`, `continue`, or `set` to
   `LinkedKernKirStatement`, or touch any loop path.
3. Introduce any `await`, `setImmediate`, microtask yield, or additional `checkAbort()`
   site on the RT-1 statement path (RT9-C9).
4. Place the RT-1 `assign` arm after the trailing `else` — that arm is `return`.
5. Rename the linked statement's expression field away from `value` (RT9-C2).
6. Desugar `op=` into a binary expression; no arithmetic operator is linkable (RT9-C3).
7. Call `bindName` from the assign branch. An assign never rebinds a link-time type
   record (RT9-C5).
8. Build a link-time mutability analysis, emit `const`→`let` rewrites, or change
   parameter emission (RT9-C10). Parameters stay `const` and stay unassignable.
9. Emit a Python `nonlocal`/`global` declaration, or wrap a branch body in a nested
   `def` (RT9-C11).
10. Allocate a host local for an assign, or reorder existing local allocation. Assign-free
    artifacts must stay byte-identical; RT-4/RT-6 `compatibility.test.mjs` digests are the
    proof and must pass unmodified.
11. Edit anything in `scripts/kern-5-rt2-boolean-if/`, `-rt3-`, `-rt4-` beyond the
    `assign` row, the quoted probe body, and the two `rt2GoldenSha256` literals.
12. Accept a fixture whose expected value was not hand-computed, or a mutant that is
    equivalent on the target.
13. Rescue a RED by widening the slice to a second statement kind or to the frontend.
14. Assert only the closed link code in a negative test. The label text is the assertion
    (RT-6 lesson).

## Standing review question

**Every new completion or dispatch path must add zero await points.** Answered in
RT9-C9: RT-1's binding store is flat, so `assign` is one `bindings.set` on the existing
synchronous generator path, with the pre-existing per-statement `checkAbort()`. The
reviewer should check `git diff` for any new `await`, `setImmediate`, `queueMicrotask`,
`Promise`, or `checkAbort()` occurrence in `kir-runtime/**` and expect **zero**.

## Open questions

- **[RT9-O1 CLOSED — admitted, and now covered]** `assign` **is** admitted in a helper
  body, and the oracle covers it. `compileHandler` is shared, so helpers get it for free,
  and the contract adds no per-position gate. Verified today that F5 projects a
  helper-body assign and the link fault names the helper frame:
  `helper.g.handler.children[1]: statement kind assign is outside RT-1`. The projected
  node is the same `{target:identifier, value:text}` shape the entry produces, pinned in
  `probe-matrix.json` under `shapes["helper-body-assign"]`. Behavior row B19 pins the
  semantics (`let x="p"` / `assign x="q"` / `return x`, called as `return g()` → `"q"`),
  and mutant M19 pins that a per-position gate is a defect rather than a choice.

## Corrections Log

| Date | Correction |
| --- | --- |
| 2026-09-02 | Nero pass added 11 discriminating fixtures (self-referential RHS, call-typed gate path, assign across async suspension, helper-body assign) — 16 tests, 13 of them new RED. Challenges 2 and 4 of the critique are inapplicable on this base: linked KIR has no `fn` values so nothing can capture a binding, and a helper body is its own flat scope so no `nonlocal` emit path exists. Challenges 1, 3 and 5 were real gaps and are now closed by B13/B14/B14b, T16–T18 with B15–B17, and B18 respectively. |
| 2026-09-02 | **RT9-C5a VERIFIED** — an integer-returning helper is not callable at all on this base (`KIR_CALL_SIGNATURE_TYPE`, `expression.ts:148`, because `linkedKirCrossCallType` has no integer row). The critique's proposed integer-helper fixture is unbuildable; the call-typed rows use the `boolean` and `list<boolean>` signatures instead. RT-8 admitted integer *signatures*, not integer *cross-calls*. |
| 2026-09-02 | **RT9-C8a VERIFIED** — the metering model in RT9-C8 was incomplete: a **parameter** read costs 2 expression steps where a `let`-bound identifier costs 1. Measured on four fresh rows. The "executed `if` costs 3 / skipped costs 2" phrasing was really "1 + the condition cost" over a parameter condition; every previously pinned constant is unchanged. |
| 2026-09-02 | **RT9-O1 CLOSED** — F5 projects a helper-body assign (verified), so the coverage boundary the open question flagged is now a pinned row rather than an assumption. |
| 2026-09-02 | Mutant list 14 → 19: M15 (target cleared to unset before evaluation), M16 (cleared to a `false` default — killed by B14b alone), M17 (type gate resolves literal arms only), M18 (cross-call half dropped on the call path only), M19 (assign gated out of helper bodies). |
