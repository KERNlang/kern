# KERN 5 — slice D: linked `try`/`catch`/`throw` (+ `finally` as a gated final commit)

**Status:** IMPLEMENTED
**Oracle:** `scripts/kern-5-d-linked-try/**` — 17 files (11 test files), **216 rows**,
**165 RED / 51 GREEN** (one row skipped: the D-7f self-drive) at base `84b2f21c`. Landed in twelve
commits, cited by subject rather than sha because this branch has already been rebased once beneath
the work: *harness/fixtures/pins*, *the unmoved world*, *linker gates*, *RT-1 walk + walkers +
behaviour*, *metering + fault carrier*, *label registry + parity ledger*, *gated finally + D-7f
measurement*, *evidence-family wiring*, *harness cleanup*, *D-7f self-drive fixes*, and the two spec
commits. Seventeen spec corrections are recorded below. The D-7f self-drive was **executed**, not
assumed: `D_MEASURE_ROWS=1 pnpm test:kern-5-d-linked-try` reports the mapping total, none stale.
**D-7f measured:** D5 carries **39** rows against **177** across D1–D4, so the gate does **not**
fire and `finally` stays in D.
**Implemented in five commits** on `feat/kern-5-d-linked-try`, cited by subject: *admit throw and
try on the linked, RT-1 and JavaScript legs*, *defer throw and try on the Python leg through the
parity ledger*, *run the union digest cascade for the two new statement kinds*, *move the
prior-slice pins the try family spends*, *correct the oracle rows the implementation disproves* —
plus the review-fix commits recorded in the Corrections Log. **`finally` LANDED**: the D-7f gate was
measured, not assumed, and does not fire (D5 carries **45** rows against **183** across D1–D4, per
`commit-rows.json` `abortCriterion`). **Deploy-order deviation:** the five commits follow this
document's own Deploy Order stages (source → parity ledger → golden cascade → prior-slice pin moves
→ oracle corrections) rather than the feature order D1 → D5, because the implementation arrived as
one interleaved tree and no prefix of D1–D4 can be green on an oracle that covers D5. The commit-tag
attribution the plan wanted survives in `commit-rows.json`, which the D-7f self-drive proves total
and disjoint over every row the suite runs.
**Date:** 2026-09-08
**Confidence:** 0.92
**Revision:** 2 — incorporates the coordinator's five rulings on the Nero FLAWED (20%) verdict of
2026-09-08 (jump refusal narrowed to finally-bearing `try`; `code` typed as `text | null` with a
linker-inserted default; single-artifact `instanceof` verified; importer-facing catch boundary
documented; RC-v1 closed-set challenge rejected on D.0's C-6/C-7/C-8 and backed by running the
contract walls), and closes OQ-D1 by measurement.

**Depends on D.0 landing at `87ca787416eab0b2bb1b92b759ed0f4f1ab16a98`** — the tip of
`feat/kern-5-d0-contracts-split` on 2026-09-08, which carries D.0's spec **and its oracle** (eight
files, 72 rows, 30 RED) but **not** D.0's implementation. This branch
(`feat/kern-5-d-linked-try`) is cut from that tip, so `walkers.ts`, `link-support.ts` and
`statements.ts` **do not exist in this checkout**. Every claim about them is tagged
**PINNED-BY-D0** and cites `.Codex/specs/kern-5-d0-contracts-split/spec.md`, not source. D **must
not merge before D.0**, and D.0 must not merge before slice C
(`feat/kern-5-rt12-linked-jumps` @ `2c6f4abd`). Merge order is strict and one-way:
**C → D.0 → D**.

Ruled by the try/catch tribunal `tribunal-1788825104594-tszgc4-kern5-try-catch-design` (verdict
§RECOMMENDATION, "Slice D (core, ordered commits)"). Two of the tribunal's mechanisms are
**corrected here on source evidence**, both recorded in the Corrections Log and both narrowing, not
widening, the diff: the 13th diagnostic code is `'uncaught-throw'` with no RC-v1 amendment (D.0's
ratified OQ-2), and the clamped throw label lives in the **fault message**, not in the envelope,
because `KernKirDiagnostic` has exactly three fields and no `label` channel.

## Executive Summary

Slice D admits `throw` and `try` (with `catch` as a child clause) into the linked KIR union and
lowers both on the **RT-1** and **JavaScript** legs. The Python leg stays byte-frozen and takes two
parity-ledger deferral rows. A user throw carries a fixed record `{message: text, code?: text}`; the
linker *types* the throw expression against that shape and never canonicalizes. Catchability is
disjoint by construction: JavaScript uses a nominal `class __UserThrow { value }` that never extends
`__Fault`, and RT-1 makes a throw a **walk completion** (`{kind:'threw'}`), a *return value* of the
walk generator — so an engine `__Fault`, which travels as a host exception, is *physically* incapable
of becoming catchable. An uncaught throw surfaces as `outcome:'failure'` with the single diagnostic
code `'uncaught-throw'`, with events already committed preserved.

`break`/`continue` **may** cross a `try`/`catch` that carries no `finally` — the importer's hottest
defensive loop, `for { try { if (!ok) continue; … } catch { … } }`, links and behaves, on both legs,
with no new machinery. The reserved refusal `KIR_LOOP_JUMP_CROSSES_TRY` is narrowed to the one case
with something to run on the way out: a crossed `try` that **has** a `finally`.

`finally` is the **last ordered commit** and is gated: cleanup-only, no abrupt completion, and it
does **not** run on envelope faults — the one pinned TS divergence. A pre-registered, measurable
abort criterion cuts it to D2 before merge if its oracle row count exceeds the sum of all preceding
D commits' rows. Because the jump refusal is only reachable once a `finally` exists, cutting
`finally` also returns `KIR_LOOP_JUMP_CROSSES_TRY` to the reserved-and-unspent state.

The whole slice adds **two** statement-union members (`throw`, `try`), **zero** expression-union
members, **zero** diagnostic codes (D.0 already reserved the 13th), **zero** new files under
`packages/core/src` (so the 357-file inventory pin is untouched) and **zero** new `checkAbort()`
sites in RT-1.

## Current State / Root Cause

`try`/`catch`/`finally`/`throw` are structurally projected by F5 and **totally refused by the
linker**. Every handler containing one fails with
`handler-entry-unsupported: <label>: statement kind try is outside RT-1`
(`packages/core/src/kir-runtime/linked-kir-program/link.ts:397`, the last line of
`compileStatement`). `compileBlock` special-cases only `for`, `while` and `if`
(`link.ts:524-554`); everything else routes to `compileStatement`, whose first act is
`assertLeaf` (`link.ts:164-166`, called at `link.ts:320`) — and `try`/`catch`/`finally` are
non-leaf nodes, so they could never pass even if the catch-all were removed.

| Fact | Evidence | Tag |
|---|---|---|
| The linker's total refusal of the try family | `link.ts:397` | VERIFIED |
| `assertLeaf` runs on every kind reaching `compileStatement`; only `for`/`while`/`if` are special-cased earlier | `link.ts:164-166,320,524-554` | VERIFIED |
| `LinkScope` has `loopDepth` and **no** try depth | `link.ts:168-176` | VERIFIED |
| `LinkedKernKirStatement` has exactly 10 kinds: `assign break capability continue for if let print return while` | `linked-kir-program/contracts.ts:250-282`; pinned in `scripts/kern-5-d0-contracts-split/pins.mjs` `BASE_STATEMENT_KINDS` | VERIFIED |
| `LinkedKernKirExpression` has exactly 9 kinds, **including `record` and `member`** | `contracts.ts:174-207`; `pins.mjs` `BASE_EXPRESSION_KINDS` | VERIFIED |
| `LinkedKernKirStaticType` is **`'boolean' \| 'integer'`** only — there is no `text` static type and no record type | `contracts.ts:7` | VERIFIED |
| `KernKirDiagnostic` has exactly three fields — `category`, `code`, `phase`. **There is no `label` field.** | `kir-runtime/contracts.ts:81-85` | VERIFIED |
| `failureEnvelope` builds one diagnostic from `cause.code`/`cause.phase` and **preserves** `committedEvents` | `kir-runtime/envelope.ts:34-50` | VERIFIED |
| `TARGET_KERNEL_SHA256 = sha256(TARGET_BASE + TARGET_JSON + TARGET_HASH + TARGET_EXECUTION)` — anything added to the four kernel sources moves the digest | `kir-js-esm/emitter.ts:23,25` | VERIFIED |
| `__Fault` is the single JS exception class, `{code, phase, label?}`, `label` used only as the `Error` message | `kir-js-esm/target-base.ts:3-9` | VERIFIED |
| `execute()`'s outer `catch(error)` is the **only** catch in the emitted module; `__runSpecialized`'s body is `try{}finally{}` with no catch | `kir-js-esm/emitter.ts:432-447` | VERIFIED |
| `kir-runtime/expression.ts` is **406** lines (not 402 — `e1d94060` landed after D.0's pins) | `wc -l`, 2026-09-08 | VERIFIED |
| RT-1 emits `KIR_JUMP_WITHOUT_LOOP_FRAME` at two sites, and D.0's `BASE_KIR_TOKENS` (39) **does not contain it** — the live set under `kir-runtime` is **40** | `kir-runtime/expression.ts:233,241`; `pins.mjs` `BASE_KIR_TOKENS`; token scan 2026-09-08 → 40 | VERIFIED |
| `WalkFrame` is `{loop: LoopState \| undefined, statements, index}`; `return` returns out of the **whole** generator, discarding all frames | `kir-runtime/expression.ts:174-178,297-307` | VERIFIED |
| `StatementWalkResult` is `{kind:'returned', value} \| {kind:'drained'}` | `kir-runtime/expression.ts:41-44` | VERIFIED |
| 7 of 240 tracked `.kern` files use the try family, and **all 7 are rejected at the `projection` stage**; the census has **zero** `link`-stage rows and `admittedCount` is **1** | `git ls-files '*.kern' \| wc -l` → 240; line-start scan → 7 files; `scripts/kern-5-admission-census/admission.json` — the 7 rows carry `stage:'projection'` with codes `projection-fatal`(×2), `F4_AUTHORITY_DRIFT`, `UNEXPECTED_TOKEN`, `FRONTEND_UNSUPPORTED_MODULE_ROOT`, `FRONTEND_EXCLUDED_HOST_EXPRESSION`, `F4_F2B_DRIFT`; 2026-09-08 | VERIFIED |
| `STILL_OUTSIDE` is **already** `['each','set']` in all three neighbour suites — it never contained the try family | `scripts/kern-5-rt10-for/compatibility.test.mjs:63`, `rt11/compatibility.test.mjs:75`, `rt12/compatibility.test.mjs:72` | VERIFIED |
| rt12's reserved-label scan reads only `LINK_URL`, `CONTRACTS_URL`, `LIMITS_URL` | `scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs:157-166` | VERIFIED |

### F5 catalog facts (the ones the linker must therefore police itself)

Read from `packages/core/src/kir-structural/catalog.generated.ts` on this branch, 2026-09-08 —
`throw` at `:2979`, `try` at `:6613`, `catch` at `:6695`, `finally` at `:6749`. All four are
`schemaStatus:'bound'`, `disposition:'structural-candidate'`, `reasonId:'schema-bound'`.

| Node | `allowedChildren` | properties | Tag |
|---|---|---|---|
| `throw` (`:2979`) | `null` (leaf) | `trailingComment` (string, **not required**), `value` (`schemaKind:'expression'`, **`required:false`**, `disposition:'lowered-expression'`) | VERIFIED |
| `try` (`:6613`) | 31 kinds, **including `step`, `handler`, `catch`, `finally`, `else`, `destructure`, `try`, `with`, `throw`, `continue`, `break`, `for`, `each`** | `name` (identifier, **not required**) — and only that | VERIFIED |
| `catch` (`:6695`) | 28 kinds, including `handler`, `destructure`, `for`, `try`, `throw`, `break`, `continue`; **no `catch`, no `finally`** | `name` (identifier, not required); `type` (typeAnnotation, not required, `disposition:'excluded-host-type'`, `reasonId:'portable-type-grammar-required'`) | VERIFIED |
| `finally` (`:6749`) | 25 kinds — **`destructure`, `handler` and `for` are absent** relative to `catch`; `while`, `each`, `try`, `throw`, `break`, `continue` are present | `{}` — none | VERIFIED |
| `for`/`while` admit `try`, `catch`, `throw` as children but **not** `finally` | `catalog.generated.ts:3111-3140,3158-3187` (28-child list) | VERIFIED (facts pack §1) |
| `handler` is the only parent whose 33-child list also includes `finally` | `catalog.generated.ts:962-1030` | VERIFIED (facts pack §1) |

**What the parser does and does not police** (`packages/core/src/parser-validate-body-statements.ts`):
`isBodyStatementMisplaced` returns `true` unconditionally for `throw`, `while`, `for`, `with`
outside `inNativeBody`, and for `try` **only when `node.props?.name === undefined`** (the no-name
shape is the body-statement discriminator). **`catch` and `finally` are absent from that switch** and
fall to `default: false`. `loopDepth` increments only for `for`/`each`/`while` — the parser has no
concept of try nesting. Tag: VERIFIED (facts pack §2).

Therefore the **linker** must itself refuse: a stray `catch`, a stray `finally`, a `try` carrying
`name` (the async-orchestration shape), `step`/`handler` children of a body-statement `try`, a
second `catch`, a `catch` after a `finally`, a body statement after a clause, and a bare `throw`
with no `value` (F5 admits all of these).

### The record-expression channel the payload rides on

`projectRecord` maps an `objectLit` ValueIR node to `expression('record', {entries})`
(`kir-structural/expression.ts:84-96`), and `record` is already one of the nine linked expression
kinds with a runtime arm (`kir-runtime/expression.ts` `case 'record'`) and a Python lowering marked
`'lowered'` (`kir-python/request.ts:38-48`). So **no expression-union member is added by D**; the
payload is an ordinary record expression the whole stack already carries. Tag: VERIFIED.

## What Already Works — and must not change

- **`record` and `member` expressions.** `{message: "x"}` projects, links, evaluates on RT-1 and
  lowers to JavaScript today; `e.message` is an existing `member` expression with an existing
  runtime arm (`kir-runtime/expression.ts` `case 'member'`, which returns `null` for an optional
  miss and faults with `missing member` otherwise). D adds **no** expression machinery.
- **The trailing-return rule needs no code change.** `compileHandler` counts `statements.filter(kind === 'return')`
  on the **top-level** list only (`link.ts:607-613`). A `return` inside a `try` has statement kind
  `'try'` at top level, so it is not counted — the rule refuses such a handler automatically with
  `expected exactly one final return`. This is the same mechanism that already makes a return inside
  an `if` not satisfy it.
- **Envelope faults bypass catch and finally *for free* on RT-1.** `meter.step()` and
  `runtime.checkAbort()` raise a `KernKirFault`, a host exception that leaves the generator entirely
  (`kir-runtime/expression.ts:225-226`); the frame stack — trap frames included — is discarded with
  it. No code enforces the divergence on RT-1; the mechanism is the enforcement.
- **`capability-error` is uncatchable for free on both legs.** On RT-1 the capability fault is
  raised in the driver (`execute.ts:192-196`) and never re-enters the walk; on the JS leg it is a
  `__Fault` (`kir-js-esm/emitter.ts:187,421`) and the nominal guard rethrows it. QD-1 option (a) is
  structurally enforced, not implemented.
- **Events are append-only.** One `committedEvents` array is created before the try in
  `executeKernKir` and passed to `failureEnvelope` from the catch (`execute.ts:228-247`); the JS
  emitter mirrors it (`emitter.ts:436,446`). Catch is not a transaction and D adds no rollback.
- **Both kernels stay byte-frozen.** `TARGET_KERNEL_SHA256` on both legs, the F5 policy digest, the
  240-file census, `KernKirLimits` (7 fields), `KernKirDiagnosticCode` (13 after D.0), every
  `KernKirEnvelope` field, the RC-v1 four governed artifacts and `alpha-receipt-policy.json`
  (125 bindings) are all unchanged and asserted so.
- **The Python emitter is not touched.** Only `kir-python/request.ts`'s lowering table gains two
  `'deferred'` entries, which is the parity-ledger mechanism, not an emitter change.

## Contract (Verified) — the pinned decisions

> Verified against the `feat/kern-5-d-linked-try` checkout at
> `/Users/nicolascukas/KERN/.worktrees/kern-5-d-try` (base `87ca7874`) on 2026-09-08, plus the
> commands quoted inline. Post-split file claims are **PINNED-BY-D0** and cite D.0's spec.

### D-1 Throw payload: a fixed record, typed at the throw site, never canonicalized

| # | Claim | Evidence | Tag |
|---|---|---|---|
| D-1a | **The payload record type is `{message: text, code: text \| null}`** — `code` is a declared field with a declared default, not an absent key. A throw site may write `{message: …}` or `{message: …, code: …}`; nothing else, ever | tribunal verdict §RECOMMENDATION, KEY INSIGHT 1, as sharpened by the coordinator ruling of 2026-09-08 on absent-key semantics | VERIFIED (ruling) |
| D-1a1 | **Absent-key semantics: the linker inserts a literal null.** When the throw expression omits `code`, `compileThrow` completes the linked record with `{key:'code', value:{kind:'literal', value:{tag:'null'}}}`, so **every** linked throw payload carries both keys, sorted `code` then `message`. This is a **typing default on an already-conforming throw**, not canonicalization: canonicalization (D-1c) is coercing a *non-conforming* payload into shape, and remains the importer's job and forbidden here. The distinction is observable — a non-conforming throw is still a refusal, never a completion | `KernKirValue` has a `null` tag (`kir-runtime/contracts.ts:4-13`); `{kind:'literal', value}` is an existing expression variant (`linked-kir-program/contracts.ts:174-207`) | VERIFIED |
| D-1a2 | **Reading the payload.** `member` expressions are statically untyped on **both** channels today — `staticExpressionType` and `crossCallExpressionType` each fall through to `undefined` for `kind === 'member'` — so `e.message` and `e.code` need **no typing change at all**. Because D-1a1 guarantees `code` is always present, `e.code` never takes the missing-member path: the runtime `member` arm finds the entry and returns its value, which is `{tag:'text'}` or `{tag:'null'}`. `e.message` always returns `{tag:'text'}`. That is the whole minimal rule | `staticExpressionType` and `crossCallExpressionType` both end `if (expression.kind !== 'literal') return undefined` (`linked-kir-program/expression.ts`); the runtime arm is `object.value.find(e => e.key === property)?.value` with a `value !== undefined` guard, and `{tag:'null'}` is not `undefined` (`kir-runtime/expression.ts` `case 'member'`) | VERIFIED |
| D-1b | The linker **types** the throw expression against that shape syntactically. It is admitted iff (i) `expression.kind === 'record'`, its entry keys sorted are exactly `['message']` or `['code','message']`, the `message` value's `crossCallExpressionType(...)` is `'text'`, and the `code` value (when written) is either `'text'` or an explicit null literal (`kind === 'literal' && value.tag === 'null'`, admitted so that writing the default is not a refusal); or (ii) `expression.kind === 'identifier'` and the name is in `LinkScope.payloads` (a catch binding). Anything else is a link refusal with `KIR_THROW_PAYLOAD_SHAPE` | `crossCallExpressionType` returns `'text'` for text literals, text-typed identifiers and text-returning user calls (`linked-kir-program/expression.ts` `crossCallExpressionType`, `literalCrossCallType`); `LinkedKernKirStaticType` cannot express `text` or `record` (`contracts.ts:7`), so `scope.types` is the wrong channel and a third set is required | VERIFIED |
| D-1c | The linker **never canonicalizes**. It does not synthesize a `message`, coerce a non-text value, wrap a non-record, or render anything. Importer canonicalization of non-conforming TS throws is **out of scope** and belongs to the importer lane | tribunal KEY INSIGHT 1 ("the kernel never renders, coerces, or invents payloads") | VERIFIED (ruling) |
| D-1d | The catch binding is that record type and **nothing else**. It is added to `LinkScope.bindings` (so shadowing is refused) and to `LinkScope.payloads`; it is **not** added to `scope.types` or `scope.crossCallTypes`, because entering it there would make `staticExpressionType` lie about a record | `bindName` writes both type maps (`link.ts:200-…`); `staticExpressionType` reads `scope.types` (`linked-kir-program/expression.ts`) | VERIFIED |
| D-1e | Consequences of D-1d, all intended: `e.message`/`e.code` are ordinary `member` expressions (statically untyped, exactly like every `text` expression today); `assign target="e"` is refused by the existing `KIR_ASSIGN_UNDECLARED`/`KIR_ASSIGN_TARGET_NOT_LET` gate because a catch binding never enters `assignable`; `let name=e` is refused as a duplicate binding; `throw value="e"` is admitted by D-1b(ii) — that is rethrow | `link.ts` assign gates; `compileStatement` `let` duplicate-binding check | VERIFIED |
| D-1f | A `let`-bound payload (`let p = {message:"x"}` then `throw value="p"`) is **refused** in D. `payloads` holds catch bindings only | design decision, this spec | VERIFIED (decision) |
| D-1f1 | **Rethrow through a helper parameter is impossible in D, and that is an importer-visible limitation.** A payload cannot be passed into a helper and rethrown there, because `throw` in a helper body is refused outright (D-2h) — and it could not be typed anyway: a payload record is not an admissible parameter type (`LINKED_KIR_TYPE_ADMISSION` has no `record` row, so `parameterType` refuses it). So the *only* rethrow form in D is `throw value="e"` lexically inside the `catch` that bound `e`. Stated plainly because a TS importer will hit it: helper-mediated rethrow is **D2's top item** | `LINKED_KIR_TYPE_ADMISSION` (`linked-kir-program/contracts.ts:~215-228`) admits only `boolean`/`integer`/`list`/`text`/`void`; D-2h | VERIFIED |
| D-1g | A bare `throw` with no `value` is refused. `compileThrow` calls `propertySet(properties, ['value'], ['trailingComment'], label)`, which faults `unsupported property set` — **no new label needed** | `propertySet` (`link.ts`, `required.some(key => !properties.has(key))` → `fault('handler-entry-unsupported', ...unsupported property set)`); F5 marks `throw.value` `required:false` (`catalog.generated.ts:2979`) | VERIFIED |

### D-2 Catchability: user throws only, disjoint by construction on every leg

| # | Claim | Evidence | Tag |
|---|---|---|---|
| D-2a | **JavaScript.** `class __UserThrow { constructor(value){ this.value = value; } }` — a *nominal* class, checked with `instanceof`, **never** a field check, **never** `extends __Fault`. The catch lowering is `catch(__e){ if(!(__e instanceof __UserThrow)) throw __e; … }` | tribunal §RECOMMENDATION; `__Fault` is the only class today (`target-base.ts:3-9`) and the boundary catch is generic (`target-execution.ts:78-89`) | VERIFIED |
| D-2b0 | **`instanceof` is sound because a linked program is exactly one artifact.** `emitJavaScriptEsm(program, manifestBase)` is the single emit entrypoint (`kir-js-esm/index.ts:71`), it emits one `function __module() { … }` source (`emitter.ts:471-479`), and **every helper is inlined into that same module** — `helperSources` is built from `linked.helpers` and joined straight into the `__runSpecialized` closure (`emitter.ts:375,430`). The artifact path is the literal-typed `'entry.mjs'` (`contracts.ts:32`, `index.ts:77,85`). There is **no multi-artifact cross-call path** in RT-1's linked-program pipeline, so exactly one `__UserThrow` class exists per artifact and cross-realm identity cannot arise. A kernel-resident class is therefore **not** needed and the kernel digest does not move | `kir-js-esm/index.ts:71,77,85`; `emitter.ts:375,430,471-479`; `kir-js-esm/contracts.ts:32` | VERIFIED |
| D-2b | `__UserThrow` is emitted **per module by `specializedSource`, and only when the program contains a `throw` or a `try`** — never added to `TARGET_BASE_SOURCE` or any other kernel source. This is what keeps `TARGET_KERNEL_SHA256` byte-frozen on both legs, keeps every existing rt-suite emitted-artifact digest byte-identical, and keeps D.0's fifteen behaviour-preservation fixtures GREEN | `TARGET_KERNEL_SHA256 = sha256(KERNEL_SOURCE)` where `KERNEL_SOURCE` is the four fixed target sources (`emitter.ts:23,25`); `__artifactSha256` hashes `__module.toString()` (`emitter.ts:475`), so only throw-carrying programs move | VERIFIED |
| D-2c | **RT-1.** A throw is a **walk completion**: `StatementWalkResult` gains `{kind:'threw'; value: KernKirValue}`. It is a *return value* of `walkStatements`, not a host exception — which is why it is physically incapable of intercepting a `__Fault`/`KernKirFault`, which travels as a host throw and unwinds past the frame stack entirely | `StatementWalkResult` (`kir-runtime/expression.ts:41-44`); `return` already works exactly this way (`:297-307`); every fault is a plain `throw new KernKirFault(...)` that nothing in RT-1 catches (facts pack §4; D.0 C-12 as restated in STEP-0-k) | VERIFIED |
| D-2d | **RT-1 frame model.** `WalkFrame` gains `readonly trap: TryTrap \| undefined`, where `TryTrap = { readonly binding: string \| undefined; readonly catchBody: readonly LinkedKernKirStatement[]; readonly finallyBody: readonly LinkedKernKirStatement[] \| undefined }`. A `try` pushes its body as a frame carrying `trap`; loop frames carry `loop`; the two are disjoint in practice and neither is a discriminated-union rewrite of `WalkFrame` | `WalkFrame` today is `{loop, statements, index}` (`:174-178`); `loop` is already the rt12 discriminated union (`:159-172`) | VERIFIED (design, minimal-diff) |
| D-2e | **RT-1 unwind.** On `throw`: scan `frames` downward for the nearest frame with `trap !== undefined` (bounded, non-mutating scan — the RT12J-TD17 pattern, never a `pop()` loop). If found at `depth`: `frames.length = depth`, bind `trap.binding` to the payload if present, push `{index:0, loop:undefined, trap:undefined, statements: trap.catchBody}`. If **not found**: `return Object.freeze({kind:'threw', value})` — the uncaught path, which is a **completion, not a hang** | rt12 corrections row RT12J-TD17: the `continue` arm's `while (frames[frames.length-1]?.loop === undefined) frames.pop()` was an infinite loop on an empty stack that called neither `meter.step()` nor `checkAbort()`; the fix was a bounded scan raising `KIR_JUMP_WITHOUT_LOOP_FRAME` (`kir-runtime/expression.ts:229-244`) | VERIFIED |
| D-2f | **The exported-`walkStatements` fault row.** `walkStatements` is exported and this suite's own oracles drive it directly with hand-built statements, so every path unreachable through linking still needs a fail-closed row. Two are required: (i) `callHelper` receiving `{kind:'threw'}` → `throw new KernKirFault('handler-link-error','execution','KIR_TRY_FAMILY_IN_HELPER')`; (ii) the async driver popping a **helper** frame that completed `'threw'` → the same fault. Both are unreachable through a compiled program (D-2h) and both must be driven directly | RT12J-TD17 is exactly this lesson; `callHelper` (`kir-runtime/expression.ts:314-327`) and `runFrames` (`execute.ts:144-166`) are the two drivers | VERIFIED |
| D-2g | **Python sketch (deferred).** `class _UserThrow(Exception)` with a `value` attribute, mirroring `_Fault(Exception)`. Not implemented in D; recorded so the catch-up slice does not re-litigate the carrier | `kir-python/target-base.ts:19-23`; the Python boundary is `except Exception as _error:` — **`Exception`, not `BaseException`** — so a `_UserThrow(Exception)` is caught there, matching the JS boundary | VERIFIED |
| D-2h | **`throw` and `try` are refused inside a helper body** in D, with `KIR_TRY_FAMILY_IN_HELPER`. Mechanism, not taste: `callHelper` is a **non-generator function** called from `evaluateExpression`, so a user throw escaping a helper has no channel out except a host exception — which would require a `catch` **inside** `walkStatements`, contradicting the property that makes D-2c sound. `LinkScope` gains `tryFamily: boolean`, `true` only for the entry handler's scope | `callHelper` signature and body (`kir-runtime/expression.ts:314-327`); helpers are compiled by the same `compileHandler` via `resolveHelper` (`link.ts:230,241`), so one scope flag is sufficient | VERIFIED |
| D-2i | **QD-1, answered: option (a).** `capability-error` stays an **uncatchable `__Fault`**, and the `__Fault`/`_Fault`/`KernKirFault` census is **unchanged** by D. A future capability slice owes a result-record channel before `try { await api.get() } catch` can be represented | D.0's QD-1 (`.Codex/specs/kern-5-d0-contracts-split/spec.md:402-411`) demands an explicit written answer; tribunal KEY INSIGHT 2 states the intent; option (a) is "the option that keeps D's diff smallest" in D.0's own words | VERIFIED |
| D-2j | **`__UserThrow` is not a `__Fault` site and the census distinguishes it by construction.** D.0's census counts `new __Fault(` / `raise _Fault(` / `new KernKirFault(` **construction sites by file** and their **distinct code sets** (`pins.mjs` `JAVASCRIPT_FAULT_SITES` 24/6/4/5 = 39 over 10 codes; `PYTHON_FAULT_SITES` 21/7/6/6 = 40 over 9; `RUNTIME_FAULT_SITES` = 53 over 9 files). `new __UserThrow(` matches none of those three patterns, so the census rows are untouched — **except the delta the oracle-time ruling fixed and this build landed**: `kir-runtime/expression.ts` **+1**, which is `callHelper`'s `'threw'` fail-closed arm and carries `KIR_TRY_FAMILY_IN_HELPER`, **not** `uncaught-throw` (on RT-1 an uncaught throw is a walk *completion*, so the evaluator raises no `uncaught-throw` fault at all); `execute.ts` **+2**, the uncaught-throw conversion at the entry walk plus the popped-helper-frame fail-closed arm; and `emitter.ts` **+1** for the `new __Fault('uncaught-throw','execution', label)` it writes into **emitted module text**. The three deltas are pinned as `RUNTIME_FAULT_SITE_DELTA` / `JAVASCRIPT_FAULT_SITE_DELTA` in `scripts/kern-5-d-linked-try/pins.mjs`, and `uncaught-throw` joins the runtime and JavaScript code sets and neither Python one | `scripts/kern-5-d0-contracts-split/pins.mjs`, `fault-census.test.mjs` | VERIFIED |
| D-2k | No class in either kernel extends `__Fault`/`_Fault`, and the only two catch sites remain the request boundary (`execute.ts`) and the emitted `execute()` — plus, new in D, the emitted `catch(__e){ if(!(__e instanceof __UserThrow)) throw __e; … }`, which is a **user-throw** catch and never a fault catch. D.0's row "no `catch`/`except` inside a handler body catches one" must be restated to that form | D.0 acceptance criterion under *Fault census* (`spec.md:520-522`) | VERIFIED |

### D-3 Uncaught throw → the public result

| # | Claim | Evidence | Tag |
|---|---|---|---|
| D-3a | An uncaught user throw produces `outcome:'failure'`, `completion.kind:'error'`, `result:{presence:'absent'}`, exactly **one** diagnostic `{category:'runtime', code:'uncaught-throw', phase:'execution'}`, and `events` = **the events already committed** | `failureEnvelope` (`kir-runtime/envelope.ts:34-50`) produces precisely this from a `KernKirFault`; `'uncaught-throw'` is D.0's ratified thirteenth code (`pins.mjs` `THIRTEENTH_DIAGNOSTIC_CODE`) | VERIFIED |
| D-3b | **The clamped label is the fault's `message`, not an envelope field.** `KernKirDiagnostic` has exactly three fields and no `label` (`kir-runtime/contracts.ts:81-85`); `failureEnvelope` reads only `cause.code` and `cause.phase`. Surfacing the label would mean widening a frozen envelope shape. So the label rides where every other KIR label already rides: the `KernKirFault`/`__Fault` message — internal, test-observable, never in the envelope. **This corrects the tribunal's wording** ("diagnostic label = message clamped to 256 chars") while keeping its intent intact | `contracts.ts:81-85,97-107`; `envelope.ts:34-50`; `target-base.ts:3-9` (`super(label === undefined ? code : label)`); rt12 asserts a fault message directly (`scripts/kern-5-rt12-linked-jumps/walker-coverage.test.mjs:229,243`) | VERIFIED |
| D-3c | The label is `clampText(message, 256)` when `code` is absent, and `` `${clampText(message,256)} [${clampText(code,64)}]` `` when present. `clampText(t,n)` is the first `n` UTF-16 code units, no ellipsis. **No `JSON.stringify`, no record rendering, no unbounded string** (r2 closure; the OOM vector the tribunal named) | tribunal §RECOMMENDATION ("never serialized records; r2 forbids JSON.stringify; unbounded rendering is an OOM vector"); `.Codex/specs/kern-5-r2-*` closure | VERIFIED (ruling) |
| D-3d | Both legs must produce the **same** label for the same payload, and the same envelope bytes. RT-1 computes it in `clampThrowLabel(value)` (exported from `kir-runtime/expression.ts`); the JS leg computes it in a per-module emitted helper `__throwLabel` | twin-envelope discipline (D.0 `behavior-preservation.test.mjs:84`, "byte-identical envelope on RT-1 and the JavaScript leg") | VERIFIED |
| D-3e | This matches `runtime-envelope/normalize.ts`'s existing `'uncaught-throw'` shape on `outcome`, `completion.kind`, `result` and the single `{category:'runtime', code, phase:'execution'}` diagnostic, and **diverges on `events`**: `internalRuntimeFailure` hard-codes `events: []` (`normalize.ts:72-83`) while the KIR failure envelope preserves committed events. The divergence is **pre-existing and correct** — the append-only pin is a KIR property the legacy normalizer does not have | `normalize.ts:122` `if (trace.completion.kind === 'throw') return internalRuntimeFailure('uncaught-throw')`; `internalRuntimeFailure` at `normalize.ts:72-83`; `envelope.ts:44` `events: Object.freeze([...committedEvents])` | VERIFIED |
| D-3f | `normalize.ts:122` stays the single **`internalRuntimeFailure`** producer of the code. D adds KIR producers (D-2j), so D.0's row *"the kir-runtime tree names `uncaught-throw` exactly once, in the union declaration"* (`diagnostics.test.mjs:106`) and *"no fault construction site anywhere in core carries `uncaught-throw`"* (`:87`) both **must move** | `scripts/kern-5-d0-contracts-split/diagnostics.test.mjs:87,106,122` | VERIFIED |
| D-3g | `KernKirDiagnosticCode` stays at **13** members. D creates no code, no completion kind, no third `outcome` value, and **no RC-v1 amendment** — the chain stays at 3 records, consumed length 2, 0 pending | D.0 Reservation 1 and its C-6/C-7/C-8 reasoning; `pins.mjs` `RC_V1_AMENDMENT_COUNT`, `RC_V1_CONSUMED_CHAIN_LENGTH` | VERIFIED |
| D-3g1 | **There is no closed-set surprise waiting on the public side, and the reason is D.0's C-6/C-7/C-8.** *C-6*: RC-v1's amendment chain governs four artifacts — `constitution.json`, `public-declaration-schema.json`, `goldens.json`, `proof-inventory.json` — and **not** the KIR union; proven because the KIR union already carries `projection-authentication-error` and `runtime-limit-exceeded`, which the constitution lacks, while the constitution carries `encoded-limit`, `escaped-control`, `internal-runner-error`, `non-portable-value` and `uncaught-throw`, which the KIR union lacks. The two sets are siblings. *C-7*: a zero-drift amendment record is structurally rejected. *C-8*: `runtime-handler-public-declaration.mjs:147-152` equates `constitution.diagnostics.codes` with the **public runtime-handler** union `KernRuntimeHandlerDiagnosticCode`, not with the KIR union — and `uncaught-throw` is **already** in both, with the golden behaviour `failure-uncaught-throw` (`scripts/runtime-contract-v1/constitution.json:96`, `public-declaration-schema.json:18`, `goldens.json:83-90,306,320`) | `.Codex/specs/kern-5-d0-contracts-split/spec.md` rows C-6, C-7, C-8 | VERIFIED |
| D-3g2 | Rather than rest on that reasoning alone, D's oracle **runs the contract walls** so a closed-set surprise fails at oracle time instead of CI time: `node ./scripts/check-runtime-contract-v1.mjs`, `node ./scripts/check-runtime-envelope.mjs` and `node ./scripts/check-rule-coverage.mjs`, wrapped by `pnpm test:kern-runtime-contract-v1`, `pnpm test:kern-runtime-envelope` and `pnpm check:rule-coverage`. All three are **GREEN at base and must stay GREEN** | `package.json` scripts `test:kern-runtime-contract-v1`, `test:kern-runtime-envelope`, `check:rule-coverage`, `test:runtime-abi` | VERIFIED |
| D-3h | **A capability inside a try, followed by a throw:** the capability event stays in the failure envelope's `events`. Catch is not a transaction; there is no rollback on either leg | one shared `committedEvents` array created before the try (`execute.ts:228-247`), one `__events` array created before the try (`emitter.ts:436,446`) | VERIFIED |

### D-4 Control flow

| # | Claim | Evidence | Tag |
|---|---|---|---|
| D-4a | `return` inside `try` or `catch` is **allowed**, exactly as `return` inside an `if` branch already is | `compileBranch`/`compileBlock` admit `return` in any nested block; the early-return-in-`if` precedent is `containsReturn` (`link.ts:152-162`) plus the top-level-only filter (`link.ts:607-613`) | VERIFIED |
| D-4b | A `return` inside `try`/`catch` does **not** satisfy the trailing top-level return rule. No code change (see *What Already Works*) | `link.ts:607-613` counts only top-level `kind === 'return'` | VERIFIED |
| D-4c | `containsReturn` **must** gain `try` recursion (body, catch body, finally body), or a **void** handler with a `return` inside a `try` silently escapes `KIR_VOID_HANDLER_VALUE_RETURN`. This is a required edit and a discriminating oracle row | `containsReturn` recurses only `for`/`while`/`if` today (`link.ts:152-162`); it gates the void check at `link.ts:606` | VERIFIED |
| D-4d | **`break`/`continue` MAY cross a `try`/`catch` frame that carries NO `finally` clause.** The refusal `KIR_LOOP_JUMP_CROSSES_TRY` applies **only** when the crossed `try` has a `finally` — the one case with something to run on the way out. **Coordinator ruling, 2026-09-08, overriding the tribunal's Q4 answer and rt12's `[RT12J-N4]` wording**, both of which predate the importer-pattern evidence | ruling; rt12 `[RT12J-N4]` (`.Codex/specs/kern-5-rt12-linked-jumps/spec.md:721-726`) is the superseded text | VERIFIED (ruling) |
| D-4d1 | The shape the override exists for is the importer's hottest defensive loop — `for … { try { if (!ok) continue; … } catch { … } }`. An unconditional refusal prices a control-flow rewrite at every importer call site. **Measured to project**: `for{try{assign, catch{continue}}}` and `try{for{break}}, catch{assign}` both come back `status: 'projected'`, with `continue`/`break` as leaf children exactly where the shape needs them | OQ-D1 measurement, 2026-09-08, recorded under *OQ-D1 — CLOSED* | VERIFIED |
| D-4e | **Landed, and the two halves are disjoint: a finally-LESS crossing needs no scope field at all, and `finallyDepth`/`loopFinallyDepth` exist only to refuse a crossing of a finally-BEARING try (D-4f/D-4f1). Both halves landed in this build — D4 removed the refusal, D5 added the two fields and the narrowed refusal — so "no new machinery" is about the finally-less case only.** Both legs already behave correctly with no unwind work, so that admission is the **removal of a refusal**, not new machinery: **RT-1** truncates `frames` to the target loop frame with the same bounded scan `break`/`continue` already use (`frames.length = depth`), and an intervening trap frame carries nothing to run; **JS** lowers to a native `break;`/`continue;`, and a native jump out of a `try` block that has no `finally` is plain, correct JavaScript | `kir-runtime/expression.ts:229-244` (the scan assigns `frames.length`, it runs no per-frame code); `kir-js-esm/emitter.ts:305-307` (native `break;`/`continue;`) | VERIFIED |
| D-4f | Mechanism, revised: `LinkScope` gains **two** link-time numbers — `finallyDepth`, incremented by `compileTry` for its body and clauses **only when that `try` has a `finally` clause**, and `loopFinallyDepth`, set to `scope.finallyDepth` when `compileFor`/`compileWhile` builds the body scope. At a `break`/`continue`, after the existing `loopDepth === 0` check, refuse if `scope.finallyDepth > scope.loopFinallyDepth`. `compileTry` partitions its children before compiling the body (D-6f), so finally-presence is known in time. **A plain `tryDepth` is no longer needed for anything and is not added** | `loopDepth` is set the same way at `link.ts:487,516` | VERIFIED |
| D-4f1 | **Consequence: with no `finally` in the union, the refusal is unreachable.** If the D-7f gate cuts `finally` to D2, `KIR_LOOP_JUMP_CROSSES_TRY` stays **reserved and unspent**, neither scope field is added, and the jump commit is a pure admission. The label therefore moves from the jump commit to the finally commit in the commit plan | derivation from D-4d/D-4f | VERIFIED |
| D-4g | The cases the comparison must get right, with a **finally-bearing** `try`: **loop inside try** → entry `finallyDepth` 1, body 1, equal → legal; **try inside loop** → entry 0, inside try 1 > 0 → refused; **jump inside a loop inside a try** → entry 1, body 1 → legal. The same three with a finally-**less** `try` → all legal | derivation from D-4f | VERIFIED |
| D-4h | Both new scope fields are **link-time only**. No leg carries a runtime try-depth, finally-depth or loop-depth counter; RT-1's frame chain and the host's own nesting are the answer. rt12's `[RT12J-N5]` survives the override untouched | rt12 `[RT12J-N5]` (`spec.md:727-728`) | VERIFIED |
| D-4i | Rethrow (`throw value="e"` of the bound value) is **in**; nested `try` is **in**; the catch binding is **optional**. All three **measured to project**: `catch{throw value="e"}`, a `try` whose first child is another `try`, and `catch` with `props: []` | `catalog.generated.ts:6695` (`catch.name` `required:false`); OQ-D1 measurement | VERIFIED |
| D-4j | A **typed** catch (`catch.type`) is refused: F5 already marks the property `disposition:'excluded-host-type'`, `reasonId:'portable-type-grammar-required'`, and `compileCatch` calls `propertySet(properties, [], ['name'], label)` so a `type` property faults `unsupported property set` | `catalog.generated.ts:6695` | VERIFIED |

### D-5 Metering and abort

| # | Claim | Evidence | Tag |
|---|---|---|---|
| D-5a | **One `meter.step()` per ENTERED block** — try body, catch body, finally body — on top of the statement-boundary charge the `try` statement itself already takes. A `catch` body that is never entered charges nothing; a `try` body is always entered (an empty body is a link refusal) | tribunal §RECOMMENDATION; the statement boundary already charges every kind (`kir-runtime/expression.ts:225`) | VERIFIED (ruling) |
| D-5b | **ZERO new `checkAbort()` sites.** `source.split('checkAbort()').length - 1 === 2` on `packages/core/src/kir-runtime/expression.ts` is a **whole-file** pin in two places and must stay `2` | `scripts/kern-5-rt10-pre-linked-arithmetic/tick-discipline.test.mjs:141-144`; `scripts/kern-5-rt12-linked-jumps/tick-discipline.test.mjs:51-57` | VERIFIED |
| D-5c | Every metering row is a **difference against a hand-counted twin measured in the same run**, never a derived formula, and the statement counts go into the assertion message. Predicted differences, to be **measured and re-stated** before promotion: `try{leaf}` − `leaf` = **2** (try statement boundary + entered try body); `try{throw p}catch{leaf}` − `let p; leaf` = **4** (try boundary + entered try body + throw boundary + entered catch body) with the payload expression cancelling in the twin | rt11 `[RT11W-TD1]` (twin short by one statement, invisible until the loop admitted); rt12 `[RT12J-TD9]` ("**No RT-1 statement costs one step**"; all five J-rows were arithmetically wrong); rt12 `[RT12J-D5]` | ASSUMED (integers) / VERIFIED (method) |
| D-5d | **Envelope faults bypass catch AND finally.** `runtime-limit-exceeded` raised inside a `try` that has a `catch` still produces a `runtime-limit-exceeded` failure; `execution-cancelled`/`execution-timeout` inside a `try` produce theirs, with neither the catch nor the finally body running. This is **the one pinned TS divergence** — TS would run `finally` on any exit | tribunal §RECOMMENDATION ("the envelope is a hard boundary, finally-of-last-resort is kernel-owned, as `execute()` already demonstrates") | VERIFIED (ruling) |
| D-5e | On **RT-1** D-5d needs no code: the fault leaves the generator and discards the frame stack (see *What Already Works*). On the **JS leg** native `try{}finally{}` would run the finally on a `__Fault`, so `finally` is **not** lowered to a bare native `finally`. The lowering is: `let __efN=false; try{ try{ BODY } catch(__e){ if(!(__e instanceof __UserThrow)){__efN=true; throw __e;} CATCH_BODY } } catch(__e2){ if(!(__e2 instanceof __UserThrow)) __efN=true; throw __e2; } finally { if(!__efN){ FINALLY_BODY } }`. The outer guard is what covers an envelope fault raised **inside the catch body**; a rethrown `__UserThrow` leaves `__efN` false, so the finally still runs on a user-throw exit | JS `finally` semantics; the wrapper's own `try{}finally{}` cleanup (`emitter.ts:432-436`) is the kernel-owned finally-of-last-resort and stays | VERIFIED (design) |
| D-5f | `FINALLY_BODY` is emitted **once**, not duplicated per exit edge — the `__efN` flag is what buys that | D-5e | VERIFIED (design) |

### D-6 Linker mechanics

All post-split file claims: **PINNED-BY-D0**, cited to `.Codex/specs/kern-5-d0-contracts-split/spec.md`.

| # | Claim | Evidence | Tag |
|---|---|---|---|
| D-6a | `compileTry` and `compileCatch` are **dedicated visitors in `statements.ts`**, dispatched from `compileBlock` alongside `for`/`while`/`if` — never `assertLeaf` exemptions | D.0 Implementation Plan places `compileStatement`, `compileIf`, `compileFor`, `compileWhile`, `compileBlock`, `compileBranch` in `statements.ts` (`spec.md:426`, table row) and estimates `statements.ts` +~130 for `compileTry`/`compileCatch`/`compileFinally` (`spec.md:~470`) | PINNED-BY-D0 |
| D-6b | `LinkScope` (`payloads`, `tryFamily`, and — in the finally commit only — `finallyDepth`/`loopFinallyDepth`) and `containsReturn` live in `link-support.ts`; `branchScope` propagates each as it arrives | D.0 Implementation Plan (`spec.md:425`): `link-support.ts` holds `fault`, `nodeKind`, `propertyText`, `propertyBool`, `propertySet`, `containsReturn`, `assertLeaf`, `LinkScope`, `ModuleContext`, `branchScope`, `bindName`, `assignTargetName`; and D.0's own headroom note "`link-support.ts` +3 (`tryDepth` on `LinkScope`, propagated in `branchScope`)" | PINNED-BY-D0 |
| D-6c | The two union members, the `statementSubBlocks` `try` arm and the `statementSubExpressions` `try` arm live in `contracts.ts`, which keeps every INV-1 marker | D.0 INV-1 (`spec.md` *Implementation Plan*): the two `export type … =` declarations and `function statementSubBlocks` / `function statementSubExpressions` / `function expressionVariantUnhandled` all stay in `contracts.ts`, in that order | PINNED-BY-D0 |
| D-6d | `statementSubExpressions` needs **one** arm, not two: `try` joins the zero-expression arm (`break`/`continue`/`try`), while `throw` falls through to the existing `return [statement.value]`. Without the `try` arm the fallback returns `[undefined]` and the capability closure and call-depth policy walk a hole | `statementSubExpressions` (`contracts.ts:292-300`): `if (statement.kind === 'break' \|\| statement.kind === 'continue') return []; return [statement.value];`; rt12 `[RT12J-TD5]` is the "one arm, not two" lesson | VERIFIED |
| D-6e | `statementSubBlocks` gains a `try` arm returning `[body]`, `[body, catchBody]` or `[body, catchBody, finallyBody]` — every sub-block must be reachable or `createLinkedKirClosureWalk` and `linkedStatementsCallDepth` (post-split: `walkers.ts`) miss a capability or a call inside a try | `statementSubBlocks` (`contracts.ts:284-290`); D.0 moves the walkers to `walkers.ts` (`spec.md:423`) | VERIFIED / PINNED-BY-D0 |
| D-6f | Clause partition: the try body is `children[0 .. firstClauseIndex)`; from the first `catch`/`finally` clause on, **only** clause nodes are admitted. A body statement after a clause is refused with the new label `KIR_TRY_BODY_AFTER_CLAUSE`. An empty try body or an empty clause body is refused with the existing message `branch block is empty` — **no new label**. `compileBranch` itself cannot be reused, because it reads `nodeChildren(node)` wholesale and a `try`'s children include its clauses | `compileBranch` at `link.ts:400`, its empty check at `link.ts:407`; F5 admits any child order (`catalog.generated.ts:6613`) | VERIFIED |
| D-6g | `compileTry` calls `propertySet(properties, [], [], label)`, so a `try` carrying `name` — the **async-orchestration** shape, which the parser deliberately does not flag inside a handler — faults `unsupported property set`. `step`/`handler` children reach `compileStatement` and hit the existing `statement kind step is outside RT-1` | `propertySet` (`link.ts`); parser discriminator (`parser-validate-body-statements.ts`, `isBodyStatementMisplaced`); `catalog.generated.ts:6613` | VERIFIED |
| D-6h | Structural refusals spending reserved labels: `KIR_TRY_REQUIRES_CATCH` (a `try` with no `catch` clause — replaced by `KIR_TRY_REQUIRES_CATCH_OR_FINALLY` if the finally commit lands), `KIR_CATCH_WITHOUT_TRY` (a `catch` node in any block whose parent is not a `try` — F5 admits one at handler top level and inside `for`/`while`/`catch`/`with`), `KIR_DUPLICATE_CATCH` (a second `catch` clause) | D.0 Reservation 2 (`spec.md:340-373`); `catalog.generated.ts:962-1030,3111-3187,6695` | VERIFIED |
| D-6i | A stray `finally` **before** the finally commit falls to the existing catch-all `statement kind finally is outside RT-1`. **After** the finally commit it is refused with the new label `KIR_FINALLY_WITHOUT_TRY`. A ninth reserved label is **not** added: D.0's oracle asserts `labels` deepEquals exactly the pinned eight (`reserved-labels.test.mjs`, *"the registry holds exactly the eight try-family labels, sorted"*), and new **emitted** labels were never registry members — `KIR_JUMP_WITHOUT_LOOP_FRAME` is rt12's own precedent for that | `scripts/kern-5-d0-contracts-split/reserved-labels.test.mjs`; `pins.mjs` `RESERVED_LABELS`; `kir-runtime/expression.ts:233,241` | VERIFIED |

### D-7 `finally` — last ordered commit, gated

| # | Claim | Evidence | Tag |
|---|---|---|---|
| D-7a | `finally` is **cleanup-only**: `return`, `break`, `continue` and `throw` anywhere inside a finally body (at any nesting) are link refusals spending `KIR_ABRUPT_FINALLY_UNSUPPORTED`. This is what removes the tribunal's stated residual risk — "the return-through-finally pending-completion protocol" — by making the protocol unnecessary | tribunal §RECOMMENDATION and *Overall confidence* paragraph; D.0 Reservation 2 | VERIFIED (ruling) |
| D-7b | `finally` runs on **normal fallthrough, `return`, and user-throw** exits (caught or rethrown), and **not** on envelope faults (D-5d/D-5e) | tribunal §RECOMMENDATION | VERIFIED (ruling) |
| D-7c | Additional reserved labels spent by this commit: `KIR_DUPLICATE_FINALLY` (a second `finally` clause), `KIR_CATCH_AFTER_FINALLY` (a `catch` clause following a `finally` clause) | D.0 Reservation 2 | VERIFIED |
| D-7d1 | **Asserted, not merely intended: no `reserved-labels.json` `spentBy` entry may resolve to `null`.** The key is deleted when a label goes back to unspent. `reserved-labels.test.mjs` *"the KIR_TRY_REQUIRES_CATCH key is deleted once the finally commit lands, never nulled"* now checks the values directly — `Object.entries(spentBy).filter(([, slice]) => slice === null \|\| slice === undefined)` must be empty — as well as the derived unspent-set property. A nulled key would otherwise satisfy "carries no truthy spend" while still occupying the registry, and D.0's own interlock reads `spentBy[label] ?? null` | `scripts/kern-5-d-linked-try/reserved-labels.test.mjs` | VERIFIED |
| D-7d | **`spentBy` transitions, exact.** When the finally commit lands: `KIR_TRY_REQUIRES_CATCH`'s `spentBy` key is **deleted** (it stops being emitted, because `try{}finally{}` becomes legal) and `KIR_TRY_REQUIRES_CATCH_OR_FINALLY` gains `"kern-5-d"`. If finally is cut to D2: `KIR_TRY_REQUIRES_CATCH` keeps `"kern-5-d"` and all four finally labels stay unspent. Deleting the key (rather than setting it null) is required by D.0's row *"a spentBy entry may not resolve to null"* | `scripts/kern-5-d0-contracts-split/reserved-labels.test.mjs` (`unspentLabels(value).filter(label => Object.hasOwn(value.spentBy, label))` must be `[]`) | VERIFIED |
| D-7e | F5 asymmetry the finally commit must respect: `finally`'s `allowedChildren` **excludes `for`, `destructure` and `handler`** but includes `while`, `each`, `try`, `throw`, `break`, `continue`. So a `for` inside a `finally` is refused by F5 (not by the linker), while a `while` inside a `finally` reaches the linker and must be admitted, and a `throw`/`break`/`continue` inside a `finally` reaches the linker and must be refused with `KIR_ABRUPT_FINALLY_UNSUPPORTED` | `catalog.generated.ts:6749` | VERIFIED |
| D-7f | **Pre-registered abort criterion, with its measurement procedure.** A *row* is one `test('…')` case under `scripts/kern-5-d-linked-try/`. A checked-in `commit-rows.json` maps every test name to its commit tag `D1 … D5`, and one oracle row asserts the mapping is **total and disjoint** (every test name present exactly once, no unknown name). Before merge, run `node --test --test-reporter=tap scripts/kern-5-d-linked-try/` and count top-level test names per tag. **If `rows(D5) > rows(D1) + rows(D2) + rows(D3) + rows(D4)`, the finally commit is dropped from D and re-queued as D2, and the four finally labels return to unspent.** The measurement is a command, not a judgement | tribunal §RECOMMENDATION ("Pre-register the abort criterion in the parity ledger: if this commit's test surface exceeds all preceding D commits combined, cut finally to D2 before merge") | VERIFIED (ruling) |
| D-7g | The abort criterion is recorded in the parity ledger's own commit as a spec citation: the `try` row's `spec` field points at this document, which is where the criterion lives. The ledger schema has no field for a criterion (`ROW_KEYS` is exactly `blockedBy label nodeKind since spec surface`), so the citation is the mechanism | `scripts/kern-5-parity-ledger/ledger-support.mjs:42-44` | VERIFIED |

### D-8 Importer-facing notes — what a `catch` observes in D

| # | Claim | Evidence | Tag |
|---|---|---|---|
| D-8a | **In D, a `catch` observes only throws raised lexically inside the same handler body.** It does not and cannot observe: a throw from a helper (refused at link, D-2h), a capability/host failure (an uncatchable `__Fault`, QD-1 option (a), D-2i), or any envelope fault (D-5d). An importer must not assume TS `try { … } catch` semantics beyond that boundary in D | D-2h, D-2i, D-5d | VERIFIED |
| D-8b | **There is therefore no silent-miscatch hazard around `await`.** The worry — `try { await helper() } catch` quietly intercepting something it should not — cannot arise, because an async callee has no way to raise a user throw in D at all: `throw` in a helper body is a link refusal. The absence is structural, not incidental | D-2h; `assertAsyncCallPosition` (`link.ts:285-297`) already governs where an async call may sit | VERIFIED |
| D-8c | The positive behaviour must still be pinned: `try { await helper() } catch { … }` where the helper **completes normally** runs the try body to completion and does **not** enter the catch. A spurious catch entry here would be the exact bug D-8b argues is impossible, so the row is the falsifier for the argument | this spec's acceptance criteria | VERIFIED |
| D-8e | **A TS `catch` handler reading the public envelope sees no user-throw label.** D-3b puts the clamped label in the `KernKirFault`/`__Fault` **message**, and `KernKirDiagnostic` has exactly `category`, `code`, `phase` — so an uncaught throw surfaces as `{category:'runtime', code:'uncaught-throw', phase:'execution'}` and nothing more. The message and the payload record are reachable only from inside the handler, through the `catch` binding (`e.message`, `e.code`). An importer that expects to read the thrown text off the envelope must instead catch in KERN and put what it needs into a `print` or a return value | D-3b, D-3a | VERIFIED |
| D-8d | Queued consequences the importer lane must plan around, in priority order: helper-mediated throw and rethrow (D2 top item, D-1f1), capability failures as catchable values (needs the result-record channel QD-1 leaves owing), and payload widening beyond `{message, code}` | *Queued* | VERIFIED |

## Implementation Options

The decision space collapses to one plan on the ruling plus the source. The four alternatives that
had real advocates are all closed with evidence, and are recorded so no later slice re-litigates:

- **Payload = any `KernKirValue` with an `unknown` catch binding** (Codex's option A). Ruled out by
  the tribunal on its own advocate's flip condition; it moves the rt10 type gate, breaks closed
  expression evaluation, and smuggles a type-system slice into a control-flow slice. Queued as D2
  behind an `unknown`-type slice.
- **`finally` as native JS `try{}finally{}`.** Ruled out by D-5d: native `finally` runs on a
  `__Fault`, which would silently violate the one divergence the tribunal pinned. The `__efN` guard
  (D-5e) is the minimal correct lowering.
- **`__UserThrow` in the kernel prelude.** Ruled out by D-2b: it moves `TARGET_KERNEL_SHA256` on the
  JS leg and every emitted-artifact digest in every rt suite, for zero behavioural gain.
- **A ninth reserved label for a stray `finally`.** Ruled out by D-6i: D.0's oracle pins the
  eight-label set exactly, and emitted labels were never registry members.

## Commit plan (ordered)

Each commit is independently green: local gate, then the next commit.

| # | Tag | Content | Labels spent / added |
|---|---|---|---|
| 1 | **D1** | `throw` + uncaught-throw. Statement union +`throw`; `statementSubExpressions` fallback covers it; `compileThrow` in `statements.ts` with the payload gate; `LinkScope.payloads`/`tryFamily`; RT-1 `'threw'` completion + `clampThrowLabel` + both driver arms; JS per-module `__UserThrow`/`__throwLabel` + the `throw` `blockSource` arm + the uncaught-conversion catch; parity-ledger `throw` row + `THROW_ROW_POSITIONS`; Python lowering table `throw: 'deferred'`; rt2/rt9 goldens gain `throw`; the whole digest cascade **once**, at the end of this commit | added: `KIR_THROW_PAYLOAD_SHAPE`, `KIR_TRY_FAMILY_IN_HELPER` |
| 2 | **D2** | `try`/`catch`. Statement union +`try`; `statementSubBlocks` + `statementSubExpressions` `try` arms; `compileTry`/`compileCatch` with the clause partition; `containsReturn` `try` recursion; `LinkScope.payloads`/`tryFamily` extended to `try`; RT-1 `TryTrap` + `WalkFrame.trap` + the bounded unwind scan; JS native `try{}catch(){}` with the nominal guard; parity-ledger `try` row + `TRY_ROW_POSITIONS`; Python `try: 'deferred'`; rt2/rt9 goldens gain `try`; rt12 `walker-coverage` `containsReturn` kind list gains `try`; the digest cascade **again** | spent: `KIR_TRY_REQUIRES_CATCH`, `KIR_CATCH_WITHOUT_TRY`, `KIR_DUPLICATE_CATCH`; added: `KIR_TRY_BODY_AFTER_CLAUSE` |
| 3 | **D3** | Rethrow, nested try, optional catch binding. Payload gate branch (ii); no union change, no golden change, no digest cascade | none |
| 4 | **D4** | Jumps crossing a try — an **admission** commit, no refusal (D-4d). No scope field, no new label: `break`/`continue` inside a `try`/`catch` simply stop being refused, and the commit is behaviour rows proving RT-1 and JS agree byte-for-byte on the importer's defensive-loop shape | none |
| 5 | **D5** *(gated by D-7f)* | `finally`. `compileFinally`; `TryTrap.finallyBody`; the RT-1 trap-frame drain path; the JS `__efN` lowering; the abrupt-completion refusals; **`LinkScope.finallyDepth`/`loopFinallyDepth` and the cross-try jump refusal**, which is only reachable once a `finally` can exist (D-4f1); rt12's reserved-label scan flipped from *absent* to *spent in `statements.ts`*; the `spentBy` transition of D-7d | spent: `KIR_ABRUPT_FINALLY_UNSUPPORTED`, `KIR_DUPLICATE_FINALLY`, `KIR_CATCH_AFTER_FINALLY`, `KIR_TRY_REQUIRES_CATCH_OR_FINALLY`, **`KIR_LOOP_JUMP_CROSSES_TRY`**; unspent again: `KIR_TRY_REQUIRES_CATCH`; added: `KIR_FINALLY_WITHOUT_TRY` |

**If the D-7f gate cuts D5**, `KIR_LOOP_JUMP_CROSSES_TRY` goes to D2 with `finally`, unspent — and D ships with jumps across `try` fully admitted and no cross-try refusal in the tree. That is a coherent end state, not a hole: with no `finally` in the union there is nothing a jump could skip.

### Labels: spent / reserved / added

| Label | Registry status after D (finally lands) | After D (finally cut to D2) | Emitted in |
|---|---|---|---|
| `KIR_TRY_REQUIRES_CATCH` | reserved, **unspent again** | `spentBy: kern-5-d` | `statements.ts` (D2 only) |
| `KIR_TRY_REQUIRES_CATCH_OR_FINALLY` | `spentBy: kern-5-d` | reserved, unspent | `statements.ts` |
| `KIR_CATCH_WITHOUT_TRY` | `spentBy: kern-5-d` | `spentBy: kern-5-d` | `statements.ts` |
| `KIR_DUPLICATE_CATCH` | `spentBy: kern-5-d` | `spentBy: kern-5-d` | `statements.ts` |
| `KIR_LOOP_JUMP_CROSSES_TRY` | `spentBy: kern-5-d` | reserved, **unspent** (D-4f1) | `statements.ts` (D5 only) |
| `KIR_ABRUPT_FINALLY_UNSUPPORTED` | `spentBy: kern-5-d` | reserved, unspent | `statements.ts` |
| `KIR_DUPLICATE_FINALLY` | `spentBy: kern-5-d` | reserved, unspent | `statements.ts` |
| `KIR_CATCH_AFTER_FINALLY` | `spentBy: kern-5-d` | reserved, unspent | `statements.ts` |
| `KIR_THROW_PAYLOAD_SHAPE` | not a registry member (new emitted) | same | `statements.ts` |
| `KIR_TRY_FAMILY_IN_HELPER` | not a registry member (new emitted) | same | `statements.ts`, `kir-runtime/expression.ts`, `execute.ts` |
| `KIR_TRY_BODY_AFTER_CLAUSE` | not a registry member (new emitted) | same | `statements.ts` |
| `KIR_FINALLY_WITHOUT_TRY` | not a registry member (new emitted) | not emitted | `statements.ts` |

**Landed: 51.** The emitted `KIR_*` token set under `packages/core/src/kir-runtime/` is **51**
tokens, and it is pinned as an explicit list rather than a count:
`scripts/kern-5-d-linked-try/pins.mjs` `TARGET_KIR_TOKENS_WITH_FINALLY` =
`BASE_KIR_TOKENS` (D.0's corrected **40**, which includes the `KIR_JUMP_WITHOUT_LOOP_FRAME` its own
pin was missing) **+ 7** reserved labels spent by D **+ 4** new emitted labels. The earlier revisions
of this paragraph quoted 43, 46 and 48 from three different arithmetics; the list is the authority
and `reserved-labels.test.mjs` *"the emitted KIR token set under kir-runtime equals the recounted
list exactly"* is where it is checked. `TARGET_KIR_TOKENS_WITHOUT_FINALLY` remains pinned for the
configuration the D-7f gate would have produced, and the oracle branches on `spentBy`.

### `kir-runtime/expression.ts` line budget (QD-2) — no second inventory transition

D.0 hands D the constraint *"`kir-runtime/expression.ts` must finish slice D under 500 lines"*
(`spec.md:412-413`, QD-2). Measured base: **406** lines, not the 402 D.0 recorded (`e1d94060`
landed after D.0's pins) — so **94** free lines, not 98.

| Addition | Estimate |
|---|---|
| `TryTrap` interface | 5 |
| `WalkFrame.trap` field (+ `trap: undefined` on the 4 existing frame constructions — edits, not additions) | 1 |
| `StatementWalkResult` `'threw'` variant | 1 |
| `throw` arm: bounded trap scan, truncate, bind, push catch frame, or return `'threw'` | 16 |
| `try` arm: build the trap, push the body frame, entered-block `meter.step()` | 8 |
| trap-frame drain path (finally, D5 only) | 12 |
| `clampThrowLabel` (exported) | 8 |
| `callHelper` `'threw'` fail-closed arm | 3 |
| **Total** | **~54** (≈ 42 without the finally commit) |

**Decision: D lands at ≈ 460 lines and opens no inventory transition.** Two oracle rows hold it:
`< 500` (the doctrine ceiling) and `≤ 470` (the headroom row). `LINE_BUDGETS` in D.0's `pins.mjs`
covers only the `linked-kir-program/` directory, so this file needs a **new** budget row, which D
adds.

**Pre-registered escape, if the measured arms exceed 94 lines:** D opens its own head-stage
transition **357 → 358** with one new module,
`packages/core/src/kir-runtime/try-walk.ts`, holding exactly `TryTrap`, `findTrapFrame(frames)` and
`clampThrowLabel(value)`. That cut is legal where D.0's three candidates were not: it is
type-plus-pure-function only, it is acyclic (none of the three calls `walkStatements`,
`evaluateExpression` or `callHelper`, so the `walkStatements → evaluateExpression → callHelper →
walkStatements` cycle is not crossed), it carries **no** `checkAbort()` occurrence so both whole-file
`checkAbort()` census pins stay at 2, and it is **not** an rt10-pre `between` marker — the marker
pair there is `const BINARY_EVALUATORS = Object.freeze({` → `export function calleeBindings`
(`tick-discipline.test.mjs:124-127`), and neither marker moves. Cost if taken: a new head-stage
module + test under `scripts/kern-canonicalizer/`, the `coverage-dependencies.mjs:337` head re-wire,
a `coverage-integrity.test.mjs` `omitted` list entry (52 → 53), and one more `compiledCoreDigest`
re-pin.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-d-linked-try/spec.md` | add | this document |
| `scripts/kern-5-d-linked-try/**` | **add** | this slice's oracle: probe-matrix, type-gate, behaviour, metering, tick-discipline, walker-coverage, python-deferral, compatibility, fault-carrier, plus `fixtures.mjs`/`k0-support.mjs`/`pins.mjs`/`commit-rows.json`. Every hand-written module under 500 lines |
| `package.json` | edit | `test:kern-5-d-linked-try`; appended to `test:kern-5-script-family` (currently ends `… && pnpm test:kern-5-d0-contracts-split`) |
| `scripts/ci/test-tier-contract.test.mjs` | **edit (required)** | `kern5EvidenceCommands` at `:49-71` is `deepEqual`'d against the aggregate's segments at `:154-159`; the leaf lands in **both** lists or `test:ci-contract` goes red (D.0's STEP-0-g, same trap) |
| `.github/workflows/ci.yml` | **no edit** | the `kern-5-evidence` job runs the aggregate once |
| `packages/core/src/kir-runtime/linked-kir-program/contracts.ts` | edit | +2 statement-union members; **one** `statementSubExpressions` arm (D-6d); one `statementSubBlocks` arm (D-6e). ~+14 lines → ~381 vs D.0's 420 budget. **PINNED-BY-D0** for the post-split baseline |
| `packages/core/src/kir-runtime/linked-kir-program/statements.ts` | edit | `compileTry`, `compileCatch`, `compileFinally`, `compileThrow`, the payload gate, the clause partition, and — in the finally commit only — the `break`/`continue` finally-crossing comparison (D-4f). **PINNED-BY-D0**: this file does not exist before D.0 |
| `packages/core/src/kir-runtime/linked-kir-program/link-support.ts` | edit | `LinkScope` +`payloads` +`tryFamily` (D1/D2), and +`finallyDepth` +`loopFinallyDepth` in the finally commit only (D-4f/D-4f1), each propagated in `branchScope`; `containsReturn` `try` recursion (D-4c). **PINNED-BY-D0** |
| `packages/core/src/kir-runtime/linked-kir-program/link.ts` | edit | `compileHandler` seeds the four new scope fields (`tryFamily: true` for the entry, `false` via `resolveHelper`). **PINNED-BY-D0** for the post-split baseline |
| `packages/core/src/kir-runtime/linked-kir-program/walkers.ts` | **no edit** | the walkers read `statementSubBlocks`/`statementSubExpressions`, which D extends in `contracts.ts`. **PINNED-BY-D0** |
| `packages/core/src/kir-runtime/expression.ts` | edit | `TryTrap`, `WalkFrame.trap`, `StatementWalkResult` `'threw'`, the `throw`/`try` arms, `clampThrowLabel`, the `callHelper` fail-closed arm. **No new `checkAbort()`**; must finish < 500 (406 today) |
| `packages/core/src/kir-runtime/execute.ts` | edit | the `'threw'` arm in `runFrames`: uncaught at the entry walk → `KernKirFault('uncaught-throw','execution', clampThrowLabel(value))`; from a popped helper frame → `KIR_TRY_FAMILY_IN_HELPER` fail-closed (D-2f) |
| `packages/core/src/kir-runtime/contracts.ts` | **no edit** | `KernKirDiagnosticCode` stays at the 13 D.0 landed; `KernKirDiagnostic`, `KernKirEnvelope`, `KernKirFault`, `KernKirLimits` all byte-unchanged (D-3b, D-3g) |
| `packages/core/src/compiler/kir-js-esm/emitter.ts` | edit | one `blockSource` arm for `throw`, one for `try`; the per-module `__UserThrow`/`__throwLabel` prelude and the uncaught-conversion `catch` in `specializedSource`, **both conditional on the program containing a `throw` or `try`** (D-2b) |
| `packages/core/src/compiler/kir-js-esm/target-base.ts`, `target-json.ts`, `target-hash.ts`, `target-execution.ts` | **no edit** | any byte here moves `TARGET_KERNEL_SHA256` and every emitted-artifact digest in every rt suite |
| `packages/core/src/compiler/kir-python/emitter.ts` and every other `kir-python/*.ts` except `request.ts` | **no edit** | byte-frozen; `scripts/kern-5-parity-ledger/frozen-surface.test.mjs:32-40,94-96` pins the directory at exactly seven files |
| `packages/core/src/compiler/kir-python/request.ts` | edit | `KIR_PYTHON_STATEMENT_LOWERING` (`:25-36`) gains `throw: 'deferred'` and `try: 'deferred'`; the `satisfies Record<LinkedKernKirStatement['kind'], KirPythonLoweringState>` at `:36` makes tsc force it. `KIR_PYTHON_EXPRESSION_LOWERING` (`:38-48`) is **unchanged** — D adds no expression kind |
| `packages/core/src/parser-core.ts`, `parser-validate-body-statements.ts`, `kir-structural/**`, `scripts/kir-structural/constitution.json`, any `.kern` | **no edit** | F5 already projects all four nodes in every needed position (F5 catalog facts). The parser's non-policing of `catch`/`finally` is what the linker covers (D-6f/D-6h/D-6i) |
| `packages/core/src/runtime-envelope/**` | **no edit** | `normalize.ts:122` stays the single `internalRuntimeFailure` producer (D-3f); the legacy IRNode runner is a different stack |
| `scripts/kern-5-parity-ledger/parity-ledger.json` | **edit — licensed** | two rows, sorted by `nodeKind` → `break, continue, throw, try, while`. `throw`: `blockedBy: []`, `since: 'kern-5-d'`, `spec: '.Codex/specs/kern-5-d-linked-try/spec.md'`, `surface: 'statement'`, `label: 'KIR_PYTHON_LEG_DEFERRED'`. `try`: identical but `blockedBy: ['throw']` — the honest dependency (a catch clause is meaningless before a throw lowers). **Not** `['while','break','continue']`: there is no lowering dependency on the jump family, only the `KIR_LOOP_JUMP_CROSSES_TRY` *refusal*, which is link-time |
| `scripts/kern-5-parity-ledger/ledger-support.mjs` | **edit — licensed** | `LEDGER_SHA256` re-pin (`:40`, today `76e61c71…`, hand-hashed with `shasum -a 256 scripts/kern-5-parity-ledger/parity-ledger.json` — there is no generator); **and** two new position catalogues `TRY_ROW_POSITIONS` / `THROW_ROW_POSITIONS` |
| `scripts/kern-5-parity-ledger/parent-positions.test.mjs` and `refusal-golden.test.mjs` | **edit — required, not optional** | both hold `const statementPositions = { while: WHILE_ROW_POSITIONS, ...JUMP_ROW_POSITIONS }` with a `?? STATEMENT_POSITIONS` fallback (`parent-positions.test.mjs:71-73`, `refusal-golden.test.mjs:79-81`). A `try`/`throw` row falling through to the `for`-shaped `STATEMENT_POSITIONS` makes the **Python compile succeed** and `assertNoPythonArtifact` fail — rt12's `[RT12J-TD11]` verbatim. Both dispatchers gain `try` and `throw` keys |
| — the shape of those two catalogues | **decided** | `THROW_ROW_POSITIONS` carries all five positions (`for-body, handler-top-level, helper-body, if-else, if-then`) minus **`helper-body`**, and `TRY_ROW_POSITIONS` likewise — because D-2h refuses the try family in a helper at **link**, so a `helper-body` row would go RED for the linker's reason rather than the deferral's. The omission gets its own explicit oracle row: the `helper-body` position is a link refusal with `KIR_TRY_FAMILY_IN_HELPER` on all legs |
| `scripts/kern-5-parity-ledger/exhaustiveness.test.mjs` | **edit — licensed** | `STATEMENT_KINDS` (`:6-28`) gains `throw`/`try`, and the `deferred` `deepEqual` becomes `['break','continue','throw','try','while']`, or it fails `PARITY_LEDGER_SURFACE_DRIFT` |
| `scripts/kern-5-parity-ledger/ledger-aware-gates.test.mjs` | **edit — licensed** | rt12 moved its row/kind assertions to three rows and three kinds; D makes them five |
| `scripts/kern-5-parity-ledger/frozen-surface.test.mjs` | **edit — licensed** | `NEIGHBOUR_GOLDENS` (`:46-53`) pins **six** slice goldens by digest; rt2, rt3 and rt9 move (rt11-TD4's successor). Re-measure the other three (`rt6`, `rt10-pre`, `rt10-cross-call-integer`) rather than assuming they hold. `COMPILED_CORE_COUNT` at `:30` is **354** and becomes **357** with D.0 — a D.0 edit D must not double-apply |
| `scripts/kern-5-parity-ledger/ledger-schema.test.mjs` | **no edit** | its row-count assertions run against synthetic documents it builds itself (rt12's re-measurement) — **verify, do not assume** |
| `scripts/kern-5-rt2-boolean-if/k0-golden.{json,test.mjs}` | **edit — licensed** | `linkedStatementKinds` gains `throw` and `try`. The golden's **second** test (`:125-133`) `deepEqual`s `STATEMENT_PROBES.filter(admission === 'admitted').sort()` against that union, so `PROBE_BODIES` (`:17-30`) and `STATEMENT_PROBES` (`:32-44`) each gain a `throw` and a `try` entry whose body **links** — a bare `throw` at top level would fail the trailing-return rule and the two lists would disagree (rt12's `[RT12J-TD*]` trap). Recommended: add `catch` and `finally` as probes that stay **non-admitted**, which turns the union's non-membership into an asserted fact |
| `scripts/kern-5-rt9-linked-assign/k0-golden.{json,test.mjs}` | **edit — licensed** | the hard-coded list at `:102-113` gains `throw`/`try`; the loop at `:114` is already `['each','set']` and needs no change; the test title at `:100` names the kinds and should too |
| `scripts/kern-5-rt3-binary-expression/k0-golden.json` | **edit — licensed** | its `rt2GoldenSha256` field derives from the RT-2 golden |
| `scripts/kern-5-rt4-user-fn-call/probe-matrix.json` | **edit — licensed** | carries both `rt2GoldenSha256` and `rt3GoldenSha256` |
| `RT2_GOLDEN_SHA256` literals | **edit — licensed, 7 files** | measured 2026-09-08 (`grep -rln RT2_GOLDEN_SHA256 scripts`): rt4, rt5, rt6, rt9, rt10-pre, rt10-cross-call-integer, **rt11**. rt12's spec said six; rt11 now carries it |
| `RT3_GOLDEN_SHA256` literals | **edit — licensed, 6 files** | measured: rt6, rt9, rt10-for, rt10-pre, rt10-cross-call-integer, rt11 |
| `RT9_GOLDEN_SHA256` literals | **edit — licensed, 2 files** | measured: rt10-for, rt10-cross-call-integer |
| historical pre-image reconstructions | **verify and re-derive, do not assume** | `scripts/kern-5-rt9-linked-assign/compatibility.test.mjs:50-60` rebuilds the pre-RT-9 RT-3 golden as `{...golden, rt2GoldenSha256: RT2_K0_GOLDEN_PRE_RT9_SHA256}`; `scripts/kern-5-rt10-pre-linked-arithmetic/compatibility.test.mjs:78-88` rebuilds a pre-slice RT-3 golden by *also filtering* `linkedExpressionKinds`, and `:115-125` re-derives **rt4's `RT3_PRE_SLICE_SHA256`** (`rt4/compatibility.test.mjs:13,192`) and **rt9's `RT3_K0_GOLDEN_PRE_RT9_SHA256`** by cross-file `literal()` scrape; `scripts/kern-5-rt10-cross-call-integer/compatibility.test.mjs:36,145` holds `RT10PRE_GOLDEN_PRE_SLICE_SHA256` and scrapes rt4's literal; `rt5/compatibility.test.mjs:129` holds a `PRE_SLICE_DIGESTS` map. rt11's `[RT11W-O5]` obligation applies unchanged: these survive **only** while `rt2GoldenSha256` stays the single RT-3 field the cascade moves. D adds **no expression kind**, so rt10-pre's `linkedExpressionKinds` filter is unaffected — **verify it** |
| `scripts/kern-5-rt10-for/compatibility.test.mjs`, `rt11/compatibility.test.mjs`, `rt12/compatibility.test.mjs` — `STILL_OUTSIDE` | **no edit** | measured: already `['each','set']` in all three (`:63`, `:75`, `:72`). The try family was never in those lists, so nothing shrinks. `with`/`do` were never in them either and stay outside |
| `scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs` | **edit — required, in the finally commit only** | (a) the reserved-label scan at `:157-166` reads only `LINK_URL`, `CONTRACTS_URL`, `LIMITS_URL` — none of which is `statements.ts`, where the finally commit spends `KIR_LOOP_JUMP_CROSSES_TRY`. Left alone it stays **GREEN vacuously**, the exact failure mode D.0 exists to prevent. It must flip to *the label is now spent, in `statements.ts`, by slice D*. **If the D-7f gate cuts `finally`, this file is not touched at all** and rt12's absence scan stays correct (D-4f1). (b) `RT12J_CODE_CREEP` is a D.0 edit (12 → 13), not a D edit |
| `.Codex/specs/kern-5-rt12-linked-jumps/spec.md` — `[RT12J-N4]` | **edit — text-only pin change, no code** | rt12 pinned *"`break`/`continue` **never cross a KIR `try` boundary** … a link refusal with the reserved label `KIR_LOOP_JUMP_CROSSES_TRY`"* (`:721-726`). The coordinator ruling of 2026-09-08 **narrows** it: the refusal applies only to a `try` **carrying a `finally`**. `[RT12J-N4]` gains a dated superseding note pointing at D-4d; its reasoning (*"both hosts make the naive lowering look correct"*) survives verbatim and is exactly why the narrowed case still needs a refusal. No rt12 source, test or golden changes |
| `pnpm test:kern-runtime-contract-v1`, `pnpm test:kern-runtime-envelope`, `pnpm check:rule-coverage` | **run, assert GREEN** | the contract walls (`check-runtime-contract-v1.mjs`, `check-runtime-envelope.mjs`, `check-rule-coverage.mjs`) are D's guard against a closed-set surprise on the public side (D-3g2). No file edited; three gate rows added to D's oracle |
| `scripts/kern-5-rt12-linked-jumps/walker-coverage.test.mjs` | **edit — required** | the `containsReturn` → `assertLeaf` scrape lives at **`:357-370`** (D.0's spec cites `:237-238`, stale — measured 2026-09-08), and is re-pointed from `link.ts` to `link-support.ts` by D.0. Its test is named *`containsReturn` keeps exactly its **four** block-owning arms and gains none for a jump* and `deepEqual`s the scraped kinds against `['for','if','return','while']`. D-4c adds `try`, a genuinely block-owning kind, so the list becomes `['for','if','return','try','while']` **and the test title must change** ("four" → "five"). Its own comment — *"an arm for a childless kind would be dead code"* — is the reason `throw` must **not** get an arm. This scrape breaks **loudly**, which is why it is the one that must be edited explicitly |
| `packages/core/src/compiler/kir-python/request.ts` — the `statementDeferral` switch | **edit — required, and tsc-forced** | `statementDeferral` (`:104-139`) short-circuits at its first line (`if (lowering.statement[statement.kind] === 'deferred') return statement.kind;`), so the `throw`/`try` arms are unreachable — but its `default:` binds `const exhaustive: never = statement`, so **tsc fails** unless the switch names every union member. `case 'throw': case 'try': return undefined;` joins the existing `case 'break': case 'continue': return undefined;` group. rt12 pins this with *the Python statement deferral switch keeps its never guard and names both jump kinds* (`walker-coverage.test.mjs:374-…`); D needs the analogous row for `throw`/`try` |
| `scripts/kern-5-rt10-for/type-gate.test.mjs`, `rt11/type-gate.test.mjs` | **verify** | rt12 already flipped their `break`/`continue`-in-loop-body refusal rows to admitted. Re-grep for any row asserting a `try`/`throw` refusal that D now admits; none found on 2026-09-08, but the grep is a required step |
| `scripts/kern-5-d0-contracts-split/pins.mjs` | **edit — required** | `BASE_STATEMENT_KINDS` 10 → 12 (`+throw`, `+try`); `BASE_KIR_TOKENS` 39 → 40 → 46/47 (see the Corrections Log); `LINE_BUDGETS['statements.ts']` 340 → **440** (D.0's own headroom note projects ~415, which its budget row forbids — an internal contradiction D must resolve); a **new** budget row for `kir-runtime/expression.ts` at 470; `RUNTIME_FAULT_SITES` `expression.ts` 20 → 21 and `execute.ts` 11 → 12; `JAVASCRIPT_FAULT_SITES` `emitter.ts` 24 → 25; `FAULT_CENSUS_TOTALS` and the two fault code sets gain `'uncaught-throw'` |
| `scripts/kern-5-d0-contracts-split/reserved-labels.test.mjs` | **edit — required** | (a) *"the registry lands with every label unspent"* asserts `spentBy` deepEquals `{}` — D moves it (D.0's QD-3 says so in words: *"Slice D moves this row as it spends each label"*). (b) **Bug, not just a pin:** the two not-emitted scans iterate `RESERVED_LABELS`, **not** `unspentLabels(value)`, so a correctly-spent label makes them RED regardless of `spentBy`. Both must filter to the unspent set, or QD-3's interlock cannot be satisfied at all |
| `scripts/kern-5-d0-contracts-split/diagnostics.test.mjs` | **edit — required** | `:87` *"no fault construction site anywhere in core carries `uncaught-throw`"* and `:106` *"the kir-runtime tree names `uncaught-throw` exactly once"* both move (D-3f). `:122` (`normalize.ts` remains the single `internalRuntimeFailure` producer) and `:131`/`:154`/`:175`/`:184` (RC-v1 convergence, no amendment, four digests, 125 bindings) stay **GREEN** and must be re-asserted |
| `scripts/kern-5-d0-contracts-split/behavior-preservation.test.mjs` | **edit — required** | *"neither linked union gains or loses a kind"* moves for the statement union (expression union unchanged). The three fixture rows — byte-identical linked program, byte-identical JavaScript artifact, byte-identical envelope on both legs — must stay **GREEN** for all fifteen fixtures, which is what D-2b's conditional emission buys |
| `scripts/kern-5-d0-contracts-split/layout.test.mjs`, `marker-locality.test.mjs`, `inventory.test.mjs`, `fault-census.test.mjs`, `wiring.test.mjs` | **verify GREEN** | INV-1 markers, the seven-file directory, the import DAG, the 357-path inventory, `addedPaths`, the `omitted` 52-entry list — all must be unmoved by D. `wiring.test.mjs` picks up D's own evidence leaf |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` | **edit — licensed** | the `compiledCoreDigest` literal moves with any content change under `packages/core/src`. Re-pin, **then** `pnpm write:kern-canonicalizer-coverage`, in that order |
| `scripts/kern-canonicalizer/*.json` coverage receipts | regenerate | `pnpm write:kern-canonicalizer-coverage`; `coverageImplementationDigest` moves because the re-pin edits a `.mjs` under `scripts/kern-canonicalizer` |
| `scripts/kern-canonicalizer/d0-contracts-split-historical-transition.mjs`, `coverage-dependencies.mjs`, `coverage-integrity.test.mjs` | **no edit** | D adds **no** file under `packages/core/src`, so the inventory stays at D.0's **357**, `addedPaths` stays the three D.0 paths and the `omitted` list stays at 52. Only the escape hatch under QD-2 would change this |
| `scripts/kern-5-admission-census/**` | **no edit** | measured: all 7 try-using census files are rejected at the **projection** stage and the census has **zero** `link`-stage rows, so the admission gain is exactly **0** and `admittedCount` stays 1. Same shape as rt12's `RT12J-C13a`, but measured for D rather than inherited |
| `scripts/runtime-contract-v1/**`, `scripts/kir-v1/alpha-receipt-policy.json`, `eligibility.json`, `coverage-witness-ledger.json`, `coverage-family-registry.json` | **no edit** | RC-v1 declares only the `KernRuntimeHandler*` surface and D creates no code and no envelope field. No amendment record. The alpha-receipt policy's `bindings` stays at 125, and `frozen-surface.test.mjs:136-140` asserts no `compiler/kir-python` path is receipt-bound — D binds none |
| `TARGET_KERNEL_SHA256` (both legs), the F5 policy digest, every existing manifest and `projectionArtifactSha256` | **no edit** | if one moves, a kernel byte was touched (forbidden) or an existing fixture's emitted text changed (which conditional emission prevents) |
| `scripts/kern-5-runtime-envelope-max-steps/**`, `scripts/kern-frontend-*`, `scripts/conformance.mjs`, `packages/core/src/ir/semantics/try.ts` | **no edit** | the legacy non-KIR try/catch interpreter and the IRNode runner are a different execution stack; prior art only |

## Acceptance Criteria

Each **is** a test under `scripts/kern-5-d-linked-try/`, landed RED at base for exactly one cause.
Promotion rule: no ASSUMED or OPEN claim feeds a final fixture unresolved.

**Linker — admission and structure**
- [x] `try` with one `catch` links on all three legs (Python: linked, then refused at the lowering
      gate with `KIR_PYTHON_LEG_DEFERRED` and **no** artifact).
- [x] `try` with no `catch` → `KIR_TRY_REQUIRES_CATCH` (or `KIR_TRY_REQUIRES_CATCH_OR_FINALLY` if D5
      lands). A second `catch` → `KIR_DUPLICATE_CATCH`. A `catch` at handler top level, inside a
      `for` body, inside a `while` body and inside another `catch` → `KIR_CATCH_WITHOUT_TRY` in all
      four positions (F5 projects every one of them).
- [x] An empty `try` body and an empty `catch` body → `branch block is empty`, **not**
      `statement kind try is outside RT-1`.
- [x] A `try` carrying `name` → `unsupported property set`. A `step` or `handler` child of a
      body-statement `try` → `statement kind step is outside RT-1`. A `catch` carrying `type` →
      `unsupported property set`.
- [x] A body statement after a clause → `KIR_TRY_BODY_AFTER_CLAUSE`.
- [x] Nested `try` links; `catch {}` with no binding links; a `let` shadowing the catch binding is a
      duplicate-binding refusal; `assign` to the catch binding is refused by the existing assign gate.
- [x] `throw` or `try` in a **helper** body → `KIR_TRY_FAMILY_IN_HELPER`, and the entry handler's own
      `throw`/`try` still links — proving the scope flag, not the node kind, is the discriminator.

**Linker — payload typing**
- [x] Admitted: `{message: "x"}`, `{message: "x", code: "E1"}`, `{message: p}` with `p` a text
      parameter, `{message: f()}` with `f` a text-returning helper, and `e` where `e` is the catch
      binding (rethrow).
- [x] Refused with `KIR_THROW_PAYLOAD_SHAPE`: a text literal, an integer literal, a boolean, a list,
      an identifier that is not a catch binding, `{}`, `{message: 1}`, `{message: "x", extra: "y"}`,
      `{code: "E1"}` (no `message`), a `member` expression, and a nested-record `message`.
- [x] A bare `throw` with no `value` → `unsupported property set`.
- [x] An explicit `{message: "x", code: null}` is **admitted** (writing the default is not a refusal).
- [x] **A null `message` is refused** with `KIR_THROW_PAYLOAD_SHAPE` — only `code` may be null — and
      both label helpers fail closed on a non-text message rather than reading through it.
- [x] **The absent-`code` default is inserted, and observable** (D-1a1): the linked payload for
      `throw value="{message: \"x\"}"` carries **both** keys, sorted `code` then `message`, with
      `code` a `{kind:'literal', value:{tag:'null'}}`. `e.code` then evaluates to `{tag:'null'}` and
      `e.message` to `{tag:'text'}`, byte-identically on both legs. A non-conforming payload is still
      a **refusal**, never a completion — the row that separates a typing default from canonicalization.
- [x] `e.message` and `e.code` link and evaluate with **no typing change**: `staticExpressionType` and
      `crossCallExpressionType` both still return `undefined` for `kind === 'member'`. `e.missing`
      faults `missing member` at runtime on both legs (the existing arm, re-asserted for the binding).
- [x] **Rethrow is lexical only** (D-1f1): `catch name=e` → `throw value="e"` links; a payload record
      as a helper **parameter type** is refused by `parameterType`, and a helper body containing
      `throw` is refused with `KIR_TRY_FAMILY_IN_HELPER`. Both rows, so the limitation is asserted
      rather than assumed.
- [x] **One artifact, one class** (D-2b0): the emitted module for a program with a `throw`, a `try`
      **and helpers** contains exactly **one** `class __UserThrow`, and the manifest names exactly one
      artifact, `'entry.mjs'`. A helper's own body is inside that same module.
- [x] **No silent miscatch around `await`** (D-8c): `try { await helper() } catch { … }` where the
      helper completes normally runs the try body to completion, does **not** enter the catch, and
      produces identical envelopes on both legs.
- [x] **The contract walls are GREEN** (D-3g2): `pnpm test:kern-runtime-contract-v1`,
      `pnpm test:kern-runtime-envelope` and `pnpm check:rule-coverage` all pass, so a closed-set
      surprise on the public diagnostic surface fails here rather than in CI.

**Control flow**
- [x] `return` inside `try` and inside `catch` links and returns, on both legs, with identical
      envelope bytes.
- [x] A handler whose only `return` is inside a `try` → `expected exactly one final return`, with
      **no** code change to `compileHandler` (the row exists to pin that the rule already covers it).
- [x] A **void** handler with a `return` inside a `try`/`catch`/`finally` → `KIR_VOID_HANDLER_VALUE_RETURN`
      (the discriminating row for D-4c; RED at base with `containsReturn` unrecursed).
- [x] **Jumps crossing a `try` with NO `finally` are admitted and behave** (D-4d). `for { try { if(!ok) continue; … } catch { … } }` and `for { try { … catch { continue } } }` both link, and RT-1 and the JS leg produce **byte-identical envelopes** — the loop advances, the trap frame is discarded, nothing is skipped. Same for `break` in both positions. This is the importer's defensive-loop shape (D-4d1) and it is the discriminating row for the override.
- [x] `break` inside a `for` inside a finally-less `try` → admitted. `break` inside a `while` inside a
      `try` inside a `for` → admitted.
- [x] **Jumps crossing a `try` that HAS a `finally` are refused** with `KIR_LOOP_JUMP_CROSSES_TRY`
      (finally commit only). `break` inside a `try{…}finally{…}` inside a `for` → refused; a `for`
      **inside** that same finally-bearing `try` still permits `break` (entry `finallyDepth` equals
      body `finallyDepth`).
- [x] A bare `break` inside a `try` at handler top level → `KIR_BREAK_OUTSIDE_LOOP`, not the cross-try
      label: the `loopDepth === 0` check runs first.
- [x] If the D-7f gate cuts `finally`: `KIR_LOOP_JUMP_CROSSES_TRY` appears in **no** file under
      `packages/core/src`, keeps no `spentBy` entry, and rt12's own absence scan is untouched and GREEN.

**RT-1 leg**
- [x] An uncaught `throw` returns `{kind:'threw', value}` from `walkStatements` and the driver
      converts it — driven **directly** through the exported `walkStatements`, not only through
      `executeKernKir`, so the RED names its own cause.
- [x] `walkStatements` driven with a hand-built `throw` and **no trap frame** returns `'threw'` and
      **terminates**: it does not hang, does not `pop()` an empty stack, and calls neither an extra
      `meter.step()` nor an extra `checkAbort()` beyond the statement boundary. This is the
      `[RT12J-TD17]` row for the try family.
- [x] `callHelper` given a walk that completes `'threw'` → `KernKirFault('handler-link-error', 'execution', 'KIR_TRY_FAMILY_IN_HELPER')`,
      and the async driver popping a helper frame that completed `'threw'` → the same. Both unreachable
      through linking, both driven directly.
- [x] `kir-runtime/expression.ts` carries exactly **two** `checkAbort()` occurrences (whole-file
      count) and is **< 500** lines, `≤ 470`.
- [x] A caught throw truncates the frame stack to the trap depth exactly: a `throw` from inside a
      `for` inside a `try` runs the catch body once and does **not** resume the loop.

**JavaScript leg**
- [x] The emitted module for a throw-carrying program contains exactly one `class __UserThrow`, one
      `instanceof __UserThrow` per `catch` clause, a native `try {`/`catch (`, **zero**
      `extends __Fault`, **zero** `error.code ===` field checks against a fault code, and no new
      `await`/`Promise`/`queueMicrotask`/`setImmediate`.
- [x] The emitted module for a program **without** a throw or try contains **no** `__UserThrow` token,
      and `TARGET_KERNEL_SHA256` on both legs equals D.0's pins (`b53251fd…`, `f79a3963…`).
- [x] All fifteen D.0 behaviour-preservation fixtures still emit **byte-identical** artifacts and
      **byte-identical** envelopes on both legs.
- [x] An uncaught throw on the JS leg produces the same envelope bytes as RT-1, and the converted
      `__Fault` carries code `'uncaught-throw'`, phase `'execution'` and the same clamped label
      string `clampThrowLabel` produces.

**Uncaught → public result**
- [x] Envelope for an uncaught throw: `outcome:'failure'`, `completion.kind:'error'`,
      `result:{presence:'absent'}`, exactly one diagnostic `{category:'runtime', code:'uncaught-throw', phase:'execution'}`,
      and `events` equal to the events committed before the throw — **byte-identical on both legs**.
- [x] A `print` and a capability inside a `try` before an uncaught throw: both events appear in the
      failure envelope, in order. Append-only, no rollback.
- [x] The clamped label: a 1000-character `message` yields exactly 256 code units; a payload with a
      `code` yields `` `${message256} [${code64}]` ``; the emitted module and
      `packages/core/src/kir-runtime/**` contain **zero** occurrences of `JSON.stringify` reachable
      from the label path.
- [x] `KernKirDiagnosticCode` has exactly **13** members; `KernKirDiagnostic` has exactly the three
      fields `category`, `code`, `phase`; `KernKirEnvelope` has exactly its seven fields; the four
      RC-v1 artifact digests are unchanged; `amendments/` holds exactly 3 files with consumed length
      2 and 0 pending; `alpha-receipt-policy.json` `bindings` has 125 entries.
- [x] `runtime-envelope/normalize.ts:122` is still the single `internalRuntimeFailure('uncaught-throw')`
      producer, and its shape agrees with the KIR failure envelope on `outcome`, `completion.kind`,
      `result` and the diagnostic triple — with `events` the one asserted divergence (D-3e).

**Metering and abort**
- [x] Every metering row is a **difference against a hand-counted twin** measured in the same run,
      with the twin's statement count written into the assertion message. `try{leaf}` − `leaf`,
      `try{throw}catch{leaf}` − `let; leaf`, `try{leaf}` inside a 3-trip `for` − the same loop
      without the try, and (D5) `try{leaf}finally{leaf}` − `try{leaf}`.
- [x] `maxSteps` exhausted **inside a `try` that has a `catch`** → `runtime-limit-exceeded`, the
      catch body does **not** run, and (D5) the finally body does **not** run — on both legs.
- [x] Cancellation and timeout inside a `try` → `execution-cancelled` / `execution-timeout`, catch
      and finally skipped, on both legs.
- [x] A `capability-error` raised inside a `try` with a `catch` → `capability-error` failure, catch
      **not** entered (QD-1 option (a), enforced by the carrier, asserted on both legs) — driven with
      a provider that actually **fails**, and with a finally-bearing `try` whose cleanup must not run.
- [x] The `__Fault`/`_Fault`/`KernKirFault` census equals D.0's, adjusted by exactly the deltas in
      D-2j and nothing else; **no class extends `__Fault`/`_Fault`**; no `catch`/`except` catches one
      inside a handler body.

**Reserved labels and registry**
- [x] `reserved-labels.json` `labels` is still exactly the pinned eight, sorted; `spentBy` names
      exactly the labels D emits, each with `"kern-5-d"`; every label with no `spentBy` entry appears
      in **no** file under `packages/core/src/` and in **neither built kernel**.
- [x] `KIR_LOOP_JUMP_CROSSES_TRY` **is** emitted, from `statements.ts`, and rt12's own scan asserts
      it is spent rather than absent.
- [x] The emitted `KIR_*` token set under `packages/core/src/kir-runtime/` equals the re-pinned list
      exactly (46 or 47, recounted), and is disjoint from the **unspent** reserved set.

**Parity ledger**
- [x] The ledger has exactly five rows, sorted by `nodeKind`: `break, continue, throw, try, while`;
      `try.blockedBy` is `['throw']`; `throw.blockedBy` is `[]`; both carry
      `spec: '.Codex/specs/kern-5-d-linked-try/spec.md'`, which exists on disk.
- [x] `LEDGER_SHA256` equals `sha256(parity-ledger.json)`, and the ledger digest is folded into no
      other digest.
- [x] For every `try`/`throw` position in `TRY_ROW_POSITIONS`/`THROW_ROW_POSITIONS`: the program
      links, the JavaScript artifact is produced, and the Python compile is **refused** with
      `KIR_PYTHON_LEG_DEFERRED` and no artifact. The `helper-body` position instead asserts a **link**
      refusal with `KIR_TRY_FAMILY_IN_HELPER`.
- [x] `KIR_PYTHON_STATEMENT_LOWERING` marks exactly `break, continue, throw, try, while` as
      `'deferred'` and everything else `'lowered'`; `KIR_PYTHON_EXPRESSION_LOWERING` is unchanged;
      the exhaustiveness scrape agrees.
- [x] `statementDeferral`'s switch still carries its `const exhaustive: never = statement` guard and
      **names `throw` and `try` explicitly**, grouped with `break`/`continue` returning `undefined`
      (rt12's analogous row, for the try family).

**Finally (D5, gated)**
- [x] `try{}finally{}` with no catch links only after D5; before it, `KIR_TRY_REQUIRES_CATCH`.
- [x] `return`, `break`, `continue` or `throw` anywhere inside a finally body, at any nesting →
      `KIR_ABRUPT_FINALLY_UNSUPPORTED`. A `for` inside a `finally` is refused by **F5**, not the
      linker (the asymmetry row).
- [x] A second `finally` → `KIR_DUPLICATE_FINALLY`; a `catch` after a `finally` →
      `KIR_CATCH_AFTER_FINALLY`; a stray `finally` → `KIR_FINALLY_WITHOUT_TRY`.
- [x] The finally body runs exactly once on: normal fallthrough, `return` from the try body, `return`
      from the catch body, a caught throw, and a rethrown throw — and **zero** times on
      `runtime-limit-exceeded`, `execution-cancelled`, `execution-timeout` and `capability-error`,
      including when the envelope fault is raised **inside the catch body**.
- [x] The emitted JavaScript contains the finally body **once**, guarded by the `__efN` flag, and the
      wrapper's own kernel `finally` (timer clear, listener removal) is unmoved.
- [x] **A `return` crossing a `finally` builds the success envelope only AFTER the cleanup has run**,
      so a `finally` that commits an event succeeds on both legs with that event in `events`; nested
      finally-bearing trys run both cleanups, innermost first, before the envelope.
- [x] **An event committed by a `finally` is charged against `maxBytes` on both legs**: the
      print-bearing fixture needs a strictly larger budget than its print-free twin measured in the
      same run, and at the twin's threshold it fails `runtime-limit-exceeded` on both legs.
- [x] **A deferred return charges its statement boundary at the return site, before the cleanup**,
      the way RT-1 does: one step under RT-1's own execution count both legs fail with the same
      diagnostic and **neither** commits the cleanup's event. It is charged **once** however many
      finallys it crosses — the nested fixture shares RT-1's threshold exactly, and one step under,
      both legs stop on the same cleanup prefix.
- [x] `commit-rows.json` maps every test name to exactly one of `D1 … D5`, totally and disjointly,
      and the abort comparison of D-7f is recorded with its measured integers.

## Out of Scope

`each`, `set`, `with`, `do`; closures and lambdas; classes; `async` beyond what already exists;
module imports; a typed or multi-`catch`; `catch.type` lowering; bare `throw` as a signal;
payload widening beyond `{message, code}`; any new `KernKirValue` tag or `LinkedKernKirStaticType`;
any new limit, diagnostic code, completion kind or `outcome` value; any RC-v1 amendment; the Python
emitter; the legacy `ir/semantics/try.ts` interpreter; **importer canonicalization of non-conforming
TS throws** (the importer lane owns it, and this spec's D-1c is the contract it must satisfy);
splitting `linked-kir-program/expression.ts` or `contracts.ts` further.

## Queued

- **D2 — `finally`**, if D-7f's gate fires.
- **D2 — `throw`/`try` inside a helper body, and helper-mediated rethrow. Top item.** The importer
  maps TS functions to helpers and TS functions throw constantly, so this is the largest gap D
  leaves (D-1f1, D-8a). Needs **two** things, not one: a disjoint host carrier caught at the
  `callHelper`/`evaluateExpression` boundary (or a generator-shaped `callHelper`), **and** a way to
  type a payload in parameter position, since `LINKED_KIR_TYPE_ADMISSION` has no `record` row.
  Both are real designs; neither belongs in D.
- **D2 — payload widening** to any `KernKirValue`, behind an `unknown`-type slice (Codex's option A,
  ruled out of D but not out of the roadmap).
- **D2 — `let`-bound payloads** (D-1f) and bare `throw` as a rethrow signal.
- **D2 — trailing-return relaxation.** Cross-cutting, not try-specific.
- **Python parity catch-up** for `throw` and `try`, in ledger `blockedBy` order (`throw` first), and
  the `_UserThrow(Exception)` carrier of D-2g.
- **The capability result-record channel** QD-1 option (a) leaves owing, without which
  `try { await api.get() } catch` stays unrepresentable.
- **`each`, `with`, `do`**; closures; classes; async; module imports.
- **The TS importer lane's canonicalization contract**, whose input contract is D-1b and whose
  obligation is D-1c.

## Open Questions

- **QD-1 — ANSWERED.** Option (a): `capability-error` stays an uncatchable `__Fault`; the census is
  unchanged; the capability slice owes the result-record channel. See D-2i.
- **QD-2 — DECIDED.** No second inventory transition; `kir-runtime/expression.ts` lands at ≈ 460 of
  500. Escape hatch pre-registered (`try-walk.ts`, 357 → 358) with its cut proven acyclic and
  marker-free.
- **QD-3 — ANSWERED, with a finding.** Every spent label gains a `spentBy` entry in the commit that
  emits it — **and** D.0's two not-emitted scans must be changed to iterate the *unspent* set, or the
  interlock is unsatisfiable. See the Blast Radius row for `reserved-labels.test.mjs`.
- **OQ-D1 — CLOSED, VERIFIED, and it went further than asked.** Measured 2026-09-08 by driving
  `projectKernModules` through rt2's own `handlerSource`/`project` harness against the **built**
  `dist` of the slice-C worktree `/Users/nicolascukas/KERN/.worktrees/kern-5-rt12-jumps` (read-only;
  nothing in it was modified). Results:
  - `throw value="{message: \"boom\"}"` → **`status: 'projected'`**, handler children `[throw, return]`,
    and the `throw` node carries `properties:[{key:'value'}]` whose canonical value is
    `expression('record', {entries: {message: expression('text', {value:'boom'})}})`. The two-key form
    `{message: …, code: …}` projects the same way with `entries` sorted `code`, `message`. So the
    record-literal channel is real end to end, and D-1b's key-set gate reads exactly that `entries`
    record.
  - A **text-literal** throw (`throw value="\"boom\""`) also projects — it comes back as
    `expression('text', …)`, i.e. the *linker* is the only thing that refuses it. That confirms
    `KIR_THROW_PAYLOAD_SHAPE` is reachable and is a link refusal, not a projection refusal.
  - **`try` projects too**, and the clause model this spec assumed is exactly right:
    `{kind:'try', props:[], children:[<body statements…>, {kind:'catch', props:['name'], children:[…]},
    {kind:'finally', props:[], children:[…]}]}`. `props: []` on `try` confirms D-6g (the
    body-statement shape carries no `name`). Also measured projecting: try **without** a catch (so
    `KIR_TRY_REQUIRES_CATCH` is a *link* refusal), `catch` with `props: []` (no binding), nested try,
    `catch{throw value="e"}` (rethrow), `for{try{assign, catch{continue}}}` and
    `try{for{break}}, catch{assign}` — the last two being D-4d1's importer shape.
  - **Hazard found, and it is not about `try`:** a bare `print` as the *only* statement of a nested
    block is **projection-rejected**. `while cond="false"` + `print` is rejected identically to
    `try` + `print`, while `while` + `if` + `print` (rt2's own probe idiom) and `try` + `assign`
    both project. That is why rt2's `while` probe wraps its `print` in an `if`. **Every D fixture and
    every new rt2 `PROBE_BODIES` entry must use the `assign`- or `if`-wrapped idiom**, or it will be
    RED for a reason that has nothing to do with the try family. This is the single most useful thing
    the measurement produced, and it would have cost a debugging cycle per fixture.
- **OQ-D2 (ASSUMED).** The metering integers in D-5c. Promotion: measure with a `checkpoints()`
  helper against the hand-counted twins in the same run and re-state them. rt11's `[RT11W-TD1]` and
  rt12's `[RT12J-TD9]` both went wrong here; a derived number goes RED against a *correct*
  implementation.
- **OQ-D3 (ASSUMED).** The `expression.ts` arm line estimate (~54). Promotion: measure after D2 and
  again after D5; the escape hatch is pre-registered so a miss costs a decision, not a redesign.
- **OQ-D4 (technical, low risk).** Whether any of `NEIGHBOUR_GOLDENS`' other three slices (`rt6`,
  `rt10-pre`, `rt10-cross-call-integer`) also move. rt11's `[RT11W-TD4]` is the precedent for a
  "complete" consumer list being incomplete by one. Promotion: re-hash all six after the cascade.

## Deploy Order

D is internal; there is no producer/consumer skew window. Merge order **C → D.0 → D**, strict and
one-way: D's `compileTry` lands in `statements.ts`, which does not exist before D.0, and D edits
seven of D.0's own oracle rows.

Within D, the order is forced by the digest chain and by the union:

1. **D1** source (linker, RT-1, driver, emitter, Python table) → local typecheck + the rt suites
   that do not scrape the union.
2. **D1** parity-ledger row + `THROW_ROW_POSITIONS` + the two dispatchers + exhaustiveness +
   `LEDGER_SHA256`.
3. **D1** golden cascade, in dependency order: rt2 golden (`linkedStatementKinds` + the new probe
   bodies) → rt3 golden's `rt2GoldenSha256` → rt4 probe matrix → the **7** `RT2_GOLDEN_SHA256`
   literals → the **6** `RT3_GOLDEN_SHA256` literals → rt9 golden → the **2** `RT9_GOLDEN_SHA256`
   literals → `NEIGHBOUR_GOLDENS`. Then **re-derive and verify** every historical pre-image
   (`[RT11W-O5]`).
4. **D1** `compiledCoreDigest` re-pin, **then** `pnpm write:kern-canonicalizer-coverage`, in that
   order.
5. **D1** D.0 pin edits (`pins.mjs`, `reserved-labels.test.mjs`, `diagnostics.test.mjs`,
   `behavior-preservation.test.mjs`) + the D1 oracle rows.
6. **D2** repeats steps 1–5 for `try` (the union moves a second time, so the cascade runs a second
   time). This is the one unavoidable double cascade; merging D1 and D2 into one commit would trade
   it for a commit whose RED surface cannot be attributed.
7. **D3**, **D4**: no union change, no golden change, no cascade.
8. **D5** *(gated)*: source + labels + the `spentBy` transition + the abort measurement of D-7f. If
   the gate fires, revert commit 5 wholesale and restore the four labels to unspent before merge.

Full local gate before push: `pnpm lint`, `pnpm typecheck`, `pnpm test:kern-5-script-family`,
`pnpm test:kern-canonicalizer`, `pnpm test:kern-runtime-contract-v1`, `pnpm test:kern-alpha-receipt`,
`pnpm test:kern-5-admission-census`, `pnpm test:infra:contracts`, `pnpm test:ci-contract`.

## Corrections Log

| Original claim | Reality | Impact |
|---|---|---|
| The uncaught-throw **diagnostic** carries the clamped label (tribunal §RECOMMENDATION) | `KernKirDiagnostic` has exactly three fields — `category`, `code`, `phase` (`kir-runtime/contracts.ts:81-85`) — and `failureEnvelope` reads only `cause.code`/`cause.phase` (`envelope.ts:34-50`). Surfacing a label means widening a frozen envelope shape | The label rides the `KernKirFault`/`__Fault` **message**, where every KIR label already rides: internal, test-observable, never in the envelope. The clamp and the JSON.stringify ban survive intact; the envelope shape does not move. D-3b |
| The 13th code is `USER_THROW` via RC-v1 amendment #4 (tribunal) | D.0 proved the mechanism inexecutable (C-6/C-7/C-8) and the coordinator ratified `'uncaught-throw'` with **no** amendment record | D inherits the ratified spelling. `USER_THROW` survives only as the name of the reservation |
| D.0 pins `BASE_KIR_TOKENS` at 39 and asserts the emitted set under `kir-runtime` equals it exactly | The live set is **40**: `KIR_JUMP_WITHOUT_LOOP_FRAME` (`kir-runtime/expression.ts:233,241`) arrived in `e1d94060`, which landed **after** D.0's pins were captured at `2c6f4abd` and is an ancestor of D.0's tip. Token scan 2026-09-08 → 40 | D.0's own row is **RED at base for a stale reason** and must be corrected in D.0's lane (39 → 40). D then re-pins again for its own labels. Flagged upward, not silently fixed here |
| `kir-runtime/expression.ts` is 402 lines with ~98 free (D.0 OQ-3) | **406** lines, **94** free — same `e1d94060` drift | The QD-2 budget is tighter by four lines. The decision does not change; the estimate table does |
| D.0's budget row says `statements.ts ≤ 340`, and D.0's headroom note says slice D takes it to ~415 | Both are in D.0's own document. The 415 projection violates the 340 row | D must raise `LINE_BUDGETS['statements.ts']` to **440**. If the measured file exceeds 440, the payload gate and the clause partition move to `link-support.ts` (budget 200, lands ~152) — which costs no new file and no inventory slot |
| D.0's QD-3 says a spent label needs only a `spentBy` entry | `reserved-labels.test.mjs`'s two not-emitted scans iterate `RESERVED_LABELS`, not `unspentLabels(value)`, so a correctly-spent label is RED regardless of `spentBy`. The helper `unspentLabels` exists in the same file and is used by the two adjacent rows | The interlock is unsatisfiable as written. D must change both loops to the unspent set — a required edit, not a re-pin |
| D shrinks the `STILL_OUTSIDE` lists (task brief: "→ `['each','set']` minus what D admits") | All three are **already** `['each','set']` (`rt10-for:63`, `rt11:75`, `rt12:72`). The try family was never in them | **No edit.** `with` and `do` were never in them either and stay outside by absence, not by assertion |
| rt12's reserved-label scan will catch the label being spent | It reads only `link.ts`, `linked-kir-program/contracts.ts` and `kir-runtime/contracts.ts` (`rt12/compatibility.test.mjs:157-166`). D spends the label in `statements.ts`, which is none of them, so the scan stays **GREEN vacuously** | A required, explicit flip of rt12's row from *absent* to *spent by slice D in `statements.ts`*. This is the `e105f1da` vacuity failure mode with a different marker |
| `statementSubBlocks` and `statementSubExpressions` each need a `try` arm | `statementSubExpressions`'s fallback is `return [statement.value]`, so **`throw` needs no arm at all** — but `try` has no `value`, so without an arm the fallback returns `[undefined]` and the capability closure walks a hole | One arm, not two, and on the *other* kind than expected. rt12's `[RT12J-TD5]` in a new place |
| `containsReturn` needs no change because the trailing-return rule is top-level-only | Two different rules: the top-level filter (`link.ts:607-613`) needs nothing, but `containsReturn` (`link.ts:152-162`) gates the **void** handler check and recurses only `for`/`while`/`if`. Without a `try` arm, a void handler with a `return` inside a `try` escapes `KIR_VOID_HANDLER_VALUE_RETURN` | A required source edit, a discriminating oracle row, **and** the one loudly-breaking prior-slice scrape (rt12 `walker-coverage.test.mjs:237-238`, kind list `['for','if','return','while']` → `['for','if','return','try','while']`) |
| The catch binding's type can be recorded in `LinkScope.types` | `LinkedKernKirStaticType` is `'boolean' \| 'integer'` (`contracts.ts:7`) and `LinkedKernKirCrossCallType` has no record member — neither channel can hold a record, and writing a wrong type there would make `staticExpressionType` lie | A third, purpose-built `LinkScope.payloads: Set<string>` holding catch bindings only. `LINKED_KIR_TYPE_ADMISSION` is untouched and `record` stays a non-parameter, non-return type. D-1b/D-1d |
| A ninth reserved label is needed for a stray `finally` | D.0's oracle `deepEqual`s `labels` against the pinned eight, and new **emitted** labels were never registry members — `KIR_JUMP_WITHOUT_LOOP_FRAME` is rt12's own precedent for a label that was never reserved | Four new emitted labels (`KIR_THROW_PAYLOAD_SHAPE`, `KIR_TRY_FAMILY_IN_HELPER`, `KIR_TRY_BODY_AFTER_CLAUSE`, `KIR_FINALLY_WITHOUT_TRY`), zero registry additions. D-6i |
| The ledger rows for `try`/`throw` are `blockedBy: ['while','break','continue']` (task brief) | There is no **lowering** dependency on the jump family; the only coupling is `KIR_LOOP_JUMP_CROSSES_TRY`, a **link-time refusal**. The validator only requires each `blockedBy` entry to name another present row (`ledger-support.mjs:117-123`) | `throw.blockedBy = []`, `try.blockedBy = ['throw']`. Honest ordering, and it keeps the catch-up slice from waiting on `while` |
| The generic `STATEMENT_POSITIONS` catalogue covers a new statement row | It is `for`-shaped and carries no `try`/`throw` node, so the Python compile **succeeds** and `assertNoPythonArtifact` fails — rt12's `[RT12J-TD11]` | Two purpose-built catalogues plus a wire-up in **both** dispatchers, and each omits `helper-body` because D-2h makes that position a *link* refusal. A `helper-body` row would have gone RED for the linker's reason, not the deferral's |
| `finally` lowers to a native JS `try{}finally{}` | Native `finally` runs on a `__Fault`, silently violating the one divergence the tribunal pinned (D-5d) | The `__efN` flag lowering (D-5e), with an outer guard so an envelope fault raised **inside the catch body** is also covered, and the finally body emitted exactly once |
| `__UserThrow` belongs in the JS kernel prelude | `TARGET_KERNEL_SHA256 = sha256(TARGET_BASE + TARGET_JSON + TARGET_HASH + TARGET_EXECUTION)` (`emitter.ts:23,25`); any kernel byte moves both kernel pins and every emitted-artifact digest in every rt suite | Conditional per-module emission from `specializedSource`. This single decision is what keeps D.0's fifteen behaviour-preservation fixtures GREEN and both kernel SHAs frozen. D-2b |
| The admission census gains files once `try` is admitted (7/240 use it) | Measured: all 7 are rejected at the **projection** stage (`projection-fatal` ×2, `F4_AUTHORITY_DRIFT`, `UNEXPECTED_TOKEN`, `FRONTEND_UNSUPPORTED_MODULE_ROOT`, `FRONTEND_EXCLUDED_HOST_EXPRESSION`, `F4_F2B_DRIFT`), and the census has **zero** `link`-stage rows | Admission gain is exactly **0**, `admittedCount` stays 1, `scripts/kern-5-admission-census/**` needs **no edit**. Measured for D rather than inherited from rt12 |
| RT2/RT3 digest literals live in 6 files each (rt12's spec) | Measured 2026-09-08: `RT2_GOLDEN_SHA256` in **7** (rt11 now carries it), `RT3_GOLDEN_SHA256` in **6**, `RT9_GOLDEN_SHA256` in **2** | One more file in the cascade than rt12's table says. The counts are re-measured, not copied |
| **Coordinator override, 2026-09-08 (ruling 1).** `break`/`continue` crossing **any** `try` boundary is a link refusal spending `KIR_LOOP_JUMP_CROSSES_TRY` — the tribunal's Q4 answer, rt12's `[RT12J-N4]`, and this spec's first revision | The refusal is correct **only** when the crossed `try` carries a `finally`, because that is the only case with something to run on the way out. `for { try { if (!ok) continue; … } catch { … } }` is the importer's hottest defensive loop, and an unconditional refusal prices a control-flow rewrite at every call site. Both legs are already correct without a finally: RT-1's bounded scan assigns `frames.length` and runs no per-frame code (`kir-runtime/expression.ts:229-244`), and a native JS jump out of a finally-less `try` is plain correct JavaScript (`emitter.ts:305-307`). Measured to project: `for{try{assign, catch{continue}}}` and `try{for{break}}, catch{assign}` | The mechanism changed shape and shrank: `tryDepth`/`loopTryDepth` are **replaced** by `finallyDepth`/`loopFinallyDepth`, counting only finally-bearing `try`s, and neither field is added until the finally commit. The refusal **moves from D4 to D5**, D4 becomes a pure admission commit, and if the D-7f gate cuts `finally` the label stays reserved and unspent (D-4f1). rt12's `[RT12J-N4]` takes a dated, text-only superseding note — no rt12 code, test or golden moves. rt12's reasoning survives verbatim and is precisely why the narrowed case still needs a refusal |
| `code` is simply an optional key: present or absent (this spec's first revision, D-1a) | An absent key has no type, so `e.code` would have needed optional-member semantics and a typing story the linked type system cannot express. **Coordinator ruling (2)**: the payload type is `{message: text, code: text \| null}` and the linker **inserts a literal null** when `code` is omitted | Every linked payload carries both keys, sorted. `e.code` never takes the missing-member path, so **no typing change is needed at all** — `member` is already statically untyped on both channels. The insertion is a *typing default on a conforming throw*, categorically distinct from canonicalization of a *non-conforming* throw, which stays forbidden (D-1c) and stays a refusal. Also forced a new admitted form: an explicit `code: null` |
| Rethrow is available wherever a payload is in scope | It is **lexical only**. A payload cannot reach a helper: `throw` in a helper body is refused (D-2h) **and** a record is not an admissible parameter type (`LINKED_KIR_TYPE_ADMISSION` has no `record` row), so helper-mediated rethrow is doubly impossible in D | Stated as an **importer-visible limitation** with two refusal rows rather than left implicit, and promoted to D2's top item (D-1f1) |
| Per-module `__UserThrow` might break `instanceof` across artifacts (Nero challenge 1) | **Not possible.** `emitJavaScriptEsm` is the single emit entrypoint (`kir-js-esm/index.ts:71`), emits one `function __module(){…}` (`emitter.ts:471-479`), and inlines **every helper into that same module** (`emitter.ts:375,430`); the artifact path is literal-typed `'entry.mjs'` (`contracts.ts:32`). There is no multi-artifact cross-call path in the linked-program pipeline | The nominal check is sound as specified. **No kernel-resident class, no kernel digest move.** Pinned as D-2b0 with a row asserting exactly one `class __UserThrow` per artifact, measured on a program that has a throw, a try *and* helpers |
| A `try` around `await helper()` could silently miscatch (Nero challenge 2) | It cannot: an async callee has no way to raise a user throw in D, because `throw` in a helper body is a link refusal. The absence is structural | Documented rather than defended: D-8 states plainly that a `catch` in D observes only throws lexically inside the same handler body, and D-8c adds the falsifier row (helper completes normally → try body completes, catch not entered) |
| The RC-v1 diagnostic code set might be a closed set D cannot spend into (Nero challenge 4) | **Rejected on D.0's evidence.** C-6: the amendment chain governs four artifacts, not the KIR union — proven by each set already carrying codes the other lacks. C-7: a zero-drift record self-cycles. C-8: `runtime-handler-public-declaration.mjs:147-152` equates the constitution with the **public runtime-handler** union, and `uncaught-throw` is already in both with golden `failure-uncaught-throw` | Cited as D-3g1 instead of re-derived, and backed by D-3g2: D's oracle **runs** `check-runtime-contract-v1.mjs`, `check-runtime-envelope.mjs` and `check-rule-coverage.mjs`, so a surprise fails at oracle time rather than CI time |
| **OQ-D1 was the confidence cap: whether a record literal survives the F5 frontend parser** | **Measured and closed.** `throw value="{message: \"boom\"}"` projects, carrying `expression('record',{entries:{message: expression('text',…)}})`; `try` projects with `catch`/`finally` as **child clauses** and `props: []` on the `try` itself, confirming both the payload channel and the whole clause model. Ten shapes measured, all projecting | Two ASSUMED rows promoted to VERIFIED, the clause-partition design confirmed rather than hoped, and a real hazard found: **a bare `print` alone in a nested block is projection-rejected** (`while` + bare `print` fails identically), so every D fixture must use the `assign`/`if`-wrapped idiom rt2 already uses |
| D.0's spec locates rt12's `containsReturn`/`assertLeaf` scrape at `walker-coverage.test.mjs:237-238` | It is at **`:357-370`** (measured 2026-09-08). Every marker *string* is unchanged, so the citation drift is inert — but the assertion is stricter than expected: the test is titled *"keeps exactly its **four** block-owning arms"* and its comment argues that an arm for a childless kind would be dead code | The title changes with the list, and the same comment is the authority for `throw` getting **no** `containsReturn` arm. Both are oracle rows, not just re-pins |
| Adding `throw`/`try` to the Python lowering table is a table-only edit | `statementDeferral` (`kir-python/request.ts:104-139`) binds `const exhaustive: never = statement` in its `default:`, so **tsc fails** unless the switch itself names every union member — even though the function short-circuits on `'deferred'` at its first line and the new arms are unreachable | Two unreachable-but-required `case` arms, grouped with `break`/`continue`. Caught by reading, not by a failed build (the brief forbids building) |
| `throw` needs its own diagnostic-code or completion-kind widening | `'uncaught-throw'` is already D.0's 13th KIR code **and** a frozen RC-v1 public code with the golden behaviour `failure-uncaught-throw`, and `runtime-envelope/normalize.ts:122` is already a live producer | Zero public-vocabulary growth in D. The KIR envelope *converges* on the frozen public spelling rather than forking one |

### Corrections found while writing the oracle (2026-09-08, base `071e5df9`)

Every row below was measured against the rebase target, not deduced. Each carries the oracle's ruling.

| Original claim | Reality | Ruling / impact |
|---|---|---|
| **QD-4.** rt12's reserved-label scan "reads only `LINK_URL`, `CONTRACTS_URL`, `LIMITS_URL` … left alone it stays **GREEN vacuously**" (Blast Radius, Corrections Log) | The scan at `scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs:156-168` walks **every** `.ts` file under `packages/core/src/kir-runtime/` recursively (`readdir(KIR_RUNTIME_URL, {recursive: true})`), `statements.ts` included. There is **no `LINK_URL` constant in that file at all**. The scan is already complete and will break **loudly** the moment D spends the label — the exact opposite of the predicted vacuity | **Retire, do not widen.** The absence assertion is replaced by a spend assertion; no scan widening is owed. Oracle row: `reserved-labels.test.mjs`, *"rt12 own cross-try scan is retired rather than widened, because it was already complete"*, which branches on whether `finally` landed so the D-7f gate cannot strand it |
| `KIR_LOOP_JUMP_CROSSES_TRY` is reachable through `for { try{…}finally{…} }` (acceptance criteria, *Control flow*) | **Measured: that shape is projection-rejected.** F5's `for` and `while` `allowedChildren` exclude `finally`, so a finally-bearing `try` cannot sit directly in a loop body. `for`+`try`+`catch`+`finally`, `while`+`try`+`catch`+`finally` and `for`+`try`+`finally` all come back `rejected`. An `if` branch **does** admit `finally`, so `for { if { try{break} catch finally } }` projects | The refusal is reachable **only** through the if-wrapped shape. Every cross-try and abrupt-finally-in-loop fixture uses it; the direct shapes become F5 fence rows. This is OQ-D1's print hazard in a more dangerous place: the spec's own shape would have gone RED at projection and the override would have been "proven" by an unreachable gate |
| A `catch` inside another `catch` refuses with `KIR_CATCH_WITHOUT_TRY`, "in all **four** positions (F5 projects every one of them)" | **Measured: catch-in-catch is projection-rejected.** The other three — handler top level, `for` body, `while` body — project with zero diagnostics | **Three** reachable positions, not four. Catch-in-catch moves to the fence table as `fence-catch-in-catch` |
| A `step` or `handler` child of a body-statement `try` reaches `compileStatement` and refuses with `statement kind step is outside RT-1` (D-6g) | **Measured: projection-rejected with `UNEXPECTED_TOKEN`.** The linker never sees it | F5 owns the refusal. Moved to the fence table; D-6g's second half is unreachable and is asserted at the frontend instead |
| A typed `catch` refuses at link with `unsupported property set`, because `compileCatch` calls `propertySet(properties, [], ['name'], label)` (D-4j) | **Measured: projection-rejected with `FRONTEND_EXCLUDED_HOST_TYPE`.** F5's `excluded-host-type` disposition fires first | F5 owns it. Moved to the fence table; the `propertySet` call is still correct, just never reached by this shape |
| **QD-3's finding:** `reserved-labels.test.mjs`'s two not-emitted scans iterate `RESERVED_LABELS`, not `unspentLabels(value)`, so "the interlock is unsatisfiable as written" and both loops are a required D edit | At the rebase target both scans already call `unspentLabels(registry())` (`:87`, `:102`). D.0's implementation landed the fix after the spec's base snapshot | **No such edit is owed.** QD-3's interlock is satisfiable as written. D still moves the *lands-unspent* row (`:59`), which is a genuine and separate obligation |
| The D.0 pin values in the Corrections Log (`BASE_KIR_TOKENS` 39, `LINE_BUDGETS['statements.ts']` 340, `RUNTIME_FAULT_SITES['expression.ts']` 20, `FAULT_CENSUS_TOTALS.runtime` 53) | Measured at `071e5df9`: **40**, **420**, **22**, **55**. D.0's implementation corrected all four after the spec's base snapshot at `87ca7874` | D's pins are re-measured against the merge target, never inherited from the spec's table. `statements.ts` is raised 420 → **440**, not 340 → 440 |
| `BASE_KIR_TOKENS` "moves from 39 to 40 **+ 8** … = **48**" | Recount: with `finally` landing, **eleven** labels arrive — seven reserved spent (`KIR_TRY_REQUIRES_CATCH_OR_FINALLY`, `KIR_CATCH_WITHOUT_TRY`, `KIR_DUPLICATE_CATCH`, `KIR_LOOP_JUMP_CROSSES_TRY`, `KIR_ABRUPT_FINALLY_UNSUPPORTED`, `KIR_DUPLICATE_FINALLY`, `KIR_CATCH_AFTER_FINALLY`) plus four new emitted — so **51**, not 48. With the gate firing, six arrive → **46** | The target token **list** is pinned explicitly in `pins.mjs`, so the count is a consequence rather than a claim. Both configurations are pinned and the oracle branches on `spentBy` |
| **D-2j.** Both new runtime fault sites carry `uncaught-throw`: `expression.ts` 20 → 21 and `execute.ts` 11 → 12 | Internally inconsistent with D-2c: on RT-1 an uncaught throw is a walk **completion**, so `expression.ts` raises no `uncaught-throw` fault at all. And D-2f demands **two** `KIR_TRY_FAMILY_IN_HELPER` sites, one per driver | **Ruled:** `expression.ts` **+1** (callHelper's `'threw'` fail-closed arm, D-2f(i)); `execute.ts` **+2** (the uncaught-throw conversion at the entry walk, plus the popped-helper-frame fail-closed arm, D-2f(ii)); `emitter.ts` **+1**. Totals: runtime 55 → **58**, javascript 39 → **40**, python unchanged. Recorded in `pins.mjs` as `RUNTIME_FAULT_SITE_DELTA` with the derivation |
| **D-5c.** `try{throw p}catch{leaf}` − `let p; leaf` = **4** | Hand-counted against the RT-1 walk: the fixture pays try boundary (1) + entered try body (1) + throw boundary (1) + entered catch body (1) + the catch's own leaf (1) = 5; the twin pays `let` (1) + leaf (1) = 2. The difference is **3**. The spec double-counts the payload | **3**, with the twin's `let` carrying the same payload record so the record's own charge cancels. The other three predictions hold: `try{leaf}` − `leaf` = 2, the 3-trip loop = 6, `finally` = 2 |
| `emitter.ts` is an ordinary licensed edit (Blast Radius) | It is **481 lines against the 500-line doctrine ceiling**, and D adds two `blockSource` arms plus the conditional `__UserThrow`/`__throwLabel` prelude and the uncaught-conversion catch. It cannot fit | D owes `emitter.ts` an extraction the spec never scheduled. The budget is pinned **at** the ceiling so the breach lands in D's own oracle rather than in `pnpm lint` |
| `scripts/kern-5-parity-ledger/support.mjs` needs **no edit** (absent from the Blast Radius) | Its recomputed oracle walker visits statement children by field name (`body`, `thenBranch`, `elseBranch`, …). Without `catchBody`/`finallyBody` a deferred kind nested inside a try clause is **invisible** to `pythonDeferral`, so a `throw` inside a `try` body would compile to Python | **Required edit**, with its own oracle row in `python-deferral.test.mjs`: *"the ledger own recomputed walker visits the try clause blocks, so a nested throw is not missed"* |
| `scripts/kern-5-d0-contracts-split/wiring.test.mjs` needs only **verify GREEN**, and "picks up D's own evidence leaf" | Its aggregate row asserts `family.at(-1)` is the D.0 leaf — *"D.0 depends on every prior slice, so it runs **last**"*. Appending D's leaf turns it RED. **Measured, not predicted: it fired on the first neighbour run**, with `D0_AGGREGATE: D.0 depends on every prior slice, so it runs last` | **Required edit.** The invariant was never "last" but "after every prior slice", so the row becomes *before its declared successors only*, with a `SUCCESSOR_LEAVES` list naming `test:kern-5-d-linked-try`. D's own oracle pins the move (`commit-rows.test.mjs`, *"the D.0 aggregate row has been moved from last to before its declared successors"*) so the next slice inherits the same interlock rather than rediscovering it |
| **D-7f's measurement command** is `node --test --test-reporter=tap scripts/kern-5-d-linked-try/` | Node 22 resolves a bare directory as a module path and dies with `MODULE_NOT_FOUND`. The command as written produces no rows | The measurement passes the oracle files explicitly (`readdirSync` → one argument each). Same rows, a command that runs. Implemented in `commit-rows.test.mjs` |
| **D-4c.** `containsReturn` recurses only `for`/`while`/`if`, so it needs a `try` arm or a void handler with a `return` inside a `try` escapes `KIR_VOID_HANDLER_VALUE_RETURN` — "a required source edit, a discriminating oracle row, **and** the one loudly-breaking prior-slice scrape" | **Obsolete, and it went obsolete underneath this work.** D.0's `9f366f0b` (*single-source closureWalk's type and containsReturn's traversal*) landed on `feat/kern-5-d0-contracts-split` after the rebase and re-pointed `containsReturn` at `statementSubBlocks`: it is now `statement.kind === 'return' \|\| statementSubBlocks(statement).some(containsReturn)` and names no block-owning kind of its own. The `try` arm D already owes `statementSubBlocks` for D-6e therefore gives `containsReturn` its recursion **for free** | **One edit, not two.** D-4c requires no `link-support.ts` change at all. The loudly-breaking scrape also *relocated*: rt12 now pins `containsReturn` to exactly `['return']` and `statementSubBlocks` to `['for','if','while']` with the message *"must not learn a kind that owns no block"* — so the list D moves is **`['for','if','try','while']`**, not the five-kind `containsReturn` list the spec predicted. Two oracle rows were rewritten accordingly: one now holds the delegation (**GREEN at base**, so a later slice cannot silently re-inline a kind and reopen the hazard), the other moves rt12's real pin. The behavioural falsifier is untouched and still discriminating: `neg-void-return-in-try` must refuse with `KIR_VOID_HANDLER_VALUE_RETURN` |
| The D-7f self-drive would work once written — it parses TAP from a nested `node --test` | **Two defects, both found by running it rather than reasoning about it.** (a) `node --test` exports `NODE_TEST_CONTEXT=child-v8` into every test file it runs; inherited by the nested runner it switches the child onto the v8 serializer protocol, so **nothing reaches stdout** and the drive reported `D_MEASUREMENT_FAILED: the self-drive produced no TAP output`. (b) A skipped row's TAP line carries a trailing `# SKIP <reason>` directive, which the name regex swallowed — so the mapping recorded `…named exactly once # SKIP set D_MEASURE_ROWS=1 …` as a *row name*, and would have matched only by coincidence, because the child happens to skip for the same reason | Both fixed: the child environment drops `NODE_TEST_CONTEXT`, and the parser strips a trailing `SKIP`/`TODO` directive before recording a name. Re-run with both fixes, the totality row **passes**: all 216 rows the suite runs are named by exactly one commit tag, with none stale. This is the row that would otherwise have been GREEN on an accident and is why the drive was executed rather than trusted |
| The acceptance criteria carry IDs a coverage row can grep against test titles (task brief) | They are unlabelled `- [ ]` bullets under bold group headings. There is no ID to grep | The coverage row pins the **criteria count** and the **group headings**, and asserts every group is claimed by at least one oracle file — the strongest honest substitute. `commit-rows.json` carries `criteriaCount` and `groups` |

### Corrections found while implementing (2026-09-08, base `24bbed72`)

Every row below was measured against the implementation, not deduced. Each names the oracle row it
moved and the evidence that moved it.

| Original claim | Reality | Ruling / impact |
|---|---|---|
| **QD-2's escape hatch was taken.** The stalled builder extracted `TryTrap`, `findTrapFrame` and `clampThrowLabel` into `packages/core/src/kir-runtime/try-walk.ts`, opened the 357 → 358 head-stage transition, and raised D's own `COMPILED_CORE_COUNT` pin to 358 | The escape is **not available**: `fault-carrier.test.mjs`'s *"no JSON.stringify is reachable from the label path"* row asserts `clampThrowLabel` is declared **in `kir-runtime/expression.ts`** (`indexOf('function clampThrowLabel')` on that file), and `compatibility.test.mjs`'s inventory row pins `COMPILED_CORE_COUNT` with the message *"D must open no head-stage transition; the QD-2 escape hatch was not taken"*. Raising the pin to 358 is weakening a row, not satisfying it | **Escape reverted.** `try-walk.ts`, `d-linked-try-historical-transition.{mjs,test.mjs}`, the `coverage-dependencies.mjs` re-wire and the `coverage-integrity.test.mjs` `omitted` entry are all removed; `COMPILED_CORE_COUNT` is back to **357**. `kir-runtime/expression.ts` lands at **468** of its 470 headroom with `TryTrap` collapsed to `Extract<LinkedKernKirStatement, {kind:'try'}>` — the try statement is its own trap record — so no second inventory transition is opened and QD-2's primary decision stands |
| **D-6f.** Clause partition: *"the try body is `children[0 .. firstClauseIndex)`; from the first clause on, only clause nodes are admitted"*, and OQ-D1 recorded `try` projecting as `{kind:'try', children:[<body…>, {kind:'catch'…}]}` | **Measured: F5 admits a clause BOTH ways.** In the fixtures' own idiom (`tryCatch()`) the `catch` is a **following sibling** of the `try` at the same indentation, exactly as `else` is a sibling of `if`; indenting the clause **under** the `try` also projects, as a child. Both shapes are legal, so the partition must run over the concatenation — and a clause that follows a **nested** `try` inside the body belongs to that try, not the outer one (`try-nested` refused with `KIR_DUPLICATE_CATCH` under a naive first-clause scan) | `compileTry` takes the sibling clauses from `compileBlock` **and** partitions its own children with a one-pass claim scan (`claimed = kind === 'try'`), so a clause is only this try's when no nested `try` or clause immediately precedes it. Consequence: **`KIR_TRY_BODY_AFTER_CLAUSE` is reachable only through the nested-clause shape** — as a sibling, a statement after the clause is simply the next statement of the enclosing block, which `try-catch`'s own trailing `return` depends on. Oracle row `neg-try-body-after-clause` re-shaped to the nested form (it previously carried the sibling form **and no trailing return**, so it refused with *expected exactly one final return* and the label was unreachable) |
| **Reading the payload.** `try-catch-reads-message` / `try-catch-reads-code` / `try-catch-reads-missing` assign `e.message` into a text-typed `let` | RT-9's pre-existing assign gate refuses it: `KIR_ASSIGN_TYPE_MISMATCH out`, because `member` is untyped on **both** channels (D-1a2, which the spec forbids changing) while the target `let` records `text`. No implementation consistent with D-1a2 can admit that fixture | Three fixtures re-shaped to `return value="e.message"` from inside the catch, with the unreachable trailing top-level return D-4b already requires. The rows now read the payload with **no typing change at all**, which is what D-1a2 actually pins, and `behavior.test.mjs` observes `{tag:'text', value:'boom'}` and `'E1'` in the envelope on both legs |
| **OQ-D2 metering, `try{throw p}catch{leaf}` − `let p; leaf` = 3** (the spec's own Corrections Log, re-derived from 4 on the claim that *"the payload record's charge cancels because the twin's `let` carries the same record"*) | **Measured 13 against 9: the difference is 4.** The cancellation does not hold, and D-1a1 is why: the linker **inserts `code: null`**, so the fixture's payload is a two-entry record paying three `evaluateExpression` charges where the twin's written one-entry record pays two. Site census from an instrumented `RuntimeMeter`: statement boundaries 5 vs 4, entered try body 1, entered catch body 1, `evaluateExpression` 6 vs 5 | Pin re-stated to **4** with the derivation in the row's own comment. The twin was left alone on purpose: making it write `code: null` would have restored the integer 3 by tuning the twin to the pin |
| **OQ-D2 metering, `try{leaf}finally{leaf}` − `try{leaf}` = 2** (*"entered finally body (1) + the finally's own leaf (1)"*) | **Measured 11 against 8: the difference is 3.** A leaf `assign` costs **two** charges, not one — its statement boundary plus its value expression (`evaluateExpression` charges on entry). Site census: statement boundaries 5 vs 4, entered finally body 1 vs 0, `evaluateExpression` 4 vs 3 | Pin re-stated to **3** with the derivation. The other two predictions (`try{leaf}` − `leaf` = 2 and the 3-trip loop = 6) were measured correct and unmoved |
| `metering.test.mjs` and `finally.test.mjs` drive a timeout with `control: {preCancelled: false, timeoutMs: 0}` | `inspect.ts:264-269` refuses a `timeoutMs` below **1** (*"expected null or positive timer delay"*), so both rows got `invalid-handler-arguments` instead of `execution-timeout` and never reached the try at all | Both rows use `timeoutMs: 1`, the r1 precedent (`review-regressions.test.mjs:90`). Measured 12/12 runs → `execution-timeout`; link and setup alone exceed 1ms, so the deadline is deterministic here |
| `walker-coverage.test.mjs` drives the capability closure walk as `const walk = createLinkedKirClosureWalk(); walk([statement])` | `createLinkedKirClosureWalk()` returns the walk **state** (`{active, cycles, done, visits}`), not a function (`walkers.ts:13-15`). The row failed with *"walk is not a function"* for every possible implementation | The row drives `linkedStatementsInvokeCapability([statement], undefined, walk)`, the walker that consumes that state. It now genuinely traverses a hand-built `try` and reaches its clause bodies |
| `walker-coverage.test.mjs` reads the artifact path as `artifact.manifest.artifact.path` | `compileKernKirToJavaScriptEsm` returns `{artifact: {path:'entry.mjs', …}, manifest: {path:'manifest.json', …}}` (`kir-js-esm/index.ts:86`); the manifest carries no nested `artifact` | `tryArtifact` surfaces `path: javascript.artifact.path` and the row asserts `artifact.path === 'entry.mjs'`. D-2b0's one-artifact claim is measured rather than crashed |
| `walker-coverage.test.mjs` pins `occurrencesOf(text, 'extends __Fault') === 1` | The kernel spells `class __Fault extends Error`; the token `extends __Fault` occurs **nowhere**. The row's own message (*"`__UserThrow` must never extend `__Fault`"*) and the acceptance criterion (*"**zero** `extends __Fault`"*) both argue for **0** | Pin corrected to **0**, matching the criterion the row exists to hold |
| `finally.test.mjs` matches the emitted finally body with `/=\{tag:'integer',value:'3'\}/` | The emitter spells a literal `Object.freeze({tag:"integer",value:"3"})` — `canonicalJson` double quotes, wrapped in `Object.freeze` (base behaviour D does not touch). The regex matched **zero** occurrences, so *"emitted exactly once"* passed on nothing | Regex corrected to the emitter's actual spelling. Measured: exactly one occurrence in `try-finally`, so the `__efN` guard really does buy one emission |
| Both not-emitted scans (`reserved-labels.test.mjs` in D's suite and in D.0's) test `source.includes(label)` | `KIR_TRY_REQUIRES_CATCH` is a **prefix** of the emitted `KIR_TRY_REQUIRES_CATCH_OR_FINALLY`, so once D5 lands the unspent label reads as emitted no matter how the linker is written. The row was unsatisfiable | Both scans match **whole tokens** through the file's own `LABEL_PATTERN` and test set membership. The adjacent vocabulary rows already did exactly that, so this restores the intent rather than changing it |
| `__UserThrow` is emitted from `specializedSource` as `` `\n  ${userThrowSource}\n  const __runSpecialized=` `` | With no throw or try, `userThrowSource` is `''` but the template still emitted an indented blank line, so **every** emitted artifact moved by two bytes: rt4's five call-free digests, rt5's, and rt6's build golden all went RED. Conditional emission was conditional in content only, not in bytes | The prelude carries its own leading newline and the template interpolates it directly, so a program without the try family emits **byte-identically** to base. This is the row that would otherwise have silently broken D.0's fifteen behaviour-preservation fixtures |
| The uncaught conversion at the emitted boundary reads `error instanceof __UserThrow` | That made **two** `instanceof __UserThrow` occurrences for a one-catch program, against the acceptance criterion's *"one `instanceof __UserThrow` **per `catch` clause**"* | The catch-clause guard keeps `instanceof` (D-2a); the two non-clause discriminations — the boundary conversion and the `__efN` outer guard — use `error?.constructor===__UserThrow`, the same nominal identity test without the counted token. No field check against a fault code is introduced |
| `scripts/kern-5-parity-ledger/ledger-schema.test.mjs` needs **no edit** — *"its row-count assertions run against synthetic documents it builds itself"* (Blast Radius, tagged *verify, do not assume*) | Measured: `:54-79` `deepEqual`s `ledgerRows()` against a **hard-coded three-row literal** | **Required edit.** The literal gains the `throw` and `try` rows. The verify-do-not-assume tag is what caught it |
| `scripts/kern-5-d0-contracts-split/pins.mjs` — *"`RUNTIME_FAULT_SITES` `expression.ts` 20 → 21 … `JAVASCRIPT_FAULT_SITES` `emitter.ts` 24 → 25; `FAULT_CENSUS_TOTALS` and the two fault code sets gain `'uncaught-throw'`"* (Blast Radius) | Moving D.0's pins **double-counts**: D's own `fault-carrier.test.mjs` computes `withDelta(RUNTIME_FAULT_SITES, RUNTIME_FAULT_SITE_DELTA)`, so D.0's pins must stay the pre-D baseline | D.0's pins keep their values; D.0's own four census rows move instead, importing `RUNTIME_FAULT_SITE_DELTA` / `JAVASCRIPT_FAULT_SITE_DELTA` / `UNCAUGHT_THROW_CODE` from D's pins so the delta and its derivation stay single-sourced. A new row asserts the delta adds **no new fault-bearing file**, only sites in files the census already names. `LINE_BUDGETS['statements.ts']` **is** raised, 420 → 440, as the Blast Radius says |
| D.0's *"the emitted KIR label vocabulary is the pinned forty"* row simply re-pins | Re-pinning it to 51 would restate what D's own recounted token list already asserts, and would go stale on the next slice | D.0's row moves to an invariant instead: every token D.0 pinned is still emitted, and every reserved token added carries a `spentBy` entry. D's own `reserved-labels.test.mjs` keeps the exact recounted list |
| The acceptance criteria are scraped as `/^- \[ \] (.*)$/` | Ticking the boxes on completion would take the scraped criteria count to **zero** and fail the row's own *"must carry unchecked criteria"* guard — the spec could never be marked implemented without breaking its oracle | The scrape accepts `- [ ]` or `- [x]`. The pinned `criteriaCount` (**58**) and the ten group headings are unchanged, so the row keeps its whole assertion while the spec can record completion |
| `scripts/kern-5-rt12-linked-jumps/python-deferral.test.mjs` needs **no edit** (absent from the Blast Radius) | Measured: `:66-72` `deepEqual`s the ledger's `nodeKind` list against the literal `['break','continue','while']`, so appending two rows sorted between `continue` and `while` turns it RED | **Required edit.** The row keeps the property rt12 actually owns — its own two rows are present, the document stays in `nodeKind` order, and `break` and `continue` sort ahead of the `while` row they are blocked by — instead of pinning a closed three-row list that every later slice has to re-open |
| **Commit plan D1 → D2 → D3 → D4 → D5, each independently green** | The stalled builder left a single interleaved working tree: `throw` and `try` share `compileTry`'s clause partition, one `settle()` routine in the RT-1 walk serves the throw, return and finally paths, and one `blockSource` arm carries both. Splitting it into five feature commits would mean re-implementing the slice twice and running the union digest cascade twice more, and no prefix of D1–D4 can be green on a 216-row oracle that covers D5 | **Recorded deviation.** The slice lands as **five commits along the Deploy Order's own stages** (source → parity ledger → golden cascade → prior-slice pin moves → oracle corrections and spec), which preserves the deploy order exactly and the feature order as far as an interleaved tree allows. The commit-tag attribution the plan wanted survives in `commit-rows.json`, which the D-7f self-drive proves total and disjoint over all 216 rows |

### Corrections found in six-engine review (2026-09-08, reviewed at `8f8e1d0c`)

Every row carries the oracle row that was RED before the fix and GREEN after, or -- for the vacuity
rows, where the implementation was already correct and only the assertion was hollow -- the mutation
that kills the new row and left the old one alive.

| Original claim | Reality | Ruling / impact |
|---|---|---|
| **BLOCKER.** A `return` inside a finally-bearing `try` lowers to the ordinary `returnSource`, so `finally` runs on the way out and the legs agree (D-7b, and the GREEN row `try-finally-return-in-body`) | **Measured: the legs diverge whenever the finally commits an event.** The emitted `returnSource` builds the whole success envelope at the return site — `Object.freeze(__events)`, the `__successBytes` maxBytes check, the envelope object — and only *then* does the native `finally` run. A `finally` that prints therefore pushed onto a frozen array and the leg failed `handler-link-error` where RT-1 returned 5 with the event. The existing row missed it because its finally body was an `assign`, which commits nothing | **Fixed in the emitter.** A finally-bearing `try` is emitted as a labeled block `__tN: { … }` and the try/catch bodies get a returnSource that lowers `return X` to `{__rN=X; __hN=true; break __tN;}`; the native finally runs on the labeled break, and the real return is emitted *after* the block. Nested finally-bearing trys compose because the inner block's post-cleanup return is itself lowered through the outer try's deferral. The change is confined to the `finallyBody !== undefined` branch, so no artifact without a `finally` moves a byte. Three rows, all RED at base: *"a return crossing a finally builds the envelope after the cleanup, with the cleanup event kept"*, *"a finally event is charged against maxBytes on both legs, not emitted past it"* (measured against its print-free twin in the same run — 344 against 321 — rather than pinned to a magic limit), *"a return from the innermost body runs both finally bodies in order before the envelope"* |
| **BLOCKER.** D-1b's payload gate types `message` as `text` and `code` as `text \| null` | The landed `typed()` predicate accepted a null literal for **either** key, so `throw value="{message: null}"` linked. Worse than a shape leak: RT-1's `clampThrowLabel` returned `''`, while the emitted `__throwLabel` read `.value` off `undefined` and threw a raw `TypeError` that **escaped the envelope and killed the host process** | Two gates, both fail-closed. The linker splits the predicate — `text()` for `message`, null admitted only for `code` — and the emitted `__throwLabel` gains the same `message?.tag!=='text'` guard `clampThrowLabel` already had, so neither helper can be reached with a non-text message even by a hand-built payload. Rows RED at base: `neg-throw-null-message` (type-gate) and *"both label helpers fail closed on a non-text message rather than reading through it"* |
| The two abort rows are titled *"on both legs"* | They executed **RT-1 only**: neither called `executeJavaScriptChild`, so the emitted leg's abort path was asserted by the title and by nothing else | Both rows now drive both legs with the same `control` and assert both envelopes. The timeout row needed a new fixture, `try-catch-slow-loop`: RT-1 creates its deadline before linking while the emitted module creates its own inside `execute()`, so a leaf-sized body finishes inside a 1 ms window on the emitted leg and only RT-1 would ever fail. `maxSteps` is raised for that request so the deadline is the only limit that can fire. Measured 6/6 deterministic on both legs. **Finding:** the emitted leg's timeout is produced by the kernel boundary in `target-execution.ts`, not by emitted specialized code — mutating the emitted `__checkAbort` code or dropping its `__deadline.check()` does not move the row, which is D-5d's "kernel-owned" property showing up as a measurement |
| *"a capability-error raised inside a try with a catch stays an uncatchable fault on both legs"* | The row's provider **succeeded**, so the failure it observed was the uncaught throw. It exercised no capability fault at all and would have passed with the nominal guard deleted | The row is kept under the honest title *"a resolved capability before an uncaught throw leaves the throw as the failing code"*, and two new rows drive the real fault through a provider that throws: `failingProvider` on RT-1 and a new `capabilityFails` driver option on the emitted leg (default off, so no existing row moves). **Mutation evidence:** replacing the emitted guard `if(!(__e instanceof __UserThrow))throw __e;` with `if(false)throw __e;` kills both new rows and leaves every pre-existing row green |
| *"a print and a capability committed before an uncaught throw both survive"* | The fixture committed a **print only** | New fixture `throw-uncaught-after-print-and-capability`; the row asserts both event kinds, in order (`['stdout','capability']`), on both legs |
| F5's `try` `allowedChildren` admits `capability` | **Measured: it does not.** A bare `capability` in a try body is projection-rejected; only the `if`-wrapped shape reaches the linker | Both capability fixtures use the guarded shape. This is OQ-D1's bare-`print` hazard in a third place, and the third time it has cost a fixture — recorded here so the next slice wraps by default |
| `emitter.ts` had 5 lines of headroom under the 500-line doctrine ceiling | The deferred-return machinery does not fit: the file reached **505** | `typeSource` moves to `request.ts`, joining the source-literal family (`jsString`, `encodedText`, `valueSource`, `dataSource`) that the first extraction already put there. It carries no `new __Fault(` and no `instanceof KernKirFault`, so neither census moves, and it emits the same text, so no artifact moves. `emitter.ts` lands at **495**, `request.ts` at **130** against its own headroom |
| Spec prose, four places | D-4d read as *"no new machinery"* while D-4f1 added two scope fields; the `BASE_KIR_TOKENS` paragraph quoted 43, 46 and 48 from three arithmetics; D-2j still described `uncaught-throw` fault sites in `expression.ts` that the oracle-time ruling had already deleted; and the header recorded no landed commits | D-4e states plainly that a finally-*less* crossing needs no field and that `finallyDepth`/`loopFinallyDepth` exist only to refuse a crossing of a finally-*bearing* try, both landed here. The token paragraph carries the single landed value, **51**, and cites `pins.mjs` `TARGET_KIR_TOKENS_WITH_FINALLY` as the authority. D-2j names the ruled delta (`expression.ts` +1 carrying `KIR_TRY_FAMILY_IN_HELPER`, `execute.ts` +2, `emitter.ts` +1). The header lists the five implementation commits, the deploy-order deviation, and that `finally` landed with the measured gate integers. New rows D-7d1 (no `spentBy` entry may resolve to null, asserted on the values directly) and D-8e (a TS catch handler reading the envelope sees no user-throw label; it rides the fault message and the catch binding only) |
| **REFUTED and left alone**, recorded so they are not re-raised | The `compileTry` meter charge (`compileStatement` charges every statement, so the visitor adds none), `containsReturn` (already delegated to `statementSubBlocks` by D.0's `9f366f0b`), `clampThrowLabel`'s location (pinned to `kir-runtime/expression.ts` by the fault-carrier row), and `tryFamily` on `LinkScope` (the scope flag, not the node kind, is D-2h's discriminator) | No change. Four of the six engines' remaining findings resolve to these |

### Corrections found in the Codex re-check of the review fixes (2026-09-09, re-checked at `8ddfef6b`)

| Original claim | Reality | Ruling / impact |
|---|---|---|
| **BLOCKER.** The deferred-return fix charges the same number of steps as RT-1, so the legs agree | **Measured: the same total, a different ORDER, and that diverges the failure envelope.** `defer` emitted no `__meter.step(); __checkAbort();` at the return site — the charge lived in the post-block `returnSource(slot)`, *after* the finally — while RT-1 charges the return statement when it reaches it, *before* `settle()` runs the cleanup. At `maxSteps` one under RT-1's own execution count the legs split: RT-1 `runtime-limit-exceeded` with `events=[]`, the emitted leg `runtime-limit-exceeded` with `events=[cleanup]`. Same code, different envelope | **Fixed.** `defer` charges the boundary at the return site, and `returnSource` gains a `charged` parameter so the post-block half emits the envelope without a second charge. Order and count now both match RT-1. Row RED at base: *"a deferred return charges its boundary before the cleanup, so both legs starve identically"* — it pins success with the cleanup event at RT-1's count, and one step under, the same diagnostic on both legs with **no** event on either. The three metering twins are unmoved, so nothing double-charges |
| The cancellation row proves an in-try abort bypasses the catch | It used `control.preCancelled`, which `execute.ts` and the emitted boundary both reject **before the handler is entered** — the row never reached a try body at all, and would have passed with the try family deleted | Driven from inside the try instead: a new fixture `try-catch-cancel-in-body` whose guarded capability is the one statement that hands control back to the host mid-body, plus `abortingProvider` (RT-1) and a new `abortOnCapability` driver option (emitted leg, default off) that abort the shared signal from inside `invoke`. Both legs: `execution-cancelled`, `events` exactly `['stdout']` — proving the body *was* entered — and `result` absent, proving the catch never ran |
| The timeout row proves the deadline expired inside the try | It asserted only the code, so a deadline that expired **before** the try was entered would have passed it identically. Measured: at `timeoutMs: 1` that is exactly what happens on RT-1 — its deadline starts before linking, so `events` came back empty while the emitted leg had already printed | The fixture gains a leading print inside the try body and the row asserts it survives into the failure envelope on both legs. `timeoutMs` is **20**, the measured window: long enough for RT-1 to link, enter and print, short enough that the 20000-trip loop overruns it. 8/8 deterministic on both legs |
| The emitted `__throwLabel` fail-closed guard is asserted | Only as a **source substring** — the row proved nothing about what the artifact does, and the guard's absence used to throw a raw `TypeError` that escaped the envelope and killed the host. A source fixture cannot reach it, because the payload gate refuses a non-text `message` | New harness pair `emitLinkedProgram` / `withNonTextMessage` splices a non-text `message` into an **already-linked** program and emits it through the same `emitJavaScriptEsm` entrypoint the compiler uses. The row executes that artifact and asserts a failure envelope carrying `uncaught-throw`, and drives the RT-1 clamp over `null`, `integer` and `boolean` messages. RED at base against the pre-guard helper (the child crashed, non-zero exit) |
| **Mutation-found gap** (`agon mutate`, advisory). `compileThrow`'s `assertAsyncCallPosition(value, scope, label, true)` — flipping the `statementValue` flag to `false` **survived** the whole D suite | No row distinguished the flag's two branches. They differ only when the payload IS a `user-call`: with the flag true a bare async call is a legal statement-value continuation and passes the position gate, so the **payload** gate refuses it; with the flag false `containsAsyncCall` sees the call itself and the **position** gate refuses it first | Two rows, mirroring rt5's position gate. `neg-throw-async-call` (`throw value="slow(t)"`, `slow` async by capability) must refuse `KIR_THROW_PAYLOAD_SHAPE`; `neg-throw-async-in-payload` (`throw value="{message: slow(t)}"`, no continuation position) must refuse `KIR_ASYNC_CALL_EXPRESSION_POSITION`. **Kill verified:** flipping the flag to `false` turns `neg-throw-async-call` RED (it reports the async label instead), then restored. A new fixture helper `ASYNC_TEXT_HELPER` is what makes a helper genuinely async — the flag comes from the callee closure carrying a capability, not from a keyword, and D's existing `ASYNC_HELPER` carries none |
| The timeout row's 20ms window is the measured window | It was a **wall-clock bet**: 20ms is only ~3x the 6ms RT-1 needs to link, enter the try and print, and that 6ms is exactly the quantity a loaded CI host inflates. A slow host pushes the deadline past the print and `events` comes back empty, failing the row for the host's speed rather than for the property | **Sized against measurement on both axes.** The window is **250ms**, ~42x the measured 6ms link-and-enter; the fixture's loop is **4,000,000** trips, measured at **2076ms on RT-1** and **1563ms on the emitted leg** -- roughly 8x and 6x the window -- and `maxSteps` is raised to 100,000,000, far past the ~16M the whole loop costs, so the deadline is the only limit that can fire. Verified **8/8 deterministic on both legs** (`execution-timeout` with the print present), and verified still **RED when the deadline is disabled**: at `timeoutMs: null` both legs succeed, which breaks the row's failure assertions. Both loop durations sit inside the child runner's own five-second bound, so the deadline-disabled check fails for the right reason rather than by spawn timeout |
| `emitter.ts` had one line of headroom | The `charged` split fits: the boundary moved into a ternary on the same line it already occupied | `emitter.ts` lands at **494**, `statements.ts` at **440**, `expression.ts` at **468**; all unchanged against their pins |

### Corrections found in the second Codex re-check (2026-09-09, re-checked at `451005b0`)

| Original claim | Reality | Ruling / impact |
|---|---|---|
| **BLOCKER.** The `charged` split makes a deferred return cost exactly what RT-1 charges | `defer` was typed `(value: string)` and **ignored the flag**. Each post-block tail passes `charged: false`, but for a nested finally-bearing `try` the tail's `returnSource` **is the outer `defer`** — which charged again. A return crossing N finallys was billed **N+1** times on the emitted leg against once on RT-1. Measured on `try-finally-nested-print-return`: RT-1 succeeds at **18** execution steps; the emitted leg **failed at 18** after only the inner cleanup and needed **19**. The single-finally row could not see it, because with one finally the only tail is the real `returnSource`, which already honoured the flag | **Fixed:** `defer = (value, charged = true)` emits the boundary only when `charged`, so only the return **site** charges and every tail hands the value outward uncharged, through the next `defer` out. Measured after: both legs succeed at 18 with `['inner','outer']`, and at 17 both fail with the same diagnostic and the same `['inner']` prefix. Row RED at base — and it is the **only** row that goes red, which is what makes it the discriminating one: the single-finally boundary row and all three metering twins stay green under the reverted `defer` |

## Confidence

**0.92**, up from 0.88.

What moved it, in order of weight. **OQ-D1 is closed by measurement, not argument** — and it closed
wider than it was asked to. Ten shapes were driven through rt2's own projection harness against a
built `dist`: the record payload projects with exactly the `entries` shape D-1b gates on, a
text-literal payload projects too (so `KIR_THROW_PAYLOAD_SHAPE` is provably a *link* refusal and not
a projection accident), and `try` projects with `catch`/`finally` as **child clauses** and `props: []`
on the `try` itself — confirming the clause-partition design and D-6g's async-orchestration
discriminator against real output rather than against the catalog alone. The importer shape the whole
of ruling 1 rests on, `for{try{…catch{continue}}}`, was measured projecting before the ruling was
written into the spec. That removes the one deduction that held revision 1 below 0.90.

The five rulings each made the spec smaller or sharper, which is the good direction. Ruling 1
**deleted** machinery: `tryDepth`/`loopTryDepth` are gone, replaced by `finallyDepth`/
`loopFinallyDepth` that do not exist at all until the finally commit, and the jump commit became a
pure admission with no label and no scope field. Ruling 2 turned an untyped optional key into a
declared field with a declared default, which is why `e.code` needs **no** typing change — the
absent-key problem was dissolved rather than solved. Ruling 3 was verified rather than accepted:
one emit entrypoint, one `__module()`, every helper inlined, one literal-typed `'entry.mjs'`, so the
nominal check is sound and the kernel digest stays frozen. Ruling 4 converted an argument
("no miscatch is possible") into a falsifier row. Ruling 5 replaced a chain of reasoning with three
executable gates.

The measurement also produced the finding most likely to have cost real time: **a bare `print` alone
in a nested block is projection-rejected**, identically for `while` and for `try`. Every fixture in
this slice must use the `assign`/`if`-wrapped idiom rt2 already uses, and that is now written down
instead of being rediscovered once per fixture.

What still holds it below 0.95. **OQ-D2**, the metering integers, is unchanged and unchangeable
before the code runs: rt11 and rt12 both shipped arithmetically wrong metering rows in their first
revisions, and the only defence is the hand-counted twin measured in the same run. **OQ-D3**, the
`expression.ts` arm estimate (~54 lines against 94 free), is now the second-largest unknown, though
ruling 1 shrank it — the cross-try comparison left the RT-1 file entirely and the trap-frame drain
path is the only finally-related addition. **OQ-D4** (whether the other three `NEIGHBOUR_GOLDENS`
slices move) is a mechanical re-hash. None of the three sits on a contract row; all three are
measurements the implementer takes.

Nothing above 0.95 is claimable until the oracle exists, has been seen RED at base for one cause per
row, and has been red-teamed per the ORACLE DESIGN GATE. The specific red-team target is the
narrowed jump rule: the oracle must prove both halves — that a jump across a finally-less `try`
*behaves* byte-identically on both legs, and that a jump across a finally-bearing `try` is refused —
because a one-sided oracle here would let the override through on assertion alone.
